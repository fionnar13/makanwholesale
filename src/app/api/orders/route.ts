// سفارش‌ها — لیست با فیلتر + ایجاد با رزرو اتمیک و قیمت‌گذاری سرور
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handler, ok, parseBody, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { createOrder, STATUS_LABELS } from '@/lib/orders'

export async function GET(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'orders.view')
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const customerId = url.searchParams.get('customerId')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const take = Math.min(parseInt(url.searchParams.get('take') ?? '100', 10), 300)

    // ویزیتور میدانی (ثبت سفارش بدون مجوز تأیید) فقط سفارش‌های خودش را می‌بیند
    const isFieldSeller = user.permissions.includes('orders.create') && !user.permissions.includes('orders.confirm')

    const orders = await db.order.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(customerId ? { customerId } : {}),
        ...(isFieldSeller ? { OR: [{ visitorId: user.id }, { createdById: user.id }] } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
      include: { customer: { select: { code: true, shopName: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    })

    const userIds = [...new Set(orders.flatMap(o => [o.createdById, o.visitorId, o.driverId].filter(Boolean) as string[]))]
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []
    const userMap = new Map(users.map(u => [u.id, u.name]))

    return ok(orders.map(o => ({
      id: o.id, orderNo: o.orderNo, status: o.status, statusLabel: STATUS_LABELS[o.status] ?? o.status,
      customer: o.customer, branchId: o.branchId,
      totalRls: o.totalRls, itemsCount: o._count.items, itemsCountBase: o.itemsCountBase,
      payMethod: o.payMethod, creditApproved: o.creditApproved,
      createdBy: userMap.get(o.createdById) ?? null,
      visitor: o.visitorId ? userMap.get(o.visitorId) ?? null : null,
      driver: o.driverId ? userMap.get(o.driverId) ?? null : null,
      createdAt: o.createdAt, notes: o.notes, isDemo: o.isDemo,
    })))
  })
}

const createSchema = z.object({
  customerId: z.string().min(1, 'انتخاب مشتری الزامی است'),
  branchId: z.string().optional().nullable(),
  payMethod: z.enum(['CASH', 'CREDIT', 'TRANSFER']).default('CREDIT'),
  notes: z.string().optional().nullable(),
  idempotencyKey: z.string().min(8).max(100).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().min(1),
    unitId: z.string().min(1),
    qty: z.number().int().min(1, 'مقدار باید عدد صحیح مثبت باشد'),
  })).min(1, 'سفارش باید حداقل یک قلم داشته باشد'),
})

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'orders.create')
    const body = await parseBody(req, createSchema)
    const { order, idempotent } = await createOrder(user, body, clientIp(req))
    return ok({
      id: order.id, orderNo: order.orderNo, status: order.status, totalRls: order.totalRls,
      idempotent,
    }, idempotent ? 200 : 201)
  })
}
