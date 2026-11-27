// منطق مأموریت پخش (DeliveryAssignment) — تخصیص، شروع، تحویل/دریافت وجه، مرجوعی، لغو
//
// قواعد مصوب فاز ۱:
//  • تخصیص فقط از READY_FOR_DISPATCH یا DISPATCHED و حداکثر یک مأموریت فعال
//    (PENDING | IN_PROGRESS) برای هر سفارش — مأموریت‌های تمام‌شده/لغوشده مانع تخصیص مجدد نیستند.
//  • شروع مأموریت فقط وقتی سفارش DISPATCHED است (خروج واقعی از انبار) و فقط توسط رانندهٔ همان مأموریت.
//  • تحویل راننده از applyDeliveryEffects مشترک (source: 'DRIVER') استفاده می‌کند:
//      – پرداخت در محل (CASH/CARD_TO_CARD/POS/OTHER) → سفارش تا COMPLETED می‌رود (مصوبهٔ فاز ۰-④)
//      – اعتباری (CREDIT) → سفارش در DELIVERED می‌ماند؛ تسویه با markPaid اصلاح‌شده در finance
//      – سفارشِ پیش‌پرداخت‌شده (paidAt ثبت شده) → بعد از تحویل، COMPLETED
//  • مرجوعی راننده فقط reason (۵ کد مصوب)؛ disposition اقلام PENDING می‌ماند تا بررسی انبار؛
//    سفارش در DISPATCHED می‌ماند تا امکان مأموریت مجدد باشد (مصوبهٔ پرسش‌های باز فاز ۱).
//  • مسیر انبار فقط وقتی مأموریت IN_PROGRESS است قفل می‌شود (گارد در orders.ts — اصلاحیهٔ ۴).
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import { nextNumber } from '@/lib/numbering'
import { audit } from '@/lib/audit'
import { notifyPermissionCodes, notifyUser } from '@/lib/notify'
import { applyDeliveryEffects, notifyLowStockAfterDelivery } from '@/lib/delivery-effects'
import {
  ACTIVE_ASSIGNMENT_STATUSES, DRIVER_PAYMENT_METHODS, RETURN_REASONS, isOnSpotPayment,
} from '@/lib/delivery-shared'
import type { DriverPaymentMethod, DeliveryReturnReason } from '@/lib/delivery-shared'

type PermUser = { id: string; permissions: string[] }

function requirePermOf(user: PermUser, perm: string) {
  if (!user.permissions.includes(perm)) {
    throw new ApiError(403, 'FORBIDDEN', 'دسترسی لازم برای این عملیات را ندارید')
  }
}

function assertOneOf(code: string, value: string, allowed: readonly string[], message: string) {
  if (!allowed.includes(value)) {
    throw new ApiError(400, code, message, { allowed, received: value })
  }
}

// ─────────────────────────── تخصیص مأموریت (مدیر/مسئول ارسال) ───────────────────────────

export async function createAssignment(
  user: PermUser,
  input: { orderId: string; deliveryUserId: string; notes?: string | null },
  ip?: string,
) {
  requirePermOf(user, 'deliveries.manage')

  const order = await db.order.findUnique({ where: { id: input.orderId } })
  if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'سفارش یافت نشد')
  if (!['READY_FOR_DISPATCH', 'DISPATCHED'].includes(order.status)) {
    throw new ApiError(409, 'ASSIGNMENT_BAD_STATE',
      `تخصیص فقط برای سفارش «آماده ارسال» یا «ارسال شده» مجاز است (وضعیت فعلی: ${order.status})`,
      { current: order.status })
  }

  const driver = await db.user.findUnique({
    where: { id: input.deliveryUserId },
    include: { roles: { include: { role: true } } },
  })
  if (!driver || !driver.isActive) throw new ApiError(400, 'BAD_DRIVER', 'راننده یافت نشد یا غیرفعال است')
  if (!driver.roles.some(r => r.role.name === 'DRIVER')) {
    throw new ApiError(400, 'NOT_A_DRIVER', 'کاربر انتخابی نقش راننده ندارد')
  }

  // حداکثر یک مأموریت فعال برای هر سفارش
  const active = await db.deliveryAssignment.findFirst({
    where: { orderId: order.id, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
  })
  if (active) {
    throw new ApiError(409, 'ASSIGNMENT_ACTIVE',
      'این سفارش یک مأموریت پخش فعال دارد؛ ابتدا آن را لغو کنید یا منتظر پایان آن بمانید',
      { assignmentId: active.id, status: active.status })
  }

  const assignment = await db.deliveryAssignment.create({
    data: {
      orderId: order.id,
      deliveryUserId: input.deliveryUserId,
      assignedById: user.id,
      notes: input.notes ?? null,
    },
  })

  await audit({
    userId: user.id, action: 'delivery.assign', entityType: 'DeliveryAssignment', entityId: assignment.id,
    after: { orderId: order.id, orderNo: order.orderNo, deliveryUserId: input.deliveryUserId }, ip,
  })

  // اعلان DELIVERY_ASSIGNED — مصوبهٔ فاز ۰ (گزینهٔ تأییدشده)
  await notifyUser(input.deliveryUserId, {
    type: 'DELIVERY_ASSIGNED', title: 'مأموریت پخش جدید',
    body: `سفارش ${order.orderNo} برای تحویل به شما تخصیص یافت`,
    refType: 'ORDER', refId: order.id,
  })

  return assignment
}

