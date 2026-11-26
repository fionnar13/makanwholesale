// موتور بکاپ — تولید فایل از دیتاست‌های انتخابی و ذخیره در Google Drive + سیاست نگهداشت
// برنامه‌ریزی: روزانه/هفتگی/ماهانه با ساعت اجرا به وقت تهران (Asia/Tehran)
import { db } from '@/lib/db'
import { getConfig } from './config'
import { DATASETS } from './datasets'
import { exportFiles } from './exporters'
import { getValidAccessToken, driveUploadFile, driveListBackups, driveDeleteFile } from './google'
import { integrationLog } from './logs'
import { emitTelegramEvent } from './telegram'

export type BackupFormat = 'JSON' | 'CSV' | 'XLSX' | 'TS'

// ── ریاضیات اسکجول (تابع خالص — قابل تست) ──

/** زمان اجرای بعدی بر اساس بازه و ساعت اجرا به وقت تهران (UTC+3:30 ثابت در ایران بدون DST از ۲۰۲۲) */
export function computeNextRunAt(interval: 'DAILY' | 'WEEKLY' | 'MONTHLY', hourTehran: number, from: Date = new Date()): Date {
  // تهران = UTC + 3:30 — تاریخ تهران را می‌سازیم
  const tehranOffsetMs = 3.5 * 3600 * 1000
  const tehran = new Date(from.getTime() + tehranOffsetMs)
  const y = tehran.getUTCFullYear(), m = tehran.getUTCMonth(), d = tehran.getUTCDate()

  // امروِ تهران — آیا ساعت اجرا امروز هنوز نرسیده؟
  const candidate = (yy: number, mm: number, dd: number): Date => {
    // ساخت تاریخ تهران → تبدیل به UTC
    const asUTC = Date.UTC(yy, mm, dd, hourTehran, 0, 0)
    return new Date(asUTC - tehranOffsetMs)
  }

  let next: Date
  if (interval === 'DAILY') {
    next = candidate(y, m, d + 1)
    if (tehran.getUTCHours() < hourTehran) next = candidate(y, m, d)
  } else if (interval === 'WEEKLY') {
    // هفتگی — لنگر بر روز هفته امروز: اگر ساعت امروز نرسیده، امروز؛ وگرنه هفته بعد همان روز
    next = candidate(y, m, d + 7)
    if (tehran.getUTCHours() < hourTehran) next = candidate(y, m, d)
  } else {
    // ماهانه — روز اول هر ماه
    next = candidate(y, m + 1, 1)
    if (d === 1 && tehran.getUTCHours() < hourTehran) next = candidate(y, m, 1)
  }
  return next
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// ── سلامت بکاپ — وضعیت رنگی پنل + مبنای هشدار اسکجولر (تابع خالص — قابل تست) ──

export type BackupHealthLevel = 'OK' | 'DELAYED' | 'FAILED' | 'STALE' | 'OFF'
export type BackupHealth = {
  level: BackupHealthLevel
  message: string
  hoursSinceSuccess: number | null
}

// آستانه‌ها: بیش از ۲۴ ساعت بی‌بکاپ = قرمز؛ شکست اخیر با موفقیت تازه = زرد
export const BACKUP_STALE_AFTER_HOURS = 24
const FAILED_GRACE_HOURS = 12
const DELAY_WARN_HOURS = 18

export function computeBackupHealth(input: {
  enabled: boolean
  lastRun: { status: string; startedAt: Date } | null
  lastSuccessAt: Date | null
  now?: Date
}): BackupHealth {
  const now = input.now ?? new Date()
  if (!input.enabled) {
    return { level: 'OFF', message: 'بکاپ خودکار خاموش است — برای پایش وضعیت، آن را فعال کنید', hoursSinceSuccess: null }
  }
  const hours = input.lastSuccessAt
    ? (now.getTime() - input.lastSuccessAt.getTime()) / 3_600_000
    : null
  // آخرین اجرا FAILED و از آن بعد موفقی نبوده
  const lastFailed = input.lastRun?.status === 'FAILED'
    && (!input.lastSuccessAt || input.lastRun.startedAt > input.lastSuccessAt)

  if (hours === null || hours > BACKUP_STALE_AFTER_HOURS) {
    return {
      level: 'STALE',
      message: 'بیش از ۲۴ ساعت از آخرین بکاپ موفق گذشته است — اسکجولر، cron بیرونی، پروکسی خروجی یا اتصال Google را بررسی کنید',
      hoursSinceSuccess: hours,
    }
  }
  if (lastFailed) {
    if (hours > FAILED_GRACE_HOURS) {
      return {
        level: 'FAILED',
        message: `آخرین اجرای بکاپ ناموفق بود و ${Math.round(hours)} ساعت از آخرین موفقیت می‌گذرد — پیام خطا در سابقهٔ اجرا`,
        hoursSinceSuccess: hours,
      }
    }
    return {
      level: 'DELAYED',
      message: `آخرین اجرا ناموفق بود ولی بکاپ موفق ${Math.round(hours)} ساعت پیش وجود دارد — پیام خطا را بررسی کنید`,
      hoursSinceSuccess: hours,
    }
  }
  if (hours > DELAY_WARN_HOURS) {
    return {
      level: 'DELAYED',
      message: `${Math.round(hours)} ساعت از آخرین بکاپ موفق می‌گذرد — نزدیک مرز ۲۴ ساعت؛ احتمالاً سرویس به‌خواب رفته`,
      hoursSinceSuccess: hours,
    }
  }
  return {
    level: 'OK',
    message: `آخرین بکاپ موفق ${Math.round(hours)} ساعت پیش — به‌روز`,
    hoursSinceSuccess: hours,
  }
}

// ── اجرای بکاپ ──

export type BackupRunResult = {
  runId: string
  status: 'SUCCESS' | 'FAILED'
  fileCount: number
  sizeBytes: number
  durationMs: number
  message: string
  files?: Array<{ name: string; link: string | null }>
}

/** اجرای کامل بکاپ — ثبت BackupRun، ارسال به Drive، اعمال نگهداشت، اطلاع تلگرام */
export async function runBackup(opts: { trigger: 'MANUAL' | 'SCHEDULED'; userId?: string | null }): Promise<BackupRunResult> {
  const cfg = await getConfig('backup')
  const started = Date.now()
  const datasets = cfg.datasets.filter(k => DATASETS[k])
  if (datasets.length === 0) {
    return finishFailed({ runId: '', started, datasets, message: 'هیچ دیتاستی برای بکاپ انتخاب نشده است', trigger: opts.trigger, userId: opts.userId })
  }

  const run = await db.backupRun.create({
    data: {
      status: 'RUNNING',
      trigger: opts.trigger,
      format: cfg.format,
      target: 'DRIVE',
      scopeJson: JSON.stringify(datasets),
      startedById: opts.userId ?? null,
    },
  })

  try {
    const gcfg = await getConfig('google')
    const folderId = gcfg.folderId?.trim() || null
    const files = await exportFiles(datasets, cfg.format)
    const token = await resolveDriveToken()
    const uploaded: Array<{ fileId: string; name: string; link: string | null }> = []
    let sizeBytes = 0
    for (const f of files) {
      const up = await driveUploadFile(token, { name: f.name, body: f.body, mimeType: f.contentType }, folderId)
      uploaded.push({ fileId: up.fileId, name: up.name, link: up.webViewLink })
      sizeBytes += up.size
    }

    // سیاست نگهداشت — حذف نسخه‌های قدیمی‌تر از retentionCount
    let deleted = 0
    try {
      const old = await driveListBackups(token, folderId)
      const excess = old.slice(cfg.retentionCount)
      for (const f of excess) {
        await driveDeleteFile(token, f.id)
        deleted++
      }
    } catch (e) {
      await integrationLog('backup', 'RETENTION_FAILED', { level: 'WARN', message: e instanceof Error ? e.message : 'اعمال نگهداشت ناموفق بود' })
    }

    const durationMs = Date.now() - started
    await db.backupRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        fileCount: uploaded.length,
        sizeBytes,
        driveLinksJson: JSON.stringify(uploaded),
        message: `${uploaded.length} فایل آپلود شد${deleted ? `، ${deleted} نسخه قدیمی حذف شد` : ''}`,
        durationMs,
        finishedAt: new Date(),
      },
    })
    await integrationLog('backup', `RUN_SUCCESS_${opts.trigger}`, { message: `بکاپ موفق (${uploaded.length} فایل، ${formatSize(sizeBytes)})` })
    await emitTelegramEvent('BACKUP_SUCCESS', { format: cfg.format, fileCount: uploaded.length, size: formatSize(sizeBytes) })
    return {
      runId: run.id, status: 'SUCCESS', fileCount: uploaded.length, sizeBytes, durationMs,
      message: `${uploaded.length} فایل با موفقیت در Google Drive ذخیره شد`,
      files: uploaded.map(u => ({ name: u.name, link: u.link })),
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'خطای ناشناخته در بکاپ'
    return finishFailed({ runId: run.id, started, datasets, message, trigger: opts.trigger, userId: opts.userId })
  }
}

