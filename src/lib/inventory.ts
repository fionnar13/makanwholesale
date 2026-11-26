// موتور موجودی — رزرو اتمیک، آزادسازی، خروج FEFO، ورود کالا، تعدیل
// همه عملیات داخل Transaction انجام می‌شود و از Conditional Update
// برای جلوگیری از فروش بیش از موجودی (Overselling) استفاده می‌کند.
import { Prisma, PrismaClient } from '@prisma/client'
import { ApiError } from '@/lib/api'

type Tx = Prisma.TransactionClient

export type ReserveItem = { productId: string; warehouseId: string; qtyBase: number }

export function availableOf(physical: number, reserved: number): number {
  return physical - reserved
}

/** رزرو اتمیک واقعی با SQL شرطی */
export async function reserveStockAtomic(
  tx: Tx,
  items: ReserveItem[],
  ref: { refType: string; refId: string; userId?: string | null; note?: string },
) {
  const perProduct = new Map<string, { warehouseId: string; qty: number }>()
  for (const it of items) {
    const prev = perProduct.get(it.productId)
    perProduct.set(it.productId, { warehouseId: it.warehouseId, qty: (prev?.qty ?? 0) + it.qtyBase })
  }

  for (const [productId, v] of perProduct) {
    // ۱) کنترل وجود رکورد و موجودی
    const balance = await tx.inventoryBalance.findUnique({
      where: { productId_warehouseId: { productId, warehouseId: v.warehouseId } },
    })
    if (!balance) {
      throw new ApiError(409, 'NO_STOCK', 'برای این کالا در انبار مورد نظر موجودی ثبت نشده است', { productId })
    }
    // ۲) Update شرطی اتمیک — فقط اگر Available کافی باشد
    //    (tagged-template با identifierهای نقل‌قول‌شده — سازگار با SQLite و PostgreSQL)
    const updated = await tx.$executeRaw`
      UPDATE "InventoryBalance"
      SET "reservedQtyBase" = "reservedQtyBase" + ${v.qty}
      WHERE "productId" = ${productId} AND "warehouseId" = ${v.warehouseId}
        AND ("physicalQtyBase" - "reservedQtyBase") >= ${v.qty}`
    if (updated === 0) {
      const fresh = await tx.inventoryBalance.findUnique({
        where: { productId_warehouseId: { productId, warehouseId: v.warehouseId } },
      })
      const avail = fresh ? fresh.physicalQtyBase - fresh.reservedQtyBase : 0
      throw new ApiError(409, 'INSUFFICIENT_STOCK',
        `موجودی قابل فروش کافی نیست (قابل فروش: ${avail}، درخواست: ${v.qty})`,
        { productId, availableBase: avail, requestedBase: v.qty })
    }
    // ۳) Ledger موجودی
    await tx.inventoryLedger.create({
      data: {
        productId, warehouseId: v.warehouseId, movement: 'RESERVE',
        physDelta: 0, reservedDelta: v.qty,
        refType: ref.refType, refId: ref.refId,
        userId: ref.userId ?? null, note: ref.note ?? 'رزرو سفارش',
      },
    })
  }
}

/** آزادسازی کنترل‌شده رزرو (لغو/رد سفارش) */
export async function releaseStockAtomic(
  tx: Tx,
  items: ReserveItem[],
  ref: { refType: string; refId: string; userId?: string | null; note?: string },
) {
  const perProduct = new Map<string, { warehouseId: string; qty: number }>()
  for (const it of items) {
    const prev = perProduct.get(it.productId)
    perProduct.set(it.productId, { warehouseId: it.warehouseId, qty: (prev?.qty ?? 0) + it.qtyBase })
  }
  for (const [productId, v] of perProduct) {
    const updated = await tx.$executeRaw`
      UPDATE "InventoryBalance"
      SET "reservedQtyBase" = "reservedQtyBase" - ${v.qty}
      WHERE "productId" = ${productId} AND "warehouseId" = ${v.warehouseId}
        AND "reservedQtyBase" >= ${v.qty}`
    if (updated === 0) {
      throw new ApiError(409, 'RELEASE_CONFLICT', 'رزرو برای آزادسازی کافی نیست', { productId, requestedBase: v.qty })
    }
    await tx.inventoryLedger.create({
      data: {
        productId, warehouseId: v.warehouseId, movement: 'RELEASE',
        physDelta: 0, reservedDelta: -v.qty,
        refType: ref.refType, refId: ref.refId,
        userId: ref.userId ?? null, note: ref.note ?? 'آزادسازی رزرو',
      },
    })
  }
}

