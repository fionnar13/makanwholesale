// پرونده کامل مشتری — شعب، مانده، گردش حساب اخیر، سفارش‌های اخیر
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, handler, ok, parseBody } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return handler(async () => {
    const user = await requirePerm(req, 'customers.view')
    const { id } = await ctx.params
    const c = await db.customer.findUnique({
      where: { id },
      include: {
        territory: { select: { id: true, name: true } },
        branches: { orderBy: { id: 'asc' } },
        ledger: { orderBy: { createdAt: 'desc' }, take: 15 },
        orders: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, orderNo: true, status: true, totalRls: true, createdAt: true } },
        receipts: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    })
    if (!c) throw new ApiError(404, 'NOT_FOUND', 'مشتری یافت نشد')

    // ویزیتور میدانی فقط پروندهٔ مشتریان مرتبط به خودش را می‌بیند
    const isManager = user.permissions.includes('customers.manage')
    if (!isManager && c.salesRepId !== user.id && c.createdById !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'این پروندهٔ مشتری متعلق به شما نیست')
    }

    const balanceRls = (await db.customerLedger.aggregate({ where: { customerId: id }, _sum: { amountRls: true } }))._sum.amountRls ?? 0
    const totalPurchases = (await db.order.aggregate({ where: { customerId: id, status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { totalRls: true } }))._sum.totalRls ?? 0

    return ok({
      id: c.id, code: c.code, shopName: c.shopName, businessType: c.businessType,
      groupKey: c.groupKey, ownerName: c.ownerName, phone: c.phone, address: c.address,
      creditLimitRls: c.creditLimitRls, creditDays: c.creditDays, status: c.status,
      isDemo: c.isDemo, createdAt: c.createdAt,
      territory: c.territory, branches: c.branches,
      balanceRls, remainingCreditRls: c.creditLimitRls - balanceRls,
      totalPurchasesRls: totalPurchases,
      recentOrders: c.orders, recentLedger: c.ledger, recentReceipts: c.receipts,
    })
  })
}

const patchSchema = z.object({
  shopName: z.string().min(2).optional(),
  businessType: z.enum(['GROCERY', 'SUPERMARKET', 'OTHER']).optional(),
  groupKey: z.enum(['REGULAR', 'GOLD', 'WHOLESALE']).optional(),
  ownerName: z.string().optional().nullable(),
  phone: z.string().optional(),
  address: z.string().optional().nullable(),
  territoryId: z.string().optional().nullable(),
  creditLimitRls: z.number().int().min(0).optional(),
  creditDays: z.number().int().min(0).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
})

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handler(async () => {
    const user = await requirePerm(req, 'customers.manage')
    const { id } = await ctx.params
    const body = await parseBody(req, patchSchema)
    const before = await db.customer.findUnique({ where: { id } })
    if (!before) throw new ApiError(404, 'NOT_FOUND', 'مشتری یافت نشد')
    await db.customer.update({ where: { id }, data: body })
    await audit({ userId: user.id, action: 'customer.update', entityType: 'Customer', entityId: id, before: { status: before.status, creditLimitRls: before.creditLimitRls }, after: body })
    return ok({ id })
  })
}