// ─────────────────────────── شروع مأموریت (راننده) ───────────────────────────

export async function startAssignment(
  user: PermUser,
  assignmentId: string,
  ip?: string,
  idempotencyKey?: string | null, // کلید ایدمپوتنت سمت کلاینت (بخش D) — فقط برای ردیابی در AuditLog؛ ضمانت اثرِ تکی با claim وضعیت
) {
  requirePermOf(user, 'deliveries.complete')

  const assignment = await db.deliveryAssignment.findUnique({
    where: { id: assignmentId },
    include: { order: true },
  })
  if (!assignment) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'مأموریت یافت نشد')
  // scoping — راننده فقط مأموریت خودش را شروع می‌کند
  if (assignment.deliveryUserId !== user.id) {
    throw new ApiError(403, 'ASSIGNMENT_NOT_YOURS', 'این مأموریت به شما تخصیص نیافته است')
  }
  if (assignment.status !== 'PENDING') {
    throw new ApiError(409, 'BAD_STATE',
      'شروع مأموریت فقط از وضعیت «تخصیص داده‌شده» ممکن است', { current: assignment.status })
  }
  if (assignment.order.status !== 'DISPATCHED') {
    throw new ApiError(409, 'ORDER_NOT_DISPATCHED',
      'سفارش هنوز از انبار خارج نشده است؛ شروع مأموریت پس از «ارسال شده» مجاز است',
      { current: assignment.order.status })
  }

  const updated = await db.$transaction(async tx => {
    // claim اتمیک (بخش C — idempotency): فقط از PENDING؛ تکرار/شلیک هم‌زمان فقط یک‌بار اثر می‌گذارد
    const claimed = await tx.deliveryAssignment.updateMany({
      where: { id: assignment.id, status: 'PENDING' },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    })
    if (claimed.count === 0) {
      throw new ApiError(409, 'BAD_STATE', 'وضعیت مأموریت هم‌اکنون تغییر کرده است', { current: assignment.status })
    }
    const u = await tx.deliveryAssignment.findUniqueOrThrow({ where: { id: assignment.id } })
    // هم‌گام‌سازی رانندهٔ سفارش با مأموریتِ در جریان (مرجع عملیاتی، مأموریت است)
    await tx.order.update({ where: { id: assignment.orderId }, data: { driverId: assignment.deliveryUserId } })
    return u
  })

  await audit({
    userId: user.id, action: 'delivery.start', entityType: 'DeliveryAssignment', entityId: assignment.id,
    before: { status: 'PENDING' },
    after: { status: 'IN_PROGRESS', orderNo: assignment.order.orderNo, idempotencyKey: idempotencyKey ?? null }, ip,
  })

  return updated
}

// ─────────────────────────── تحویل + دریافت وجه (راننده) ───────────────────────────

export type CompleteDeliveryInput = {
  paymentMethod?: DriverPaymentMethod
  paymentReference?: string | null
  notes?: string | null
  idempotencyKey?: string | null // کلید ایدمپوتنت سمت کلاینت (بخش D) — فقط برای ردیابی در AuditLog
}

