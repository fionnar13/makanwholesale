// جزئیات مأموریت پخش + اکشن‌های راننده/مدیر (شروع، تحویل+دریافت وجه، مرجوعی، لغو)
//
// ماتریس مجوزهای مصوب بخش C (هر اکشن perm مستقل):
//   GET  /api/deliveries/[id] → deliveries.view.own + کنترل مالکیت (راننده فقط مأموریت خودش)
//   POST action=start   → deliveries.complete (رانندهٔ همان مأموریت)
//   POST action=complete→ deliveries.complete (رانندهٔ همان مأموریت)
//   POST action=return  → deliveries.return  (رانندهٔ همان مأموریت)
//   POST action=cancel  → deliveries.manage  (مدیر پخش)
//
// idempotency (مصوبهٔ بخش C): تکرار همان اکشن روی همان وضعیت، اثر جدیدی ثبت نمی‌کند و
// همان وضعیت جاری را با idempotent:true برمی‌گرداند — دوبار کلیک = دوبار اثر نیست.
//   start → وضعیت IN_PROGRESS | complete → DELIVERED/PAID | return → RETURNED | cancel → CANCELLED
// گارد اتمیک داخل کتابخانه (claim شرطی روی وضعیت) هم شلیک هم‌زمان دوباره را می‌بندد.
//
// نگاشت خطاهای وضعیت:
//   409 BAD_STATE/ASSIGNMENT_ACTIVE/ORDER_NOT_DISPATCHED/ACTIVE_DELIVERY_ASSIGNMENT = تعارض وضعیت
//   403 ASSIGNMENT_NOT_YOURS/FORBIDDEN = مالکیت/مجوز
//   404 ASSIGNMENT_NOT_FOUND = مأموریت غیرقابل‌دسترس
//   400 VALIDATION/PAYMENT_METHOD_REQUIRED/BAD_JSON = اعتبارسنجی ورودی
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, handler, ok, parseBody, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import {
  startAssignment, completeDelivery, recordDeliveryReturn, cancelAssignment, getAssignmentForUser,
} from '@/lib/deliveries'
import {
  ASSIGNMENT_STATUS_LABELS, DRIVER_PAYMENT_LABELS, DRIVER_PAYMENT_METHODS, RETURN_REASON_LABELS, RETURN_REASONS,
} from '@/lib/delivery-shared'
import { STATUS_LABELS } from '@/lib/orders'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return handler(async () => {
    const user = await requirePerm(req, 'deliveries.view.own')
    const { id } = await ctx.params
    const a = await getAssignmentForUser(user, id)

    return ok({
      id: a.id, status: a.status, statusLabel: ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status,
      paymentMethod: a.paymentMethod,
      paymentMethodLabel: a.paymentMethod ? DRIVER_PAYMENT_LABELS[a.paymentMethod] ?? a.paymentMethod : null,
      paymentReference: a.paymentReference,
      failureReason: a.failureReason,
      failureReasonLabel: a.failureReason ? RETURN_REASON_LABELS[a.failureReason] ?? a.failureReason : null,
      notes: a.notes,
      assignedAt: a.assignedAt, startedAt: a.startedAt, completedAt: a.completedAt,
      driver: a.driver,
      order: {
        id: a.order.id, orderNo: a.order.orderNo,
        status: a.order.status, statusLabel: STATUS_LABELS[a.order.status] ?? a.order.status,
        totalRls: a.order.totalRls, payMethod: a.order.payMethod, paidAt: a.order.paidAt,
        customer: a.order.customer, branch: a.order.branch,
        items: a.order.items.map(i => ({
          productId: i.productId, productName: i.product.name, baseUnitName: i.product.baseUnitName,
          unitId: i.unitId, unitName: i.unitName, qtyBase: i.qtyBase,
          unitPriceRls: i.unitPriceRls, lineTotalRls: i.lineTotalRls,
        })),
      },
    })
  })
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({
    action: z.literal('complete'),
    paymentMethod: z.enum(DRIVER_PAYMENT_METHODS).optional(),
    paymentReference: z.string().max(100, 'مرجع پرداخت حداکثر ۱۰۰ نویسه است').optional().nullable(),
    notes: z.string().max(500, 'یادداشت حداکثر ۵۰۰ نویسه است').optional().nullable(),
  }),
  z.object({
    action: z.literal('return'),
    reason: z.enum(RETURN_REASONS, { message: 'دلیل مرجوعی باید یکی از پنج کد مصوب باشد' }),
    notes: z.string().max(500, 'یادداشت حداکثر ۵۰۰ نویسه است').optional().nullable(),
  }),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().max(200, 'دلیل لغو حداکثر ۲۰۰ نویسه است').optional().nullable(),
  }),
])

