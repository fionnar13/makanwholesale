// پیکربندی یکپارچه‌سازی‌ها — خواندن/ذخیره در جدول IntegrationConfig با رمزنگاری فیلدهای حساس
// هر یکپارچه‌سازی یک کلید دارد: google (Drive) | sheets | telegram | ai | backup
import { db } from '@/lib/db'
import { encryptValue, decryptValue, maskSecret } from './crypto'

// فیلدهای حساس هر ماژول که قبل از ذخیره رمزنگاری می‌شوند
const SENSITIVE_FIELDS: Record<string, string[]> = {
  google: ['serviceAccountJson'],
  sheets: ['serviceAccountJson'],
  telegram: ['botToken'],
  ai: ['apiKey'],
  backup: [],
}

export type GoogleDriveConfig = {
  mode: 'oauth' | 'service' // حساب شخصی یا Service Account
  serviceAccountJson: string | null // محتوای کامل JSON سرویس‌اکانت (رمز شده)
  serviceAccountEmail: string | null
  folderId: string | null // شناسه پوشه Drive مقصد (خالی = ریشه My Drive)
  retentionCount: number // تعداد نسخه‌های نگهداری‌شده
}

export type SheetsConfig = {
  serviceAccountJson: string | null // رمز شده
  serviceAccountEmail: string | null
  spreadsheetId: string
  sheetName: string // نام تب (شیت) داخل فایل
  syncIntervalMinutes: number // صفر = همگام‌سازی خودکار خاموش
  mappings: Record<string, Record<string, string>> // datasetKey → { فیلد سامانه: نام ستون شیت }
  nextSyncAt: string | null // ISO — توسط اسکجولر به‌روز می‌شود
}

export type TelegramConfig = {
  botToken: string | null // رمز شده
  chatId: string
  events: string[] // رویدادهای فعال
  templates: Record<string, string> // event → متن پیام با {{placeholders}}
}

export type AiConfig = {
  enabled: boolean
  provider: 'openrouter' | 'ninerouter' | 'custom'
  baseUrl: string // پایه API سازگار با OpenAI
  apiKey: string | null // رمز شده
  model: string
  systemPrompt: string
  temperature: number
  maxDataRows: number // حداکثر سطر داده در snapshot ارسالی به AI
}

export type BackupConfig = {
  enabled: boolean // بکاپ خودکار فعال است
  format: 'JSON' | 'CSV' | 'XLSX' | 'TS' // فرمت پیش‌فرض بکاپ
  interval: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  hour: number // ساعت اجرا به وقت تهران (۰ تا ۲۳)
  datasets: string[] // دیتاست‌های انتخابی
  retentionCount: number
  nextRunAt: string | null // ISO — توسط اسکجولر به‌روز می‌شود
}

// پیش‌فرض‌ها با تایپ صریح — تا مقادیر literal به نوع نهایی گسترش یابند
export const DEFAULTS: {
  google: GoogleDriveConfig
  sheets: SheetsConfig
  telegram: TelegramConfig
  ai: AiConfig
  backup: BackupConfig
} = {
  google: {
    mode: 'oauth',
    serviceAccountJson: null,
    serviceAccountEmail: null,
    folderId: null,
    retentionCount: 10,
  },
  sheets: {
    serviceAccountJson: null,
    serviceAccountEmail: null,
    spreadsheetId: '',
    sheetName: 'Sheet1',
    syncIntervalMinutes: 0,
    mappings: {},
    nextSyncAt: null,
  },
  telegram: {
    botToken: null,
    chatId: '',
    events: ['ORDER_NEW', 'BACKUP_SUCCESS', 'BACKUP_ERROR', 'BACKUP_STALE'],
    templates: {},
  },
  ai: {
    enabled: false,
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: null,
    model: 'openai/gpt-4o-mini',
    systemPrompt: 'تو دستیار مدیریتی سامانه بنکداری هستی. بر اساس داده‌های داده‌شده، دقیق و مختصر به فارسی پاسخ بده.',
    temperature: 0.3,
    maxDataRows: 200,
  },
  backup: {
    enabled: false,
    format: 'XLSX',
    interval: 'DAILY',
    hour: 3,
    datasets: ['customers', 'products', 'orders', 'suppliers'],
    retentionCount: 10,
    nextRunAt: null,
  },
}

