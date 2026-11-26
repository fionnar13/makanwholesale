// مرجوعی کالا — مستقل از لغو سفارش؛ متصل به سفارش و فاکتور اصلی
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, handler, ok, parseBody } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { nextNumber } from '@/lib/numbering'
import { notifyPermissionCodes } from '@/lib/notify'
import { emitTelegramEvent } from '@/lib/integrations/telegram'
import { audit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'returns.view')
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const returns = await db.returnRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        order: { select: { orderNo: true, totalRls: true } },
        customer: { select: { code: true, shopName: true } },
        items: { include: { product: { select: { name: true, baseUnitName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return ok(returns.map(r => ({
      id: r.id, returnNo: r.returnNo, status: r.status, reason: r.reason,
      order: r.order, customer: r.customer,
      items: r.items.map(i => ({
        id: i.id, productId: i.productId, productName: i.product.name,
        baseUnitName: i.product.baseUnitName, qtyBase: i.qtyBase, reason: i.reason,
        disposition: i.disposition, qcNote: i.qcNote,
      })),
      reviewedAt: r.reviewedAt, financialPosted: r.financialPosted, createdAt: r.createdAt,
    })))
  })
}

const createSchema = z.object({
  orderId: z.string().min(1, 'انتخاب سفارش الزامی است'),
  reason: z.string().min(3, 'دلیل کلی مرجوعی الزامی است'),
  items: z.array(z.object({
    productId: z.string().min(1),
    qtyBase: z.number().int().min(1),
    reason: z.string().optional().nullable(),
  })).min(1, 'حداقل یک قلم مرجوعی الزامی است'),
})

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'orders.create')
    const body = await parseBody(req, createSchema)
    const order = await db.order.findUnique({ where: { id: body.orderId }, include: { items: true, customer: { select: { shopName: true } } } })
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'سفارش یافت نشد')
    if (!['DELIVERED', 'COMPLETED'].includes(order.status)) {
      throw new ApiError(409, 'BAD_STATE', 'مرجوعی فقط برای سفارش تحویل‌شده امکان‌پذیر است')
    }

    // مقدار قبلاً درخواست‌شده برای هر کالا
    const priorReturns = await db.returnItem.findMany({
      where: { request: { orderId: order.id, status: { in: ['REQUESTED', 'REVIEWED', 'CLOSED'] } } },
      select: { productId: true, qtyBase: true },
    })
    const priorMap = new Map<string, number>()
    for (const p of priorReturns) priorMap.set(p.productId, (priorMap.get(p.productId) ?? 0) + p.qtyBase)

    for (const it of body.items) {
      const orderItem = order.items.find(i => i.productId === it.productId)
      if (!orderItem) throw new ApiError(400, 'BAD_ITEM', 'این کالا در سفارش اصلی وجود ندارد', { productId: it.productId })
      const already = priorMap.get(it.productId) ?? 0
      if (already + it.qtyBase > orderItem.qtyBase) {
        throw new ApiError(409, 'QTY_EXCEEDED',
          'مجموع مرجوعی این کالا از مقدار سفارش‌شده بیشتر است',
          { orderedBase: orderItem.qtyBase, alreadyRequestedBase: already, requestedBase: it.qtyBase })
      }
    }

    const created = await db.$transaction(async tx => {
      const returnNo = await nextNumber(tx, 'RET')
      const rr = await tx.returnRequest.create({
        data: { returnNo, orderId: order.id, customerId: order.customerId, reason: body.reason, status: 'REQUESTED' },
      })
      for (const it of body.items) {
        await tx.returnItem.create({
          data: { returnRequestId: rr.id, productId: it.productId, qtyBase: it.qtyBase, reason: it.reason ?? null },
        })
      }
      return rr
    })

    await audit({ userId: user.id, action: 'return.create', entityType: 'ReturnRequest', entityId: created.id, after: { returnNo: created.returnNo, orderNo: order.orderNo } })
    await notifyPermissionCodes(['returns.manage'], {
      type: 'RETURN', title: 'درخواست مرجوعی جدید',
      body: `درخواست ${created.returnNo} بابت سفارش ${order.orderNo} ثبت شد`,
      refType: 'RETURN', refId: created.id,
    })
    await emitTelegramEvent('RETURN_NEW', { returnNo: created.returnNo, customerName: order.customer?.shopName ?? '' })
    return ok({ id: created.id, returnNo: created.returnNo }, 201)
  })
}
