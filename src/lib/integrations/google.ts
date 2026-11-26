// لایه گوگل — احراز هویت (OAuth حساب شخصی + Service Account)، آپلود Drive و خواندن/نوشتن Sheets
// دو حالت پشتیبانی می‌شود:
//   oauth   → حساب شخصی Gmail متصل‌شده از پنل (توکن‌ها در GoogleAccount رمزنگاری‌شده)
//   service → Service Account (کاربر ایمیل سرویس‌اکانت را در اشتراک‌گذاری پوشه/فایل اضافه می‌کند)
import { OAuth2Client } from 'google-auth-library'
import { db } from '@/lib/db'
import { decryptValue, encryptValue } from './crypto'
import { integrationLog } from './logs'
import { proxyFetch } from './proxy'

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

// اسکوپ‌های اتصال بکاپ — فقط فایل‌های ساخته‌شده توسط خود برنامه قابل دیدن/حذف‌اند
export const INTEGRATION_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  DRIVE_FILE_SCOPE,
]

export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
export const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets'

export function newOAuthClient(origin: string) {
  // پیکربندی OAuth از env یا Setting (تنظیمات ورود با گوگل) استفاده می‌شود
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID?.trim(),
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
    `${origin}/api/integrations/google/callback`,
  )
}

// ── دسترسی توکن برای حساب ذخیره‌شده ──

export type AccountRow = {
  id: string
  email: string
  displayName: string | null
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: Date | null
  isBackupTarget: boolean
}

export async function getValidAccessToken(account: AccountRow): Promise<string> {
  const access = account.accessToken ? decryptValue(account.accessToken) : null
  const notExpired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + 60_000
  if (access && notExpired) return access

  const refresh = account.refreshToken ? decryptValue(account.refreshToken) : null
  if (!refresh) throw new Error('حساب گوگل بدون Refresh Token است — باید دوباره متصل شود')

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || (await dbSetting('auth.google.clientId'))
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || (await dbSetting('auth.google.clientSecret'))
  if (!clientId || !clientSecret) throw new Error('پیکربندی OAuth گوگل (Client ID/Secret) یافت نشد')

  const res = await proxyFetch('GOOGLE', 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    await integrationLog('google', 'TOKEN_REFRESH_FAILED', { level: 'ERROR', message: `بروزرسانی توکن ${account.email} ناموفق بود`, data: { status: res.status } })
    throw new Error(`بروزرسانی توکن گوگل ناموفق بود (${res.status}). ${detail.slice(0, 200)}`)
  }
  const tokens = (await res.json()) as { access_token: string; expires_in: number }
  await db.googleAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encryptValue(tokens.access_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  })
  return tokens.access_token
}

async function dbSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

// ── Service Account ──

export async function getServiceAccountToken(serviceAccountJson: string, scopes: string[]): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({ credentials: JSON.parse(serviceAccountJson), scopes })
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  if (!token.token) throw new Error('دریافت توکن از Service Account ناموفق بود')
  return token.token
}

/** ایمیل سرویس‌اکانت از JSON — برای راهنمای اشتراک‌گذاری در پنل */
export function serviceAccountEmail(json: string): string | null {
  try {
    const parsed = JSON.parse(json)
    return typeof parsed.client_email === 'string' ? parsed.client_email : null
  } catch {
    return null
  }
}

export function validateServiceAccountJson(json: string): { ok: true } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(json)
    if (!parsed.client_email || !parsed.private_key) {
      return { ok: false, error: 'فایل JSON معتبر نیست — فیلدهای client_email و private_key باید موجود باشند' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'محتوای JSON قابل تجزیه نیست — فایل کامل Service Account را بارگذاری کنید' }
  }
}

// ── Drive ──

export type DriveUploadResult = { fileId: string; name: string; size: number; webViewLink: string | null }

