// لایه انتزاعی هوش مصنوعی — سازگار با OpenAI API (OpenRouter / 9Router / هر ارائه‌دهنده دلخواه)
// ادمین بدون تغییر کد، ارائه‌دهنده/Base URL/کلید/مدل را از پنل عوض می‌کند
import { getConfig } from './config'
import { db } from '@/lib/db'
import { proxyFetch } from './proxy'

export type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type AiChatResult = {
  ok: boolean
  content?: string
  error?: string
  latencyMs?: number
  model?: string
}

const REQUEST_TIMEOUT_MS = 60_000

/** فراخوانی خام chat/completions — با مدیریت ۴۲۹ و لاگ در AiLog */
export async function aiChat(messages: AiMessage[], purpose: string): Promise<AiChatResult> {
  const cfg = await getConfig('ai')
  if (!cfg.enabled) return { ok: false, error: 'هوش مصنوعی در تنظیمات غیرفعال است' }
  if (!cfg.apiKey) return { ok: false, error: 'کلید API ارائه‌دهنده تنظیم نشده است' }

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const started = Date.now()
  try {
    const res = await proxyFetch('AI', url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
        // HTTP-Referer/X-Title برای OpenRouter به‌منظور نمایش نام اپ در داشبورد
        'HTTP-Referer': process.env.APP_URL ?? 'https://makan-store.local',
        'X-Title': 'Makan Store',
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature,
        messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') ?? '؟'
      await aiLog(cfg, purpose, 'ERROR', 0, 0, Date.now() - started, `Rate limit — retry after ${retryAfter}s`)
      return { ok: false, error: `محدودیت نرخ ارائه‌دهنده فعال است — پس از ${retryAfter} ثانیه دوباره تلاش کنید`, latencyMs: Date.now() - started }
    }

    const json = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    } | null

    if (!res.ok || !json) {
      const msg = json?.error?.message ?? `خطای ارائه‌دهنده (${res.status})`
      await aiLog(cfg, purpose, 'ERROR', 0, 0, Date.now() - started, msg)
      return { ok: false, error: msg, latencyMs: Date.now() - started }
    }

    const content = json.choices?.[0]?.message?.content ?? ''
    const latencyMs = Date.now() - started
    await aiLog(cfg, purpose, 'SUCCESS', messages.reduce((s, m) => s + m.content.length, 0), content.length, latencyMs, null)
    return { ok: true, content, latencyMs, model: cfg.model }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'خطای ناشناخته در ارتباط با ارائه‌دهنده'
    const latencyMs = Date.now() - started
    await aiLog(cfg, purpose, 'ERROR', 0, 0, latencyMs, msg)
    return { ok: false, error: msg.includes('Timeout') || msg.includes('aborted') ? 'زمان پاسخ ارائه‌دهنده بیش از حد طول کشید' : msg, latencyMs }
  }
}

async function aiLog(
  cfg: { provider: string; model: string },
  purpose: string,
  status: 'SUCCESS' | 'ERROR',
  promptChars: number,
  responseChars: number,
  latencyMs: number,
  error: string | null,
) {
  try {
    await db.aiLog.create({
      data: { provider: cfg.provider, model: cfg.model, purpose, status, promptChars, responseChars, latencyMs, error },
    })
  } catch (e) {
    console.error('[AI_LOG_FAIL]', e)
  }
}

// ── Snapshot داده‌های سامانه برای پاسخ به پرسش‌های مدیریتی ──

export async function buildDataSnapshot(maxRows: number): Promise<string> {
  const { DATASETS } = await import('./datasets')
  const parts: string[] = []
  for (const key of ['customers', 'products', 'orders', 'suppliers']) {
    const ds = DATASETS[key]
    const rows = await ds.exportRows()
    const limited = rows.slice(0, maxRows)
    parts.push(`## ${ds.label} (${rows.length} سطر — نمایش حداکثر ${limited.length})`)
    if (ds.columns.length > 0) parts.push('ستون‌ها: ' + ds.columns.map(c => `${c.label}(${c.field})`).join('، '))
    for (const r of limited) {
      parts.push(ds.columns.map(c => `${c.field}: ${r[c.field] ?? ''}`).join(' | '))
    }
    parts.push('')
  }
  return parts.join('\n')
}

// ── کاربردهای آماده ──

/** پاسخ به پرسش مدیریتی بر اساس داده‌های سامانه */
export async function aiAnswerManagementQuestion(question: string): Promise<AiChatResult> {
  const cfg = await getConfig('ai')
  const snapshot = await buildDataSnapshot(cfg.maxDataRows)
  return aiChat(
    [
      { role: 'system', content: cfg.systemPrompt },
      {
        role: 'user',
        content: `داده‌های سامانه:\n${snapshot}\n\nپرسش مدیر: ${question}\nفقط بر اساس داده‌های بالا پاسخ بده؛ اگر داده کافی نیست صریح بگو.`,
      },
    ],
    'ASSISTANT',
  )
}

/** خلاصه‌سازی داده‌ها و گزارش‌ها */
export async function aiSummarizeData(question?: string): Promise<AiChatResult> {
  const cfg = await getConfig('ai')
  const snapshot = await buildDataSnapshot(Math.min(cfg.maxDataRows, 120))
  return aiChat(
    [
      { role: 'system', content: cfg.systemPrompt },
      {
        role: 'user',
        content: `از داده‌های زیر یک خلاصه مدیریتی به فارسی بساز: نکات کلیدی، ریسک‌ها و ۳ پیشنهاد عملی.\n\n${snapshot}${question ? `\nتمرکز ویژه: ${question}` : ''}`,
      },
    ],
    'SUMMARIZE',
  )
}

/** پیشنهاد دسته‌بندی خودکار محصولات — خروجی JSON: [{sku, suggestedCategory, confidence}] */
export async function aiSuggestCategories(): Promise<AiChatResult> {
  const cfg = await getConfig('ai')
  const rows = (await (await import('./datasets')).DATASETS.products.exportRows()).slice(0, 100)
  const cats = await db.category.findMany({ select: { name: true } })
  const lines = rows.map(r => `- sku: ${r['sku']}, نام: ${r['name']}, برند: ${r['brand'] ?? '-'}, دسته فعلی: ${r['category'] ?? 'بدون دسته'}`)
  return aiChat(
    [
      { role: 'system', content: 'تو دستیار دسته‌بندی کالای یک بنکداری مواد غذایی ایرانی هستی. فقط JSON معتبر برگردان.' },
      {
        role: 'user',
        content: `دسته‌های موجود: ${cats.map(c => c.name).join('، ')}\n\nبرای هر کالا از لیست زیر، دسته مناسب از بین دسته‌های موجود انتخاب کن (اگر هیچ مناسب نیست، دسته جدید پیشنهاد بده):\n${lines.join('\n')}\n\nفقط JSON برگردان به شکل: [{"sku":"...","suggestedCategory":"..."}]`,
      },
    ],
    'CATEGORIZE',
  )
}

/** تبدیل پاسخ AI به آرایه پیشنهاد دسته‌بندی — با مقاومت در برابر متن اضافه */
export function parseCategorySuggestions(content: string): Array<{ sku: string; suggestedCategory: string }> {
  const start = content.indexOf('[')
  const end = content.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try {
    const arr = JSON.parse(content.slice(start, end + 1)) as Array<{ sku?: string; suggestedCategory?: string }>
    return arr
      .filter(x => typeof x.sku === 'string' && typeof x.suggestedCategory === 'string')
      .map(x => ({ sku: x.sku as string, suggestedCategory: x.suggestedCategory as string }))
  } catch {
    return []
  }
}
