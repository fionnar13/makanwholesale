// بارگذاری تصاویر و ویدیو (لوگو، فایوآیکون، تصویر پروفایل، بنر، پس‌زمینه صفحه ورود)
// اعتبارسنجی نوع واقعی فایل با امضای بایت (Magic Bytes) + محدودیت حجم و ابعاد
// تبدیل خودکار تصاویر شطرنجی به WebP با sharp (کیفیت/ابعاد از متغیرهای محیطی)
// + نوشتن اتمیک (فایل موقت → rename) با پاک‌سازی فایل موقت در صورت خطا
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { ApiError } from '@/lib/api'

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // ۲ مگابایت
export const MAX_LOGIN_IMAGE_BYTES = 8 * 1024 * 1024 // ۸ مگابایت — پس‌زمینه صفحه ورود
export const MAX_LOGIN_VIDEO_BYTES = 50 * 1024 * 1024 // ۵۰ مگابایت — ویدیوی پس‌زمینه

// ─── تنظیمات تبدیل WebP — همه از متغیرهای محیطی قابل سفارشی‌سازی ───
// UPLOAD_WEBP_ENABLED: «0» = تبدیل خاموش (فایل اصلی ذخیره می‌شود) — پیش‌فرض روشن
// UPLOAD_WEBP_QUALITY: کیفیت WebP از ۴۰ تا ۱۰۰ — پیش‌فرض ۸۲
// UPLOAD_WEBP_EFFORT: تلاش رمزگذار sharp (۰ تا ۶) — عدد بالاتر فایل کوچک‌تر ولی کندتر؛ پیش‌فرض ۴
// UPLOAD_WEBP_MAX_DIMENSION: سقف بزرگ‌ترین ضلع تصویر؛ ابعاد بزرگ‌تر متناسب کوچک می‌شوند؛ «0» = بدون تغییر ابعاد؛ پیش‌فرض ۲۵۶۰
function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export const WEBP_ENABLED = process.env.UPLOAD_WEBP_ENABLED !== '0'
export const WEBP_QUALITY = envInt('UPLOAD_WEBP_QUALITY', 82, 40, 100)
export const WEBP_EFFORT = envInt('UPLOAD_WEBP_EFFORT', 4, 0, 6)
export const WEBP_MAX_DIMENSION = envInt('UPLOAD_WEBP_MAX_DIMENSION', 2560, 0, 10000)

// اعتبارسنجی ابعاد — تصویرهای نامعقول (خیلی کوچک یا خیلی بزرگ) رد می‌شوند
export const MIN_IMAGE_DIMENSION = 8
export const MAX_IMAGE_DIMENSION = 10000

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

// امضای بایتی برای اطمینان از نوع واقعی فایل (نه صرفاً MIME اعلامی کلاینت)
function detectExt(buf: Buffer, declaredExt: string): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString('ascii')
    if (head === 'GIF87a' || head === 'GIF89a') return 'gif'
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('hex') === '00000100') return 'ico'
  // ویدیو — MP4: رشته ftyp در بایت ۴ تا ۸ / WebM: سرآیند EBML
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4'
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'
  // SVG متن است — با بررسی محتوایی در مسیر خودش اعتبارسنجی می‌شود
  if (declaredExt === 'svg') return 'svg'
  return null
}

export type UploadKind = 'site' | 'avatars' | 'banners' | 'login'

// محدودیت حجم هر نوع — بنرهای هیرو تصویر بزرگ‌تر دارند (۵ مگابایت)
const MAX_BYTES_BY_KIND: Record<UploadKind, number> = {
  site: MAX_IMAGE_BYTES,
  avatars: MAX_IMAGE_BYTES,
  banners: 5 * 1024 * 1024,
  login: MAX_LOGIN_IMAGE_BYTES,
}

// ─── پردازش تصویر شطرنجی → WebP ───
// خروجی null یعنی «فایل اصلی عاری از تغییر ذخیره شود» — سیاست‌های نگه‌داشتن:
//   • SVG (وکتوری — تبدیل معنی ندارد و باید متن بماند) و ICO (چند-ابعادی مخصوص فایوآیکون)
//   • تصاویر متحرک (GIF/WebP فریم‌های متعدد — تبدیل تک‌فریمی انیمیشن را از بین می‌برد)
//   • وقتی خروجی WebP از فایل اصلی بزرگ‌تر شود (آیکون‌های خیلی کوچک) — صرفه‌جویی نداریم، اصل را نگه می‌داریم
// در صورت خرابی فایل یا خطای پردازش، ApiError پرتاب می‌شود و هیچ فایلی ذخیره نمی‌شود.
type Converted = { buf: Buffer; ext: 'webp' } | null

