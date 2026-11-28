// خلاصهٔ وضعیت مأموریت‌های پخش — داشبورد مدیر (فاز ۱ — بخش E)
//
// GET /api/deliveries/summary → deliveries.manage
//
// پارامترها (همه اختیاری):
//   from/to   — بازهٔ ISO datetime روی completedAt برای شمارش «تحویل دوره» و «مرجوعی دوره»
//               (کارت‌های «تحویل امروز» و «مرجوعی امروز» داشبورد — مرز روز را کلاینت با
//               منطقهٔ زمانی خودش می‌فرستد تا «امروزِ» مدیر پخش درست باشد)
//   driverId  — محدود کردن همهٔ شمارش‌ها به یک راننده (هم برای داشبورد، هم برای تست scope دقیق)
//
// پاسخ:
//   pending         — مأموریت در انتظار شروع
//   inProgress      — مأموریت در مسیر
//   paidInPeriod    — تحویل تسویه‌شده در بازهٔ completedAt (بدون بازه = کل زمان)
//   returnedInPeriod— مرجوعی در بازهٔ completedAt (RETURNED + PARTIAL_RETURNED)
//   creditUnpaid    — تحویل‌شدهٔ بی‌تسویهٔ اعتباری (مأموریت DELIVERED با سفارش CREDIT)
//                     ← گزارش «تحویل‌شده بدون تسویه» (نکتهٔ اصلاحی ۲ فاز ۰)
//
// بدون migration — صرفاً شمارش روی جداول موجود (additive).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, handler, ok } from '@/lib/api'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  return handler(async () => {
    const user = await requireAuth(req)
    if (!user.permissions.includes('deliveries.manage')) {
      throw new ApiError(403, 'FORBIDDEN', 'دسترسی لازم برای این عملیات را ندارید', { need: 'deliveries.manage' })
    }

    const url = new URL(req.url)
    const querySchema = z.object({
      from: z.string().refine(v => !Number.isNaN(Date.parse(v)), 'از تاریخ نامعتبر است').optional(),
      to: z.string().refine(v => !Number.isNaN(Date.parse(v)), 'تا تاریخ نامعتبر است').optional(),
      driverId: z.string().min(1).optional(),
    })
    const q = querySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!q.success) {
      throw new ApiError(400, 'VALIDATION', 'پارامترهای جستجو نامعتبر است', q.error.flatten())
    }
    if (q.data.from && q.data.to && new Date(q.data.from) > new Date(q.data.to)) {
      throw new ApiError(400, 'VALIDATION', 'بازهٔ تاریخ نامعتبر است — «از» نباید پس از «تا» باشد')
    }

    const driverScope = q.data.driverId ? { deliveryUserId: q.data.driverId } : {}
    const periodScope = (q.data.from || q.data.to)
      ? {
          completedAt: {
            ...(q.data.from ? { gte: new Date(q.data.from) } : {}),
            ...(q.data.to ? { lte: new Date(q.data.to) } : {}),
          },
        }
      : {}

    const [pending, inProgress, paidInPeriod, returnedInPeriod, creditUnpaid] = await Promise.all([
      db.deliveryAssignment.count({ where: { status: 'PENDING', ...driverScope } }),
      db.deliveryAssignment.count({ where: { status: 'IN_PROGRESS', ...driverScope } }),
      db.deliveryAssignment.count({ where: { status: 'PAID', ...periodScope, ...driverScope } }),
      db.deliveryAssignment.count({
        where: { status: { in: ['RETURNED', 'PARTIAL_RETURNED'] }, ...periodScope, ...driverScope },
      }),
      db.deliveryAssignment.count({
        where: { status: 'DELIVERED', order: { payMethod: 'CREDIT' }, ...driverScope },
      }),
    ])

    return ok({ pending, inProgress, paidInPeriod, returnedInPeriod, creditUnpaid })
  })
}