export async function completeDelivery(
  user: PermUser,
  assignmentId: string,
  input: CompleteDeliveryInput,
  ip?: string,
) {
  requirePermOf(user, 'deliveries.complete')
  if (input.paymentMethod != null) {
    assertOneOf('BAD_PAYMENT_METHOD', input.paymentMethod, DRIVER_PAYMENT_METHODS,
      'روش پرداخت نامعتبر است')
  }

  const assignment = await db.deliveryAssignment.findUnique({
    where: { id: assignmentId },
    include: { order: { include: { items: true } } },
  })
  if (!assignment) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'مأموریت یافت نشد')
  if (assignment.deliveryUserId !== user.id) {
    throw new ApiError(403, 'ASSIGNMENT_NOT_YOURS', 'این مأموریت به شما تخصیص نیافته است')
  }
  if (assignment.status !== 'IN_PROGRESS') {
    throw new ApiError(409, 'BAD_STATE',
      'ثبت تحویل فقط برای مأموریت «در مسیر پخش» ممکن است', { current: assignment.status })
  }
  if (assignment.order.status !== 'DISPATCHED') {
    throw new ApiError(409, 'ORDER_NOT_DISPATCHED',
      'این سفارش در وضعیت قابل تحویل نیست', { current: assignment.order.status })
  }

  const order = assignment.order
  // روش پرداخت: صریح از ورودی؛ برای سفارش اعتباری پیش‌فرض CREDIT؛
  // برای سفارشِ پرداخت‌نشدهٔ نقدی، ثبت روش پرداخت الزامی است.
  let method = input.paymentMethod ?? null
  if (method == null && order.payMethod === 'CREDIT') method = 'CREDIT'
  if (method == null && order.paidAt == null) {
    throw new ApiError(400, 'PAYMENT_METHOD_REQUIRED',
      'برای سفارشِ پرداخت‌نشده، ثبت روش پرداخت در محل الزامی است')
  }

  const onSpot = isOnSpotPayment(method)
  const alreadyPaid = order.paidAt != null
  // گارد تسویهٔ پیشین (بخش C — ضد دوگانه‌ثبتی وجه): سفارشِ تسویه‌شده پرداختِ در محل نمی‌پذیرد؛
  // وگرنه رسید دوم بابت همان سفارش ثبت می‌شد. تحویل بدون پرداخت مجدد ادامه می‌یابد (paidAt → COMPLETED).
  if (alreadyPaid && method != null && method !== 'CREDIT') {
    throw new ApiError(400, 'PAYMENT_ALREADY_SETTLED',
      'این سفارش پیش‌تر تسویه شده است؛ ثبت پرداخت در محل مجاز نیست')
  }

  const result = await db.$transaction(async tx => {
    // ۱) وضعیت مأموریت — PAID اگر وجه این‌جا یا پیش‌تر دریافت شده؛ DELIVERED برای اعتباری
    // claim اتمیک (بخش C — idempotency): فقط از IN_PROGRESS؛ لغو/تکمیل هم‌زمان از این‌جا رد می‌شود
    const claimed = await tx.deliveryAssignment.updateMany({
      where: { id: assignment.id, status: 'IN_PROGRESS' },
      data: {
        status: (onSpot || alreadyPaid) ? 'PAID' : 'DELIVERED',
        paymentMethod: method,
        paymentReference: input.paymentReference ?? null,
        notes: input.notes ?? assignment.notes,
        completedAt: new Date(),
      },
    })
    if (claimed.count === 0) {
      throw new ApiError(409, 'BAD_STATE', 'وضعیت مأموریت هم‌اکنون تغییر کرده است', { current: assignment.status })
    }
    const updated = await tx.deliveryAssignment.findUniqueOrThrow({ where: { id: assignment.id } })

    // ۲) افکت‌های تحویل — نقطهٔ واحد مشترک (source: 'DRIVER') → DELIVERED + FEFO + فاکتور + Ledger INVOICE
    const effects = await applyDeliveryEffects(tx, order.id, {
      source: 'DRIVER', actorRole: 'DELIVERY', userId: user.id,
      paymentMethod: method ?? undefined,
      note: input.notes ?? undefined,
    })

    // ۳) سند دریافت وجه در محل — فقط اگر واقعاً وجه این‌جا گرفته شد
    if (onSpot) {
      const receiptNo = await nextNumber(tx, 'RCP')
      const receipt = await tx.receipt.create({
        data: {
          receiptNo, customerId: order.customerId, amountRls: order.totalRls,
          method: method!, // CASH | CARD_TO_CARD | POS | OTHER
          refNo: input.paymentReference ?? null,
          userId: user.id,
          note: `دریافت در محل بابت سفارش ${order.orderNo}`,
        },
      })
      await tx.customerLedger.create({
        data: {
          customerId: order.customerId, entryType: 'RECEIPT',
          amountRls: -order.totalRls,
          refType: 'RECEIPT', refId: receipt.id,
          description: `دریافت ${receiptNo} در محل بابت سفارش ${order.orderNo}`,
          userId: user.id,
        },
      })
    }

    // ۴) مصوبهٔ فاز ۰-④ — سفارشِ تسویه‌شده (پرداخت در محل یا پیشین) تا COMPLETED می‌رود؛
    //    اعتباری در DELIVERED می‌ماند تا finance با markPaid اصلاح‌شده تسویه کند.
    let finalOrderStatus: 'DELIVERED' | 'COMPLETED' = 'DELIVERED'
    if (onSpot || alreadyPaid) {
      finalOrderStatus = 'COMPLETED'
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id, fromStatus: 'DELIVERED', toStatus: 'COMPLETED',
          actorRole: 'DELIVERY', userId: user.id,
          note: onSpot ? 'تکمیل توسط راننده — پرداخت در محل' : 'تکمیل توسط راننده — پرداخت پیشین',
        },
      })
    }

    return { assignment: updated, effects, finalOrderStatus }
  })

  // AuditLog اجباری برای اقدامات راننده (مصوبهٔ فاز ۰-④)
  await audit({
    userId: user.id, action: 'delivery.complete', entityType: 'DeliveryAssignment', entityId: assignment.id,
    before: { status: 'IN_PROGRESS', orderStatus: 'DISPATCHED' },
    after: {
      status: result.assignment.status, orderStatus: result.finalOrderStatus,
      invoiceNo: result.effects.invoiceNo, invoiceStatus: result.effects.invoiceStatus,
      paymentMethod: method, paymentReference: input.paymentReference ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    }, ip,
  })

  // اعلان به مدیران پخش/مالی
  await notifyPermissionCodes(['deliveries.manage'], {
    type: onSpot ? 'PAYMENT' : 'ORDER_CONFIRMED',
    title: onSpot ? 'تحویل با دریافت وجه در محل' : 'تحویل سفارش اعتباری توسط راننده',
    body: `سفارش ${order.orderNo} توسط راننده تحویل شد${onSpot ? ' و وجه در محل دریافت شد' : ' (تسویه اعتباری در انتظار finance)'}`,
    refType: 'ORDER', refId: order.id,
  })

  // هشدار کم‌موجودی — مشترک با مسیر انبار
  const wh = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (wh) await notifyLowStockAfterDelivery(order.items, wh.id)

  return result
}

