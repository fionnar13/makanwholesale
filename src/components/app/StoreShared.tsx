'use client'
// اجزای مشترک نمای فروشگاهی — کاشی تصویر محصول، وضعیت موجودی، انواع مشترک
// اگر محصول imageUrl داشته باشد تصویر واقعی نمایش داده می‌شود؛ در غیر این صورت
// کاشی گرافیکی متناسب با دسته‌بندی (آیکون + پالت رنگی ثابت بر اساس نام دسته)
import { Bean, CupSoda, Fish, Package, Soup } from 'lucide-react'
import type { ProductListItem } from './types'

export type StoreMeta = {
  categories: Array<{ id: string; name: string }>
  brands: Array<{ id: string; name: string; isConfirmed: boolean; categoryId: string | null; categoryName: string | null }>
}

export const COMPARE_MAX = 4

const PALETTES = [
  { bg: 'from-rose-100 to-orange-50', fg: 'text-rose-500' },
  { bg: 'from-sky-100 to-cyan-50', fg: 'text-sky-600' },
  { bg: 'from-amber-100 to-yellow-50', fg: 'text-amber-600' },
  { bg: 'from-emerald-100 to-teal-50', fg: 'text-emerald-600' },
  { bg: 'from-violet-100 to-fuchsia-50', fg: 'text-violet-600' },
  { bg: 'from-lime-100 to-green-50', fg: 'text-lime-600' },
]

// پالت رنگی پایدار بر اساس نام دسته‌بندی — محصولات یک دسته همیشه یک رنگ دارند
export function paletteFor(name: string | null) {
  if (!name) return PALETTES[0]
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTES[h % PALETTES.length]
}

// آیکون گرافیکی متناسب با دسته‌بندی — به‌صورت JSX مستقیم (بدون انتخاب کامپوننت پویا)
export function CategoryGlyph({ category, fg, className }: {
  category: string | null
  fg: string
  className: string
}) {
  const cls = `${className} ${fg}`
  if (category?.includes('نوشیدنی')) return <CupSoda className={cls} aria-hidden />
  if (category?.includes('ماهی')) return <Fish className={cls} aria-hidden />
  if (category?.includes('حبوبات')) return <Bean className={cls} aria-hidden />
  if (category?.includes('رب')) return <Soup className={cls} aria-hidden />
  return <Package className={cls} aria-hidden />
}

export function stockInfo(p: ProductListItem) {
  if (p.availableBase <= 0) return { label: 'ناموجود', cls: 'text-rose-600', dot: 'bg-rose-500' }
  if (p.availableBase < p.reorderPointBase) return { label: 'کم‌موجود', cls: 'text-amber-600', dot: 'bg-amber-500' }
  return { label: 'موجود', cls: 'text-emerald-600', dot: 'bg-emerald-500' }
}

// کاشی تصویر محصول — متناسب با موقعیت نمایش:
//   fit='cover'   → پرکردن کادر با برش کنترل‌شده (کارت محصول، بندانگشتی لیست/مقایسه) — تصویر هرگز
//                   از کانتینر بیرون نمی‌زند و کشیده نمی‌شود؛ کانتینر نسبت ابعاد ثابت دارد (بدون پرش Layout)
//   fit='contain' → نمایش کامل محصول بدون برش روی پس‌زمینه روشن (گالری جزئیات محصول)
export function ProductTile({ p, fit = 'cover' }: { p: ProductListItem; fit?: 'cover' | 'contain' }) {
  if (p.imageUrl) {
    return (
      <img
        src={p.imageUrl}
        alt={p.name}
        className={`h-full w-full ${fit === 'contain' ? 'object-contain p-2' : 'object-cover'}`}
        loading="lazy"
        decoding="async"
      />
    )
  }
  const pal = paletteFor(p.category)
  return (
    <div className={`h-full w-full bg-gradient-to-bl ${pal.bg} grid place-items-center relative`}>
      <CategoryGlyph category={p.category} fg={pal.fg} className="h-1/2 w-1/2 max-h-16 max-w-16 opacity-75" />
      <span className="absolute bottom-1.5 left-2 text-[9px] font-bold text-stone-400/90 max-w-[70%] truncate" dir="ltr">{p.sku}</span>
    </div>
  )
}
