'use client'
// لایت‌باکس نمایش تمام‌صفحه تصویر — با کلیک روی تصویر محصول باز می‌شود
// بستن: دکمه بستن، کلید Escape و کلیک روی پس‌زمینه
// ناوبری: دکمه قبلی/بعدی، کلیدهای جهت‌دار (راست‌چین: چپ = بعدی) و کشیدن لمسی در موبایل
// دسترسی‌پذیری: role=dialog، قفل اسکرول صفحه، مدیریت فوکوس و بازگرداندن آن پس از بستن
// بهینه: تصویر فقط هنگام باز بودن رندر می‌شود و هیچ تصویر بزرگی از قبل بارگذاری نمی‌شود
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { formatFaNumber } from './kit'

export type LightboxImage = { src: string; alt: string }

const SWIPE_THRESHOLD_PX = 40

export default function ImageLightbox({ images, index, onClose }: {
  images: LightboxImage[]
  index: number | null // null = بسته
  onClose: () => void
}) {
  const open = index != null && images.length > 0
  const [pos, setPos] = useState(0)
  const [lastIndex, setLastIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  // کشیدن لمسی — مبدأ pointer و نشانه جابه‌جایی (برای تمایز swipe از کلیک روی پس‌زمینه)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)

  // همگام‌سازی موقعیت با index بیرونی — الگوی رسمی React «تنظیم وضعیت هنگام رندر»
  // هر بار باز شدن از جای درست گالری شروع می‌شود
  if (index !== lastIndex) {
    setLastIndex(index)
    if (index != null && images.length > 0) {
      setPos(((index % images.length) + images.length) % images.length)
    }
  }

  const close = useCallback(() => {
    onClose()
    // بازگرداندن فوکوس به عنصری که قبل از باز شدن فعال بود
    requestAnimationFrame(() => lastFocused.current?.focus?.())
  }, [onClose])

  const next = useCallback(() => setPos(p => (p + 1) % images.length), [images.length])
  const prev = useCallback(() => setPos(p => (p - 1 + images.length) % images.length), [images.length])

  // ── قفل اسکرول صفحه + کلیدها + قفل فوکوس + ذخیره فوکوس قبلی ──
  useEffect(() => {
    if (!open) return
    lastFocused.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden' // جلوگیری از اسکرول صفحه پشت لایت‌باکس

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (images.length > 1) {
        // راست‌چین: فلش چپ = بعدی، فلش راست = قبلی
        if (e.key === 'ArrowLeft') { e.preventDefault(); next() }
        if (e.key === 'ArrowRight') { e.preventDefault(); prev() }
      }
      if (e.key === 'Tab') {
        // قفل فوکوس درون لایت‌باکس — عناصر قابل فوکوس فقط دکمه‌ها و تصویر هستند
        const focusables = containerRef.current?.querySelectorAll<HTMLElement>('button, [href]')
        if (!focusables || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        else if (!containerRef.current?.contains(document.activeElement)) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    // فوکوس اولیه روی خود کانتینر (tabIndex=-1) برای خروج تمیز با Tab
    requestAnimationFrame(() => containerRef.current?.focus())
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close, next, prev, images.length])

  // پایان کشیدن لمسی — جابه‌جایی افقی بیش از آستانه = قبلی/بعدی
  const onPointerDown = (e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY }
    moved.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointerStart.current && Math.hypot(e.clientX - pointerStart.current.x, e.clientY - pointerStart.current.y) > 8) {
      moved.current = true
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start || images.length <= 1) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      // راست‌چین: کشیدن به راست = بعدی، کشیدن به چپ = قبلی
      if (dx < 0) next(); else prev()
    }
  }

  if (!open || typeof document === 'undefined') return null
  const current = images[pos]
  const many = images.length > 1

  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`تصویر ${current.alt}`}
      className="fixed inset-0 z-[70] bg-black/92 outline-none"
      onClick={() => { if (!moved.current) close() }} // کلیک روی پس‌زمینه = بستن (کشیدن لمسی بستن نیست)
    >
      {/* دکمه بستن — گوشه بالا */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); close() }}
        aria-label="بستن نمایش تصویر"
        className="absolute top-3 left-3 z-20 grid place-items-center h-10 w-10 rounded-full bg-white/15 text-white hover:bg-white/30 transition-colors"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>

      {/* شمارنده تصاویر */}
      {many && (
        <span className="absolute top-5 right-4 z-20 rounded-full bg-white/15 text-white text-xs font-bold px-3 py-1.5" dir="ltr">
          {formatFaNumber(pos + 1)} / {formatFaNumber(images.length)}
        </span>
      )}

      {/* تصویر — بدون کشیدگی/بریدگی با object-contain */}
      <div
        className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 touch-pan-y"
        onClick={e => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          src={current.src}
          alt={current.alt}
          className="max-h-[88vh] max-w-full object-contain select-none rounded-lg shadow-2xl"
          draggable={false}
          decoding="async"
        />
      </div>

      {/* دکمه‌های قبلی/بعدی — راست‌چین: چپ = بعدی */}
      {many && (
        <>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); next() }}
            aria-label="تصویر بعدی"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20 grid place-items-center h-11 w-11 rounded-full bg-white/15 text-white hover:bg-white/30 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); prev() }}
            aria-label="تصویر قبلی"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20 grid place-items-center h-11 w-11 rounded-full bg-white/15 text-white hover:bg-white/30 transition-colors"
          >
            <ChevronRight className="h-6 w-6" aria-hidden />
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
