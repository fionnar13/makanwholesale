// یکپارچه‌سازی تلگرام — ارسال رویدادهای سامانه و فایل گزارش به کانال/گروه/چت مقصد
// توکن بات از @BotFather؛ ارسال با Bot API رسمی (sendMessage / sendDocument)
import { getConfig } from './config'
import { integrationLog } from './logs'
import { proxyFetch } from './proxy'

export const TELEGRAM_EVENTS: Array<{ key: string; label: string; description: string }> = [
  { key: 'ORDER_NEW', label: 'ثبت سفارش جدید', description: 'به‌محض ثبت هر سفارش جدید پیام ارسال می‌شود' },
  { key: 'BACKUP_SUCCESS', label: 'بکاپ موفق', description: 'پس از هر بکاپ خودکار موفق گزارش ارسال می‌شود' },
  { key: 'BACKUP_ERROR', label: 'خطای بکاپ', description: 'در صورت شکست بکاپ خودکار هشدار ارسال می‌شود' },
  { key: 'BACKUP_STALE', label: 'هشدار توقف بکاپ', description: 'اگر بیش از ۲۴ ساعت از آخرین بکاپ موفق بگذرد، هشدار می‌دهد' },
  { key: 'LOW_STOCK', label: 'کم‌موجودی کالا', description: 'وقتی موجودی کالا از نقطه سفارش کمتر شود' },
  { key: 'RETURN_NEW', label: 'درخواست مرجوعی جدید', description: 'ثبت هر درخواست مرجوعی' },
  { key: 'SHEETS_SYNC_ERROR', label: 'خطای همگام‌سازی Google Sheets', description: 'شکست همگام‌سازی خودکار شیت‌ها' },
]

// الگوهای پیش‌فرض پیام‌ها — قابل بازنویسی از پنل با {{placeholders}}
export const TELEGRAM_DEFAULT_TEMPLATES: Record<string, string> = {
  ORDER_NEW: '🧾 سفارش جدید ثبت شد\nشماره: {{orderNo}}\nمشتری: {{customerName}}\nمبلغ: {{total}} ریال',
  BACKUP_SUCCESS: '✅ بکاپ خودکار انجام شد\nفرمت: {{format}}\nفایل‌ها: {{fileCount}}\nحجم: {{size}}',
  BACKUP_ERROR: '⚠️ بکاپ خودکار ناموفق بود\nخطا: {{error}}',
  BACKUP_STALE: '🚨 هشدار بکاپ\nبیش از ۲۴ ساعت از آخرین بکاپ موفق گذشته است ({{hours}} ساعت)\nاسکجولر، cron بیرونی، پروکسی یا اتصال Google را بررسی کنید',
  LOW_STOCK: '📦 کم‌موجودی\nکالا: {{productName}}\nموجودی: {{available}}\nنقطه سفارش: {{reorderPoint}}',
  RETURN_NEW: '↩️ درخواست مرجوعی جدید\nشماره: {{returnNo}}\nمشتری: {{customerName}}',
  SHEETS_SYNC_ERROR: '⚠️ همگام‌سازی Google Sheets ناموفق بود\nخطا: {{error}}',
}

/** جایگذاری متغیرها در الگوی پیام — {{key}} با مقدار جایگزین می‌شود */
export function renderTemplate(template: string, data: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = data[key]
    return v === null || v === undefined ? '' : String(v)
  })
}

export type TelegramSendResult = { ok: true; messageId: number } | { ok: false; error: string }

async function botCall(token: string, method: string, body: FormData | string): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await proxyFetch('TELEGRAM', `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`, {
    method: 'POST',
    ...(typeof body === 'string'
      ? { headers: { 'content-type': 'application/json' }, body }
      : { body }),
  })
  const json = (await res.json().catch(() => ({ ok: false, description: 'پاسخ نامعتبر از سرور تلگرام' }))) as { ok: boolean; result?: unknown; description?: string }
  return json
}

/** ارسال پیام متنی */
export async function telegramSendMessage(text: string): Promise<TelegramSendResult> {
  const cfg = await getConfig('telegram')
  if (!cfg.botToken) return { ok: false, error: 'توکن بات تنظیم نشده است' }
  if (!cfg.chatId.trim()) return { ok: false, error: 'Chat ID مقصد تنظیم نشده است' }
  const json = await botCall(cfg.botToken, 'sendMessage', JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML' }))
  if (!json.ok) {
    await integrationLog('telegram', 'SEND_FAILED', { level: 'ERROR', message: json.description })
    return { ok: false, error: json.description ?? 'ارسال ناموفق بود' }
  }
  const result = json.result as { message_id?: number } | undefined
  return { ok: true, messageId: result?.message_id ?? 0 }
}

/** ارسال فایل (گزارش CSV/Excel/JSON) با متد sendDocument */
export async function telegramSendDocument(
  file: { name: string; body: Buffer | string; mimeType?: string },
  caption?: string,
): Promise<TelegramSendResult> {
  const cfg = await getConfig('telegram')
  if (!cfg.botToken) return { ok: false, error: 'توکن بات تنظیم نشده است' }
  if (!cfg.chatId.trim()) return { ok: false, error: 'Chat ID مقصد تنظیم نشده است' }
  const form = new FormData()
  form.append('chat_id', cfg.chatId)
  const body = Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body, 'utf8')
  form.append('document', new Blob([new Uint8Array(body)], { type: file.mimeType ?? 'application/octet-stream' }), file.name)
  if (caption) form.append('caption', caption)
  const json = await botCall(cfg.botToken, 'sendDocument', form)
  if (!json.ok) {
    await integrationLog('telegram', 'DOCUMENT_FAILED', { level: 'ERROR', message: json.description, data: { file: file.name } })
    return { ok: false, error: json.description ?? 'ارسال فایل ناموفق بود' }
  }
  const result = json.result as { message_id?: number } | undefined
  return { ok: true, messageId: result?.message_id ?? 0 }
}

/**
 * انتشار رویداد سامانه به تلگرام — اگر رویداد در تنظیمات فعال باشد
 * این تابع هرگز جریان اصلی را نمی‌شکند (همه خطاها لاگ می‌شوند)
 */
export async function emitTelegramEvent(event: string, data: Record<string, string | number | null | undefined>): Promise<boolean> {
  try {
    const cfg = await getConfig('telegram')
    if (!cfg.botToken || !cfg.chatId.trim()) return false
    if (!cfg.events.includes(event)) return false
    const template = cfg.templates[event] || TELEGRAM_DEFAULT_TEMPLATES[event] || event
    const text = renderTemplate(template, data)
    const res = await telegramSendMessage(text)
    if (res.ok) {
      await integrationLog('telegram', `EVENT_${event}`, { message: 'پیام رویداد ارسال شد', data: { event } })
    }
    return res.ok
  } catch (e) {
    await integrationLog('telegram', `EVENT_${event}_ERROR`, { level: 'ERROR', message: e instanceof Error ? e.message : 'خطای ناشناخته' })
    return false
  }
}