export type ConfigKey = keyof typeof DEFAULTS

export const AI_PROVIDER_BASE_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  ninerouter: 'http://localhost:20128/v1',
}

export function defaultConfig<K extends ConfigKey>(key: K): (typeof DEFAULTS)[K] {
  return JSON.parse(JSON.stringify(DEFAULTS[key])) as (typeof DEFAULTS)[K]
}

/** خواندن پیکربندی رمزگشایی‌شده — اگر فیلدهای حساس از env بیایند، اولویت با env است */
export async function getConfig<K extends ConfigKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const base = defaultConfig(key)
  const row = await db.integrationConfig.findUnique({ where: { key } })
  if (!row) return base
  let stored: Record<string, unknown> = {}
  try { stored = JSON.parse(row.dataJson) } catch { stored = {} }
  const merged = { ...base, ...stored } as Record<string, unknown>

  // اولویت env برای کلیدهای حساس — در پروداکشن ممکن است مدیر ترجیح دهد از env تنظیم کند
  if (key === 'telegram' && process.env.TELEGRAM_BOT_TOKEN?.trim() && !stored.botToken) {
    merged.botToken = process.env.TELEGRAM_BOT_TOKEN.trim()
  }
  if (key === 'ai' && process.env.OPENROUTER_API_KEY?.trim() && !stored.apiKey && merged.provider === 'openrouter') {
    merged.apiKey = process.env.OPENROUTER_API_KEY.trim()
  }

  // بازگشایی فیلدهای حساس برای استفاده داخلی
  for (const f of SENSITIVE_FIELDS[key]) {
    if (typeof merged[f] === 'string' && merged[f]) merged[f] = decryptValue(merged[f] as string)
  }
  return merged as (typeof DEFAULTS)[K]
}

/** ذخیره پیکربندی — فیلدهای حساس رمز می‌شوند؛ مقدار null یعنی «دست‌نخورده باقی بماند» */
export async function saveConfig<K extends ConfigKey>(
  key: K,
  patch: Partial<(typeof DEFAULTS)[K]>,
): Promise<void> {
  const current = await getConfig(key)
  const next = { ...(current as object), ...(patch as object) } as Record<string, unknown>
  for (const f of SENSITIVE_FIELDS[key]) {
    const v = next[f]
    if (v === null || v === undefined) {
      next[f] = (current as Record<string, unknown>)[f] ? encryptValue((current as Record<string, unknown>)[f] as string) : null
    } else if (typeof v === 'string' && v) {
      next[f] = encryptValue(v)
    }
  }
  await db.integrationConfig.upsert({
    where: { key },
    update: { dataJson: JSON.stringify(next) },
    create: { key, dataJson: JSON.stringify(next) },
  })
}

/** حذف کامل پیکربندی + پاک‌سازی داده حساس */
export async function resetConfig(key: string): Promise<void> {
  await db.integrationConfig.deleteMany({ where: { key } })
}

/** نمای عمومی پیکربندی برای پنل — فیلدهای حساس mask می‌شوند و هرگز مقدار واقعی برنمی‌گردد */
export async function getConfigView<K extends ConfigKey>(key: K) {
  const cfg = (await getConfig(key)) as unknown as Record<string, unknown>
  for (const f of SENSITIVE_FIELDS[key]) {
    if (f === 'serviceAccountJson') {
      cfg.serviceAccountJson = null
      cfg.serviceAccountJsonSet = Boolean(cfg.serviceAccountEmail)
    } else {
      cfg[f] = maskSecret(cfg[f] as string | null)
    }
  }
  return cfg
}
