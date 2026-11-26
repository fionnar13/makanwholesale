# راهنمای پوش مخزن به GitHub — makanwholesale

> این سند توسط ایجنت اجرایی پس از تکمیل فازهای ۰ تا ۶ تولید شده است.
> تاریخ تولید: 2026-11-26 | نقطهٔ `main`: `7b26f3a86180b56e57464eceb8a7bb7ba9631ed7`

## وضعیت فعلی در یک نگاه

| مورد | مقدار |
|---|---|
| تعداد کل کامیت‌های `main` | ۲۵ |
| کامیت‌های جدید نسبت به `origin/main` | **۱۱** (`origin/main..main`) |
| نوک `origin/main` روی GitHub | `9d10a86` («Update seed.ts») |
| نوک `main` محلی (سندباکس) | `7b26f3a` |
| رابطهٔ تاریخچه‌ها | `origin/main` جدِ `main` است → **پوش سریع به جلو (fast-forward) بدون نیاز به force** |
| فایل باندل | `makanwholesale.bundle` — ۳٬۵۸۸٬۰۸۱ بایت (≈ ۳٫۵ MB)، تاریخچهٔ کامل، بدون وابستگی به کامیت‌های دیگر |
| آرشیو کامل | `makanwholesale-full.zip` — بدون `.git`، `node_modules`، `.next`، `.env`، `db/`، `public/uploads/` |

---

## الف) فهرست ۱۱ کامیت جدید (قدیمی‌ترین → جدیدترین)

خروجی واقعی `git log --oneline origin/main..main`:

```
68c151a feat(store-order): ثبت سفارش توسط ویزیتور در فروشگاه + هماهنگ‌سازی مخزن جدید
af7b2ae feat(media): تبدیل خودکار WebP + نمایش واکنش‌گرای تصویر + لایت‌باکس + گرادیانت متحرک موبایل صفحه ورود
0978827 feat(integrations): یکپارچه‌سازی‌های خارجی — بکاپ خودکار Google Drive، Google Sheets، تلگرام و هوش مصنوعی از پنل مدیریت
c83d08f fix(seed): حذف بازنویسی رمز کاربران در اجرای مجدد seed
38148a3 fix(types): رفع ۳۸ خطای TypeScript و حذف پنهان‌سازی ignoreBuildErrors
f98ec6f ci: GitHub Action برای typecheck، lint، test و build با PostgreSQL موقت
d9f3ed7 feat(proxy): پروکسی خروجی برای دسترسی به سرویس‌های خارجی از داخل ایران + تکمیل پیکربندی استقرار
8ff3ca7 feat(backup): بکاپ قابل‌اتکا — هشدار توقف، وضعیت رنگی پنل و چک‌لیست cron بیرونی
1ba0577 test: مستحکم‌سازی تست‌ها — تفکیک unit/integration، تست جریان سفارش ویزیتور، smoke در CI
6fa8a8f docs(integrations): راه‌اندازی گام‌به‌گام اعتبارنامه‌های Google + چک‌لیست تأیید نهایی
7b26f3a docs(STATUS): به‌روزرسانی شمارش تست‌ها (unit 33/33، integration 6/6، smoke 65/65)
```

سه قابلیت بزرگ (`feat(store-order)`، `feat(media)`، `feat(integrations)`) + هفت کامیت اصلاح/زیرساخت/مستندسازی از فازهای ۰ تا ۶.

---

## ب) روش اول (توصیه‌شده): کلون تازه از باندل

این روش تمیزترین حالت است: تاریخچهٔ دقیقاً یکسان با سندباکس منتقل می‌شود و هیچ چیز محلی بازنویسی نمی‌شود.

```bash
# ۱. فایل makanwholesale.bundle را دانلود و در یک پوشهٔ امن ذخیره کن (مثلاً ~/Downloads)

# ۲. از باندل یک کلون تازه بساز
#    ⚠️ حتماً از -b main استفاده کن؛ بدون این پرچم، git چون داخل باندل HEAD ثبت نشده
#       یک شاخهٔ خالی master می‌سازد و پوش چیزی منتقل نمی‌کند (تست شده).
git clone -b main makanwholesale.bundle makanwholesale-new

# ۳. وارد پوشه شو
cd makanwholesale-new

# ۴. مخزن راه‌دور را روی GitHub تنظیم کن
git remote set-url origin https://github.com/fionnar13/makanwholesale.git

# ۵. تاریخچه و وضعیت را تأیید کن — هر دو باید مطابق جدول بالا باشند
git log --oneline -15        # باید ۷b26f3a در صدر باشد
git rev-list --count main    # باید ۲۵ باشد
git status                   # باید clean باشد

# ۶. پوش به GitHub (بدون force — چون origin/main جدِ main است، fast-forward می‌شود)
git push origin main
```

اگر به هر دلیلی بدون `-b main` کلون گرفتی و شاخهٔ `master` خالی ساخته شد، نجاتش ساده است:

```bash
git fetch origin '+refs/heads/*:refs/remotes/origin/*'
git checkout main
# حالا دوباره گام ۴ به بعد را اجرا کن
```

---

## ج) روش دوم: اعمال باندل روی مخزن موجود کاربر

