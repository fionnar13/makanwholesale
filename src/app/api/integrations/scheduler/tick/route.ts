// تیک اسکجولر از بیرون — برای سرویس cron اکسترنال (مثلاً cron-job.org یا GitHub Actions)
// امنیت: هدر x-cron-secret باید دقیقاً برابر INTEGRATION_SECRET_KEY باشد
// نکته استقرار: سرویس رایگان Render پس از ۱۵ دقیقه بی‌کاری می‌خوابد؛ یک cron بیرونی
// با فراخوانی این مسیر (هر ۵ تا ۱۵ دقیقه) هم بیدار نگه می‌دارد هم بکاپ دقیق می‌کند
import { NextRequest } from 'next/server'
import { ApiError, handler, ok } from '@/lib/api'
import { tick, schedulerStatus } from '@/lib/integrations/scheduler'

export async function POST(req: NextRequest) {
  return handler(async () => {
    const expected = process.env.INTEGRATION_SECRET_KEY?.trim()
    const provided = req.headers.get('x-cron-secret')?.trim()
    if (!expected) throw new ApiError(500, 'NO_SECRET', 'INTEGRATION_SECRET_KEY روی سرور تنظیم نشده است')
    if (provided !== expected) throw new ApiError(403, 'FORBIDDEN', 'رمز cron نامعتبر است')
    await tick()
    return ok({ ok: true, ...schedulerStatus() })
  })
}
