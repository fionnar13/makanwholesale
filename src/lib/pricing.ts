// موتور قیمت‌گذاری — کاملاً سمت سرور
// اولویت: CUSTOMER > GROUP > TERRITORY > VOLUME > DEFAULT
// در هر سطح: بیشترین minQty (خاص‌تر) برنده است؛ تساوی کامل دو قاعدهِ فعالِ ناسازگار
// یعنی خطای پیکربندی و خطا صادر می‌شود.
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'

export type ResolveInput = {
  productId: string
  unitId: string
  qtyBase: number
  customerId: string
}

export type ResolvedPrice = {
  priceRls: number
  unitFactor: number
  ruleId: string | null
  scope: string
  note: string | null
}

type Rule = {
  id: string
  scope: string
  refId: string | null
  priceRls: number
  minQtyBase: number
  note: string | null
  createdAt: Date
}

function inWindow(r: { startAt: Date | null; endAt: Date | null }): boolean {
  const now = Date.now()
  if (r.startAt && r.startAt.getTime() > now) return false
  if (r.endAt && r.endAt.getTime() < now) return false
  return true
}

const SCOPE_PRIORITY: Record<string, number> = {
  CUSTOMER: 100,
  GROUP: 80,
  TERRITORY: 60,
  VOLUME: 40,
  DEFAULT: 20,
}

export async function resolvePrice(input: ResolveInput): Promise<ResolvedPrice> {
  const { productId, unitId, qtyBase, customerId } = input

  const unit = await db.productUnit.findUnique({ where: { id: unitId } })
  if (!unit || unit.productId !== productId) {
    throw new ApiError(400, 'BAD_UNIT', 'واحد فروش برای این کالا معتبر نیست')
  }

  const customer = await db.customer.findUnique({ where: { id: customerId } })
  if (!customer) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'مشتری یافت نشد')

  const rules = await db.priceRule.findMany({
    where: { productId, unitId, isActive: true },
  })
  const valid = rules.filter(r => inWindow(r) && r.minQtyBase <= qtyBase && (!r.maxQtyBase || qtyBase <= r.maxQtyBase))

  // قاعده‌های منطبق بر مشتری
  const scoped = valid.filter(r => {
    switch (r.scope) {
      case 'CUSTOMER': return r.refId === customer.id
      case 'GROUP': return r.refId === customer.groupKey
      case 'TERRITORY': return !!customer.territoryId && r.refId === customer.territoryId
      case 'VOLUME': return true // با محدودیت qty قبلاً فیلتر شده
      case 'DEFAULT': return true
      default: return false
    }
  })

  if (scoped.length === 0) {
    throw new ApiError(409, 'NO_PRICE_RULE', 'قیمت معتبری برای این کالا/واحد تعریف نشده است', { productId, unitId })
  }

  // سطح اولویت بالاتر را انتخاب کن
  const topScore = Math.max(...scoped.map(r => SCOPE_PRIORITY[r.scope] ?? 0))
  let candidates = scoped.filter(r => (SCOPE_PRIORITY[r.scope] ?? 0) === topScore)
  // خاص‌ترین (بیشترین minQty)
  const maxMin = Math.max(...candidates.map(r => r.minQtyBase))
  candidates = candidates.filter(r => r.minQtyBase === maxMin)

  if (candidates.length > 1) {
    const prices = new Set(candidates.map(c => c.priceRls))
    if (prices.size > 1) {
      // تساوی اولویت با قیمت متفاوت — خطای پیکربندی صریح
      throw new ApiError(409, 'AMBIGUOUS_PRICE_RULES',
        'دو قاعده قیمت هم‌اولویت و ناسازگار برای این کالا تعریف شده است؛ پیکربندی قیمت‌ها را اصلاح کنید',
        { ruleIds: candidates.map(c => c.id) })
    }
    // قیمت برابر اما چند قاعده — آخرین ایجادشده ملاک است
    candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }
  const rule = candidates[0]

  return {
    priceRls: rule.priceRls,
    unitFactor: unit.factor,
    ruleId: rule.id,
    scope: rule.scope,
    note: rule.note,
  }
}

// قیمت چند قلم سفارش با Snapshot کامل
export type PricedItem = { productId: string; unitId: string; qtyBase: number } & ResolvedPrice

export async function resolveOrderPrices(
  items: Array<{ productId: string; unitId: string; qtyBase: number }>,
  customerId: string,
): Promise<PricedItem[]> {
  const results: PricedItem[] = []
  for (const it of items) {
    const price = await resolvePrice({ productId: it.productId, unitId: it.unitId, qtyBase: it.qtyBase, customerId })
    results.push({ ...it, ...price })
  }
  return results
}
