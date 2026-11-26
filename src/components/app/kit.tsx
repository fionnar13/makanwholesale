'use client'
// کیت مشترک فرانت‌اند — کلاینت API، هوک داده، قالب‌بندی و اجزای پایه UI
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatFaNumber, formatToman, jalaliDate, jalaliDateTime, ORDER_STATUS_LABELS, STATUS_BADGE_CLASS } from '@/lib/format'

export { formatFaNumber, formatToman, jalaliDate, jalaliDateTime, ORDER_STATUS_LABELS, STATUS_BADGE_CLASS }

// هویت وب‌سایت (تنظیم از پنل مدیریت → تب «وب‌سایت») + بنرهای هیرو فروشگاه
export type SiteBanner = {
  id: string
  title: string | null
  subtitle: string | null
  imageUrl: string
  linkUrl: string | null
  linkLabel: string | null
}

export type SiteIdentity = {
  name: string
  slogan: string
  logoUrl: string | null
  faviconUrl: string | null
  banners?: SiteBanner[]
}

// رویداد اطلاع‌رسانی تغییر هویت سایت — هدر/تب مرورگر بلافاصله به‌روز می‌شوند
export const SITE_CHANGED_EVENT = 'bwh:site-changed'
export function notifySiteChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SITE_CHANGED_EVENT))
}

// ─── پیکربندی صفحه ورود (تنظیم از پنل مدیریت → تب «صفحه ورود») ───

export type LoginMediaKind = 'none' | 'image' | 'video'
export type LoginTextTone = 'auto' | 'light' | 'dark'

// ستون معرفی (سمت راست در RTL) — نوشته‌ها، توضیحات و پس‌زمینه تصویری/ویدیویی
export type LoginSideConfig = {
  bgKind: LoginMediaKind
  bgUrl: string | null
  overlay: number // تاریکی روی پس‌زمینه ۰ تا ۸۰ درصد
  title: string
  subtitle: string
  items: string[] // بندهای توضیحات
  footer: string
  textTone: LoginTextTone
}

// ستون فرم ورود (سمت چپ در RTL) — پس‌زمینه، رنگ/شفافیت/محو بودن کارت و نوشته‌های بالا و پایین فرم
export type LoginFormConfig = {
  bgKind: LoginMediaKind
  bgUrl: string | null
  color: string // رنگ کارت فرم — HEX
  transparency: number // ۰ تا ۱۰۰ درصد
  blur: number // محو بودن پشت کارت ۰ تا ۲۴ پیکسل
  title: string // نوشته بالای فرم
  subtitle: string // نوشته زیر عنوان فرم
  footer: string // نوشته پایین فرم
  textTone: LoginTextTone
  showDemo: boolean // نمایش کادر حساب‌های نمایشی
}

export type LoginConfig = { side: LoginSideConfig; form: LoginFormConfig; mobile: LoginMobileConfig }

// بخش موبایل (گرادیانت متحرک) — نوع و ثابت‌ها در src/lib/login-config.ts مشترک بین سرور و کلاینت‌اند
import type { LoginMobileConfig } from '@/lib/login-config'
export { DEFAULT_GRADIENT_COLORS, defaultMobileConfig } from '@/lib/login-config'
export type { LoginMobileConfig }

// تبدیل HEX به rgba با شفافیت درصدی — برای کارت فرم
export function hexToRgba(hex: string, transparencyPercent: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return `rgba(${r}, ${g}, ${b}, ${(1 - transparencyPercent / 100).toFixed(3)})`
}

export class ApiClientError extends Error {
  code: string
  details?: unknown
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.details = details
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  // credentials: include — کوکی حتی در iframe (پیش‌نمایش) ارسال شود
  // x-bwh-proto — سرور پروتکل واقعی (HTTPS) را از دید مرورگر بداند (برای ویژگی‌های کوکی)
  const proto = typeof window !== 'undefined' ? window.location.protocol.replace(':', '') : 'http'
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-bwh-proto': proto,
      ...(init?.headers ?? {}),
    },
  })
  let json: { ok?: boolean; data?: T; error?: { code: string; message: string; details?: unknown } } | null = null
  try {
    json = await res.json()
  } catch {
    throw new ApiClientError('BAD_RESPONSE', 'پاسخ سرور معتبر نیست')
  }
  if (!json?.ok) {
    throw new ApiClientError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? 'خطای ناشناخته', json?.error?.details)
  }
  return json.data as T
}