/** آپلود multipart به Drive — فقط فایل‌های ساخته‌شده توسط برنامه در drive.file scope دیده می‌شوند */
export async function driveUploadFile(
  accessToken: string,
  file: { name: string; body: Buffer | string; mimeType: string },
  folderId: string | null,
): Promise<DriveUploadResult> {
  const boundary = 'makan-b' + Math.random().toString(36).slice(2)
  const metadata = {
    name: file.name,
    ...(folderId ? { parents: [folderId] } : {}),
    appProperties: { makanBackup: '1' }, // نشانه فایل‌های بکاپ سامانه برای پاک‌سازی نگهداشت
  }
  const metaJson = JSON.stringify(metadata)
  const bodyBuf = Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body, 'utf8')
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${file.mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`),
    bodyBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const res = await proxyFetch('GOOGLE', `${DRIVE_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': `multipart/related; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    body: new Uint8Array(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`آپلود به Google Drive ناموفق بود (${res.status}): ${detail.slice(0, 300)}`)
  }
  const json = (await res.json()) as { id: string; name: string; webViewLink?: string }
  return { fileId: json.id, name: json.name, size: bodyBuf.length, webViewLink: json.webViewLink ?? null }
}

/** فهرست فایل‌های بکاپ برنامه در پوشه — برای اعمال نگهداشت (retention) */
export async function driveListBackups(accessToken: string, folderId: string | null): Promise<Array<{ id: string; name: string; createdTime: string }>> {
  const q = ["appProperties has { key='makanBackup' and value='1' }"]
  if (folderId) q.push(`'${folderId}' in parents`)
  const params = new URLSearchParams({ q: q.join(' and '), orderBy: 'createdTime desc', pageSize: '100', fields: 'files(id,name,createdTime)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
  const res = await proxyFetch('GOOGLE', `${DRIVE_FILES_URL}?${params}`, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`خواندن فهرست Drive ناموفق بود (${res.status})`)
  const json = (await res.json()) as { files: Array<{ id: string; name: string; createdTime: string }> }
  return json.files ?? []
}

export async function driveDeleteFile(accessToken: string, fileId: string): Promise<void> {
  const res = await proxyFetch('GOOGLE', `${DRIVE_FILES_URL}/${fileId}?supportsAllDrives=true`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok && res.status !== 404) throw new Error(`حذف فایل Drive ناموفق بود (${res.status})`)
}

// ── Sheets ──

export async function sheetsGetValues(accessToken: string, spreadsheetId: string, range: string): Promise<string[][]> {
  const res = await proxyFetch('GOOGLE', `${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`خواندن Google Sheets ناموفق بود (${res.status}): ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { values?: string[][] }
  return json.values ?? []
}

export async function sheetsWriteValues(accessToken: string, spreadsheetId: string, range: string, values: string[][], mode: 'WRITE' | 'APPEND'): Promise<number> {
  const params = new URLSearchParams({ valueInputOption: 'USER_ENTERED', insertDataOption: mode === 'APPEND' ? 'INSERT_ROWS' : 'OVERWRITE' })
  const res = await proxyFetch('GOOGLE', `${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${params}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values, majorDimension: 'ROWS' }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`نوشتن در Google Sheets ناموفق بود (${res.status}): ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { updates?: { updatedCells?: number } }
  return json.updates?.updatedCells ?? 0
}

/** آزمایش دسترسی به Spreadsheet — خطای خوانا برای راهنمای کاربر */
export async function sheetsCheckAccess(accessToken: string, spreadsheetId: string): Promise<{ ok: true; title: string; sheets: string[] } | { ok: false; error: string }> {
  const res = await proxyFetch('GOOGLE', `${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    if (res.status === 403) {
      return { ok: false, error: 'دسترسی رد شد — ایمیل سرویس‌اکانت را در اشتراک‌گذاری فایل با نقش «ویرایشگر» اضافه کنید' }
    }
    if (res.status === 404) {
      return { ok: false, error: 'فایل با این شناسه یافت نشد — Spreadsheet ID را بررسی کنید' }
    }
    return { ok: false, error: `دسترسی به Spreadsheet ناموفق بود (${res.status})` }
  }
  const json = (await res.json()) as { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> }
  return { ok: true, title: json.properties?.title ?? '', sheets: (json.sheets ?? []).map(s => s.properties?.title ?? '') }
}