// ─────────────────────────── مرجوعی در مسیر پخش (راننده) ───────────────────────────

export async function recordDeliveryReturn(
  user: PermUser,
  assignmentId: string,
  input: { reason: DeliveryReturnReason; notes?: string | null; idempotencyKey?: string | null },
  ip?: string,
) {
  requirePermOf(user, 'deliveries.return')
  // اصلاحیهٔ ۵ — فرم راننده فقط reason دارد (۵ کد مصوب)
  assertOneOf('BAD_RETURN_REASON', input.reason, RETURN_REASONS, 'دلیل مرجوعی نامعتبر است')

  const assignment = await db.deliveryAssignment.findUnique({
    where: { id: assignmentId },
    include: { order: { include: { items: true } } },
  })
  if (!assignment) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'مأموریت یافت نشد')
  if (assignment.deliveryUserId !== user.id) {
    throw new ApiError(403, 'ASSIGNMENT_NOT_YOURS', 'این مأموریت به شما تخصیص نیافته است')
  }
  if (assignment.status !== 'IN_PROGRESS') {
    throw new ApiError(409, 'BAD_STATE',
      'ثبت مرجوعی فقط برای مأموریت «در مسیر پخش» ممکن است', { current: assignment.status })
  }
  if (assignment.order.status !== 'DISPATCHED') {
    throw new ApiError(409, 'ORDER_NOT_DISPATCHED',
      'مرجوعی فقط برای سفارشِ خارج‌شده از انبار (ارسال شده) ثبت می‌شود',
      { current: assignment.order.status })
  }

  const order = assignment.order
  const result = await db.$transaction(async tx => {
    // claim اتمیک (بخش C — idempotency): فقط از IN_PROGRESS و پیش از ساخت سند مرجوعی؛
    // تکرار/شلیک هم‌زمان یعنی درخواست مرجوعی تکراری ثبت نمی‌شود (کاهش در صورت شکست rollback می‌شود)
    const claimed = await tx.deliveryAssignment.updateMany({
      where: { id: assignment.id, status: 'IN_PROGRESS' },
      data: {
        status: 'RETURNED',
        failureReason: input.reason,
        notes: input.notes ?? assignment.notes,
        completedAt: new Date(),
      },
    })
    if (claimed.count === 0) {
      throw new ApiError(409, 'BAD_STATE', 'وضعیت مأموریت هم‌اکنون تغییر کرده است', { current: assignment.status })
    }
    // درخواست مرجوعی کل سفارش — اقلام با disposition=PENDING برای بررسی انبار (اصلاحیهٔ ۵)
    const returnNo = await nextNumber(tx, 'RET')
    const returnRequest = await tx.returnRequest.create({
      data: {
        returnNo, orderId: order.id, customerId: order.customerId,
        status: 'REQUESTED', reason: input.reason,
      },
    })
    await tx.returnItem.createMany({
      data: order.items.map(i => ({
        returnRequestId: returnRequest.id,
        productId: i.productId,
        unitId: i.unitId,
        qtyBase: i.qtyBase,
        reason: input.reason,
        disposition: 'PENDING',
      })),
    })
    const updated = await tx.deliveryAssignment.findUniqueOrThrow({ where: { id: assignment.id } })
    return { returnRequest, assignment: updated }
  })

  // سفارش در DISPATCHED می‌ماند (مصوبه) — بدون رویداد جدید ماشین حالت؛
  // امکان تخصیص مأموریت مجدد (تلاش دوم) باز است و مسیر انبار هم قفل نیست.
  await audit({
    userId: user.id, action: 'delivery.return', entityType: 'DeliveryAssignment', entityId: assignment.id,
    before: { status: 'IN_PROGRESS' },
    after: {
      status: 'RETURNED', reason: input.reason, returnNo: result.returnRequest.returnNo,
      orderNo: order.orderNo, orderStatus: 'DISPATCHED', idempotencyKey: input.idempotencyKey ?? null,
    }, ip,
  })

  await notifyPermissionCodes(['returns.manage', 'deliveries.manage'], {
    type: 'RETURN', title: 'مرجوعی در مسیر پخش ثبت شد',
    body: `سفارش ${order.orderNo} با دلیل «${input.reason}» مرجوع شد؛ در انتظار بررسی انبار`,
    refType: 'RETURN', refId: result.returnRequest.id,
  })

  return result
}

