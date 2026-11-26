'use client'
// ورود به سامانه — دو ستونِ کاملاً قابل سفارشی‌سازی از پنل مدیریت (تب «صفحه ورود»):
//  • ستون راست (معرفی): نوشته‌ها و توضیحات + پس‌زمینه تصویر یا ویدیو + درصد تاریکی و رنگ متن
//  • ستون چپ (فرم): پس‌زمینه تصویر یا ویدیو + رنگ/شفافیت/محو بودن کارت + نوشته‌های بالا و پایین فرم
import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { apiFetch, LogoImg, hexToRgba, DEFAULT_GRADIENT_COLORS, defaultMobileConfig, type SiteIdentity, type LoginConfig, type LoginSideConfig, type LoginFormConfig } from './kit'
import type { SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

// لوگوی رسمی گوگل — چهار رنگ، بدون فایل خارجی
function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

// پیکربندی پیش‌فرض سمت کلاینت — وقتی API تنظیمات در دسترس نبود؛ مطابق پیش‌فرض‌های سرور
function fallbackSide(siteName: string, siteSlogan: string): LoginSideConfig {
  return {
    bgKind: 'none',
    bgUrl: null,
    overlay: 45,
    title: siteName,
    subtitle: siteSlogan,
    items: [
      'سفارش‌گیری ویزیتورها با رزرو اتمیک موجودی و جلوگیری از فروش بیش از موجودی',
      'موتور قیمت‌گذاری سمت سرور با قیمت اختصاصی مشتری، گروه و منطقه',
      'مدیریت بچ‌ها و تاریخ انقضا با سیاست FEFO',
      'دفتر مالی مشتریان، تأمین‌کنندگان و اسناد اصلاحی',
      'داشبورد مدیریتی و گزارش‌های فروش، انبار و وصول مطالبات',
    ],
    footer: 'این نسخه با داده‌های نمایشی (DEMO_SEED) راه‌اندازی شده است.',
    textTone: 'auto',
  }
}

function fallbackForm(siteName: string): LoginFormConfig {
  return {
    bgKind: 'none',
    bgUrl: null,
    color: '#ffffff',
    transparency: 0,
    blur: 0,
    title: `ورود به ${siteName}`,
    subtitle: 'با شماره موبایل و رمز عبور خود وارد شوید',
    footer: '',
    textTone: 'auto',
    showDemo: true,
  }
}

// پس‌زمینه تصویر یا ویدیوی تمام‌صفحه یک ستون
function SideMedia({ kind, url }: { kind: 'image' | 'video'; url: string }) {
  if (kind === 'image') {
    return <img src={url} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
  }
  return (
    <video
      src={url}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

export default function Login({ onSuccess, authError, onRetry, site }: {
  onSuccess: (u: SessionUserLike) => void
  authError?: string | null
  onRetry?: () => void
  site?: SiteIdentity | null
}) {
  const siteName = site?.name ?? 'بنکداری هوشمند'
  const siteSlogan = site?.slogan ?? 'سامانه مدیریت B2B بنکداری مواد غذایی'
  const [phone, setPhone] = useState('09120000000')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  // وضعیت ورود با گوگل — فقط وقتی مدیر فعال کرده و شناسه/رمز تنظیم شده دکمه نشان داده می‌شود
  const [googleAvailable, setGoogleAvailable] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  // پیکربندی صفحه ورود از پنل مدیریت — تا زمان پاسخ سرور، پیش‌فرض‌ها نمایش داده می‌شوند
  const [cfg, setCfg] = useState<LoginConfig | null>(null)

  // خطای بازگشت از گوگل — ?googleError=... از ریدایرکت callback
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const ge = p.get('googleError')
    if (ge) {
      setGoogleError(ge)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    apiFetch<{ enabled: boolean; configured: boolean }>('/api/auth/google/status')
      .then(s => setGoogleAvailable(s.enabled && s.configured))
      .catch(() => setGoogleAvailable(false))
  }, [])

  useEffect(() => {
    apiFetch<LoginConfig>('/api/login-settings')
      .then(setCfg)
      .catch(() => setCfg(null))
  }, [])

  const side = cfg?.side ?? fallbackSide(siteName, siteSlogan)
  const form = cfg?.form ?? fallbackForm(siteName)
  const mobile = cfg?.mobile ?? defaultMobileConfig()

  // گرادیانت متحرک موبایل — فقط وقتی روشن است و ستون فرم پس‌زمینه تصویری/ویدیویی ندارد
  const showGradient = mobile.gradientEnabled && mobile.gradientColors.length >= 2 && form.bgKind === 'none'
  // متغیرهای CSS لایه گرادیانت — رنگ‌ها، سرعت، جهت و شدت از پنل مدیریت
  const gradientStyle: React.CSSProperties = {
    '--lg-c1': mobile.gradientColors[0] ?? DEFAULT_GRADIENT_COLORS[0],
    '--lg-c2': mobile.gradientColors[1] ?? DEFAULT_GRADIENT_COLORS[1],
    '--lg-c3': mobile.gradientColors[2] ?? mobile.gradientColors[0] ?? DEFAULT_GRADIENT_COLORS[2],
    '--lg-c4': mobile.gradientColors[3] ?? mobile.gradientColors[1] ?? DEFAULT_GRADIENT_COLORS[3],
    '--lg-speed': `${mobile.gradientSpeed}s`,
    '--lg-angle': `${mobile.gradientAngle}deg`,
    '--lg-opacity': (mobile.gradientIntensity / 100).toFixed(2),
  } as React.CSSProperties

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const me = await apiFetch<SessionUserLike>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      })
      toast.success(`خوش آمدید ${me.name}`)
      onSuccess(me)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ورود ناموفق بود')
    } finally {
      setBusy(false)
    }
  }

  // شروع ورود با گوگل — داخل iframe (پیش‌نمایش) گوگل اجرا نمی‌شود؛ در تب جدید باز می‌کنیم
  const startGoogle = () => {
    try {
      if (window.self !== window.top) {
        window.open('/api/auth/google/start', '_blank')
        toast.info('ورود با گوگل در تب جدید باز شد؛ پس از ورود، تب را ببیندید و این صفحه را بازخوانی کنید.')
        return
      }
    } catch { /* دسترسی به top ممکن نیست — همان جابه‌جایی عادی */ }
    window.location.href = '/api/auth/google/start'
  }

  const fill = (p: string, pass: string) => {
    setPhone(p)
    setPassword(pass)
  }

  // ── رنگ متن هر ستون بر اساس تنظیم مدیر ──
  // auto: روی پس‌زمینه تصویری/ویدیویی متن روشن، در غیر این صورت رنگ قالب
  const sideLight = side.textTone === 'light' || (side.textTone === 'auto' && side.bgKind !== 'none')
  const formLight = form.textTone === 'light' || (form.textTone === 'auto' && form.bgKind !== 'none')

  // کارت فرم — رنگ، شفافیت و محو بودن تنظیم‌شده توسط مدیر
  const cardStyle: React.CSSProperties = {
    backgroundColor: hexToRgba(form.color, form.transparency),
    backdropFilter: form.blur > 0 ? `blur(${form.blur}px)` : undefined,
    WebkitBackdropFilter: form.blur > 0 ? `blur(${form.blur}px)` : undefined,
  }

  return (
    <div className="h-dvh overflow-hidden flex bg-stone-100">
      {/* ── ستون معرفی (سمت راست) — نوشته‌ها و توضیحات با پس‌زمینه قابل سفارشی‌سازی ── */}
      <section
        className={`hidden lg:block relative w-1/2 overflow-hidden ${
          side.bgKind === 'none' ? 'bg-sidebar text-sidebar-foreground' : 'bg-stone-900'
        }`}
      >
        {(side.bgKind === 'image' || side.bgKind === 'video') && side.bgUrl && (
          <SideMedia kind={side.bgKind} url={side.bgUrl} />
        )}
        {/* لایه تاریکی تنظیم‌شده برای خوانایی متن روی پس‌زمینه */}
        {side.bgKind !== 'none' && (
          <div className="absolute inset-0" style={{ backgroundColor: `rgba(10, 14, 20, ${(side.overlay / 100).toFixed(2)})` }} aria-hidden />
        )}

        <div className="absolute inset-0 overflow-y-auto scrollbar-none">
          <div className={`min-h-full flex flex-col justify-center gap-6 px-10 xl:px-12 py-10 ${sideLight ? 'text-white' : 'text-sidebar-foreground'}`}>
            <div className="flex items-center gap-3">
              <LogoImg
                src={site?.logoUrl}
                alt={siteName}
                className="h-12 w-12 rounded-xl object-cover"
                fallback={<span className="grid place-items-center h-12 w-12 rounded-xl bg-primary text-primary-foreground text-2xl font-black">ب</span>}
              />
              <div className="min-w-0">
                {side.title && <h1 className="text-2xl font-black">{side.title}</h1>}
                {side.subtitle && <p className={`text-sm mt-0.5 ${sideLight ? 'text-white/70' : 'text-sidebar-foreground/60'}`}>{side.subtitle}</p>}
              </div>
            </div>

            {side.items.length > 0 && (
              <ul className={`grid gap-3 text-sm ${sideLight ? 'text-white/85' : 'text-sidebar-foreground/80'}`}>
                {side.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${sideLight ? 'bg-white/60' : 'bg-sidebar-foreground/40'}`} />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            )}

            {side.footer && (
              <p className={`text-xs ${sideLight ? 'text-white/50' : 'text-sidebar-foreground/40'}`}>{side.footer}</p>
            )}
          </div>
        </div>
      </section>

      {/* ── ستون فرم ورود (سمت چپ) — کارت فرم با رنگ/شفافیت/محو بودن قابل تنظیم ── */}
      <section className="relative flex-1 overflow-hidden bg-stone-100">
        {/* گرادیانت متحرک — فقط موبایل/تبلت (lg:hidden)؛ دسکتاپ مانند قبل قالبِ پیش‌فرض را می‌بیند */}
        {/* prefers-reduced-motion: انیمیشن در CSS خاموش می‌شود و گرادیانت ثابت می‌ماند */}
        {showGradient && (
          <div aria-hidden className="bwh-login-gradient lg:hidden" style={gradientStyle} />
        )}
        {(form.bgKind === 'image' || form.bgKind === 'video') && form.bgUrl && (
          <SideMedia kind={form.bgKind} url={form.bgUrl} />
        )}

        <div className="absolute inset-0 overflow-y-auto scrollbar-none flex p-5 md:p-6">
          <form
            onSubmit={submit}
            style={cardStyle}
            className={`m-auto w-full max-w-sm rounded-2xl border shadow-sm p-6 grid gap-4 ${
              formLight ? 'border-white/30 text-white' : 'bg-card text-card-foreground'
            }`}
          >
            <div className="text-center">
              <div className="lg:hidden mb-2">
                <LogoImg
                  src={site?.logoUrl}
                  alt={siteName}
                  className="h-11 w-11 mx-auto rounded-xl object-cover"
                  fallback={<span className="grid place-items-center h-11 w-11 mx-auto rounded-xl bg-primary text-primary-foreground text-xl font-black">ب</span>}
                />
              </div>
              {form.title && <h2 className="text-lg font-bold">{form.title}</h2>}
              {form.subtitle && (
                <p className={`text-xs mt-1 ${formLight ? 'text-white/70' : 'text-muted-foreground'}`}>{form.subtitle}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="phone" className={formLight ? 'text-white/90' : ''}>شماره موبایل</Label>
              <Input
                id="phone" dir="ltr" inputMode="numeric" placeholder="09xxxxxxxxx"
                value={phone} onChange={e => setPhone(e.target.value)} required
                autoComplete="username"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password" className={formLight ? 'text-white/90' : ''}>رمز عبور</Label>
              <Input
                id="password" type="password" dir="ltr" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required
                autoComplete="current-password"
              />
            </div>
            {authError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 grid gap-2" role="alert">
                <div className="flex items-start gap-2 text-xs text-amber-900">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  <span>{authError}</span>
                </div>
                {onRetry && (
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onRetry}>
                    تلاش مجدد برای برقراری نشست
                  </Button>
                )}
              </div>
            )}
            <Button type="submit" disabled={busy} className="mt-1">
              {busy ? 'در حال ورود…' : 'ورود'}
            </Button>

            {/* ورود با گوگل — فقط وقتی مدیر فعال و پیکربندی کرده باشد */}
            {googleAvailable && (
              <>
                <div className={`flex items-center gap-3 text-[11px] ${formLight ? 'text-white/60' : 'text-muted-foreground'}`}>
                  <span className={`h-px flex-1 ${formLight ? 'bg-white/30' : 'bg-stone-200'}`} aria-hidden />
                  یا
                  <span className={`h-px flex-1 ${formLight ? 'bg-white/30' : 'bg-stone-200'}`} aria-hidden />
                </div>
                <Button type="button" variant="outline" onClick={startGoogle} className="gap-2 bg-white text-stone-700 hover:bg-white">
                  <GoogleG /> ورود با گوگل
                </Button>
                <p className={`text-[10px] text-center -mt-1 ${formLight ? 'text-white/60' : 'text-muted-foreground'}`}>
                  ورود با گوگل در تب جدید انجام می‌شود؛ با اولین ورود، حساب با نقش «کاربر آنلاین» ساخته می‌شود
                </p>
              </>
            )}

            {googleError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700" role="alert">
                ورود با گوگل ناموفق بود: {googleError}
              </div>
            )}

            {form.showDemo && (
              <div className={`rounded-lg border p-3 text-[11px] grid gap-1.5 ${
                formLight ? 'border-white/25 bg-white/10 text-white/80' : 'bg-stone-50 text-muted-foreground'
              }`}>
                <span className={`font-medium ${formLight ? 'text-white' : 'text-stone-600'}`}>حساب‌های نمایشی این محیط:</span>
                <button type="button" className="text-right hover:underline" onClick={() => fill('09120000000', 'Admin#1404')}>
                  مدیر کل: <span dir="ltr">09120000000</span> — <span dir="ltr">Admin#1404</span>
                </button>
                <button type="button" className="text-right hover:underline" onClick={() => fill('09120000005', 'Demo#1404')}>
                  ویزیتور: <span dir="ltr">09120000005</span> — <span dir="ltr">Demo#1404</span>
                </button>
                <span>سایر نقش‌ها با همان رمز نمایشی (<span dir="ltr">Demo#1404</span>) از <span dir="ltr">09120000001</span> تا <span dir="ltr">09120000009</span></span>
              </div>
            )}

            {form.footer && (
              <p className={`text-center text-xs ${formLight ? 'text-white/70' : 'text-muted-foreground'}`}>{form.footer}</p>
            )}
          </form>
        </div>
      </section>
    </div>
  )
}
