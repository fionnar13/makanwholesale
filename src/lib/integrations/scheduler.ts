// اسکجولر یکپارچه‌سازی‌ها — تایمر درون‌پردازشی برای بکاپ خودکار و همگام‌سازی Sheets
// در هر تیک (هر ۶۰ ثانیه) زمان‌های سررسید بررسی و اجرا می‌شوند
// نکته استقرار: روی Render free پس از ۱۵ دقیقه بی‌کاری سرویس می‌خوابد؛
// برای اجرای دقیق‌تر می‌توان سرویس اکسترنال cron را به POST /api/integrations/scheduler/tick وصل کرد
import { db } from '@/lib/db'
import { getConfig, saveConfig } from './config'
import { computeNextRunAt, runBackup, computeBackupHealth } from './backup'
import { runSheetsAutoSync } from './sheets-sync'
import { integrationLog } from './logs'
import { emitTelegramEvent } from './telegram'

const TICK_MS = 60_000

type SchedulerState = {
  timer: NodeJS.Timeout | null
  running: boolean
  lastTick: Date | null
}

const g = globalThis as unknown as { __makanScheduler?: SchedulerState }
const state: SchedulerState = g.__makanScheduler ?? { timer: null, running: false, lastTick: null }
if (process.env.NODE_ENV !== 'production') g.__makanScheduler = state

export async function tick(): Promise<void> {
  if (state.running) return // هم‌پوشانی اجراها ندارد
  state.running = true
  state.lastTick = new Date()
  try {
    // ۱) بکاپ خودکار
    const bcfg = await getConfig('backup')
    if (bcfg.enabled) {
      const due = bcfg.nextRunAt ? new Date(bcfg.nextRunAt) : null
      if (!due || due.getTime() <= Date.now()) {
        await integrationLog('scheduler', 'BACKUP_DUE', { message: 'اجرای بکاپ برنامه‌ریزی‌شده' })
        await runBackup({ trigger: 'SCHEDULED' })
        await saveConfig('backup', { nextRunAt: computeNextRunAt(bcfg.interval, bcfg.hour).toISOString() })
      }
      // ۱-ب) هشدار توقف بکاپ — اگر بیش از ۲۴ ساعت از آخرین موفقیت بگذرد
      // حداکثر هر ۱۲ ساعت یک‌بار (دوباخه در DB — پس از ری‌استارت هم تکرار نمی‌شود)
      await alertBackupStale()
    }

    // ۲) همگام‌سازی خودکار Sheets
    const scfg = await getConfig('sheets')
    if (scfg.syncIntervalMinutes > 0 && scfg.serviceAccountJson && scfg.spreadsheetId.trim()) {
      const due = scfg.nextSyncAt ? new Date(scfg.nextSyncAt) : null
      if (!due || due.getTime() <= Date.now()) {
        await runSheetsAutoSync()
      }
    }
  } catch (e) {
    await integrationLog('scheduler', 'TICK_ERROR', { level: 'ERROR', message: e instanceof Error ? e.message : 'خطای ناشناخته' })
  } finally {
    state.running = false
  }
}

/**
 * هشدار «بکاپ اجرا نشد» — اگر بکاپ فعال است ولی آخرین موفقیت بیش از ۲۴ ساعت قبل است،
 * رویداد BACKUP_STALE به تلگرام (در صورت اتصال و فعال‌بودن رویداد) ارسال می‌شود.
 * برای جلوگیری از اسپم، بین دو هشدار حداقل ۱۲ ساعت فاصله است (بدون‌باخه در IntegrationLog).
 */
const STALE_ALERT_COOLDOWN_MS = 12 * 3600 * 1000

async function alertBackupStale(): Promise<void> {
  try {
    const [lastRun, lastSuccess, lastAlert] = await Promise.all([
      db.backupRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      db.backupRun.findFirst({ where: { status: 'SUCCESS' }, orderBy: { startedAt: 'desc' } }),
      db.integrationLog.findFirst({ where: { integration: 'scheduler', event: 'BACKUP_STALE_ALERT' }, orderBy: { createdAt: 'desc' } }),
    ])
    if (lastAlert && Date.now() - lastAlert.createdAt.getTime() < STALE_ALERT_COOLDOWN_MS) return
    const health = computeBackupHealth({
      enabled: true,
      lastRun: lastRun ? { status: lastRun.status, startedAt: lastRun.startedAt } : null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
    })
    if (health.level !== 'STALE' && health.level !== 'FAILED') return
    await integrationLog('scheduler', 'BACKUP_STALE_ALERT', { level: 'WARN', message: health.message, data: { level: health.level } })
    await emitTelegramEvent('BACKUP_STALE', {
      hours: health.hoursSinceSuccess === null ? '۲۴+' : String(Math.round(health.hoursSinceSuccess)),
    })
  } catch (e) {
    await integrationLog('scheduler', 'BACKUP_STALE_CHECK_ERROR', { level: 'ERROR', message: e instanceof Error ? e.message : 'خطای ناشناخته' })
  }
}

export function startScheduler(): void {
  if (state.timer) return // قبلاً شروع شده (دابل‌استارت در dev hot-reload)
  if (process.env.INTEGRATIONS_SCHEDULER_DISABLED === '1') return
  state.timer = setInterval(() => { void tick() }, TICK_MS)
  // اولین تیک با تأخیر کوتاه تا سرور کاملاً بالا بیاید
  setTimeout(() => { void tick() }, 15_000)
  console.log('[SCHEDULER] اسکجولر یکپارچه‌سازی‌ها شروع شد (هر ۶۰ ثانیه)')
}

export function schedulerStatus(): { running: boolean; lastTick: string | null } {
  return { running: state.running, lastTick: state.lastTick?.toISOString() ?? null }
}

/** بازمحاسبه زمان اجرای بعدی پس از تغییر تنظیمات بکاپ */
export async function rescheduleBackup(): Promise<string> {
  const cfg = await getConfig('backup')
  const next = computeNextRunAt(cfg.interval, cfg.hour)
  await saveConfig('backup', { nextRunAt: next.toISOString() })
  await integrationLog('scheduler', 'BACKUP_RESCHEDULED', { data: { nextRunAt: next.toISOString() } })
  return next.toISOString()
}