// ─────────────────────────── لغو مأموریت (مدیر) ───────────────────────────

export async function cancelAssignment(
  user: PermUser,
  assignmentId: string,
  input: { reason?: string | null; idempotencyKey?: string | null },
  ip?: string,
) {
  requirePermOf(user, 'deliveries.manage')

  const assignment = await db.deliveryAssignment.findUnique({
    where: { id: assignmentId },
    include: { order: true },
  })
  if (!assignment) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'مأموریت یافت نشد')
  if (!['PENDING', 'IN_PROGRESS'].includes(assignment.status)) {
    throw new ApiError(409, 'BAD_STATE',
      'فقط مأموریت فعال (تخصیص‌داده‌شده یا در مسیر) قابل لغو است', { current: assignment.status })
  }

  const updated = await db.deliveryAssignment.update({
    where: { id: assignment.id },
    data: { status: 'CANCELLED', failureReason: input.reason ?? 'CANCELLED_BY_MANAGER' },
  })

  await audit({
    userId: user.id, action: 'delivery.cancel', entityType: 'DeliveryAssignment', entityId: assignment.id,
    before: { status: assignment.status },
    after: { status: 'CANCELLED', reason: input.reason ?? null, idempotencyKey: input.idempotencyKey ?? null }, ip,
  })

  await notifyUser(assignment.deliveryUserId, {
    type: 'SYSTEM', title: 'مأموریت پخش لغو شد',
    body: `مأموریت سفارش ${assignment.order.orderNo} لغو شد`,
    refType: 'ORDER', refId: assignment.orderId,
  })

  return updated
}