async function processImageToWebp(buf: Buffer, sourceExt: string): Promise<Converted> {
  // سیاست نگه‌داشتن فرمت اصلی — قبل از باز کردن با sharp
  if (sourceExt === 'svg' || sourceExt === 'ico' || !WEBP_ENABLED) return null
  try {
    const image = sharp(buf, { failOn: 'error' })
    const meta = await image.metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    // تصاویر متحرک (فریم‌های متعدد) — اصل ذخیره می‌شود تا انیمیشن حفظ شود
    const isAnimated = (meta.pages ?? 1) > 1
    if (isAnimated) return null
    // اعتبارسنجی ابعاد — تصویر بدون ابعاد یا خارج از محدوده مجاز نیست
    if (!width || !height) {
      throw new ApiError(400, 'BAD_IMAGE', 'ابعاد تصویر قابل تشخیص نیست؛ فایل ممکن است خراب باشد')
    }
    if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION ||
        width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw new ApiError(400, 'BAD_DIMENSIONS',
        `ابعاد تصویر باید بین ${MIN_IMAGE_DIMENSION} تا ${MAX_IMAGE_DIMENSION} پیکسل باشد`)
    }
    // rotate() جهت EXIF عکس‌های موبایل را اصلاح می‌کند؛ resize داخل‌کشیده (بدون بزرگ‌نمایی)
    const pipeline = image.rotate()
    if (WEBP_MAX_DIMENSION > 0) {
      pipeline.resize({
        width: WEBP_MAX_DIMENSION,
        height: WEBP_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
    }
    const out = await pipeline
      .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT, alphaQuality: 100 })
      .toBuffer()
    if (out.length === 0) {
      throw new ApiError(400, 'BAD_IMAGE', 'تبدیل تصویر ناموفق بود؛ فایل ذخیره نشد')
    }
    // اگر WebP کوچک‌تر نشد، فایل اصلی را نگه می‌داریم (آیکون‌های ریز و گراف‌های ساده)
    if (out.length >= buf.length) return null
    return { buf: out, ext: 'webp' }
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(400, 'BAD_IMAGE', 'پردازش تصویر ناموفق بود؛ فایل ممکن است خراب یا ناقص باشد')
  }
}

// نوشتن اتمیک — اول در فایل موقت، سپس rename؛ در خطا فایل موقت پاک می‌شود
async function writeAtomic(dir: string, name: string, buf: Buffer): Promise<void> {
  const tmp = path.join(dir, `.${name}.tmp`)
  try {
    await writeFile(tmp, buf)
    await rename(tmp, path.join(dir, name))
  } catch (e) {
    await rm(tmp, { force: true }) // پاک‌سازی فایل موقت نیمه‌کاره
    throw e
  }
}

