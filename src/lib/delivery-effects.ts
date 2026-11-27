// افکت‌های تحویل — نقطهٔ واحد منطقِ «تحویل سفارش» برای هر دو مسیر:
//   • مسیر انبار: transitionOrder در orders.ts (اکشن deliver) با source: 'WAREHOUSE'
//   • مسیر راننده: completeDelivery در deliveries.ts با source: 'DRIVER'
//
// چرا این انتزاع؟ نگهداری دو نسخه از منطق FEFO + فاکتور + Ledger یعنی هر تغییر آینده
// باید دو جا اعمال شود (تصمیم طراحی مصوب فاز ۱). هر دو مسیر دقیقاً از همین تابع
// استفاده می‌کنند و هیچ مسیر دیگری حق صدور فاکتور یا خروج FEFO برای سفارش ندارد.
//
// مسئولیت‌های applyDeliveryEffects (داخل تراکنشِ فراخوان):
//   ۱) وضعیت سفارش → DELIVERED + deliveredAt + رویداد وضعیت با actorRole الزامی
//   ۲) خروج فیزیکی کالا با FEFO + کاهش رزرو (نقطهٔ واحد خروج کالا از انبار)
//   ۳) صدور فاکتور + ثبت بدهی در دفتر مشتری (Ledger INVOICE — فقط همین‌جا)
import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api'
import { nextNumber } from '@/lib/numbering'
import { issueStockFEFO, checkLowStock } from '@/lib/inventory'
import { db } from '@/lib/db'
import { notifyPermissionCodes } from '@/lib/notify'
import { emitTelegramEvent } from '@/lib/integrations/telegram'
import { isOnSpotPayment } from '@/lib/delivery-shared'
import type { DeliveryActorRole, DeliverySource, DriverPaymentMethod } from '@/lib/delivery-shared'

type Tx = Prisma.TransactionClient

const DEFAULT_DELIVERY_NOTE: Record<DeliverySource, string> = {
  WAREHOUSE: 'تحویل به مشتری و خروج فیزیکی کالا',
  DRIVER: 'تحویل توسط راننده در مسیر پخش',
}

export type ApplyDeliveryEffectsOpts = {
  source: DeliverySource
  actorRole: DeliveryActorRole
  userId: string
  /** روش پرداخت در لحظهٔ تحویل (مسیر راننده)؛ CREDIT یعنی وجهی دریافت نشده */
  paymentMethod?: DriverPaymentMethod
  /** شماره مرجع کارت‌به‌کارت/POS — در سند دریافتِ مسیر راننده ثبت می‌شود، نه در افکت‌ها */
  paymentReference?: string | null
  note?: string | null
}

export type DeliveryEffectsResult = {
  invoiceId: string
  invoiceNo: string
  invoiceStatus: 'PAID' | 'ISSUED'
}

/**
 * افکت‌های تحویل — باید داخل تراکنش صدا زده شود (tx پاس داده می‌شود).
 * برگشتی: مشخصات فاکتور صادرشده.
 *
 * وضعیت فاکتور:
 *  • پرداخت در محل (paymentMethod ≠ CREDIT) → PAID
 *  • پرداخت پیشین (order.paidAt ثبت شده — نقدیِ پیش‌پرداخت) → PAID
 *  • اعتباری (تسویهٔ بعدی) → ISSUED (بعداً markPaid اصلاح‌شده آن را PAID می‌کند)
 */
export async function applyDeliveryEffects(
  tx: Tx,
  orderId: string,
  opts: ApplyDeliveryEffectsOpts,
): Promise<DeliveryEffectsResult> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'سفارش یافت نشد')
  if (!order.items.length) throw new ApiError(400, 'EMPTY_ORDER', 'سفارش اقلامی ندارد')

  const wh = await tx.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) throw new ApiError(500, 'NO_WAREHOUSE', 'انبار پیش‌فرض تعریف نشده است')

  const now = new Date()

  // ۱) وضعیت سفارش + رویداد وضعیت — actorRole طبق مصوبهٔ فاز ۰ همیشه در کد پر می‌شود
  await tx.order.update({
    where: { id: order.id },
    data: { status: 'DELIVERED', deliveredAt: now },
  })
  await tx.orderStatusEvent.create({
    data: {
      orderId: order.id, fromStatus: order.status, toStatus: 'DELIVERED',
      actorRole: opts.actorRole, userId: opts.userId,
      note: opts.note ?? DEFAULT_DELIVERY_NOTE[opts.source],
    },
  })

  // ۲) خروج فیزیکی کالا — FEFO + کاهش رزرو (نقطهٔ واحد خروج؛ مسیر انبار و راننده هر دو این‌جا هستند)
  const reserveItems = order.items.map(i => ({ productId: i.productId, warehouseId: wh.id, qtyBase: i.qtyBase }))
  await issueStockFEFO(tx, reserveItems, {
    refType: 'ORDER', refId: order.id, userId: opts.userId,
    note: `خروج فیزیکی بابت سفارش ${order.orderNo}`,
  })

  // ۳) فاکتور + ثبت بدهی در دفتر مشتری — سند INVOICE فقط و فقط همین‌جا ثبت می‌شود
  const invoiceNo = await nextNumber(tx, 'INV')
  const invoiceStatus: 'PAID' | 'ISSUED' =
    (isOnSpotPayment(opts.paymentMethod) || order.paidAt != null) ? 'PAID' : 'ISSUED'
  const invoice = await tx.invoice.create({
    data: {
      invoiceNo, orderId: order.id, customerId: order.customerId,
      totalRls: order.totalRls, status: invoiceStatus,
    },
  })
  await tx.customerLedger.create({
    data: {
      customerId: order.customerId, entryType: 'INVOICE',
      amountRls: order.totalRls,
      refType: 'INVOICE', refId: invoice.id,
      description: `فاکتور ${invoiceNo} بابت سفارش ${order.orderNo}`,
      userId: opts.userId,
    },
  })

  return { invoiceId: invoice.id, invoiceNo, invoiceStatus }
}

/**
 * هشدار کم‌موجودی پس از خروج فیزیکی — بیرون از تراکنش، مشترک بین دو مسیر.
 * خطا هرگز جریان اصلی را نمی‌شکند (مشابق رفتار پیشین transitionOrder).
 */
export async function notifyLowStockAfterDelivery(
  items: Array<{ productId: string }>,
  warehouseId: string,
) {
  for (const it of items) {
    const low = await checkLowStock(db, it.productId, warehouseId)
    if (low) {
      await notifyPermissionCodes(['inventory.receive', 'products.manage'], {
        type: 'LOW_STOCK', title: 'هشدار کم‌موجودی',
        body: `«${low.productName}» به نقطه سفارش رسید (قابل فروش: ${low.availableBase})`,
        refType: 'PRODUCT', refId: low.productId,
      })
      // یکپارچه‌سازی‌ها — رویداد تلگرام کم‌موجودی (اگر فعال باشد؛ هرگز جریان اصلی را نمی‌شکند)
      await emitTelegramEvent('LOW_STOCK', {
        productName: low.productName,
        available: low.availableBase,
        reorderPoint: low.reorderPoint,
      })
    }
  }
}

void Prisma
