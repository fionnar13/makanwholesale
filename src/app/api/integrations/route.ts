// نمای کلی یکپارچه‌سازی‌ها — وضعیت هر اتصال برای پنل مدیریت
// دسترسی: فقط مجوز users.manage
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handler, ok } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { getConfig, getConfigView } from '@/lib/integrations/config'
import { DATASETS } from '@/lib/integrations/datasets'
import { TELEGRAM_EVENTS } from '@/lib/integrations/telegram'
import { schedulerStatus } from '@/lib/integrations/scheduler'

export async function GET(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'users.manage')

    const [google, sheets, telegram, ai, backup, drive] = await Promise.all([
      getConfigView('google'),
      getConfigView('sheets'),
      getConfigView('telegram'),
      getConfigView('ai'),
      getConfigView('backup'),
      getConfig('google'),
    ])

    const accounts = await db.googleAccount.findMany({
      select: { id: true, email: true, displayName: true, isBackupTarget: true, tokenExpiresAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    })
    const lastBackup = await db.backupRun.findFirst({ orderBy: { startedAt: 'desc' } })
    const aiLogs = await db.aiLog.count()
    const [aiErrors, backupOk, backupFailed] = await Promise.all([
      db.aiLog.count({ where: { status: 'ERROR' } }),
      db.backupRun.count({ where: { status: 'SUCCESS' } }),
      db.backupRun.count({ where: { status: 'FAILED' } }),
    ])

    const connected = (mode: string, accountCount: number) =>
      mode === 'service' ? true : accountCount > 0

    return ok({
      google: {
        ...google,
        connected: connected(drive.mode, accounts.length),
        accounts: accounts.map(a => ({
          id: a.id, email: a.email, displayName: a.displayName,
          isBackupTarget: a.isBackupTarget,
          tokenValidUntil: a.tokenExpiresAt?.toISOString() ?? null,
          updatedAt: a.updatedAt.toISOString(),
        })),
      },
      sheets: { ...sheets, connected: Boolean(sheets.serviceAccountJsonSet && (sheets as { spreadsheetId?: string }).spreadsheetId) },
      telegram: { ...telegram, connected: Boolean(telegram.botToken && telegram.chatId) },
      ai: { ...ai, connected: Boolean(ai.enabled && ai.apiKey) },
      backup: {
        ...backup,
        lastRun: lastBackup ? {
          id: lastBackup.id, status: lastBackup.status, trigger: lastBackup.trigger,
          format: lastBackup.format, fileCount: lastBackup.fileCount, sizeBytes: lastBackup.sizeBytes,
          message: lastBackup.message, startedAt: lastBackup.startedAt.toISOString(),
          durationMs: lastBackup.durationMs,
          files: lastBackup.driveLinksJson ? JSON.parse(lastBackup.driveLinksJson) : null,
        } : null,
        stats: { success: backupOk, failed: backupFailed },
        aiLogs: { total: aiLogs, errors: aiErrors },
        scheduler: schedulerStatus(),
      },
      datasets: Object.values(DATASETS).map(d => ({ key: d.key, label: d.label, exportOnly: Boolean(d.exportOnly) })),
      telegramEvents: TELEGRAM_EVENTS,
    })
  })
}