export async function POST(req: NextRequest, ctx: Ctx) {
  return handler(async () => {
    const { id } = await ctx.params
    const body = await parseBody(req, actionSchema)

    // هر اکشن perm مستقل خود را دارد (ماتریس مصوب بخش C)
    const permByAction = {
      start: 'deliveries.complete', complete: 'deliveries.complete',
      return: 'deliveries.return', cancel: 'deliveries.manage',
    } as const
    const user = await requirePerm(req, permByAction[body.action])

    // پیش‌خوانی با کنترل 404/403/perm مشاهده — پایهٔ تشخیص تکرار و نگاشت خطای وضعیت
    const current = await getAssignmentForUser(user, id)
    const orderStatus = (await db.order.findUnique({ where: { id: current.orderId }, select: { status: true } }))?.status ?? null

    // ─── idempotency: تکرار همان اکشن روی وضعیتِ هم‌نتیجه → همان وضعیت، بدون اثر مجدد ───
    if (body.action === 'start' && current.status === 'IN_PROGRESS') {
      return ok({ id: current.id, status: current.status, statusLabel: ASSIGNMENT_STATUS_LABELS[current.status], orderStatus, idempotent: true })
    }
    if (body.action === 'complete' && (current.status === 'DELIVERED' || current.status === 'PAID')) {
      const invoice = await db.invoice.findUnique({ where: { orderId: current.orderId }, select: { invoiceNo: true, status: true } })
      return ok({
        id: current.id, status: current.status, statusLabel: ASSIGNMENT_STATUS_LABELS[current.status],
        orderStatus, invoiceNo: invoice?.invoiceNo ?? null, invoiceStatus: invoice?.status ?? null, idempotent: true,
      })
    }
    if (body.action === 'return' && current.status === 'RETURNED') {
      const rr = await db.returnRequest.findFirst({
        where: { orderId: current.orderId }, orderBy: { createdAt: 'desc' }, select: { returnNo: true },
      })
      return ok({ id: current.id, status: current.status, statusLabel: ASSIGNMENT_STATUS_LABELS[current.status], returnNo: rr?.returnNo ?? null, idempotent: true })
    }
    if (body.action === 'cancel' && current.status === 'CANCELLED') {
      return ok({ id: current.id, status: current.status, statusLabel: ASSIGNMENT_STATUS_LABELS[current.status], idempotent: true })
    }

    // ─── اجرای اکشن از مسیر کتابخانه (گارد وضعیت اتمیک + AuditLog + اعلان‌ها) ───
    switch (body.action) {
      case 'start': {
        const a = await startAssignment(user, id, clientIp(req))
        return ok({ id: a.id, status: a.status, statusLabel: ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status, orderStatus })
      }
      case 'complete': {
        const r = await completeDelivery(user, id, {
          paymentMethod: body.paymentMethod,
          paymentReference: body.paymentReference ?? null,
          notes: body.notes ?? null,
        }, clientIp(req))
        return ok({
          id: r.assignment.id, status: r.assignment.status,
          statusLabel: ASSIGNMENT_STATUS_LABELS[r.assignment.status] ?? r.assignment.status,
          orderStatus: r.finalOrderStatus, orderStatusLabel: STATUS_LABELS[r.finalOrderStatus] ?? r.finalOrderStatus,
          invoiceNo: r.effects.invoiceNo, invoiceStatus: r.effects.invoiceStatus,
        })
      }
      case 'return': {
        const r = await recordDeliveryReturn(user, id, { reason: body.reason, notes: body.notes ?? null }, clientIp(req))
        return ok({
          id: r.assignment.id, status: r.assignment.status,
          statusLabel: ASSIGNMENT_STATUS_LABELS[r.assignment.status] ?? r.assignment.status,
          returnNo: r.returnRequest.returnNo, orderStatus,
        })
      }
      case 'cancel': {
        const a = await cancelAssignment(user, id, { reason: body.reason ?? null }, clientIp(req))
        return ok({ id: a.id, status: a.status, statusLabel: ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status })
      }
    }
  })
}
