# دیپلوی فروشگاه مکان روی Render.com (پلن رایگان)

فایل `render.yaml` در ریشهٔ ریپو، زیرساخت (وب‌سرویس + دیتابیس) را به‌صورت خودکار می‌سازد؛
هیچ تنظیم دستی دیگری لازم نیست.

## راه‌اندازی (فقط یک بار)

1. مطمئن شوید آخرین تغییرات (شامل `render.yaml`) روی GitHub و شاخهٔ `main` پوش شده است.
2. در [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint** → ریپو را انتخاب کنید.
3. Render فایل `render.yaml` را می‌خواند و دو ریسورس نشان می‌دهد:
   - Web Service: `makan-store` (Node، پلن free)
   - PostgreSQL: `makan-store-db` (دیتابیس `makan_store`، پلن free)
4. در فرم Apply، برای متغیرهایی که `sync: false` دارند مقدار وارد کنید:
   - `ADMIN_PASSWORD` — رمز مدیر (مثلاً `Admin#1404`). **حتماً مقدار بدهید** وگرنه رمز تصادفی ساخته
     می‌شود که در فایل موقت ذخیره شده و بعد از دیپلوی قابل بازیابی نیست.
   - `DEMO_USERS_PASSWORD` — رمز ۹ کاربر نمایشی (اختیاری).
5. **Apply** → بیلد شروع می‌شود (۵ تا ۱۰ دقیقه). لاگ زنده در تب **Events / Logs** همان سرویس است.
6. بعد از اتمام بیلد، آدرس سرویس مثل `https://makan-store-xxxx.onrender.com` فعال است.
   ورود مدیر: شمارهٔ `09120000000` + همان `ADMIN_PASSWORD`.

## Build Command دقیقاً چه می‌کند؟

| مرحله | دستور | کار |
|---|---|---|
| 1 | `npm install` | نصب پکیج‌ها + `postinstall` (تولید خودکار کلاینت Prisma) |
| 2 | `npx prisma generate` | تولید کلاینت Prisma از `schema.prisma` |
| 3 | `npx prisma db push` | ساخت/همگام‌سازی جداول — بدون نیاز به فایل migration (پلن رایگان Pre-deploy Command ندارد) |
| 4 | `npx prisma db seed` | مدیر اول + نقش‌ها/مجوزها + دادهٔ نمایشی (Idempotent؛ رمز کاربر موجود را تغییر نمی‌دهد) |
| 5 | `npm run build` | بیلد Next.js |

Start Command: `npm start` یعنی `cross-env NODE_ENV=production next start`.

## متغیرهای محیطی

- `DATABASE_URL` و `DIRECT_URL` به‌صورت خودکار از دیتابیس تعریف‌شده در همان فایل تزریق می‌شوند
  (`fromDatabase → connectionString`) — اتصال داخلی هم‌ریجن، سریع و بدون SSL.
- نسخهٔ Node با `NODE_VERSION=22` قفل شده است (Next.js 16 به Node ≥ 20.9 نیاز دارد).
- ورود با گوگل اختیاری است: خطوط `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` در `render.yaml` را
  از کامنت خارج کنید یا بعداً از **Dashboard → Environment** اضافه کنید؛ Redirect URI در کنسول گوگل
  باید `https://<your-app>.onrender.com/api/auth/google/callback` باشد.

## محدودیت‌های پلن رایگان (مهم)

- **خواب سرویس:** وب‌سرویس پس از ۱۵ دقیقه بی‌کاری خاموش می‌شود؛ اولین درخواست بعدی ۳۰ تا ۶۰ ثانیه
  تأخیر دارد. برای جلوگیری از خواب، پلن Starter لازم است.
- **انقضای دیتابیس:** دیتابیس PostgreSQL رایگان Render **پس از ۳۰ روز منقضی می‌شود**؛ پیش از انقضا
  از داده‌ها خروجی بگیرید یا پلن را ارتقا دهید.
- **دیسک موقت:** فایل‌سیستم با هر دیپلوی خالی می‌شود؛ یعنی تصاویر آپلودی از پنل
  (محصولات/بنرها/پس‌زمینهٔ صفحه ورود در `public/uploads`) پاک می‌شوند. برای استفادهٔ جدی،
  ذخیره‌سازی ابری (مثل Cloudinary/S3) یا پلن دارای دیسک دائمی لازم است.
- **رم بیلد:** پلن رایگان ۵۱۲MB رم دارد؛ اگر بیلد با خطای OOM (exit code 137) قطع شد، موقتاً
  پلن Starter برای بیلد استفاده کنید.

## به‌روزرسانی‌های بعدی

- هر `git push` به `main` → دیپلوی خودکار؛ در هر بیلد `prisma db push` اسکیما را همگام می‌کند و
  `prisma db seed` فقط داده‌های جاافتاده را اضافه می‌کند (دادهٔ موجود بازنویسی نمی‌شود).
- اگر در `schema.prisma` تغییری مخرب (حذف ستون/جدول) بدهید، `db push` برای جلوگیری از ازدست‌رفتن
  داده متوقف می‌شود؛ در آن صورت موقتاً `--accept-data-loss` به Build Command اضافه کنید.
- متغیرهای جدید را از **Dashboard → سرویس → Environment** اضافه کنید؛ Render خودش ری‌دپلوی می‌کند.
- دامنهٔ اختصاصی: **Settings → Custom Domains** (SSL رایگان صادر می‌شود).
