// تست قابلیت‌های تصویر — تبدیل خودکار WebP، سیاست نگه‌داشتن فرمت‌ها، اعتبارسنجی و پاک‌سازی
// اجرا:  bunx tsx scripts/test-image-features.ts   (نیازی به سرور یا دیتابیس ندارد)
// فایل‌های ساخته‌شده در public/uploads بعد از تست حذف می‌شوند.
import { spawnSync } from 'node:child_process'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { saveUploadImage } from '@/lib/uploads'
import { ApiError } from '@/lib/api'

const ROOT = process.cwd()
const UPLOADS_DIR = path.join(ROOT, 'public', 'uploads')
let PASS = 0
let FAIL = 0
const created: string[] = []

function check(desc: string, cond: boolean, extra = '') {
  if (cond) { PASS++; console.log(`   PASS: ${desc}`) }
  else { FAIL++; console.log(`   FAIL: ${desc}${extra ? ` — ${extra}` : ''}`) }
}

// File شبه‌مرورگری از بافر — شبیه‌سازی FormData روی مسیر API
function makeFile(buf: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(buf)], name, { type })
}

async function outMeta(url: string) {
  return sharp(path.join(ROOT, 'public', url)).metadata()
}

// ─── تصاویر نمونه در حافظه ───
const pngAlpha = await sharp({
  create: { width: 40, height: 30, channels: 4, background: { r: 34, g: 197, b: 94, alpha: 0.5 } },
}).png().toBuffer()
const jpegBig = await sharp({
  create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 120, b: 40 } },
}).jpeg({ quality: 90 }).toBuffer()
const webpSample = await sharp({
  create: { width: 100, height: 80, channels: 3, background: { r: 10, g: 60, b: 120 } },
}).webp().toBuffer()
const hugePng = await sharp({
  create: { width: 3000, height: 1000, channels: 3, background: { r: 90, g: 90, b: 90 } },
}).png().toBuffer()
const tinyPng = await sharp({
  create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
}).png().toBuffer()
const tooHugePng = await sharp({
  create: { width: 10500, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
}).png().toBuffer()
const corruptPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('this-is-not-a-valid-image-body'),
])
// ICO حداقلی (بدون نیاز به دیکود — فقط امضای بایتی مسیر نگه‌داشتن را طی می‌کند)
const icoBytes = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]), // ICONDIR + ۱ تصویر
  Buffer.from([16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  Buffer.alloc(16, 0),
])
const svgText = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="tomato"/></svg>')
// GIF متحرک دو‌فریمه با ffmpeg (اگر موجود بود)
let animatedGif: Buffer | null = null
let ffmpegBin = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).status === 0
  ? 'ffmpeg' : '/usr/bin/ffmpeg'
