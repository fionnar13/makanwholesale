// شروع اتصال حساب شخصی Google برای بکاپ — ساخت URL رضایت OAuth 2.0 + PKCE
// از همان Client ID/Secret ورود با گوگل استفاده می‌کند؛ ریدایرکت جداگانه دارد
import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library'
import { db } from '@/lib/db'
import { ApiError, handler, clientIp, rateLimit } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { INTEGRATION_SCOPES } from '@/lib/integrations/google'

export const CONNECT_STATE_COOKIE = 'bwh_int_oauth'

function resolveSettingValue(key: string): Promise<string | null> {
  return db.setting.findUnique({ where: { key } }).then(r => r?.value ?? null)
}

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    rateLimit(`google-connect:${user.id}`, 10, 60_000)

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || (await resolveSettingValue('auth.google.clientId'))
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || (await resolveSettingValue('auth.google.clientSecret'))
    if (!clientId || !clientSecret) {
      throw new ApiError(400, 'NO_OAUTH_CONFIG', 'ابتدا Client ID و Client Secret گوگل را در تب «ورود با گوگل» یا متغیرهای محیطی تنظیم کنید')
    }

    // پروتکل واقعی از دید مرورگر — مانند بقیه مسیرهای OAuth سامانه
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
      || req.headers.get('x-bwh-proto')?.trim().toLowerCase()
      || (req.nextUrl.protocol === 'https:' ? 'https' : 'http')
    const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.nextUrl.host
    const origin = `${proto}://${host}`

    const client = new OAuth2Client(clientId, clientSecret, `${origin}/api/integrations/google/callback`)
    const state = randomBytes(16).toString('hex')
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    const url = client.generateAuthUrl({
      access_type: 'offline', // دریافت refresh_token — برای بکاپ خودکار الزامی است
      prompt: 'consent',
      scope: INTEGRATION_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      redirect_uri: `${origin}/api/integrations/google/callback`,
    })

    const res = NextResponse.json({ ok: true, data: { url } })
    res.cookies.set(CONNECT_STATE_COOKIE, JSON.stringify({ state, verifier: codeVerifier, userId: user.id }), {
      httpOnly: true,
      sameSite: proto === 'https' ? 'none' : 'lax',
      secure: proto === 'https',
      path: '/',
      maxAge: 600,
    })
    return res
  })
}
