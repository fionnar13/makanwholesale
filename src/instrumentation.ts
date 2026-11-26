// نقاط ورود Next.js — شروع اسکجولر یکپارچه‌سازی‌ها فقط در رانتایم Node.js
// این فایل به‌صورت خودکار در استارت سرور (next start / standalone) فراخوانی می‌شود
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.INTEGRATIONS_SCHEDULER_DISABLED === '1') return
  try {
    const { startScheduler } = await import('@/lib/integrations/scheduler')
    startScheduler()
  } catch (e) {
    console.error('[INSTRUMENTATION] شروع اسکجولر ناموفق بود:', e)
  }
}