const ff = spawnSync(ffmpegBin, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=32x32:d=0.2', '-f', 'lavfi', '-i', 'color=blue:s=32x32:d=0.2', '-filter_complex', '[0][1]concat=n=2:v=1,fps=5', '/tmp/bwh-anim-test.gif'])
if (ff.status === 0) {
  const { readFile } = await import('node:fs/promises')
  animatedGif = await readFile('/tmp/bwh-anim-test.gif')
  await rm('/tmp/bwh-anim-test.gif', { force: true })
} else if (ff.stderr) {
  console.log(`   (ffmpeg: ${String(ff.stderr).slice(0, 120)})`)
}

console.log('== ۱) تبدیل PNG با شفافیت به WebP — حفظ شفافیت و ابعاد')
{
  const url = await saveUploadImage(makeFile(pngAlpha, 'a.png', 'image/png'), 'avatars')
  created.push(url)
  check('امت خروجی webp است', url.endsWith('.webp'), url)
  const m = await outMeta(url)
  check('شفافیت حفظ شده (hasAlpha)', m.hasAlpha === true, `hasAlpha=${m.hasAlpha}`)
  check('ابعاد تغییری نکرده', m.width === 40 && m.height === 30, `${m.width}x${m.height}`)
  check('فرمت واقعی webp', m.format === 'webp', `format=${m.format}`)
}

console.log('== ۲) تبدیل JPEG بزرگ به WebP — بدون شفافیت')
{
  const url = await saveUploadImage(makeFile(jpegBig, 'b.jpg', 'image/jpeg'), 'banners')
  created.push(url)
  const m = await outMeta(url)
  check('JPEG به webp تبدیل شد', url.endsWith('.webp') && m.format === 'webp', url)
  check('JPEG شفافیت ندارد', m.hasAlpha !== true, `hasAlpha=${m.hasAlpha}`)
}

console.log('== ۳) ورودی WebP — همچنان WebP')
{
  const url = await saveUploadImage(makeFile(webpSample, 'c.webp', 'image/webp'), 'avatars')
  created.push(url)
  const m = await outMeta(url)
  check('webp → webp', url.endsWith('.webp') && m.format === 'webp', url)
}

console.log('== ۴) سیاست نگه‌داشتن فرمت‌های خاص — SVG، ICO، متحرک، فایوآیکون')
{
  const url = await saveUploadImage(makeFile(svgText, 'd.svg', 'image/svg+xml'), 'site')
  created.push(url)
  check('SVG بدون تغییر ماند', url.endsWith('.svg'), url)

  const urlIco = await saveUploadImage(makeFile(icoBytes, 'e.ico', 'image/x-icon'), 'site')
  created.push(urlIco)
  check('ICO بدون تغییر ماند', urlIco.endsWith('.ico'), urlIco)

  const urlFavicon = await saveUploadImage(makeFile(pngAlpha, 'f.png', 'image/png'), 'site', { convert: false })
  created.push(urlFavicon)
  check('فایوآیکون (convert:false) PNG ماند', urlFavicon.endsWith('.png'), urlFavicon)

  if (animatedGif) {
    const urlGif = await saveUploadImage(makeFile(animatedGif, 'g.gif', 'image/gif'), 'banners')
    created.push(urlGif)
    const m = await outMeta(urlGif)
    check('GIF متحرک بدون تغییر ماند (انیمیشن حفظ شد)', urlGif.endsWith('.gif') && (m.pages ?? 1) > 1, `${urlGif} pages=${m.pages}`)
  } else {
    console.log('   SKIP: ffmpeg در دسترس نیست — تست GIF متحرک رد شد')
  }
}

console.log('== ۵) محدودسازی ابعاد بزرگ با UPLOAD_WEBP_MAX_DIMENSION (پیش‌فرض ۲۵۶۰)')
{
  const url = await saveUploadImage(makeFile(hugePng, 'h.png', 'image/png'), 'banners')
  created.push(url)
  const m = await outMeta(url)
  check('بزرگ‌ترین ضلع به ۲۵۶۰ محدود شد', m.width === 2560 && m.height === 853, `${m.width}x${m.height}`)
  check('نسبت ابعاد حفظ شده (بدون کشیدگی)', Math.abs(m.width! / m.height! - 3) < 0.01)
}

console.log('== ۶) اعتبارسنجی — فایل خراب، خیلی کوچک، خیلی بزرگ')
{
  let threw = ''
  try { await saveUploadImage(makeFile(corruptPng, 'x.png', 'image/png'), 'avatars') } catch (e) { threw = e instanceof ApiError ? e.code : String(e) }
  check('فایل خراب رد شد (BAD_IMAGE) و چیزی ذخیره نشد', threw === 'BAD_IMAGE', threw)

  threw = ''
  try { await saveUploadImage(makeFile(tinyPng, 'y.png', 'image/png'), 'avatars') } catch (e) { threw = e instanceof ApiError ? e.code : String(e) }
  check('تصویر خیلی کوچک رد شد (BAD_DIMENSIONS)', threw === 'BAD_DIMENSIONS', threw)

  threw = ''
  try { await saveUploadImage(makeFile(tooHugePng, 'z.png', 'image/png'), 'banners') } catch (e) { threw = e instanceof ApiError ? e.code : String(e) }
  check('تصویر خیلی بزرگ رد شد (BAD_DIMENSIONS)', threw === 'BAD_DIMENSIONS', threw)
}

console.log('== ۷) کیفیت WebP قابل تنظیم با UPLOAD_WEBP_QUALITY (فرزند مستقل با env متفاوت)')
{
  // WEBP_QUALITY هنگام import خوانده می‌شود — دو فرزند با env متفاوت مقایسه می‌شوند
  const childCode = `
    (async () => {
      process.env.UPLOAD_WEBP_QUALITY = process.env.BWH_TEST_QUALITY
      const { saveUploadImage } = await import('${path.join(ROOT, 'src/lib/uploads.ts').replaceAll('\\', '/')}')
      const sharp = (await import('sharp')).default
      // تصویر پرتراکستِ همه‌به‌تر — تفاوت کیفیت در اندازه خروجی کاملاً دیده می‌شود
      const raw = Buffer.alloc(600 * 400 * 3)
      for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251
      const buf = await sharp(raw, { raw: { width: 600, height: 400, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
      const url = await saveUploadImage(new File([new Uint8Array(buf)], 'q.jpg', { type: 'image/jpeg' }), 'avatars')
      const { stat } = await import('node:fs/promises')
      const s = await stat('public' + url)
      console.log(JSON.stringify({ url, size: s.size }))
    })().catch(e => { console.error(e); process.exit(1) })
  `
  const run = (quality: string) => spawnSync('bunx', ['tsx', '-e', childCode], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, BWH_TEST_QUALITY: quality },
  })
  const low = run('40')
  const high = run('100')
  if (low.status === 0 && high.status === 0) {
    const lo = JSON.parse(low.stdout.trim().split('\n').pop()!) as { url: string; size: number }
    const hi = JSON.parse(high.stdout.trim().split('\n').pop()!) as { url: string; size: number }
    created.push(lo.url, hi.url)
    check('کیفیت ۴۰ → WebP کوچک', lo.url.endsWith('.webp') && lo.size < 200_000, `${lo.url} ${lo.size}B`)
    // محافظ ضد بزرگ‌شدگی: برای این الگوی پرتراکست، WebP با کیفیت ۱۰۰ از JPEG اصلی بزرگ‌تر می‌شود
    // → سیاست درست «نگه‌داشتن فایل اصلی» است و خروجی .jpg می‌ماند
    check('کیفیت ۱۰۰ → محافظ ضد بزرگ‌شدگی فایل اصلی را نگه می‌دارد', hi.url.endsWith('.jpg'), `${hi.url} ${hi.size}B`)
    check('خروجی کیفیت ۴۰ از فایل اصلی کیفیت ۱۰۰ کوچک‌تر است', lo.size < hi.size, `${lo.size} vs ${hi.size}`)
  } else {
    check('اجرای فرزند tsx موفق بود', false, low.stderr || high.stderr)
  }
}

console.log('== ۸) پاک‌سازی فایل‌های موقت — هیچ .tmp باقی نمانده است')
{
  const leftovers: string[] = []
  for (const dir of ['avatars', 'banners', 'site', 'login']) {
    try {
      const names = await readdir(path.join(UPLOADS_DIR, dir))
      for (const n of names) if (n.endsWith('.tmp')) leftovers.push(`${dir}/${n}`)
    } catch { /* پوشه ممکن است اصلاً نباشد — مشکلی نیست */ }
  }
  check('بدون فایل موقت باقی‌مانده', leftovers.length === 0, leftovers.join(', '))
}

// ─── پاک‌سازی فایل‌های ساخته‌شده توسط تست ───
for (const url of created) {
  await rm(path.join(ROOT, 'public', url), { force: true })
}

console.log()
console.log(`════ نتیجه تست تصاویر: ${PASS} موفق، ${FAIL} ناموفق ════`)
if (FAIL > 0) process.exit(1)
