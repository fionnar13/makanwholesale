// پروکسی خروجی برای دسترسی به سرویس‌های خارجی از داخل ایران
// Node.js داخلی fetch متغیرهای HTTPS_PROXY را به‌صورت خودکار نمی‌خواند؛
// این ماژول هر فراخوانی fetch یکپارچه‌سازی‌ها را در صورت تنظیم پروکسی، از طریق
// ProxyAgent کتابخانه undici عبور می‌دهد.
//
// اولویت متغیرها برای هر سرویس:
//   ۱) متغیر اختصاصی سرویس:  GOOGLE_PROXY_URL / TELEGRAM_PROXY_URL / AI_PROXY_URL
//   ۲) متغیر عمومی:          HTTPS_PROXY یا https_proxy
//
// نکته: فراخوانی‌های داخلی google-auth-library (توکن Service Account) به‌جای fetch ما
// از gaxios استفاده می‌کنند که خودش HTTPS_PROXY را می‌خواند؛ پس برای Service Account
// کافی است HTTPS_PROXY تنظیم شود (مستند در docs/integrations.md).
import { ProxyAgent, type Dispatcher } from 'undici'

export type ProxyService = 'GOOGLE' | 'TELEGRAM' | 'AI'

const cache = new Map<string, Dispatcher>()

function resolveProxyUrl(service: ProxyService): string | null {
  const specific = process.env[`${service}_PROXY_URL`]?.trim()
  if (specific) return specific
  const generic = process.env.HTTPS_PROXY?.trim() || process.env.https_proxy?.trim()
  return generic || null
}

/** Dispatcher پروکسی برای سرویس — اگر پروکسی تنظیم نشده باشد undefined برمی‌گرداند */
export function proxyDispatcher(service: ProxyService): Dispatcher | undefined {
  const url = resolveProxyUrl(service)
  if (!url) return undefined
  let agent = cache.get(url)
  if (!agent) {
    // ProxyAgent فقط پروکسی HTTP/HTTPS (تونل CONNECT) را پشتیبانی می‌کند —
    // برای SOCKS باید از ابزار سطح سیستم (مثل tun2socks/gost) یا پروکسی HTTP محلی استفاده کنید
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`آدرس ${service}_PROXY_URL معتبر نیست: «${url}»`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`پروکسی «${parsed.protocol}» برای ${service} پشتیبانی نمی‌شود — فقط http:// یا https:// (پروکسی SOCKS را با ابزار سطح سیستم به HTTP تبدیل کنید)`)
    }
    agent = new ProxyAgent(url)
    cache.set(url, agent)
  }
  return agent
}

/**
 * fetch با پشتیبانی پروکسی — امضای fetch استاندارد؛ اگر پروکسی تنظیم نشده باشد
 * دقیقاً مثل fetch معمولی عمل می‌کند (بدون dispatcher).
 * مثال: await proxyFetch('TELEGRAM', url, { method: 'POST', ... })
 */
export async function proxyFetch(
  service: ProxyService,
  url: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const dispatcher = proxyDispatcher(service)
  if (!dispatcher) return fetch(url, init)
  return fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Dispatcher })
}

/** خواندن متغیر پروکسی مؤثر برای یک سرویس — برای لاگ/تشخیص‌عیب بدون افشای رمز */
export function effectiveProxyUrl(service: ProxyService): string | null {
  const url = resolveProxyUrl(service)
  if (!url) return null
  try {
    const u = new URL(url)
    // اگر پروکسی credential دارد فقط userinfo را پوشانده نمایش بده
    return `${u.protocol}//${u.username ? '***' : ''}${u.password ? ':***' : ''}${u.username || u.password ? '@' : ''}${u.host}`
  } catch {
    return '(آدرس پروکسی نامعتبر)'
  }
}