// ذخیره تصویر و برگرداندن مسیر عمومی آن مثل /uploads/site/xxxx.webp
// opts.convert=false: فایل بدون تبدیل ذخیره می‌شود (فایوآیکون — سازگاری حداکثری مرورگرها)
export async function saveUploadImage(
  file: File,
  kind: UploadKind,
  opts?: { convert?: boolean },
): Promise<string> {
  const convert = opts?.convert !== false
  const maxBytes = MAX_BYTES_BY_KIND[kind] ?? MAX_IMAGE_BYTES
  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, 'EMPTY_FILE', 'فایلی انتخاب نشده است')
  }
  if (file.size > maxBytes) {
    throw new ApiError(400, 'TOO_LARGE', `حجم تصویر باید حداکثر ${Math.round(maxBytes / (1024 * 1024))} مگابایت باشد`)
  }
  const declaredExt = EXT_BY_MIME[file.type]
  if (!declaredExt) {
    throw new ApiError(400, 'BAD_TYPE', 'فرمت پشتیبانی نمی‌شود؛ از PNG، JPEG، WEBP، GIF، SVG یا ICO استفاده کنید')
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const ext = detectExt(buf, declaredExt)
  if (!ext) {
    throw new ApiError(400, 'BAD_TYPE', 'محتوای فایل با فرمت اعلام‌شده مطابقت ندارد')
  }
  if (ext === 'svg') {
    // SVG حاوی اسکریپت خطرناک است (XSS از طریق <img>/مستقیم)
    const text = buf.toString('utf8')
    if (/<script[\s>]/i.test(text) || /\son\w+\s*=/i.test(text) || /javascript\s*:/i.test(text)) {
      throw new ApiError(400, 'BAD_SVG', 'فایل SVG حاوی کد اجرایی است و مجاز نیست')
    }
    if (text.length > MAX_IMAGE_BYTES) {
      throw new ApiError(400, 'TOO_LARGE', 'حجم تصویر باید حداکثر ۲ مگابایت باشد')
    }
  }
  // تبدیل به WebP — خطای پردازش همان‌جا ApiError می‌دهد و فایل نامعتبری ذخیره نمی‌شود
  const converted = convert ? await processImageToWebp(buf, ext) : null
  const finalBuf = converted ? converted.buf : buf
  const finalExt = converted ? converted.ext : ext

  const dir = path.join(process.cwd(), 'public', 'uploads', kind)
  await mkdir(dir, { recursive: true })
  const name = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}.${finalExt}`
  try {
    await writeAtomic(dir, name, finalBuf)
  } catch {
    throw new ApiError(500, 'WRITE_FAILED', 'ذخیره فایل روی دیسک ناموفق بود')
  }
  return `/uploads/${kind}/${name}`
}

const MEDIA_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
])

// ذخیره تصویر یا ویدیوی پس‌زمینه صفحه ورود — تصویر تا ۸ و ویدیو تا ۵۰ مگابایت
// تصاویر شطرنجی ثابت به WebP تبدیل می‌شوند؛ GIF/WebP متحرک و ویدیو دست‌نخورده می‌مانند
// خروجی مثل /uploads/login/xxxx.mp4 یا /uploads/login/xxxx.webp
export async function saveUploadMedia(file: File, kind: UploadKind): Promise<string> {
  if (!(file instanceof File) || file.size === 0) {
    throw new ApiError(400, 'EMPTY_FILE', 'فایلی انتخاب نشده است')
  }
  const isVideoMime = file.type.startsWith('video/')
  const maxBytes = isVideoMime ? MAX_LOGIN_VIDEO_BYTES : MAX_LOGIN_IMAGE_BYTES
  if (file.size > maxBytes) {
    throw new ApiError(400, 'TOO_LARGE', isVideoMime
      ? 'حجم ویدیو باید حداکثر ۵۰ مگابایت باشد'
      : 'حجم تصویر باید حداکثر ۸ مگابایت باشد')
  }
  if (!MEDIA_MIMES.has(file.type)) {
    throw new ApiError(400, 'BAD_TYPE', 'فرمت پشتیبانی نمی‌شود؛ از PNG، JPEG، WEBP، GIF (تصویر) یا MP4، WEBM (ویدیو) استفاده کنید')
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const ext = detectExt(buf, file.type)
  if (!ext) {
    throw new ApiError(400, 'BAD_TYPE', 'محتوای فایل با فرمت اعلام‌شده مطابقت ندارد')
  }
  const isVideoExt = ext === 'mp4' || ext === 'webm'
  if (isVideoExt !== isVideoMime) {
    throw new ApiError(400, 'BAD_TYPE', 'نوع فایل با محتوای آن مطابقت ندارد')
  }
  // فقط تصاویر شطرنجی به WebP تبدیل می‌شوند — ویدیوها و انیمیشن‌ها اصل ذخیره می‌شوند
  const converted = isVideoExt ? null : await processImageToWebp(buf, ext)
  const finalBuf = converted ? converted.buf : buf
  const finalExt = converted ? converted.ext : ext

  const dir = path.join(process.cwd(), 'public', 'uploads', kind)
  await mkdir(dir, { recursive: true })
  const name = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}.${finalExt}`
  try {
    await writeAtomic(dir, name, finalBuf)
  } catch {
    throw new ApiError(500, 'WRITE_FAILED', 'ذخیره فایل روی دیسک ناموفق بود')
  }
  return `/uploads/${kind}/${name}`
}
