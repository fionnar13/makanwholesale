// بازگشت از رضایت گوگل — تبادل کد، ذخیره حساب و توکن‌ها (رمزنگاری‌شده)، انتخاب مقصد بکاپ
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientIp } from '@/lib/api'
import { audit } from '@/lib/audit'
import { encryptValue } from '@/lib/integrations/crypto'
import { INTEGRATION_SCOPES } from '@/lib/integrations/google'
import { integrationLog } from '@/lib/integrations/logs'
import { CONNECT_STATE_COOKIE } from '../connect/route'

async function resolveSettingValue(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

function resolveOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
    || req.headers.get('x-bwh-proto')?.trim().toLowerCase()
    || (req.nextUrl.protocol === 'https:' ? 'https' : 'http')
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.nextUrl.host
  return `${proto}://${host}`
}

function errorPage(origin: string, title: string, detail: string): NextResponse {
  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:Vazirmatn,system-ui,sans-serif;background:#f5f5f4;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:32px;max-width:420px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.06)}h1{font-size:18px;color:#b91c1c;margin:0 0 12px}p{font-size:14px;color:#57534e;line-height:2;margin:0 0 20px}a{display:inline-block;background:#059669;color:#fff;border-radius:10px;padding:10px 24px;text-decoration:none;font-size:14px}</style></head>
<body><main><h1>${title}</h1><p>${detail}</p><a href="${origin}/#/integrations">بازگشت به تنظیمات یکپارچه‌سازی</a></main></body></html>`
  return new NextResponse(html, { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function GET(req: NextRequest) {
  const origin = resolveOrigin(req)
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const googleError = url.searchParams.get('error')

    const cookie = req.cookies.get(CONNECT_STATE_COOKIE)?.value
    let oauth: { state?: string; verifier?: string; userId?: string } = {}
    try { oauth = cookie ? JSON.parse(cookie) : {} } catch { oauth = {} }

    if (googleError) {
      return errorPage(origin, 'اتصال لغو شد', googleError === 'access_denied' ? 'اجازه دسترسی توسط شما لغو شد.' : `خطای گوگل: ${googleError}`)
    }
    if (!code || !state || !oauth.state || !oauth.verifier || state !== oauth.state) {
      return errorPage(origin, 'درخواست نامعتبر', 'وضعیت اتصال یافت نشد یا منقضی شده است. از پنل مدیریت دوباره «اتصال حساب Google» را بزنید.')
    }

    // تبادل کد با توکن‌ها — روش دستی مانند مسیر ورود با گوگل
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || (await resolveSettingValue('auth.google.clientId'))
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || (await resolveSettingValue('auth.google.clientSecret'))
    if (!clientId || !clientSecret) {
      return errorPage(origin, 'پیکربندی ناقص', 'Client ID/Secret گوگل تنظیم نشده است. ابتدا از تب «ورود با گوگل» پنل مدیریت تنظیم کنید.')
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/integrations/google/callback`,
        grant_type: 'authorization_code',
        code_verifier: oauth.verifier,
      }),
    })
    if (!tokenRes.ok) {
      console.error('[GOOGLE_CONNECT_TOKEN_ERROR]', await tokenRes.text().catch(() => ''))
      return errorPage(origin, 'اتصال ناموفق بود', 'تبادل توکن با گوگل ناموفق بود. چند لحظه بعد دوباره تلاش کنید.')
    }
    const tokens = (await tokenRes.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      id_token?: string
    }
    if (!tokens.access_token) return errorPage(origin, 'اتصال ناموفق بود', 'پاسخ گوگل معتبر نبود.')

    // پروفایل حساب از id_token یا userinfo
    let email = '', name: string | null = null, picture: string | null = null
    const ui = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })
    if (ui.ok) {
      const p = (await ui.json()) as { email?: string; name?: string; picture?: string }
      email = p.email ?? ''
      name = p.name ?? null
      picture = p.picture ?? null
    }
    if (!email) return errorPage(origin, 'اتصال ناموفق بود', 'دریافت ایمیل حساب گوگل ناموفق بود.')

    // ذخیره حساب — توکن‌ها رمزنگاری‌شده؛ اولین حساب = مقصد بکاپ مرکزی
    const existingCount = await db.googleAccount.count()
    await db.googleAccount.upsert({
      where: { email },
      update: {
        displayName: name, picture,
        accessToken: encryptValue(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptValue(tokens.refresh_token) : undefined,
        tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        scope: (tokens.scope ?? INTEGRATION_SCOPES.join(' ')).slice(0, 500),
        isActive: true,
        connectedById: oauth.userId ?? null,
      },
      create: {
        email,
        displayName: name,
        picture,
        accessToken: encryptValue(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptValue(tokens.refresh_token) : null,
        tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        scope: (tokens.scope ?? INTEGRATION_SCOPES.join(' ')).slice(0, 500),
        isBackupTarget: existingCount === 0,
        connectedById: oauth.userId ?? null,
      },
    })

    await audit({
      userId: oauth.userId ?? null,
      action: 'integration.google.connected', entityType: 'GoogleAccount', entityId: email,
      after: { email, isBackupTarget: existingCount === 0 }, ip: clientIp(req),
    })
    await integrationLog('google', 'ACCOUNT_CONNECTED', { message: `حساب ${email} متصل شد`, data: { email, isBackupTarget: existingCount === 0 } })

    const res = NextResponse.redirect(`${origin}/#/integrations`)
    res.cookies.set(CONNECT_STATE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  } catch (e) {
    console.error('[GOOGLE_CONNECT_CALLBACK_ERROR]', e)
    return errorPage(origin, 'خطای غیرمنتظره', 'در پردازش اتصال گوگل خطایی رخ داد. لطفاً دوباره تلاش کنید.')
  }
}