// ─────────────────────────── مشاهده (راننده / مدیر) ───────────────────────────

/** فیلترهای مشترک فهرست مأموریت‌ها — بخش D: از/تا روی assignedAt یا completedAt + سقف تعداد */
export type AssignmentListFilters = {
  status?: string | string[]
  from?: Date
  to?: Date
  dateField?: 'assignedAt' | 'completedAt' // پیش‌فرض assignedAt
  take?: number
}

function assignmentDateWhere(filters: AssignmentListFilters) {
  const df = filters.dateField ?? 'assignedAt'
  if (!filters.from && !filters.to) return {}
  const range = {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lte: filters.to } : {}),
  }
  // صریح به‌جای کلید محاسباتی — تایپ‌سیف با WhereInput پرایسما
  return df === 'completedAt' ? { completedAt: range } : { assignedAt: range }
}

/** مأموریت‌های خود راننده — scoping با deliveryUserId (الگوی isFieldSeller در auth.ts) */
export async function listMyAssignments(userId: string, filters: AssignmentListFilters = {}) {
  return db.deliveryAssignment.findMany({
    where: {
      deliveryUserId: userId,
      ...(filters.status ? { status: Array.isArray(filters.status) ? { in: filters.status } : filters.status } : {}),
      ...assignmentDateWhere(filters),
    },
    orderBy: { assignedAt: 'desc' },
    ...(filters.take ? { take: Math.min(filters.take, 500) } : {}),
    include: {
      order: {
        select: {
          id: true, orderNo: true, status: true, totalRls: true, payMethod: true, paidAt: true,
          branch: { select: { id: true, name: true, address: true, phone: true } },
          customer: { select: { id: true, code: true, shopName: true, phone: true, address: true } },
        },
      },
    },
  })
}

/** فهرست همهٔ مأموریت‌ها برای مدیریت پخش (perm deliveries.manage در API کنترل می‌شود) */
export async function listAllAssignments(filters: AssignmentListFilters & { driverId?: string; orderId?: string } = {}) {
  return db.deliveryAssignment.findMany({
    where: {
      ...(filters.status ? { status: Array.isArray(filters.status) ? { in: filters.status } : filters.status } : {}),
      ...(filters.driverId ? { deliveryUserId: filters.driverId } : {}),
      ...(filters.orderId ? { orderId: filters.orderId } : {}),
      ...assignmentDateWhere(filters),
    },
    orderBy: { assignedAt: 'desc' },
    ...(filters.take ? { take: Math.min(filters.take, 500) } : {}),
    include: {
      order: {
        select: {
          id: true, orderNo: true, status: true, totalRls: true, payMethod: true,
          customer: { select: { id: true, shopName: true } },
        },
      },
      driver: { select: { id: true, name: true } },
    },
  })
}

/** جزئیات مأموریت با کنترل مالکیت — راننده فقط مأموریت خودش */
export async function getAssignmentForUser(user: PermUser, assignmentId: string) {
  requirePermOf(user, 'deliveries.view.own')
  const assignment = await db.deliveryAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      order: {
        include: {
          items: { include: { product: { select: { name: true, baseUnitName: true } } } },
          customer: { select: { id: true, code: true, shopName: true, phone: true, address: true } },
          branch: { select: { id: true, name: true, address: true, phone: true } },
        },
      },
      driver: { select: { id: true, name: true } },
    },
  })
  if (!assignment) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'مأموریت یافت نشد')
  const isManager = user.permissions.includes('deliveries.manage')
  if (!isManager && assignment.deliveryUserId !== user.id) {
    throw new ApiError(403, 'ASSIGNMENT_NOT_YOURS', 'این مأموریت به شما تخصیص نیافته است')
  }
  return assignment
}
