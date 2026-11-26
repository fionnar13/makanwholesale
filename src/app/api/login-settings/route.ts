// سفارشی‌سازی صفحه ورود — پس‌زمینه تصویری/ویدیویی دو ستون، رنگ و شفافیت فرم، نوشته‌ها
// GET عمومی است (صفحه ورود قبل از احراز هویت)؛ PUT فقط با مجوز users.manage
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { handler, ok, parseBody } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { DEFAULT_SITE_NAME, DEFAULT_SITE_SLOGAN } from '@/app/api/site-settings/route'
import { DEFAULT_GRADIENT_COLORS, type LoginMobileConfig } from '@/lib/login-config'
import type { LoginConfig, LoginFormConfig, LoginSideConfig } from '@/components/app/kit'

// کلیدهای تنظیمات صفحه ورود در جدول Setting — هر فیلد یک کلید
const KEYS = [
  'login.side.bgKind', 'login.side.bgUrl', 'login.side.overlay', 'login.side.title',
  'login.side.subtitle', 'login.side.items', 'login.side.footer', 'login.side.textTone',
  'login.form.bgKind', 'login.form.bgUrl', 'login.form.color', 'login.form.transparency',
  'login.form.blur', 'login.form.title', 'login.form.subtitle', 'login.form.footer',
  'login.form.textTone', 'login.form.showDemo',
  'login.mobile.gradientEnabled', 'login.mobile.gradientColors', 'login.mobile.gradientSpeed',
  'login.mobile.gradientAngle', 'login.mobile.gradientIntensity',
] as const

// بندهای پیش‌فرض ستون معرفی — تا وقتی مدیر چیزی ثبت نکرده باشد
const DEFAULT_SIDE_ITEMS = [
  'سفارش‌گیری ویزیتورها با رزرو اتمیک موجودی و جلوگیری از فروش بیش از موجودی',
  'موتور قیمت‌گذاری سمت سرور با قیمت اختصاصی مشتری، گروه و منطقه',
  'مدیریت بچ‌ها و تاریخ انقضا با سیاست FEFO',
  'دفتر مالی مشتریان، تأمین‌کنندگان و اسناد اصلاحی',
  'داشبورد مدیریتی و گزارش‌های فروش، انبار و وصول مطالبات',
]

const DEFAULT_SIDE_FOOTER = 'این نسخه با داده‌های نمایشی (DEMO_SEED) راه‌اندازی شده است.'

function toBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback
  return v === '1'
}

