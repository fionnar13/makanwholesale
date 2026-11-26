'use client'
// فروشگاه محصولات — نمای فروشگاهیِ کاتالوگ برای نمایش بهترین شکل محصولات به مشتری
// همان لیستی که ویزیتور می‌بیند و به مشتری نشان می‌دهد؛ مدیر سیستم و آدمین نیز همین نما را می‌بینند
// امکانات: جستجو، فیلتر دسته‌بندی و برند (برندها وابسته به دسته‌بندی)، مرتب‌سازی،
// کارت محصول با قیمت عمومی و موجودی زنده، مشاهده جزئیات و مقایسه تا ۴ محصول،
// و برای دارندهٔ مجوز orders.create: سبد خرید و ثبت سفارش برای مشتری (StoreOrderCart)
import { useEffect, useMemo, useState } from 'react'
import { ErrorState, Money, formatFaNumber, useApiData, type SiteIdentity } from './kit'
import { COMPARE_MAX, ProductTile, stockInfo, type StoreMeta } from './StoreShared'
import CompareDialog from './StoreCompare'
import StoreHero from './StoreHero'
import StoreOrderCart, { type CartItem } from './StoreOrderCart'
import type { ProductListItem, SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Eye, GitCompareArrows, PackageX, RefreshCw, Scale, Search, ShoppingBasket, Store, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

const COMPARE_HINT = 'حداکثر ۴ محصول هم‌زمان قابل مقایسه است'
const CART_STORAGE_KEY = 'bwh-storefront-cart'

export default function StorefrontView({ user }: { user?: SessionUserLike }) {
  const { data, loading, error, reload } = useApiData<ProductListItem[]>('/api/products')
  const { data: meta } = useApiData<StoreMeta>('/api/products?meta=1')
  // بنرهای هیرو از تنظیمات وب‌سایت (مدیریت از پنل مدیریت → بنرهای فروشگاه)
  const { data: site } = useApiData<SiteIdentity>('/api/site-settings')
  const heroBanners = site?.banners ?? []
  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [brandId, setBrandId] = useState<string | null>(null)
  const [sort, setSort] = useState('newest')
  const [onlyActive, setOnlyActive] = useState(true)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)

  // ─── سبد خرید ویزیتور — در sessionStorage زنده می‌ماند (بازخوانی صفحه سبد را نمی‌بندد) ───
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) ?? '[]') as CartItem[] } catch { return [] }
  })
  const [cartOpen, setCartOpen] = useState(false)
  useEffect(() => {
    try { sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)) } catch { /* ignore */ }
  }, [cart])

  // فقط دارندهٔ مجوز ثبت سفارش (ویزیتور/مدیر) سبد و دکمه‌های افزودن را می‌بیند
  const canOrder = !!user?.permissions?.includes('orders.create')

  // جستجو و فیلتر فعال — پایه شمارش دسته‌ها و مرتب‌سازی
  const baseList = useMemo(() => {
    const needle = q.trim()
    return (data ?? []).filter(p =>
      (!onlyActive || p.isActive) &&
      (!needle ||
        p.name.includes(needle) ||
        p.sku.toLowerCase().includes(needle.toLowerCase()) ||
        (p.brand ?? '').includes(needle) ||
        (p.description ?? '').includes(needle)),
    )
  }, [data, q, onlyActive])

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of baseList) if (p.categoryId) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1)
    return m
  }, [baseList])

  // برندها وابسته به دسته‌بندی‌اند — با انتخاب دسته فقط برندهای همان دسته نمایش داده می‌شود
  const brandOptions = useMemo(
    () => (meta?.brands ?? []).filter(b => !categoryId || b.categoryId === categoryId),
    [meta, categoryId],
  )

  const filtered = useMemo(() => {
    let list = baseList.filter(p => (!categoryId || p.categoryId === categoryId) && (!brandId || p.brandId === brandId))
    const basePrice = (p: ProductListItem) =>
      p.units.find(u => u.isBase)?.defaultPriceRls ?? p.units.find(u => u.defaultPriceRls != null)?.defaultPriceRls ?? null
    switch (sort) {
      case 'priceAsc': list = [...list].sort((a, b) => (basePrice(a) ?? Infinity) - (basePrice(b) ?? Infinity)); break
      case 'priceDesc': list = [...list].sort((a, b) => (basePrice(b) ?? -Infinity) - (basePrice(a) ?? -Infinity)); break
      case 'stock': list = [...list].sort((a, b) => b.availableBase - a.availableBase); break
      case 'name': list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'fa')); break
      default: list = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    return list
  }, [baseList, categoryId, brandId, sort])

  const all = data ?? []
  const detail = detailId ? all.find(p => p.id === detailId) ?? null : null
  const compareProducts = compareIds
    .map(id => all.find(p => p.id === id))
    .filter((p): p is ProductListItem => !!p)

  const changeCategory = (id: string | null) => {
    setCategoryId(id)
    setBrandId(null) // برند انتخابی ممکن است به دسته جدید تعلق نداشته باشد
  }

  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= COMPARE_MAX) {
        toast.error(COMPARE_HINT)
        return prev
      }
      return [...prev, id]
    })
  }

  // ─── افزودن به سبد — ادغام با خط موجود، کنترل موجودی قابل فروش ───
  const addToCart = (p: ProductListItem, unitId?: string, qty = 1) => {
    const unit = (unitId ? p.units.find(u => u.id === unitId) : null)
      ?? p.units.find(u => !u.isBase && u.defaultPriceRls != null) // پیش‌فرض: کارتن (عمده)
      ?? p.units.find(u => !u.isBase)
      ?? p.units[0]
    if (!unit) { toast.error('واحد فروشی برای این محصول ثبت نشده است'); return }
    const addQty = Math.max(1, Math.floor(qty) || 1)
    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === p.id && i.unitId === unit.id)
      const existingQty = idx >= 0 ? prev[idx].qty : 0
      if (p.availableBase != null && (existingQty + addQty) * unit.factor > p.availableBase) {
        toast.error(`موجودی قابل فروش «${p.name}» کافی نیست (قابل فروش: ${formatFaNumber(p.availableBase)})`)
        return prev
      }
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + addQty }
        return next
      }
      return [...prev, {
        productId: p.id, productName: p.name, sku: p.sku, imageUrl: p.imageUrl,
        unitId: unit.id, unitName: unit.name, factor: unit.factor,
        qty: addQty, unitPriceRls: unit.defaultPriceRls, availableBase: p.availableBase,
      }]
    })
    toast.success(`«${p.name}» به سبد اضافه شد`)
  }

  return (
    <div>
      {/* هیرو اسلایدشو با بنرهای مدیر — در نبود بنر، بنر پیش‌فرض گرادیانی */}
      {heroBanners.length > 0 ? (
        <StoreHero slides={heroBanners} />
      ) : (
        <div className="rounded-2xl overflow-hidden bg-gradient-to-l from-emerald-800 via-emerald-600 to-teal-500 text-white shadow-md mb-5">
          <div className="p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <div className="text-xl md:text-2xl font-black flex items-center gap-2.5">
                <span className="grid place-items-center h-10 w-10 rounded-xl bg-white/15" aria-hidden><Store className="h-5 w-5" /></span>
                فروشگاه محصولات
              </div>
              <p className="text-xs md:text-sm text-white/80 mt-2 leading-6 max-w-2xl">
                همان کاتالوگی که ویزیتور به مشتری نشان می‌دهد — با قیمت عمومی، موجودی زنده و امکان مقایسه؛
                مدیر سیستم و آدمین نیز همین نما را می‌بینند
              </p>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" aria-hidden />
              <Input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="جستجوی نام، برند یا SKU…"
                aria-label="جستجوی محصول"
                className="bg-white/95 text-stone-800 border-0 pr-9 placeholder:text-stone-400"
              />
            </div>
            {canOrder && (
              <Button
                size="sm" onClick={() => setCartOpen(true)}
                className="bg-white text-emerald-700 hover:bg-emerald-50 shrink-0 relative"
                aria-label="باز کردن سبد سفارش مشتری"
              >
                <ShoppingBasket className="h-4 w-4 ml-1" /> سبد سفارش مشتری
                {cart.length > 0 && (
                  <span className="absolute -top-1.5 -left-1.5 grid place-items-center h-5 min-w-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                    {formatFaNumber(cart.length)}
                  </span>
                )}
              </Button>
            )}
            <Button
              variant="outline" size="sm" onClick={reload}
              className="bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white shrink-0"
            >
              <RefreshCw className="h-4 w-4 ml-1" /> به‌روزرسانی
            </Button>
          </div>
        </div>
      )}

      {/* نوار جستجو و به‌روزرسانی — فقط در حالت اسلایدشو (در بنر پیش‌فرض داخل همان است) */}
      {heroBanners.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" aria-hidden />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="جستجوی نام، برند یا SKU…"
              aria-label="جستجوی محصول"
              className="bg-card pr-9 placeholder:text-stone-400"
            />
          </div>
          {canOrder && (
            <Button variant="outline" size="sm" onClick={() => setCartOpen(true)} className="shrink-0 relative">
              <ShoppingBasket className="h-4 w-4 ml-1" /> سبد سفارش مشتری
              {cart.length > 0 && (
                <span className="absolute -top-1.5 -left-1.5 grid place-items-center h-5 min-w-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                  {formatFaNumber(cart.length)}
                </span>
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={reload} className="shrink-0">
            <RefreshCw className="h-4 w-4 ml-1" /> به‌روزرسانی
          </Button>
        </div>
      )}

      {/* فیلتر دسته‌بندی‌ها */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2" role="group" aria-label="فیلتر دسته‌بندی">
        <Chip active={categoryId === null} onClick={() => changeCategory(null)}>همه دسته‌ها</Chip>
        {meta?.categories?.map(c => (
          <Chip key={c.id} active={categoryId === c.id} onClick={() => changeCategory(c.id)}>
            {c.name}
            <span className="mr-1 rounded-full bg-black/10 px-1.5 text-[10px] leading-5">{formatFaNumber(catCounts.get(c.id) ?? 0)}</span>
          </Chip>
        ))}
      </div>

      {/* فیلتر برندها — وابسته به دسته‌بندی انتخابی */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3" role="group" aria-label="فیلتر برند">
        <Chip tone="brand" active={brandId === null} onClick={() => setBrandId(null)}>همه برندها</Chip>
        {brandOptions.map(b => (
          <Chip key={b.id} tone="brand" active={brandId === b.id} onClick={() => setBrandId(b.id)}>
            {b.name}{!b.isConfirmed && <span className="text-[9px] opacity-70"> (نیازمند تأیید)</span>}
          </Chip>
        ))}
        {brandOptions.length === 0 && (
          <span className="text-[11px] text-muted-foreground">برندی برای این دسته ثبت نشده است</span>
        )}
      </div>

      {/* نوار ابزار */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">مرتب‌سازی:</span>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="ترتیب نمایش"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">جدیدترین</SelectItem>
              <SelectItem value="name">نام (الفبا)</SelectItem>
              <SelectItem value="priceAsc">ارزان‌ترین</SelectItem>
              <SelectItem value="priceDesc">گران‌ترین</SelectItem>
              <SelectItem value="stock">بیشترین موجودی</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <Switch checked={onlyActive} onCheckedChange={setOnlyActive} aria-label="فقط کالاهای فعال" />
          فقط کالاهای فعال
        </label>
        <span className="text-xs text-muted-foreground mr-auto">
          {loading ? 'در حال بارگذاری…' : `${formatFaNumber(filtered.length)} کالا`}
        </span>
      </div>

      {/* شبکه محصولات */}
      {error ? (
        <ErrorState text={error} onRetry={reload} />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border bg-card py-14 text-center">
          <PackageX className="h-10 w-10 text-stone-300 mx-auto" aria-hidden />
          <p className="text-sm text-muted-foreground mt-3">محصولی با این فیلترها یافت نشد</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { setQ(''); changeCategory(null); setBrandId(null) }}>
            پاک کردن فیلترها
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(p => (
            <ProductCard
              key={p.id}
              p={p}
              inCompare={compareIds.includes(p.id)}
              onToggleCompare={() => toggleCompare(p.id)}
              onDetail={() => setDetailId(p.id)}
              canAdd={canOrder}
              onAdd={() => addToCart(p)}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-6 leading-5">
        قیمت‌های نمایش‌داده‌شده «قیمت عمومی» است؛ قیمت اختصاصی هر مشتری بر اساس قواعد قیمت‌گذاری
        (گروه مشتری، منطقه، مقدار خرید یا اختصاصی) در لحظه ثبت سفارش محاسبه می‌شود. {COMPARE_HINT}.
      </p>

      {/* نوار شناور مقایسه */}
      {compareIds.length > 0 && (
        <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-stone-900/95 text-white shadow-2xl border border-stone-700 py-2 pr-4 pl-2 max-w-full overflow-x-auto">
            <span className="text-xs text-white/60 whitespace-nowrap shrink-0 hidden sm:block">انتخاب مقایسه:</span>
            {compareProducts.map(p => (
              <span key={p.id} className="flex items-center gap-1 rounded-full bg-white/10 py-1 pr-3 pl-1.5 text-[11px] whitespace-nowrap">
                {p.name.length > 20 ? `${p.name.slice(0, 20)}…` : p.name}
                <button
                  onClick={() => toggleCompare(p.id)}
                  aria-label={`حذف ${p.name} از مقایسه`}
                  className="rounded-full hover:bg-white/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Button
              size="sm"
              disabled={compareIds.length < 2}
              onClick={() => setCompareOpen(true)}
              className="rounded-full bg-emerald-500 hover:bg-emerald-600 text-white h-8 shrink-0"
              title={compareIds.length < 2 ? 'حداقل دو محصول برای مقایسه لازم است' : undefined}
            >
              <Scale className="h-4 w-4 ml-1" /> مقایسه ({formatFaNumber(compareIds.length)})
            </Button>
            <button onClick={() => setCompareIds([])} aria-label="پاک کردن انتخاب مقایسه" className="rounded-full hover:bg-white/20 p-1.5 shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <ProductDetailDialog p={detail} canOrder={canOrder} onAddUnit={u => detail && addToCart(detail, u)} onClose={() => setDetailId(null)} />
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} products={compareProducts} onRemove={toggleCompare} />

      {/* نوار شناور سبد — وقتی مقایسه فعال است بالاتر می‌ایستد تا با هم تداخل نکنند */}
      {canOrder && cart.length > 0 && (
        <div className={`fixed inset-x-0 z-40 flex justify-center px-4 pointer-events-none ${compareIds.length > 0 ? 'bottom-20' : 'bottom-4'}`}>
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-emerald-600 text-white shadow-2xl border border-emerald-700 py-2 pr-4 pl-2">
            <ShoppingBasket className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-xs font-bold whitespace-nowrap">{formatFaNumber(cart.length)} قلم در سبد</span>
            <span className="text-[11px] whitespace-nowrap opacity-90 hidden sm:block">
              تخمین با قیمت عمومی: <Money rls={cart.reduce((s, i) => s + (i.unitPriceRls ?? 0) * i.qty, 0)} className="font-bold" />
            </span>
            <Button
              size="sm" onClick={() => setCartOpen(true)}
              className="rounded-full bg-white text-emerald-700 hover:bg-emerald-50 h-8 shrink-0"
            >
              مشاهده و ثبت سفارش
            </Button>
            <button onClick={() => setCart([])} aria-label="خالی کردن سبد" className="rounded-full hover:bg-white/20 p-1.5 shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {canOrder && user && (
        <StoreOrderCart open={cartOpen} onOpenChange={setCartOpen} user={user} items={cart} onItemsChange={setCart} />
      )}
    </div>
  )
}

// ─── کارت محصول ───

function ProductCard({ p, inCompare, onToggleCompare, onDetail, canAdd, onAdd }: {
  p: ProductListItem
  inCompare: boolean
  onToggleCompare: () => void
  onDetail: () => void
  canAdd: boolean
  onAdd: () => void
}) {
  const base = p.units.find(u => u.isBase) ?? null
  const carton = p.units.find(u => !u.isBase && u.defaultPriceRls != null) ?? p.units.find(u => !u.isBase) ?? null
  const headline = carton ?? base // قیمت کارتن (عمده) در صدر؛ در نبود آن قیمت واحد پایه
  const secondary = headline && base && headline.id !== base.id ? base : null
  const st = stockInfo(p)

  return (
    <div className="group rounded-2xl border bg-card overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all flex flex-col">
      <div className="relative aspect-[4/3] overflow-hidden">
        <ProductTile p={p} />
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {p.isDemo && <Badge variant="outline" className="text-[9px] bg-white/90 text-amber-700 border-amber-300 backdrop-blur">DEMO_SEED</Badge>}
          {!p.isActive && <Badge variant="outline" className="text-[9px] bg-white/90 text-rose-600 border-rose-300 backdrop-blur">غیرفعال</Badge>}
        </div>
        {p.category && (
          <span className="absolute top-2 left-2 rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-[10px] font-bold text-stone-600 shadow-sm">
            {p.category}
          </span>
        )}
        {p.brand && (
          <span className="absolute bottom-2 right-2 rounded-full bg-stone-900/75 backdrop-blur px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">
            {p.brand}
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <button onClick={onDetail} className="text-right" title="نمایش جزئیات محصول">
          <div className="text-sm font-bold leading-6 line-clamp-2 min-h-[3rem]">{p.name}</div>
        </button>
        {p.description && <p className="text-[11px] text-muted-foreground leading-5 line-clamp-2">{p.description}</p>}

        <div className="flex items-center gap-1.5 text-[11px]">
          <span className={`h-2 w-2 rounded-full ${st.dot}`} aria-hidden />
          <span className={st.cls}>{st.label}</span>
          <span className="text-muted-foreground">— موجودی: {formatFaNumber(p.availableBase)} {p.baseUnitName}</span>
        </div>

        <div className="mt-auto pt-2 border-t border-dashed">
          {headline?.defaultPriceRls != null ? (
            <>
              <Money rls={headline.defaultPriceRls} className="text-base font-black text-emerald-700" />
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {headline.name}
                {secondary?.defaultPriceRls != null && (
                  <> | {secondary.name}: <Money rls={secondary.defaultPriceRls} className="font-bold text-stone-600" /></>
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground py-1">بدون قیمت عمومی ثبت‌شده</div>
          )}
        </div>

        {p.minOrderQtyBase > 1 && (
          <p className="text-[10px] text-muted-foreground">حداقل سفارش: {formatFaNumber(p.minOrderQtyBase)} {p.baseUnitName}</p>
        )}

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={onDetail}>
            <Eye className="h-3.5 w-3.5 ml-1" /> جزئیات
          </Button>
          {canAdd && (
            <Button
              size="sm" onClick={onAdd}
              className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              title="افزودن به سبد سفارش مشتری"
            >
              <ShoppingBasket className="h-3.5 w-3.5 ml-1" /> سبد
            </Button>
          )}
          <Button
            size="sm"
            variant={inCompare ? 'default' : 'outline'}
            onClick={onToggleCompare}
            aria-pressed={inCompare}
            className={`flex-1 h-8 text-xs ${inCompare ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
          >
            <GitCompareArrows className="h-3.5 w-3.5 ml-1" /> {inCompare ? 'در مقایسه' : 'مقایسه'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── مشاهده جزئیات محصول ───

function ProductDetailDialog({ p, canOrder, onAddUnit, onClose }: {
  p: ProductListItem | null
  canOrder: boolean
  onAddUnit: (unitId: string) => void
  onClose: () => void
}) {
  const st = p ? stockInfo(p) : null
  return (
    <Dialog open={!!p} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {p && st && (
          <>
            <DialogHeader>
              <DialogTitle>{p.name}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-1.5 pt-1">
                {p.brand && <Badge variant="secondary" className="text-[10px]">{p.brand}{!p.brandConfirmed && ' (نیازمند تأیید)'}</Badge>}
                {p.category && <Badge variant="outline" className="text-[10px]">{p.category}</Badge>}
                {p.isDemo && <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-300">DEMO_SEED</Badge>}
                {!p.isActive && <Badge variant="outline" className="text-[9px] text-rose-600 border-rose-300">غیرفعال</Badge>}
              </DialogDescription>
            </DialogHeader>

            {/* ارتفاع ثابت — aspect-ratio روی آیتم گریدِ Dialog در Chrome ردیف را به‌هم می‌ریزد */}
            <div className="rounded-xl overflow-hidden h-52 sm:h-60 border bg-stone-50">
              <ProductTile p={p} />
            </div>

            {p.description && <p className="text-xs text-stone-600 leading-6">{p.description}</p>}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <SpecBox label="موجودی قابل فروش" value={`${formatFaNumber(p.availableBase)} ${p.baseUnitName}`} />
              <SpecBox label="وضعیت موجودی" value={st.label} />
              <SpecBox label="حداقل سفارش" value={`${formatFaNumber(p.minOrderQtyBase)} ${p.baseUnitName}`} />
              <SpecBox label="مضرب سفارش" value={formatFaNumber(p.orderMultipleBase)} />
              {p.weightG != null && <SpecBox label="وزن" value={`${formatFaNumber(p.weightG)} گرم`} />}
              {p.volumeMl != null && <SpecBox label="حجم" value={`${formatFaNumber(p.volumeMl)} میلی‌لیتر`} />}
              {p.packagingType && <SpecBox label="نوع بسته‌بندی" value={p.packagingType} />}
              <SpecBox label="SKU" value={p.sku} ltr />
            </div>

            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50 hover:bg-stone-50">
                    <TableHead>واحد فروش</TableHead>
                    <TableHead>فاکتور پایه</TableHead>
                    <TableHead>بارکد</TableHead>
                    <TableHead>قیمت عمومی</TableHead>
                    {canOrder && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.units.map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="text-xs font-medium">
                        {u.name}
                        {u.isBase && <Badge variant="secondary" className="text-[9px] mr-1.5">پایه</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">×{formatFaNumber(u.factor)}</TableCell>
                      <TableCell className="text-[11px]" dir="ltr">{u.barcode ?? '—'}</TableCell>
                      <TableCell>
                        {u.defaultPriceRls != null
                          ? <Money rls={u.defaultPriceRls} className="text-xs font-bold text-emerald-700" />
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      {canOrder && (
                        <TableCell>
                          <Button
                            size="sm" variant="outline" className="h-7 text-[11px]"
                            onClick={() => onAddUnit(u.id)}
                            title="افزودن این واحد به سبد سفارش مشتری"
                          >
                            <ShoppingBasket className="h-3 w-3 ml-1" /> افزودن
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-[10px] text-muted-foreground leading-5">
              قیمت عمومی مبنای نمایش است؛ قیمت نهایی هر مشتری طبق قواعد قیمت‌گذاری (گروه، منطقه، مقدار خرید یا اختصاصی)
              هنگام ثبت سفارش توسط سرور محاسبه می‌شود.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SpecBox({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-lg border bg-stone-50 p-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-bold mt-1" dir={ltr ? 'ltr' : undefined}>{value}</div>
    </div>
  )
}

// ─── چیپ فیلتر ───

function Chip({ active, onClick, children, tone = 'cat' }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  tone?: 'cat' | 'brand'
}) {
  const activeCls = tone === 'brand'
    ? 'bg-stone-800 text-white border-stone-800 shadow-sm'
    : 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? activeCls : 'bg-card text-stone-600 border-stone-200 hover:border-emerald-400 hover:text-emerald-700'
      }`}
    >
      {children}
    </button>
  )
}
