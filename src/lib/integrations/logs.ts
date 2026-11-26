// لاگ یکپارچه‌سازی‌ها — ثبت رویدادها در IntegrationLog بدون اطلاعات حساس
import { db } from '@/lib/db'

export type IntegrationKey = 'google' | 'sheets' | 'telegram' | 'ai' | 'backup' | 'scheduler'

export async function integrationLog(
  integration: IntegrationKey,
  event: string,
  opts?: { level?: 'INFO' | 'WARN' | 'ERROR'; message?: string; data?: unknown },
) {
  try {
    await db.integrationLog.create({
      data: {
        integration,
        event,
        level: opts?.level ?? 'INFO',
        message: opts?.message ?? null,
        dataJson: opts?.data !== undefined ? JSON.stringify(opts.data) : null,
      },
    })
  } catch (e) {
    console.error('[INTEGRATION_LOG_FAIL]', event, e)
  }
}

/** خواندن آخرین لاگ‌ها برای پنل */
export async function recentLogs(integration?: IntegrationKey, take = 50) {
  return db.integrationLog.findMany({
    where: integration ? { integration } : undefined,
    orderBy: { createdAt: 'desc' },
    take,
  })
}