export function useApiData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [tick, setTick] = useState(0)
  const [lastUrl, setLastUrl] = useState(url)
  const reload = useCallback(() => setTick(t => t + 1), [])

  // تطبیق وضعیت هنگام تغییر URL — الگوی رسمی React (adjusting state on prop change)
  if (lastUrl !== url) {
    setLastUrl(url)
    setData(null)
    setError(null)
    setDone(false)
  }

  useEffect(() => {
    if (!url) return
    let alive = true
    apiFetch<T>(url)
      .then(d => { if (alive) { setData(d); setError(null); setDone(true) } })
      .catch(e => { if (alive) { setError(e instanceof Error ? e.message : 'خطا'); setDone(true) } })
    return () => { alive = false }
  }, [url, tick])

  const loading = !!url && (!done || lastUrl !== url)
  return { data, loading, error, reload }
}

// بارگذاری فایل (multipart/form-data) — مثل apiFetch اما با FormData و بدون Content-Type JSON
export async function apiUpload<T>(url: string, form: FormData, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const proto = typeof window !== 'undefined' ? window.location.protocol.replace(':', '') : 'http'
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'x-bwh-proto': proto },
    body: form,
  })
  let json: { ok?: boolean; data?: T; error?: { code: string; message: string; details?: unknown } } | null = null
  try {
    json = await res.json()
  } catch {
    throw new ApiClientError('BAD_RESPONSE', 'پاسخ سرور معتبر نیست')
  }
  if (!json?.ok) {
    throw new ApiClientError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? 'خطای ناشناخته', json?.error?.details)
  }
  return json.data as T
}

// ─── بهینه‌سازی سمت کلاینت تصویر قبل از آپلود ───
// تصاویر PNG/JPEG/WEBP بزرگ با Canvas به WebP مقیاس‌شده تبدیل می‌شوند تا حجم آپلود کم شود؛
// سرور همیشه دوباره به WebP تبدیل می‌کند، پس این مرحله فقط «شتاب‌دهنده» است و در نبود پشتیبانی
// مرورگر (مثلاً رمزگذاری WebP در Safari قدیمی) فایل اصلی بدون تغییر ارسال می‌شود.
// SVG و GIF و ICO و ویدیو دست‌نخورده می‌مانند (وکتور/انیمیشن/فرمت خاص).
const CLIENT_OPTIMIZE_MIN_BYTES = 256 * 1024 // زیر ۲۵۶ کیلوبایت بهینه‌سازی لازم نیست

export async function optimizeImageBeforeUpload(file: File, opts?: {
  maxDimension?: number // سقف بزرگ‌ترین ضلع — پیش‌فرض ۲۰۴۸
  quality?: number // کیفیت WebP از ۰٫۱ تا ۱ — پیش‌فرض ۰٫۸۵
}): Promise<File> {
  const maxDimension = opts?.maxDimension ?? 2048
  const quality = opts?.quality ?? 0.85
  try {
    const isRaster = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    if (!isRaster || file.size < CLIENT_OPTIMIZE_MIN_BYTES) return file
    if (typeof createImageBitmap !== 'function') return file
    const bitmap = await createImageBitmap(file)
    try {
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
      if (scale >= 1 && file.type === 'image/webp') return file // WebP مقیاس‌شده تکراری است
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h })
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0, w, h)
      const blob: Blob | null = await new Promise(resolve => {
        if ('convertToBlob' in canvas) resolve((canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality }))
        else (canvas as HTMLCanvasElement).toBlob(b => resolve(b), 'image/webp', quality)
      })
      // اگر مرورگر WebP رمزگذاری نکرد (blob.type متفاوت) یا کوچک‌تر نشد — فایل اصلی ارسال می‌شود
      if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file
      const base = file.name.replace(/\.[^.]+$/, '')
      return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: file.lastModified })
    } finally {
      bitmap.close()
    }
  } catch {
    return file // هر خطایی در بهینه‌سازی نباید مانع آپلود شود
  }
}

// ─── اجزای نمایش ───

export function Money({ rls, className, sign }: { rls: number | null | undefined; className?: string; sign?: boolean }) {
  if (rls == null || Number.isNaN(rls)) return <span className={className}>—</span>
  const prefix = sign && rls > 0 ? '+' : ''
  return (
    <span className={className} title={`${formatFaNumber(rls)} ریال`}>
      {prefix}{formatToman(rls)}
    </span>
  )
}

