// رمزنگاری مقادیر حساس یکپارچه‌سازی‌ها — AES-256-GCM
// هر مقدار رمزشده با پیشوند enc.v1 شناخته می‌شود؛ کلید از env خوانده می‌شود
// کلید در .env.example مستند است: INTEGRATION_SECRET_KEY (۳۲+ کاراکتر تصادفی)
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PREFIX = 'enc.v1'

// کلید ۳۲ بایتی از رمز عبور دلخواه با SHA-256 ساخته می‌شود (قابل استفاده در env بدون قید فرمت)
function deriveKey(): Buffer {
  const secret =
    process.env.INTEGRATION_SECRET_KEY?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    '' // fallback ثابت فقط برای محیط توسعه — در پروداکشن هشدار داده می‌شود
  if (!secret) {
    console.warn('[SECURITY] INTEGRATION_SECRET_KEY تنظیم نشده است؛ از کلید جایگزین استفاده می‌شود. برای پروداکشن حتماً تنظیم کنید.')
  }
  return createHash('sha256').update(secret || 'makan-default-dev-key').digest()
}

/** رمزنگاری متن — خروجی enc.v1.<iv>.<tag>.<cipher> به base64url */
export function encryptValue(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.')
}

/** بازگشایی رمز — اگر ورودی رمزشده نباشد، خودش را برمی‌گرداند (سازگاری عقب) */
export function decryptValue(value: string): string {
  if (!isEncrypted(value)) return value
  try {
    // ساختار: enc.v1.<iv>.<tag>.<cipher> — پیشوند شامل نقطه است؛ سه بخش آخر را جدا می‌کنیم
    const parts = value.split('.')
    const [ivB64, tagB64, dataB64] = [parts[2], parts[3], parts[4]]
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64url'), { authTagLength: 16 })
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8')
  } catch (e) {
    throw new Error('رمزگشایی مقدار ذخیره‌شده ناموفق بود — احتمالاً INTEGRATION_SECRET_KEY تغییر کرده است', { cause: e })
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX + '.')
}

/** پوشاندن مقدار حساس برای نمایش در پنل — فقط ۴ کاراکتر آخر باقی می‌ماند */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (isEncrypted(value)) return '•••••••• (ذخیره‌شده و رمزنگاری‌شده)'
  if (value.length <= 8) return '••••••••'
  return '••••••' + value.slice(-4)
}
