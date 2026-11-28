// مأموریت‌های پخش — فهرست (راننده: فقط مأموریت‌های خودش / مدیر: همه) + تخصیص مأموریت (مدیر)
//
// ماتریس مجوزهای مصوب بخش C:
//   GET  /api/deliveries  → deliveries.view.own (راننده، scoping سخت با deliveryUserId)
//                          یا deliveries.manage (مدیر، همهٔ مأموریت‌ها + فیلترها)
//   POST /api/deliveries  → deliveries.manage
//
// فیلترهای بخش D (additive):
//   from/to — بازهٔ ISO datetime روی assignedAt (پیش‌فرض) یا completedAt با پارامتر dateField
//   take — سقف تعداد (۱ تا ۵۰۰؛ بدون پارامتر = همه)
//
// نگاشت خطاهای وضعیت (مصوبهٔ بخش C):
//   409 = تعارض وضعیت، 403 = مالکیت/مجوز، 404 = مأموریت غیرقابل‌دسترس، 400 = اعتبارسنجی
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, handler, ok, parseBody, clientIp } from '@/lib/api'
import { requireAuth, requirePerm } from '@/lib/auth'
import { createAssignment, listMyAssignments, listAllAssignments } from '@/lib/deliveries'
import {
  DELIVERY_ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS, DRIVER_PAYMENT_LABELS, RETURN_REASON_LABELS,
} from '@/lib/delivery-shared'

export async function GET(req: NextRequest) {
  return handler(async () => {
    const user = await requireAuth(req)
    const isManager = user.permissions.includes('deliveries.manage')
    if (!isManager && !user.permissions.includes('deliveries.view.own')) {
      throw new ApiError(403, 'FORBIDDEN', 'دسترسی لازم برای این عملیات را ندارید', { need: 'deliveries.view.own' })
    }

    const url = new URL(req.url)
    const querySchema = z.object({
      status: z.enum(DELIVERY_ASSIGNMENT_STATUSES).optional(),
      driverId: z.string().min(1).optional(),
      orderId: z.string().min(1).optional(),
      // بخش D — فیلتر دوره‌ای: از/تا (ISO datetime) روی assignedAt یا completedAt
      from: z.string().refine(v => !Number.isNaN(Date.parse(v)), 'از تاریخ نامعتبر است').optional(),
      to: z.string().refine(v => !Number.isNaN(Date.parse(v)), 'تا تاریخ نامعتبر است').optional(),
      dateField: z.enum(['assignedAt', 'completedAt']).optional(),
      take: z.coerce.number().int().min(1).max(500).optional(),
    })
    const q = querySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!q.success) {
      throw new ApiError(400, 'VALIDATION', 'پارامترهای جستجو نامعتبر است', q.error.flatten())
    }
    if (q.data.from && q.data.to && new Date(q.data.from) > new Date(q.data.to)) {
      throw new ApiError(400, 'VALIDATION', 'بازهٔ تاریخ نامعتبر است — «از» نباید پس از «تا» باشد')
    }

    // scoping سخت‌گیرانه — راننده فقط مأموریت‌های خودش را می‌بیند؛ فیلتر driverId/orderId مخصوص مدیر است
    const listFilters = {
      status: q.data.status,
      from: q.data.from ? new Date(q.data.from) : undefined,
      to: q.data.to ? new Date(q.data.to) : undefined,
      dateField: q.data.dateField,
      take: q.data.take,
    }
    const rows = isManager
      ? await listAllAssignments({ driverId: q.data.driverId, orderId: q.data.orderId, ...listFilters })
      : await listMyAssignments(user.id, listFilters)

    return ok(rows.map(a => ({
      ...a,
      statusLabel: ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status,
      paymentMethodLabel: a.paymentMethod ? DRIVER_PAYMENT_LABELS[a.paymentMethod] ?? a.paymentMethod : null,
      failureReasonLabel: a.failureReason ? RETURN_REASON_LABELS[a.failureReason] ?? a.failureReason : null,
    })))
  })
}

const createSchema = z.object({
  orderId: z.string().min(1, 'شناسه سفارش الزامی است'),
  deliveryUserId: z.string().min(1, 'انتخاب راننده الزامی است'),
  notes: z.string().max(500, 'یادداشت حداکثر ۵۰۰ نویسه است').optional().nullable(),
})

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'deliveries.manage')
    const body = await parseBody(req, createSchema)
    const assignment = await createAssignment(user, body, clientIp(req))
    return ok({
      id: assignment.id, orderId: assignment.orderId, deliveryUserId: assignment.deliveryUserId,
      status: assignment.status, statusLabel: ASSIGNMENT_STATUS_LABELS[assignment.status] ?? assignment.status,
      assignedAt: assignment.assignedAt, notes: assignment.notes,
    }, 201)
  })
}
