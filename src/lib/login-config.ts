// پیکربندی مشترک گرادیانت متحرک موبایل صفحه ورود
// بدون 'use client' — هم در کد سرور (API تنظیمات) و هم در کامپوننت‌های کلاینت قابل ایمپورت است
export type LoginMobileConfig = {
  gradientEnabled: boolean
  gradientColors: string[] // ۲ تا ۵ رنگ HEX
  gradientSpeed: number // ثانیه برای هر سیکل — ۴ تا ۶۰
  gradientAngle: number // جهت گرادیانت به درجه — ۰ تا ۳۶۰
  gradientIntensity: number // شدت گرادیانت ۲۰ تا ۱۰۰ درصد
}

// رنگ‌های پیش‌فرض گرادیانت موبایل — تُن سبزِ قالب (زمرّدی)
export const DEFAULT_GRADIENT_COLORS = ['#34d399', '#0d9488', '#10b981', '#065f46']

// پیش‌فرض کامل بخش موبایل — وقتی مدیر هنوز چیزی ثبت نکرده باشد
export function defaultMobileConfig(): LoginMobileConfig {
  return {
    gradientEnabled: true,
    gradientColors: DEFAULT_GRADIENT_COLORS,
    gradientSpeed: 14,
    gradientAngle: 135,
    gradientIntensity: 60,
  }
}
