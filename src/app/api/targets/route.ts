// اهداف فروش و تحقق — ماهانه برای هر ویزیتور
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handler, ok, parseBody } from '@/lib/api'
import { requireAuth, requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'

function jalaliYm(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: '2-digit' }).formatToParts(d)
  const y = parts.find(p => p.type === 'year')?.value ?? ''
  const m = parts.find(p => p.type === 'month')?.value ?? ''
  return `${y}-${m}`
}

export async function GET(req: NextRequest) {
  return handler(async () => {
    const user = await requireAuth(req)
    const url = new URL(req.url)
    const me = url.searchParams.get('mine') === '1'
    const ym = jalaliYm(new Date())

    if (me || (!user.permissions.includes('reports.view') && user.permissions.includes('orders.create'))) {
      const target = await db.saleTarget.findUnique({ where: { userId_periodYm: { userId: user.id, periodYm: ym } } })
      const now = new Date()
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const perf = await db.order.aggregate({
        where: { visitorId: user.id, status: { in: ['DELIVERED', 'COMPLETED'] }, createdAt: { gte: startMonth } },
        _sum: { totalRls: true }, _count: true,
      })
      const visitsCount = await db.visit.count({ where: { visitorId: user.id, startedAt: { gte: startMonth } } })
      const orderedVisits = await db.visit.count({ where: { visitorId: user.id, startedAt: { gte: startMonth }, result: 'ORDERED' } })
      return ok({
        periodYm: ym,
        target: target ?? null,
        achievedRls: perf._sum.totalRls ?? 0,
        ordersCount: perf._count,
        visitsCount, orderedVisits,
        conversionPct: visitsCount > 0 ? Math.round((orderedVisits / visitsCount) * 100) : null,
      })
    }

    await requirePerm(req, 'reports.view')
    const targets = await db.saleTarget.findMany({ where: { periodYm: ym } })
    const users = await db.user.findMany({
      where: { roles: { some: { role: { name: 'VISITOR' } } } },
      select: { id: true, name: true },
    })
    const now = new Date()
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    type TargetRow = {
      userId: string; name: string; target: { id: string; createdAt: Date; userId: string; amountRls: number; periodYm: string } | null
      achievedRls: number; ordersCount: number; achievementPct: number | null
    }
    const result: TargetRow[] = []
    for (const u of users) {
      const t = targets.find(x => x.userId === u.id) ?? null
      const perf = await db.order.aggregate({
        where: { visitorId: u.id, status: { in: ['DELIVERED', 'COMPLETED'] }, createdAt: { gte: startMonth } },
        _sum: { totalRls: true }, _count: true,
      })
      result.push({
        userId: u.id, name: u.name, target: t,
        achievedRls: perf._sum.totalRls ?? 0, ordersCount: perf._count,
        achievementPct: t && t.amountRls > 0 ? Math.round(((perf._sum.totalRls ?? 0) / t.amountRls) * 100) : null,
      })
    }
    return ok({ periodYm: ym, items: result })
  })
}

const upsertSchema = z.object({
  userId: z.string().min(1),
  amountRls: z.number().int().min(0),
  periodYm: z.string().regex(/^\d{4}-\d{2}$/, 'دوره باید به شکل 1404-09 باشد'),
})

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'orders.confirm')
    const body = await parseBody(req, upsertSchema)
    const target = await db.saleTarget.upsert({
      where: { userId_periodYm: { userId: body.userId, periodYm: body.periodYm } },
      update: { amountRls: body.amountRls },
      create: { userId: body.userId, periodYm: body.periodYm, amountRls: body.amountRls },
    })
    await audit({ userId: user.id, action: 'target.upsert', entityType: 'SaleTarget', entityId: target.id, after: { userId: body.userId, periodYm: body.periodYm, amountRls: body.amountRls } })
    return ok({ id: target.id }, 201)
  })
}