اگر می‌خواهی همان مخزن محلی فعلی‌ات را نگه داری و صرفاً شاخهٔ `main` را با نسخهٔ سندباکس هم‌تراز کنی:

```bash
# ۰. داخل مخزن محلی خودت — اول از وضعیت فعلی پشتیبان بگیر
git branch backup-before-bundle

# ۱. باندل را به عنوان ریموت موقت اضافه کن
git remote add bundle /path/to/makanwholesale.bundle
git fetch bundle main

# ۲. شاخهٔ main را به سمت باندل ریست کن (چون در سندباکس rebase انجام شده)
git checkout main
git reset --hard bundle/main

# ۳. صحت‌سنجی — نوک باید 7b26f3a و تعداد کامیت‌ها ۲۵ باشد
git log --oneline -3
git rev-list --count main

# ۴. ریموت موقت را حذف کن
git remote remove bundle

# ۵. پوش به GitHub
git push origin main
```

> **⚠️ هشدار:** این روش تاریخچهٔ محلی شاخهٔ `main` تو را بازنویسی می‌کند (کامیت‌های محلی‌ای که در باندل نیستند از `main` کنار می‌روند؛ ولی در شاخهٔ `backup-before-bundle` باقی می‌مانند). اگر مطمئن نیستی، از روش اول استفاده کن.

---

## د) روش سوم: استفاده از zip کامل (اگر Git باندل را در دسترس ندارد)

```bash
# ۱. از مخزن محلی خودت نسخهٔ پشتیبان بگیر
git branch backup-before-zip

# ۲. محتوای zip را روی پوشهٔ پروژه استخراج کن (overwrite)
unzip -o makanwholesale-full.zip -d /path/to/makanwholesale

# ۳. تغییرات را stage و کامیت کن
cd /path/to/makanwholesale
git add -A
git commit -m "feat: sync all improvements from audit phases 0-6"
git push origin main
```

> **⚠️ هشدار:** این روش تاریخچهٔ ۱۱ کامیت را به یک کامیت واحد تبدیل می‌کند (squash). اگر اهمیت تاریخچه برایت زیاد است، روش اول یا دوم را انتخاب کن.
>
> **نکتهٔ امنیتی:** قبل از `git add -A` مطمئن شو `.env` و محتویات `db/` و `public/uploads/` در مخزن تو gitignore شده‌اند (در `.gitignore` ارسالی هست؛ ولی اگر فایل‌های حساس محلی دیگری داری، اول اضافه‌شان کن به `.gitignore`).

---

## ه) چک‌لیست راستی‌آزمایی پس از پوش

- [ ] `git push` بدون خطا تمام شد و خروجی پیام fast-forward/merge عادی داد (نه reject).
- [ ] در GitHub، تب **Actions** یک اجرای CI سبز دارد (workflow «CI» روی پوش جدید).
- [ ] badge در بالای `README.md` وضعیت «passing» را نشان می‌دهد (بعد از سبز شدن CI refresh کن).
- [ ] `git log origin/main` هر سه قابلیت بزرگ را نشان می‌دهد:
      `feat(store-order)`، `feat(media)`، `feat(integrations)`.
- [ ] محتوای `scripts/seed.ts` روی GitHub را باز کن و مطمئن شو در upsert کاربران، `passwordHash` فقط داخل `create:` است و `update: {}` خالی است (نباید بازنویسی رمز باشد). مرجع: خطوط ~۳۳۱–۳۳۲.
- [ ] فایل `.github/workflows/ci.yml` روی GitHub موجود است.
- [ ] `next.config.ts` روی GitHub دیگر `ignoreBuildErrors: true` ندارد.
- [ ] در مخزن GitHub فایلی به نام `.env` وجود ندارد و `public/uploads/` فقط `.gitkeep` دارد.

---

## و) برنامهٔ بازگشت اضطراری

اگر بعد از پوش به مشکل خوردی:

```bash
# اگر روش دوم را اجرا کرده بودی — بازگشت به حالت قبل محلی:
git checkout main
git reset --hard backup-before-bundle

# برای بازگرداندن شاخهٔ main روی GitHub به قبل از پوش:
git push origin backup-before-bundle:main --force-with-lease
```

> نکته: اگر روش اول (کلون تازه) را استفاده کرده باشی، مخزن محلی اصلی‌ات دست‌نخورده مانده و فقط کافی است روی GitHub از تب History یک revert/rollback انجام دهی یا با `--force-with-lease` از شاخهٔ پشتیبان بازگردانی کنی.
>
> `--force-with-lease` امن‌تر از `--force` است: اگر همزمان کس دیگری پوش کرده باشد، درخواست رد می‌شود.

---

## پیوست — مقادیر مرجع برای تأیید

| کمیت | مقدار مورد انتظار |
|---|---|
| SHA نوک main | `7b26f3a86180b56e57464eceb8a7bb7ba9631ed7` |
| تعداد کل کامیت‌ها | ۲۵ |
| تعداد کامیت‌های جدید | ۱۱ |
| `git bundle verify` | «The bundle records a complete history.» + ref `refs/heads/main` |
| حجم باندل | ۳٬۵۸۸٬۰۸۱ بایت (کمتر از ۱۰۰ مگابایت ✓) |
