// جزئیات سفارش + اقدام ماشین حالت (تأیید/پرداخت/آماده‌سازی/ارسال/تحویل/لغو)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, handler, ok, parseBody, clientIp } from '@/lib/api'
import { requireAuth, requirePerm } from '@/lib/auth'
import { transitionOrder, STATUS_LABELS } from '@/lib/orders'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return handler(async () => {
    const user = await requirePerm(req, 'orders.view')
    const { id } = await ctx.params
    const o = await db.order.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, shopName: true, phone: true, address: true } },
        branch: { select: { id: true, name: true, address: true } },
        items: { include: { product: { select: { name: true, baseUnitName: true } } } },
        events: { orderBy: { createdAt: 'asc' } },
        invoice: true,
        returns: { select: { id: true, returnNo: true, status: true } },
      },
    })
    if (!o) throw new ApiError(404, 'ORDER_NOT_FOUND', 'سفارش یافت نشد')

    // ویزیتور میدانی فقط جزئیات سفارش‌های خودش را می‌بیند
    const isFieldSeller = user.permissions.includes('orders.create') && !user.permissions.includes('orders.confirm')
    if (isFieldSeller && o.visitorId !== user.id && o.createdById !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'این سفارش متعلق به شما نیست')
    }

    const userIds = [...new Set([o.createdById, o.visitorId, o.driverId, ...o.events.map(e => e.userId)].filter((u): u is string => !!u))]
    const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    const userMap = new Map(users.map(u => [u.id, u.name]))

    return ok({
      id: o.id, orderNo: o.orderNo, status: o.status, statusLabel: STATUS_LABELS[o.status] ?? o.status,
      customer: o.customer, branch: o.branch, payMethod: o.payMethod, creditApproved: o.creditApproved,
      totalRls: o.totalRls, discountTotalRls: o.discountTotalRls, notes: o.notes, isDemo: o.isDemo,
      createdBy: userMap.get(o.createdById) ?? null,
      visitor: o.visitorId ? userMap.get(o.visitorId) ?? null : null,
      driver: o.driverId ? userMap.get(o.driverId) ?? null : null,
      createdAt: o.createdAt, reservedAt: o.reservedAt, confirmedAt: o.confirmedAt,
      paidAt: o.paidAt, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt,
      completedAt: o.completedAt, cancelledAt: o.cancelledAt,
      items: o.items.map(i => ({
        id: i.id, productId: i.productId, productName: i.product.name,
        unitId: i.unitId, unitName: i.unitName, qtyBase: i.qtyBase,
        unitPriceRls: i.unitPriceRls, lineTotalRls: i.lineTotalRls,
        priceSnapshot: JSON.parse(i.priceSnapshotJson || '{}'),
      })),
      events: o.events.map(e => ({ id: e.id, from: e.fromStatus, to: e.toStatus, user: e.userId ? userMap.get(e.userId) ?? null : null, note: e.note, createdAt: e.createdAt })),
      invoice: o.invoice,
      returns: o.returns,
    })
  })
}

const actionSchema = z.object({
  action: z.enum(['confirm', 'reject', 'creditApprove', 'markPaid', 'startPicking', 'readyForDispatch', 'dispatch', 'deliver', 'complete', 'cancel']),
  driverId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
})

export async function POST(req: NextRequest, ctx: Ctx) {
  return handler(async () => {
    const user = await requireAuth(req)
    const { id } = await ctx.params
    const body = await parseBody(req, actionSchema)
    const order = await transitionOrder(user, id, body.action, { driverId: body.driverId ?? null, note: body.note ?? null }, clientIp(req))
    return ok({ id: order.id, status: order.status, statusLabel: STATUS_LABELS[order.status] ?? order.status })
  })
}