export function Num({ n, className }: { n: number | null | undefined; className?: string }) {
  return <span className={className}>{n == null || Number.isNaN(n) ? '—' : formatFaNumber(n)}</span>
}

export function JDate({ d, time }: { d: string | Date | null | undefined; time?: boolean }) {
  return <span>{time ? jalaliDateTime(d) : jalaliDate(d)}</span>
}

// نشان لوگوی وب‌سایت — اگر تصویر سفارشی تنظیم شده باشد نمایش داده می‌شود، وگرنه fallback
export function LogoImg({ src, alt, className, fallback }: {
  src: string | null | undefined
  alt: string
  className: string
  fallback: ReactNode
}) {
  // الگوی رسمی React «تنظیم وضعیت هنگام رندر» — ریست خطا هنگام تغییر تصویر
  const [prevSrc, setPrevSrc] = useState(src)
  const [failed, setFailed] = useState(false)
  if (src !== prevSrc) {
    setPrevSrc(src)
    setFailed(false)
  }
  if (!src || failed) return <>{fallback}</>
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
}

// آواتار کاربر — تصویر پروفایل در صورت تنظیم، وگرنه حرف اول نام
export function UserAvatar({ name, avatarUrl, size = 'h-7 w-7 text-xs', imgClass }: {
  name: string
  avatarUrl?: string | null
  size?: string
  imgClass?: string
}) {
  // الگوی رسمی React «تنظیم وضعیت هنگام رندر» — ریست خطا هنگام تغییر تصویر
  const [prevUrl, setPrevUrl] = useState(avatarUrl)
  const [failed, setFailed] = useState(false)
  if (avatarUrl !== prevUrl) {
    setPrevUrl(avatarUrl)
    setFailed(false)
  }
  const cls = `grid place-items-center rounded-full bg-emerald-600 text-white font-bold shrink-0 overflow-hidden ${size}`
  if (avatarUrl && !failed) {
    return <img src={avatarUrl} alt={`تصویر ${name}`} className={`${cls} object-cover ${imgClass ?? ''}`} onError={() => setFailed(true)} />
  }
  return <span className={cls} aria-hidden>{name.slice(0, 1)}</span>
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge className={`border-transparent ${STATUS_BADGE_CLASS[status] ?? 'bg-stone-200 text-stone-700'}`}>
      {label ?? ORDER_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {desc && <p className="text-sm text-muted-foreground mt-1">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, hint, tone = 'default' }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad'
}) {
  const toneClass = {
    default: 'border-t-stone-300',
    good: 'border-t-emerald-500',
    warn: 'border-t-amber-500',
    bad: 'border-t-rose-500',
  }[tone]
  return (
    <div className={`rounded-xl border border-t-4 ${toneClass} bg-card p-4 shadow-sm`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-1.5">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

export function EmptyState({ text = 'داده‌ای برای نمایش نیست' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
      <Inbox className="h-8 w-8 opacity-50" aria-hidden />
      <span className="text-sm">{text}</span>
    </div>
  )
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <AlertTriangle className="h-8 w-8 text-rose-500" aria-hidden />
      <p className="text-sm text-rose-600">{text}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm underline underline-offset-4">تلاش مجدد</button>
      )}
    </div>
  )
}

export function LoadingRows({ cols = 5 }: { cols?: number }) {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}><Skeleton className="h-4 w-full max-w-24" /></TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  )
}

export function Spinner({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

// جدول عمومی — ستون‌ها به‌صورت declarative
export type Col<T> = { key: string; header: ReactNode; cell: (row: T, idx: number) => ReactNode; className?: string }

export function DataTable<T>({ columns, rows, rowKey, loading, empty, cols = columns.length }: {
  columns: Array<Col<T>>
  rows: T[]
  rowKey: (r: T) => string
  loading?: boolean
  empty?: string
  cols?: number
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-stone-50 hover:bg-stone-50">
              {columns.map(c => (
                <TableHead key={c.key} className={c.className}>{c.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          {loading ? (
            <LoadingRows cols={cols} />
          ) : rows.length === 0 ? (
            <TableBody>
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState text={empty} />
                </TableCell>
              </TableRow>
            </TableBody>
          ) : (
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={rowKey(r)}>
                  {columns.map(c => (
                    <TableCell key={c.key} className={c.className}>{c.cell(r, i)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          )}
        </Table>
      </div>
    </div>
  )
}

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}