function toInt(v: string | undefined, fallback: number, min: number, max: number): number {
  if (v === undefined) return fallback
  const n = Number.parseInt(v, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

async function readLoginConfig(): Promise<LoginConfig> {
  const [rows, siteRows] = await Promise.all([
    db.setting.findMany({ where: { key: { in: [...KEYS] } } }),
    db.setting.findMany({ where: { key: { in: ['site.name', 'site.slogan'] } } }),
  ])
  const map = Object.fromEntries(rows.map(r => [r.key, r.value])) as Record<string, string>
  const siteMap = Object.fromEntries(siteRows.map(r => [r.key, r.value])) as Record<string, string>
  const siteName = siteMap['site.name'] || DEFAULT_SITE_NAME
  const siteSlogan = siteMap['site.slogan'] || DEFAULT_SITE_SLOGAN

  // پس‌زمینه — فقط وقتی هم نوع و هم فایل معتبر ثبت شده باشد اعمال می‌شود
  const sideBgKind = map['login.side.bgKind']
  const sideBgUrl = map['login.side.bgUrl'] || ''
  const sideHasMedia = (sideBgKind === 'image' || sideBgKind === 'video') && sideBgUrl.startsWith('/uploads/login/')
  const formBgKind = map['login.form.bgKind']
  const formBgUrl = map['login.form.bgUrl'] || ''
  const formHasMedia = (formBgKind === 'image' || formBgKind === 'video') && formBgUrl.startsWith('/uploads/login/')

  const side: LoginSideConfig = {
    bgKind: sideHasMedia ? (sideBgKind as 'image' | 'video') : 'none',
    bgUrl: sideHasMedia ? sideBgUrl : null,
    overlay: toInt(map['login.side.overlay'], 45, 0, 80),
    // مقدار خالی ثبت‌شده توسط مدیر = پاک‌کردن عمدی متن (بدون fallback)
    title: map['login.side.title'] !== undefined ? map['login.side.title'] : siteName,
    subtitle: map['login.side.subtitle'] !== undefined ? map['login.side.subtitle'] : siteSlogan,
    items: map['login.side.items'] !== undefined
      ? map['login.side.items'].split('\n').map(s => s.trim()).filter(Boolean)
      : DEFAULT_SIDE_ITEMS,
    footer: map['login.side.footer'] !== undefined ? map['login.side.footer'] : DEFAULT_SIDE_FOOTER,
    textTone: (map['login.side.textTone'] as LoginSideConfig['textTone']) || 'auto',
  }

  const form: LoginFormConfig = {
    bgKind: formHasMedia ? (formBgKind as 'image' | 'video') : 'none',
    bgUrl: formHasMedia ? formBgUrl : null,
    color: /^#[0-9a-fA-F]{6}$/.test(map['login.form.color'] ?? '') ? map['login.form.color'] : '#ffffff',
    transparency: toInt(map['login.form.transparency'], 0, 0, 100),
    blur: toInt(map['login.form.blur'], 0, 0, 24),
    title: map['login.form.title'] !== undefined ? map['login.form.title'] : `ورود به ${siteName}`,
    subtitle: map['login.form.subtitle'] !== undefined
      ? map['login.form.subtitle']
      : 'با شماره موبایل و رمز عبور خود وارد شوید',
    footer: map['login.form.footer'] ?? '',
    textTone: (map['login.form.textTone'] as LoginFormConfig['textTone']) || 'auto',
    showDemo: toBool(map['login.form.showDemo'], true),
  }

  // گرادیانت متحرک موبایل — رنگ‌های نامعتبر حذف و در نبود حداقل دو رنگ، پیش‌فرض اعمال می‌شود
  const colors = (map['login.mobile.gradientColors'] ?? '')
    .split(',')
    .map(c => c.trim().toLowerCase())
    .filter(c => /^#[0-9a-fA-F]{6}$/.test(c))
  const mobile: LoginMobileConfig = {
    gradientEnabled: toBool(map['login.mobile.gradientEnabled'], true),
    gradientColors: colors.length >= 2 ? colors : DEFAULT_GRADIENT_COLORS,
    gradientSpeed: toInt(map['login.mobile.gradientSpeed'], 14, 4, 60),
    gradientAngle: toInt(map['login.mobile.gradientAngle'], 135, 0, 360),
    gradientIntensity: toInt(map['login.mobile.gradientIntensity'], 60, 20, 100),
  }

  return { side, form, mobile }
}

export async function GET() {
  return handler(async () => {
    return ok(await readLoginConfig())
  })
}

// nullish — کلاینت وقتی پس‌زمینه‌ای الصاق نشده باشد bgUrl را null می‌فرستد و باید پذیرفته شود
const bgUrlField = z.string().max(300)
  .refine(v => v === '' || v.startsWith('/uploads/login/'), 'نشانی پس‌زمینه نامعتبر است')
  .nullish()

const sideSchema = z.object({
  bgKind: z.enum(['none', 'image', 'video']).optional(),
  bgUrl: bgUrlField.optional(),
  overlay: z.number().int().min(0).max(80, 'میزان تاریکی باید بین ۰ تا ۸۰ درصد باشد').optional(),
  title: z.string().trim().max(80, 'عنوان حداکثر ۸۰ کاراکتر است').optional(),
  subtitle: z.string().trim().max(160, 'زیرعنوان حداکثر ۱۶۰ کاراکتر است').optional(),
  items: z.array(z.string().trim().max(160, 'هر بند حداکثر ۱۶۰ کاراکتر است')).max(8, 'حداکثر ۸ بند').optional(),
  footer: z.string().trim().max(200, 'متن پایین حداکثر ۲۰۰ کاراکتر است').optional(),
  textTone: z.enum(['auto', 'light', 'dark']).optional(),
})

const formSchema = z.object({
  bgKind: z.enum(['none', 'image', 'video']).optional(),
  bgUrl: bgUrlField.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'رنگ فرم باید به شکل HEX باشد (مثل #ffffff)').optional(),
  transparency: z.number().int().min(0).max(100, 'شفافیت باید بین ۰ تا ۱۰۰ درصد باشد').optional(),
  blur: z.number().int().min(0).max(24, 'میزان محو بودن باید بین ۰ تا ۲۴ پیکسل باشد').optional(),
  title: z.string().trim().max(80, 'عنوان حداکثر ۸۰ کاراکتر است').optional(),
  subtitle: z.string().trim().max(160, 'زیرعنوان حداکثر ۱۶۰ کاراکتر است').optional(),
  footer: z.string().trim().max(200, 'متن پایین فرم حداکثر ۲۰۰ کاراکتر است').optional(),
  textTone: z.enum(['auto', 'light', 'dark']).optional(),
  showDemo: z.boolean().optional(),
})

// گرادیانت متحرک موبایل — ۲ تا ۵ رنگ HEX، سرعت/جهت/شدت با محدوده مجاز
const mobileSchema = z.object({
  gradientEnabled: z.boolean().optional(),
  gradientColors: z.array(
    z.string().regex(/^#[0-9a-fA-F]{6}$/, 'هر رنگ باید HEX شش‌رقمی باشد (مثل #10b981)'),
  ).min(2, 'حداقل دو رنگ لازم است').max(5, 'حداکثر پنج رنگ').optional(),
  gradientSpeed: z.number().int().min(4, 'سرعت باید بین ۴ تا ۶۰ ثانیه باشد').max(60, 'سرعت باید بین ۴ تا ۶۰ ثانیه باشد').optional(),
  gradientAngle: z.number().int().min(0, 'جهت باید بین ۰ تا ۳۶۰ درجه باشد').max(360, 'جهت باید بین ۰ تا ۳۶۰ درجه باشد').optional(),
  gradientIntensity: z.number().int().min(20, 'شدت باید بین ۲۰ تا ۱۰۰ درصد باشد').max(100, 'شدت باید بین ۲۰ تا ۱۰۰ درصد باشد').optional(),
})

const putSchema = z.object({
  side: sideSchema.optional(),
  form: formSchema.optional(),
  mobile: mobileSchema.optional(),
}).refine(v => v.side !== undefined || v.form !== undefined || v.mobile !== undefined, 'داده‌ای برای ذخیره ارسال نشده است')

export async function PUT(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, putSchema)
    const before = await readLoginConfig()

    const updates: Array<{ key: string; value: string }> = []
    const s = body.side
    if (s) {
      if (s.bgKind !== undefined) updates.push({ key: 'login.side.bgKind', value: s.bgKind === 'none' ? '' : s.bgKind })
      if (s.bgUrl !== undefined) updates.push({ key: 'login.side.bgUrl', value: s.bgUrl ?? '' })
      if (s.overlay !== undefined) updates.push({ key: 'login.side.overlay', value: String(s.overlay) })
      if (s.title !== undefined) updates.push({ key: 'login.side.title', value: s.title })
      if (s.subtitle !== undefined) updates.push({ key: 'login.side.subtitle', value: s.subtitle })
      if (s.items !== undefined) updates.push({ key: 'login.side.items', value: s.items.join('\n') })
      if (s.footer !== undefined) updates.push({ key: 'login.side.footer', value: s.footer })
      if (s.textTone !== undefined) updates.push({ key: 'login.side.textTone', value: s.textTone })
    }
    const f = body.form
    if (f) {
      if (f.bgKind !== undefined) updates.push({ key: 'login.form.bgKind', value: f.bgKind === 'none' ? '' : f.bgKind })
      if (f.bgUrl !== undefined) updates.push({ key: 'login.form.bgUrl', value: f.bgUrl ?? '' })
      if (f.color !== undefined) updates.push({ key: 'login.form.color', value: f.color.toLowerCase() })
      if (f.transparency !== undefined) updates.push({ key: 'login.form.transparency', value: String(f.transparency) })
      if (f.blur !== undefined) updates.push({ key: 'login.form.blur', value: String(f.blur) })
      if (f.title !== undefined) updates.push({ key: 'login.form.title', value: f.title })
      if (f.subtitle !== undefined) updates.push({ key: 'login.form.subtitle', value: f.subtitle })
      if (f.footer !== undefined) updates.push({ key: 'login.form.footer', value: f.footer })
      if (f.textTone !== undefined) updates.push({ key: 'login.form.textTone', value: f.textTone })
      if (f.showDemo !== undefined) updates.push({ key: 'login.form.showDemo', value: f.showDemo ? '1' : '0' })
    }
    const m = body.mobile
    if (m) {
      if (m.gradientEnabled !== undefined) updates.push({ key: 'login.mobile.gradientEnabled', value: m.gradientEnabled ? '1' : '0' })
      if (m.gradientColors !== undefined) updates.push({ key: 'login.mobile.gradientColors', value: m.gradientColors.map(c => c.toLowerCase()).join(',') })
      if (m.gradientSpeed !== undefined) updates.push({ key: 'login.mobile.gradientSpeed', value: String(m.gradientSpeed) })
      if (m.gradientAngle !== undefined) updates.push({ key: 'login.mobile.gradientAngle', value: String(m.gradientAngle) })
      if (m.gradientIntensity !== undefined) updates.push({ key: 'login.mobile.gradientIntensity', value: String(m.gradientIntensity) })
    }

    for (const u of updates) {
      await db.setting.upsert({
        where: { key: u.key },
        update: { value: u.value },
        create: { key: u.key, value: u.value },
      })
    }

    await audit({
      userId: user.id,
      action: 'site.loginSettings.update',
      entityType: 'Setting',
      entityId: 'login.*',
      before: { side: before.side, form: before.form },
      after: body,
    })

    return ok(await readLoginConfig())
  })
}