/** خروج فیزیکی کالا با FEFO — فقط در نقطه تأییدشده انبار (تحویل/خروج واقعی) */
export async function issueStockFEFO(
  tx: Tx,
  items: ReserveItem[],
  ref: { refType: string; refId: string; userId?: string | null; note?: string },
) {
  for (const it of items) {
    let remaining = it.qtyBase
    const lots = await tx.inventoryLot.findMany({
      where: { productId: it.productId, warehouseId: it.warehouseId, remainingQtyBase: { gt: 0 } },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    })
    for (const lot of lots) {
      if (remaining <= 0) break
      const take = Math.min(lot.remainingQtyBase, remaining)
      if (take <= 0) continue
      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: { remainingQtyBase: { decrement: take } },
      })
      remaining -= take
      await tx.inventoryLedger.create({
        data: {
          productId: it.productId, warehouseId: it.warehouseId, lotId: lot.id,
          movement: 'OUT', physDelta: -take, reservedDelta: 0,
          refType: ref.refType, refId: ref.refId,
          userId: ref.userId ?? null, note: ref.note ?? `خروج FEFO بچ ${lot.lotNo}`,
        },
      })
    }
    if (remaining > 0) {
      throw new ApiError(409, 'PHYSICAL_SHORTAGE',
        `موجودی فیزیکی برای خروج کافی نیست (کمبود: ${remaining} واحد پایه)`,
        { productId: it.productId, shortageBase: remaining })
    }
    // کاهش موجودی فیزیکی و رزرو به‌اندازه خروج
    const updated = await tx.$executeRaw`
      UPDATE "InventoryBalance"
      SET "physicalQtyBase" = "physicalQtyBase" - ${it.qtyBase},
          "reservedQtyBase" = "reservedQtyBase" - ${it.qtyBase}
      WHERE "productId" = ${it.productId} AND "warehouseId" = ${it.warehouseId}
        AND "physicalQtyBase" >= ${it.qtyBase} AND "reservedQtyBase" >= ${it.qtyBase}`
    if (updated === 0) {
      throw new ApiError(409, 'PHYSICAL_SHORTAGE', 'کاهش موجودی فیزیکی ناموفق بود', { productId: it.productId })
    }
  }
}

/** ورود کالا به انبار — ایجاد لات با بچ/انقضا */
export async function receiveStock(
  tx: Tx,
  input: {
    productId: string; warehouseId: string; qtyBase: number;
    lotNo: string; producedAt?: Date | null; expiresAt?: Date | null;
    supplierId?: string | null;
  },
  ref: { refType: string; refId: string | null; userId?: string | null; note?: string },
) {
  const lot = await tx.inventoryLot.create({
    data: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      lotNo: input.lotNo,
      producedAt: input.producedAt ?? null,
      expiresAt: input.expiresAt ?? null,
      supplierId: input.supplierId ?? null,
      initialQtyBase: input.qtyBase,
      remainingQtyBase: input.qtyBase,
      refType: ref.refType,
      refId: ref.refId,
    },
  })
  await tx.inventoryBalance.upsert({
    where: { productId_warehouseId: { productId: input.productId, warehouseId: input.warehouseId } },
    update: { physicalQtyBase: { increment: input.qtyBase } },
    create: {
      productId: input.productId, warehouseId: input.warehouseId,
      physicalQtyBase: input.qtyBase, reservedQtyBase: 0,
    },
  })
  await tx.inventoryLedger.create({
    data: {
      productId: input.productId, warehouseId: input.warehouseId, lotId: lot.id,
      movement: 'RECEIVE', physDelta: input.qtyBase, reservedDelta: 0,
      refType: ref.refType, refId: ref.refId,
      userId: ref.userId ?? null, note: ref.note ?? 'ورود کالا به انبار',
    },
  })
  return lot
}

/** تعدیل موجودی فیزیکی (با دلیل الزامی) */
export async function adjustStock(
  tx: Tx,
  input: { productId: string; warehouseId: string; deltaBase: number; reason: string },
  ref: { userId?: string | null; refType?: string; refId?: string },
) {
  if (input.deltaBase === 0) throw new ApiError(400, 'BAD_ADJUST', 'مقدار تعدیل نباید صفر باشد')
  if (input.deltaBase > 0) {
    await tx.inventoryBalance.upsert({
      where: { productId_warehouseId: { productId: input.productId, warehouseId: input.warehouseId } },
      update: { physicalQtyBase: { increment: input.deltaBase } },
      create: {
        productId: input.productId, warehouseId: input.warehouseId,
        physicalQtyBase: input.deltaBase, reservedQtyBase: 0,
      },
    })
  } else {
    const updated = await tx.$executeRaw`
      UPDATE "InventoryBalance"
      SET "physicalQtyBase" = "physicalQtyBase" + ${input.deltaBase}
      WHERE "productId" = ${input.productId} AND "warehouseId" = ${input.warehouseId}
        AND ("physicalQtyBase" + ${input.deltaBase}) >= 0
        AND ("physicalQtyBase" - "reservedQtyBase") >= ${-input.deltaBase}`
    if (updated === 0) {
      throw new ApiError(409, 'ADJUST_CONFLICT', 'تعدیل ناممکن است؛ موجودی فیزیکی یا رزرو کافی نیست')
    }
  }
  await tx.inventoryLedger.create({
    data: {
      productId: input.productId, warehouseId: input.warehouseId,
      movement: 'ADJUST', physDelta: input.deltaBase, reservedDelta: 0,
      refType: ref.refType ?? 'ADJUST', refId: ref.refId ?? null,
      userId: ref.userId ?? null, note: input.reason,
    },
  })
}

// مانده حساب مشتری از Ledger مالی
export async function customerBalance(tx: Tx | PrismaClient, customerId: string): Promise<number> {
  const agg = await tx.customerLedger.aggregate({
    where: { customerId },
    _sum: { amountRls: true },
  })
  return agg._sum.amountRls ?? 0
}

// بررسی کم‌موجودی پس از عملیات — برای اعلان
export async function checkLowStock(dbp: PrismaClient | Tx, productId: string, warehouseId: string) {
  const bal = await dbp.inventoryBalance.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    include: { product: true },
  })
  if (!bal) return null
  const avail = bal.physicalQtyBase - bal.reservedQtyBase
  if (avail < bal.product.reorderPointBase) {
    return { productId, productName: bal.product.name, availableBase: avail, reorderPoint: bal.product.reorderPointBase }
  }
  return null
}

void Prisma
