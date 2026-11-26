// مشتریان عمده — لیست با مانده حساب از Ledger + ایجاد مشتری جدید
// دسترسی:
//   • customers.manage → مشاهده همهٔ مشتریان + ایجاد کامل (اعتبار، منطقه، شعب)
//   • orders.create (ویزیتور میدانی) → فقط مشتریان خودش (salesRep یا ثبت‌شده توسط خودش)
//     و ایجاد سریع مشتری از فروشگاه/اپ — بدون اعتبار و منطقه؛ ثبت‌کننده = خود ویزیتور
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, handler, ok, parseBody } from '@/lib/api'
import { requireAuth, requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { nextNumber } from '@/lib/numbering'
import type { SessionUser } from '@/lib/auth'

// مشتریان «مربوط به ویزیتور» — مسئول فروش یا ثبت‌کننده
const mineCustomerWhere = (userId: string) => ({ OR: [{ salesRepId: userId }, { createdById: userId }] })

export async function GET(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'customers.view')
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()
    const isManager = user.permissions.includes('customers.manage')

    const customers = await db.customer.findMany({
      where: {
        // ویزیتور فقط مشتریان مرتبط به خودش را می‌بیند؛ مدیر به همه دسترسی دارد
        ...(isManager ? {} : mineCustomerWhere(user.id)),
        ...(q ? { OR: [{ shopName: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }, { ownerName: { contains: q } }] } : {}),
      },
      include: {
        territory: { select: { name: true } },
        _count: { select: { branches: true, orders: true } },
        ledger: { select: { amountRls: true } },
      },
      orderBy: { code: 'asc' },
    })

    const data = customers.map(c => {
      const balanceRls = c.ledger.reduce((s, l) => s + l.amountRls, 0)
      return {
        id: c.id, code: c.code, shopName: c.shopName,
        businessType: c.businessType, groupKey: c.groupKey,
        ownerName: c.ownerName, phone: c.phone, address: c.address,
        creditLimitRls: c.creditLimitRls, creditDays: c.creditDays,
        status: c.status, isDemo: c.isDemo, salesRepId: c.salesRepId,
        territory: c.territory?.name ?? null,
        branchesCount: c._count.branches, ordersCount: c._count.orders,
        balanceRls, remainingCreditRls: c.creditLimitRls - balanceRls,
        createdAt: c.createdAt,
      }
    })
    return ok(data)
  })
}

const createSchema = z.object({
  shopName: z.string().min(2, 'نام فروشگاه الزامی است'),
  businessType: z.enum(['GROCERY', 'SUPERMARKET', 'OTHER']).default('GROCERY'),
  groupKey: z.enum(['REGULAR', 'GOLD', 'WHOLESALE']).default('REGULAR'),
  ownerName: z.string().optional().nullable(),
  phone: z.string().min(8, 'شماره تماس الزامی است'),
  address: z.string().optional().nullable(),
  territoryId: z.string().optional().nullable(),
  creditLimitRls: z.number().int().min(0).default(0),
  creditDays: z.number().int().min(0).default(0),
  branches: z.array(z.object({
    name: z.string().min(2),
    address: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
  })).min(1, 'حداقل یک شعبه الزامی است'),
})

// مسیر سریع ویزیتور — فیلدهای تجاری (اعتبار/گروه/منطقه) فقط توسط مدیر تنظیم می‌شوند
const quickCreateSchema = z.object({
  shopName: z.string().min(2, 'نام فروشگاه الزامی است'),
  ownerName: z.string().max(100).optional().nullable(),
  phone: z.string().min(8, 'شماره تماس الزامی است').max(20),
  address: z.string().max(500).optional().nullable(),
  businessType: z.enum(['GROCERY', 'SUPERMARKET', 'OTHER']).default('GROCERY'),
})

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requireAuth(req)
    const isManager = user.permissions.includes('customers.manage')
    if (!isManager && !user.permissions.includes('orders.create')) {
      throw new ApiError(403, 'FORBIDDEN', 'دسترسی لازم برای ثبت مشتری را ندارید')
    }

    if (isManager) return createFullCustomer(req, user)
    return createQuickCustomer(req, user)
  })
}

// ─── ایجاد کامل — مسیر مدیر (customers.manage) ───
async function createFullCustomer(req: NextRequest, user: SessionUser) {
  const body = await parseBody(req, createSchema)

  const customer = await db.$transaction(async tx => {
    const code = await nextNumber(tx, 'CUS')
    const created = await tx.customer.create({
      data: {
        code, shopName: body.shopName, businessType: body.businessType,
        groupKey: body.groupKey, ownerName: body.ownerName ?? null,
        phone: body.phone, address: body.address ?? null,
        territoryId: body.territoryId ?? null,
        creditLimitRls: body.creditLimitRls, creditDays: body.creditDays,
        salesRepId: body.territoryId
          ? (await tx.territory.findUnique({ where: { id: body.territoryId } }))?.visitorId ?? null
          : null,
        createdById: user.id,
      },
    })
    for (const b of body.branches) {
      await tx.customerBranch.create({
        data: { customerId: created.id, name: b.name, address: b.address ?? null, phone: b.phone ?? null },
      })
    }
    return created
  })

  await audit({ userId: user.id, action: 'customer.create', entityType: 'Customer', entityId: customer.id, after: { code: customer.code, shopName: customer.shopName, via: 'panel' } })
  return ok({ id: customer.id, code: customer.code, shopName: customer.shopName }, 201)
}

// ─── ایجاد سریع — مسیر ویزیتور میدانی (orders.create) ───
async function createQuickCustomer(req: NextRequest, user: SessionUser) {
  const body = await parseBody(req, quickCreateSchema)

  // جلوگیری از ثبت تکراری — مشتری با همین تلفن که قبلاً توسط همین ویزیتور ثبت شده
  const existing = await db.customer.findFirst({
    where: { phone: body.phone, ...mineCustomerWhere(user.id) },
    select: { id: true, code: true, shopName: true },
  })
  if (existing) {
    return ok({ ...existing, existing: true }, 200)
  }

  const customer = await db.$transaction(async tx => {
    const code = await nextNumber(tx, 'CUS')
    const created = await tx.customer.create({
      data: {
        code, shopName: body.shopName, businessType: body.businessType,
        groupKey: 'REGULAR', ownerName: body.ownerName ?? null,
        phone: body.phone, address: body.address ?? null,
        creditLimitRls: 0, creditDays: 0,
        salesRepId: user.id,
        createdById: user.id,
      },
    })
    // شعبهٔ اصلی خودکار — ویزیتور فرم شعبه جداگانه پر نمی‌کند
    await tx.customerBranch.create({
      data: { customerId: created.id, name: 'فروشگاه اصلی', address: body.address ?? null, phone: body.phone },
    })
    return created
  })

  await audit({ userId: user.id, action: 'customer.create', entityType: 'Customer', entityId: customer.id, after: { code: customer.code, shopName: customer.shopName, via: 'visitor-storefront' } })
  return ok({ id: customer.id, code: customer.code, shopName: customer.shopName }, 201)
}
