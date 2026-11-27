// ماژول سفارش — ایجاد با رزرو اتمیک + ماشین حالت کامل
import { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import { nextNumber } from '@/lib/numbering'
import { resolveOrderPrices } from '@/lib/pricing'
import { reserveStockAtomic, releaseStockAtomic, customerBalance } from '@/lib/inventory'
import { applyDeliveryEffects, notifyLowStockAfterDelivery } from '@/lib/delivery-effects'
import { emitTelegramEvent } from '@/lib/integrations/telegram'
import { audit } from '@/lib/audit'
import { notifyPermissionCodes, notifyUser } from '@/lib/notify'

type Tx = Prisma.TransactionClient
type DbLike = PrismaClient | Tx

export const ORDER_STATUSES = [
  'SUBMITTED', 'RESERVED', 'CONFIRMED', 'CREDIT_APPROVED', 'PAID',
  'PICKING', 'READY_FOR_DISPATCH', 'DISPATCHED', 'DELIVERED', 'COMPLETED',
  'CANCELLED', 'REJECTED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

import { ORDER_STATUS_LABELS } from '@/lib/format'

export const STATUS_LABELS = ORDER_STATUS_LABELS

export type CreateOrderInput = {
  customerId: string
  branchId?: string | null
  payMethod: 'CASH' | 'CREDIT' | 'TRANSFER'
  notes?: string | null
  idempotencyKey?: string | null
  items: Array<{ productId: string; unitId: string; qty: number }>
}

async function getDefaultWarehouseId(tx: DbLike): Promise<string> {
  const wh = await tx.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) throw new ApiError(500, 'NO_WAREHOUSE', 'انبار پیش‌فرض تعریف نشده است')
  return wh.id
}

export async function createOrder(
  user: { id: string; permissions: string[]; roles?: string[] },
  input: CreateOrderInput,
  ip?: string,
) {
  // Idempotency — درخواست تکراری همان سفارش را برمی‌گرداند
  if (input.idempotencyKey) {
    const existing = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
    if (existing) {
      return { order: existing, idempotent: true }
    }
  }

  if (!input.items.length) throw new ApiError(400, 'EMPTY_ORDER', 'سفارش باید حداقل یک قلم داشته باشد')

  const customer = await db.customer.findUnique({ where: { id: input.customerId } })
  if (!customer || customer.status !== 'ACTIVE') {
    throw new ApiError(400, 'CUSTOMER_INACTIVE', 'مشتری یافت نشد یا غیرفعال است')
  }
  // ویزیتور میدانی فقط برای مشتریان مرتبط به خودش (مسئول فروش یا ثبت‌کننده) سفارش ثبت می‌کند
  const isFieldSeller = user.permissions.includes('orders.create') && !user.permissions.includes('orders.confirm')
  if (isFieldSeller && !user.permissions.includes('customers.manage')
    && customer.salesRepId !== user.id && customer.createdById !== user.id) {
    throw new ApiError(403, 'CUSTOMER_NOT_ASSIGNED', 'این مشتری به شما اختصاص ندارد و ثبت سفارش برای آن مجاز نیست')
  }
  if (input.branchId) {
    const branch = await db.customerBranch.findUnique({ where: { id: input.branchId } })
    if (!branch || branch.customerId !== customer.id) {
      throw new ApiError(400, 'BAD_BRANCH', 'شعبه انتخابی معتبر نیست')
    }
  }

  // اعتبارسنجی اقلام + تبدیل به واحد پایه
  type PreparedItem = { productId: string; unitId: string; qty: number; qtyBase: number; unitName: string }
  const prepared: PreparedItem[] = []
  for (const it of input.items) {
    if (!Number.isInteger(it.qty) || it.qty <= 0) {
      throw new ApiError(400, 'BAD_QTY', 'مقدار سفارش باید عدد صحیح مثبت باشد', it)
    }
    const unit = await db.productUnit.findUnique({ where: { id: it.unitId } })
    if (!unit || unit.productId !== it.productId) {
      throw new ApiError(400, 'BAD_UNIT', 'واحد فروش با کالا هم‌خوانی ندارد', it)
    }
    const product = await db.product.findUnique({ where: { id: it.productId } })
    if (!product || !product.isActive) {
      throw new ApiError(400, 'PRODUCT_INACTIVE', 'کالا یافت نشد یا غیرفعال است', it)
    }
    const qtyBase = unit.factor * it.qty
    if (qtyBase < product.minOrderQtyBase) {
      throw new ApiError(400, 'MIN_ORDER', `حداقل سفارش برای «${product.name}» ${product.minOrderQtyBase} واحد پایه است`, it)
    }
    if (product.orderMultipleBase > 1 && qtyBase % product.orderMultipleBase !== 0) {
      throw new ApiError(400, 'ORDER_MULTIPLE', `مضرب مجاز سفارش برای «${product.name}» رعایت نشده است`, it)
    }
    prepared.push({ productId: it.productId, unitId: it.unitId, qty: it.qty, qtyBase, unitName: unit.name })
  }

  // قیمت‌گذاری سمت سرور + Snapshot
  const priced = await resolveOrderPrices(
    prepared.map(p => ({ productId: p.productId, unitId: p.unitId, qtyBase: p.qtyBase })),
    customer.id,
  )
  const lines = prepared.map(p => {
    const price = priced.find(x => x.productId === p.productId && x.unitId === p.unitId)!
    const lineTotal = p.qty * price.priceRls
    return {
      ...p,
      unitPriceRls: price.priceRls,
      lineTotalRls: lineTotal,
      snapshot: JSON.stringify({ ruleId: price.ruleId, scope: price.scope, unitFactor: price.unitFactor, note: price.note, resolvedAt: new Date().toISOString() }),
    }
  })
  const totalRls = lines.reduce((s, l) => s + l.lineTotalRls, 0)
  const itemsCountBase = lines.reduce((s, l) => s + l.qtyBase, 0)

  // بررسی اعتبار مشتری (مانده از Ledger)
  const balance = await customerBalance(db, customer.id)
  if (input.payMethod === 'CREDIT' && customer.creditLimitRls > 0) {
    if (balance + totalRls > customer.creditLimitRls) {
      throw new ApiError(402, 'CREDIT_EXCEEDED',
        'سقف اعتبار مشتری برای این سفارش کافی نیست',
        { balanceRls: balance, creditLimitRls: customer.creditLimitRls, orderTotalRls: totalRls })
    }
  }

  const warehouseId = await getDefaultWarehouseId(db)
  const reserveItems = lines.map(l => ({ productId: l.productId, warehouseId, qtyBase: l.qtyBase }))

  // تراکنش: شماره، سفارش، اقلام، رزرو اتمیک، رویداد وضعیت، اعلان
  const order = await db.$transaction(async tx => {
    const orderNo = await nextNumber(tx, 'ORD')
    const now = new Date()
    const created = await tx.order.create({
      data: {
        orderNo,
        customerId: customer.id,
        branchId: input.branchId ?? null,
        status: 'RESERVED',
        createdById: user.id,
        // visitorId فقط برای ویزیتور واقعی ثبت می‌شود؛ سفارش مدیر/عملیات visitorId ندارد
        visitorId: user.roles?.includes('VISITOR') ? user.id : null,
        payMethod: input.payMethod,
        totalRls,
        discountTotalRls: 0,
        itemsCountBase,
        idempotencyKey: input.idempotencyKey ?? null,
        notes: input.notes ?? null,
        reservedAt: now,
      },
    })
    for (const l of lines) {
      await tx.orderItem.create({
        data: {
          orderId: created.id,
          productId: l.productId,
          unitId: l.unitId,
          qtyBase: l.qtyBase,
          unitName: l.unitName,
          unitPriceRls: l.unitPriceRls,
          lineTotalRls: l.lineTotalRls,
          priceSnapshotJson: l.snapshot,
        },
      })
    }
    await tx.orderStatusEvent.createMany({
      data: [
        { orderId: created.id, fromStatus: null, toStatus: 'SUBMITTED', userId: user.id, note: 'ثبت سفارش' },
        { orderId: created.id, fromStatus: 'SUBMITTED', toStatus: 'RESERVED', userId: user.id, note: 'رزرو اتمیک موجودی در تراکنش ثبت سفارش' },
      ],
    })
    // رزرو اتمیک — در صورت نبود موجودی، کل تراکنش Rollback می‌شود
    await reserveStockAtomic(tx, reserveItems, { refType: 'ORDER', refId: created.id, userId: user.id })
    return created
  })

  await audit({
    userId: user.id, action: 'order.create', entityType: 'Order', entityId: order.id,
    after: { orderNo: order.orderNo, totalRls, customer: customer.code }, ip,
  })
  await notifyPermissionCodes(['orders.confirm'], {
    type: 'ORDER_NEW', title: 'سفارش جدید ثبت شد',
    body: `سفارش ${order.orderNo} برای «${customer.shopName}» به مبلغ ${totalRls.toLocaleString('fa-IR')} ریال`,
    refType: 'ORDER', refId: order.id,
  })
  // یکپارچه‌سازی‌ها — رویداد تلگرام سفارش جدید (اگر فعال باشد؛ هرگز جریان اصلی را نمی‌شکند)
  await emitTelegramEvent('ORDER_NEW', {
    orderNo: order.orderNo,
    customerName: customer.shopName,
    total: totalRls.toLocaleString('fa-IR'),
  })
  return { order, idempotent: false }
}

// ─── ماشین حالت ───
type ActionDef = {
  to: OrderStatus
  perm: string
  from: OrderStatus[]
  requiresDriver?: boolean
  note: string
}

const TRANSITIONS: Record<string, ActionDef> = {
  confirm: { to: 'CONFIRMED', perm: 'orders.confirm', from: ['RESERVED'], note: 'تأیید سفارش' },
  reject: { to: 'REJECTED', perm: 'orders.confirm', from: ['SUBMITTED', 'RESERVED'], note: 'رد سفارش' },
  creditApprove: { to: 'CREDIT_APPROVED', perm: 'orders.creditApprove', from: ['CONFIRMED'], note: 'تأیید اعتبار' },
  markPaid: { to: 'PAID', perm: 'finance.receipts', from: ['CONFIRMED', 'CREDIT_APPROVED', 'DELIVERED'], note: 'ثبت پرداخت سفارش' },
  startPicking: { to: 'PICKING', perm: 'inventory.issue', from: ['PAID', 'CREDIT_APPROVED'], note: 'شروع آماده‌سازی' },
  readyForDispatch: { to: 'READY_FOR_DISPATCH', perm: 'inventory.issue', from: ['PICKING'], note: 'آماده‌سازی کامل شد' },
  dispatch: { to: 'DISPATCHED', perm: 'deliveries.manage', from: ['READY_FOR_DISPATCH'], requiresDriver: true, note: 'خروج از انبار و ارسال' },
  deliver: { to: 'DELIVERED', perm: 'inventory.issue', from: ['DISPATCHED'], note: 'تحویل به مشتری و خروج فیزیکی کالا' },
  complete: { to: 'COMPLETED', perm: 'orders.confirm', from: ['DELIVERED', 'PAID'], note: 'بستن سفارش' },
  cancel: {
    to: 'CANCELLED', perm: 'orders.cancel',
    from: ['SUBMITTED', 'RESERVED', 'CONFIRMED', 'CREDIT_APPROVED', 'PAID', 'PICKING', 'READY_FOR_DISPATCH'],
    note: 'لغو سفارش',
  },
}

// نقش مجری رویدادهای ماشین حالت (مصوبهٔ فاز ۰-③) — مسیر انبار=WAREHOUSE، راننده=DELIVERY (در deliveries.ts)،
// رویدادهای خودکار=SYSTEM؛ اقدامات دفتری (تأیید/پرداخت/لغو/…) بدون نقش → در نمایش SYSTEM
const ACTOR_ROLE_BY_ACTION: Partial<Record<string, 'WAREHOUSE' | 'DELIVERY'>> = {
  dispatch: 'WAREHOUSE', deliver: 'WAREHOUSE', complete: 'WAREHOUSE',
}

export async function transitionOrder(
  user: { id: string; permissions: string[] },
  orderId: string,
  action: string,
  opts: { driverId?: string | null; note?: string | null },
  ip?: string,
) {
  const def = TRANSITIONS[action]
  if (!def) throw new ApiError(400, 'BAD_ACTION', 'اقدام نامعتبر است')
  if (!user.permissions.includes(def.perm)) {
    await audit({ userId: user.id, action: `order.${action}`, entityType: 'Order', entityId: orderId, ip, result: 'DENIED' })
    throw new ApiError(403, 'FORBIDDEN', 'دسترسی لازم برای این اقدام را ندارید')
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, customer: true },
  })
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'سفارش یافت نشد')
  if (!def.from.includes(order.status as OrderStatus)) {
    throw new ApiError(409, 'BAD_STATE',
      `این اقدام از وضعیت «${STATUS_LABELS[order.status] ?? order.status}» امکان‌پذیر نیست`,
      { current: order.status, allowedFrom: def.from })
  }
  if (def.requiresDriver && !opts.driverId) {
    throw new ApiError(400, 'DRIVER_REQUIRED', 'برای ارسال، انتخاب راننده الزامی است')
  }

  const warehouseId = await getDefaultWarehouseId(db)
  const reserveItems = order.items.map(i => ({ productId: i.productId, warehouseId, qtyBase: i.qtyBase }))

  // گارد مسیر انبار (مصوبهٔ فاز ۱ — اصلاحیهٔ ۴): اگر مأموریت پخش «در جریان» (IN_PROGRESS) باشد،
  // خروج فیزیکی از مسیر انبار مجاز نیست و تحویل باید توسط راننده ثبت شود.
  // مأموریت PENDING قفل نمی‌کند — تخصیص ≠ شروع فیزیکی.
  if (action === 'deliver') {
    const activeAssignment = await db.deliveryAssignment.findFirst({
      where: { orderId: order.id, status: 'IN_PROGRESS' },
    })
    if (activeAssignment) {
      throw new ApiError(409, 'ACTIVE_DELIVERY_ASSIGNMENT',
        'مأموریت پخش این سفارش در جریان است؛ تحویل باید از مسیر راننده ثبت شود',
        { assignmentId: activeAssignment.id })
    }
  }

  await db.$transaction(async tx => {
    const now = new Date()

    if (action === 'deliver') {
      // نقطهٔ واحد تحویل — منطق مشترک مسیر انبار/راننده (src/lib/delivery-effects.ts):
      // وضعیت → DELIVERED + رویداد (actorRole=WAREHOUSE) + خروج FEFO + فاکتور + Ledger INVOICE
      await applyDeliveryEffects(tx, order.id, {
        source: 'WAREHOUSE', actorRole: 'WAREHOUSE', userId: user.id,
        note: opts.note ?? def.note,
      })
    } else {
      const data: Prisma.OrderUpdateInput = { status: def.to }

      if (action === 'dispatch') {
        data.dispatchedAt = now
        if (opts.driverId) {
          const driver = await tx.user.findUnique({ where: { id: opts.driverId } })
          if (!driver) throw new ApiError(400, 'BAD_DRIVER', 'راننده معتبر نیست')
          data.driverId = opts.driverId
        }
      }
      if (action === 'complete') data.completedAt = now
      if (action === 'confirm') data.confirmedAt = now
      if (action === 'markPaid') data.paidAt = now
      if (action === 'cancel') data.cancelledAt = now

      await tx.order.update({ where: { id: order.id }, data })

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id, fromStatus: order.status, toStatus: def.to,
          actorRole: ACTOR_ROLE_BY_ACTION[action] ?? null,
          userId: user.id, note: opts.note ?? def.note,
        },
      })

      switch (action) {
        case 'reject':
        case 'cancel': {
          // آزادسازی کنترل‌شده رزرو (اگر هنوز خروج فیزیکی نشده)
          if (['SUBMITTED', 'RESERVED', 'CONFIRMED', 'CREDIT_APPROVED', 'PAID', 'PICKING', 'READY_FOR_DISPATCH'].includes(order.status)) {
            await releaseStockAtomic(tx, reserveItems, {
              refType: 'ORDER', refId: order.id, userId: user.id,
              note: action === 'cancel' ? 'آزادسازی به دلیل لغو سفارش' : 'آزادسازی به دلیل رد سفارش',
            })
          }
          // اگر پرداخت پیشین ثبت شده بود، سند اصلاحی منفی در Ledger ثبت شود
          if (['PAID'].includes(order.status)) {
            await tx.customerLedger.create({
              data: {
                customerId: order.customerId, entryType: 'ADJUST',
                amountRls: -order.totalRls,
                refType: 'ORDER', refId: order.id,
                description: `سند اصلاحی لغو سفارش ${order.orderNo}`,
                userId: user.id,
              },
            })
          }
          break
        }
        case 'markPaid': {
          // دریافت وجه سفارش — اصلاح دوگانه‌ثبتی (مصوبهٔ فاز ۱ — اصلاحیهٔ ۱):
          //  • اگر فاکتور در لحظهٔ تحویل صادر شده و ISSUED است → فقط وضعیتش PAID می‌شود
          //  • سند INVOICE هرگز این‌جا تکرار نمی‌شود (INVOICE فقط یک‌بار در تحویل ثبت شده)
          //  • این‌جا فقط Receipt + سند RECEIPT ثبت می‌شود
          const existingInvoice = await tx.invoice.findUnique({ where: { orderId: order.id } })
          if (existingInvoice && existingInvoice.status === 'ISSUED') {
            await tx.invoice.update({ where: { id: existingInvoice.id }, data: { status: 'PAID' } })
          }
          // سناریوی مصوب بخش C (PAID ← COMPLETED): مأموریت تحویل‌شدهٔ اعتباری همین سفارش با تسویه → PAID
          // (فقط وضعیت DELIVERED هدف است؛ مأموریت‌های دیگر دست‌نخورده می‌مانند — پیش‌پرداخت از قبل PAID است)
          await tx.deliveryAssignment.updateMany({
            where: { orderId: order.id, status: 'DELIVERED' },
            data: { status: 'PAID' },
          }
          const receiptNo = await nextNumber(tx, 'RCP')
          const receipt = await tx.receipt.create({
            data: {
              receiptNo, customerId: order.customerId, amountRls: order.totalRls,
              method: order.payMethod === 'CASH' ? 'CASH' : 'TRANSFER',
              userId: user.id,
              note: `دریافت بابت سفارش ${order.orderNo}`,
            },
          })
          await tx.customerLedger.create({
            data: {
              customerId: order.customerId, entryType: 'RECEIPT',
              amountRls: -order.totalRls,
              refType: 'RECEIPT', refId: receipt.id,
              description: `دریافت ${receiptNo} بابت سفارش ${order.orderNo}`,
              userId: user.id,
            },
          })
          break
        }
      }
    }
  })

  // اعلان‌ها و Audit (خارج از تراکنش)
  await audit({
    userId: user.id, action: `order.${action}`, entityType: 'Order', entityId: order.id,
    before: { status: order.status }, after: { status: def.to }, ip,
  })
  if (def.to === 'DELIVERED') {
    // هشدار کم‌موجودی پس از خروج فیزیکی — مشترک بین دو مسیر (انبار/راننده)
    await notifyLowStockAfterDelivery(order.items, warehouseId)
  }
  if (order.visitorId && order.visitorId !== user.id) {
    await notifyUser(order.visitorId, {
      type: 'ORDER_CONFIRMED', title: 'وضعیت سفارش تغییر کرد',
      body: `سفارش ${order.orderNo}: ${STATUS_LABELS[order.status] ?? order.status} → ${STATUS_LABELS[def.to]}`,
      refType: 'ORDER', refId: order.id,
    })
  }

  const fresh = await db.order.findUnique({ where: { id: order.id } })
  return fresh!
}

// موجودی قابل فروش برای کاتالوگ سفارش‌گیری
export async function availableForProducts(productIds: string[], warehouseId: string) {
  const balances = await db.inventoryBalance.findMany({
    where: { productId: { in: productIds }, warehouseId },
  })
  const map: Record<string, number> = {}
  for (const b of balances) map[b.productId] = b.physicalQtyBase - b.reservedQtyBase
  return map
}
