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