async function resolveDriveToken(): Promise<string> {
  const gcfg = await getConfig('google')
  if (gcfg.mode === 'service' && gcfg.serviceAccountJson) {
    const { getServiceAccountToken } = await import('./google')
    return getServiceAccountToken(gcfg.serviceAccountJson, ['https://www.googleapis.com/auth/drive.file'])
  }
  const account = await db.googleAccount.findFirst({ where: { isBackupTarget: true, isActive: true } })
    ?? await db.googleAccount.findFirst({ where: { isActive: true } })
  if (!account) throw new Error('هیچ حساب گوگلی متصل نیست — ابتدا از کارت «Google Drive» حساب را متصل کنید')
  return getValidAccessToken(account)
}

async function finishFailed(x: { runId: string; started: number; datasets: string[]; message: string; trigger: string; userId?: string | null }): Promise<BackupRunResult> {
  const durationMs = Date.now() - x.started
  if (x.runId) {
    await db.backupRun.update({
      where: { id: x.runId },
      data: { status: 'FAILED', message: x.message.slice(0, 500), durationMs, finishedAt: new Date() },
    }).catch(() => null)
  } else {
    await db.backupRun.create({
      data: {
        status: 'FAILED', trigger: x.trigger, format: 'JSON', target: 'DRIVE',
        scopeJson: JSON.stringify(x.datasets), message: x.message.slice(0, 500), durationMs,
        startedById: x.userId ?? null, finishedAt: new Date(),
      },
    }).catch(() => null)
  }
  await integrationLog('backup', `RUN_FAILED_${x.trigger}`, { level: 'ERROR', message: x.message })
  await emitTelegramEvent('BACKUP_ERROR', { error: x.message.slice(0, 300) })
  return { runId: x.runId || '-', status: 'FAILED', fileCount: 0, sizeBytes: 0, durationMs, message: x.message }
}
