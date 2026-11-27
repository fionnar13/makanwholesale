// ثابت‌ها و توابع خالص مسیر پخش — بدون وابستگی به دیتابیس/سرور
// Client-safe (مشابه format.ts) — در UI راننده و پنل مدیریت هم استفاده می‌شود.

export const DELIVERY_ASSIGNMENT_STATUSES = [
  'PENDING', 'IN_PROGRESS', 'DELIVERED', 'PAID', 'RETURNED', 'PARTIAL_RETURNED', 'CANCELLED',
] as const
export type DeliveryAssignmentStatus = (typeof DELIVERY_ASSIGNMENT_STATUSES)[number]

// وضعیت‌های «فعال» مأموریت — حداکثر یک مأموریت فعال برای هر سفارش مجاز است.
// نکتهٔ مصوبهٔ فاز ۱ (اصلاحیهٔ ۴): فقط IN_PROGRESS مسیر انبار را قفل می‌کند؛
// PENDING (فقط تخصیص روی کاغذ) قفل نیست — تخصیص ≠ شروع فیزیکی.
export const ACTIVE_ASSIGNMENT_STATUSES: DeliveryAssignmentStatus[] = ['PENDING', 'IN_PROGRESS']

// منشأ ثبت تحویل — مسیر انبار یا مسیر راننده (پارامتر تابع مشترک applyDeliveryEffects)
export type DeliverySource = 'WAREHOUSE' | 'DRIVER'
// نقش مجری رویداد وضعیت هنگام تحویل
export type DeliveryActorRole = 'WAREHOUSE' | 'DELIVERY'

export const DRIVER_PAYMENT_METHODS = ['CASH', 'CARD_TO_CARD', 'POS', 'CREDIT', 'OTHER'] as const
export type DriverPaymentMethod = (typeof DRIVER_PAYMENT_METHODS)[number]

// کدهای استاندارد دلیل مرجوعی راننده (مصوبهٔ فاز ۱ — اصلاحیهٔ ۵: فرم راننده فقط reason دارد؛
// disposition اقلام PENDING می‌ماند و تصمیم RESTOCK/SCRAP با انبار است)
export const RETURN_REASONS = ['CUSTOMER_REFUSED', 'WRONG_ITEM', 'DAMAGED', 'NOT_PAID', 'OTHER'] as const
export type DeliveryReturnReason = (typeof RETURN_REASONS)[number]

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'تخصیص داده‌شده',
  IN_PROGRESS: 'در مسیر پخش',
  DELIVERED: 'تحویل شده (اعتباری)',
  PAID: 'تحویل و تسویه‌شده',
  RETURNED: 'مرجوع‌شده',
  PARTIAL_RETURNED: 'مرجوعی جزئی',
  CANCELLED: 'لغو شده',
}

// کلاس رنگ نشان وضعیت مأموریت — مشترک بین اپ راننده و نمای مدیر (بخش D)
export const ASSIGNMENT_STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-sky-100 text-sky-800',
  DELIVERED: 'bg-violet-100 text-violet-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  RETURNED: 'bg-rose-100 text-rose-800',
  PARTIAL_RETURNED: 'bg-orange-100 text-orange-800',
  CANCELLED: 'bg-stone-200 text-stone-700',
}

export const DRIVER_PAYMENT_LABELS: Record<string, string> = {
  CASH: 'نقدی',
  CARD_TO_CARD: 'کارت به کارت',
  POS: 'کارت‌خوان (POS)',
  CREDIT: 'اعتباری (بدون دریافت وجه)',
  OTHER: 'سایر',
}

export const RETURN_REASON_LABELS: Record<string, string> = {
  CUSTOMER_REFUSED: 'امتناع مشتری از تحویل',
  WRONG_ITEM: 'کالای اشتباه',
  DAMAGED: 'آسیب‌دیده',
  NOT_PAID: 'عدم پرداخت مشتری',
  OTHER: 'سایر',
}

// نقش مجری رویداد وضعیت (مصوبهٔ فاز ۰ — بند ۳):
// WAREHOUSE = مسیر انبار، DELIVERY = راننده، SYSTEM = رویداد خودکار.
// داده‌های قدیمی (null) در نمایش به‌عنوان SYSTEM تفسیر می‌شوند.
export const ACTOR_ROLE_LABELS: Record<string, string> = {
  WAREHOUSE: 'انبار',
  DELIVERY: 'راننده',
  SYSTEM: 'سیستم',
}

export function actorRoleLabel(role?: string | null): string {
  return ACTOR_ROLE_LABELS[role ?? 'SYSTEM'] ?? 'سیستم'
}

/** آیا روش پرداخت انتخابی به دریافت واقعی وجه در لحظهٔ تحویل منجر می‌شود؟ (CREDIT یعنی نه) */
export function isOnSpotPayment(method?: DriverPaymentMethod | string | null): boolean {
  return method != null && method !== 'CREDIT'
}

// ─── فیلترهای دورهٔ زمانی UI (بخش D تاریخچهٔ راننده / بخش E داشبورد مدیر) ───

export type UiPeriod = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL'

/**
 * بازهٔ زمانی دوره — مرزها به‌وقت محلی مرورگر محاسبه و به‌صورت ISO ارسال می‌شوند
 * تا «امروز» و «این هفته» با تقویم خودِ کاربر (ایران) درست باشد؛ هفته از شنبه شروع می‌شود.
 */
export function periodRange(p: UiPeriod): { from?: string; to?: string } {
  if (p === 'ALL') return {}
  const now = new Date()
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  if (p === 'TODAY') {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), to: endOfToday.toISOString() }
  }
  if (p === 'WEEK') {
    const daysSinceSat = (now.getDay() + 1) % 7 // شنبه = روز شروع هفته
    const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceSat)
    return { from: saturday.toISOString(), to: endOfToday.toISOString() }
  }
  return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: endOfToday.toISOString() }
}

/** بازهٔ یک روز تقویمی (YYYY-MM-DD از input type=date) — ابتدای یا انتهای روز به‌وقت محلی */
export function dayRange(dateStr: string, endOfDay = false): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const [, y, mo, d] = m
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d))
  return dt.toISOString()
}
