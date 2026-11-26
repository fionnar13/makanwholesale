<div dir="rtl">

# مهاجرت SQLite → PostgreSQL — راهنمای کامل

> این سند روی برنچ `migrate/sqlite-to-postgres` اعمال شده و همه سناریوهای استقرار (لوکال، VPS/Docker، Neon، Supabase)، مهاجرت داده واقعی و برنامه بازگشت (Rollback) را پوشش می‌دهد.

---

## فهرست

1. [چه چیزهایی تغییر کرد](#۱-چه-چیزهایی-تغییر-کرد)
2. [اجرای لوکال با PostgreSQL](#۲-اجرای-لوکال-با-postgresql)
3. [استقرار با Docker روی VPS](#۳-استقرار-با-docker-روی-vps)
4. [استقرار روی Neon / Supabase](#۴-استقرار-روی-neon--supabase)
5. [مهاجرت داده واقعی از SQLite](#۵-مهاجرت-داده-واقعی-از-sqlite)
6. [بکاپ‌گیری و بازگردانی](#۶-بکاپ‌گیری-و-بازگردانی)
7. [برنامه Rollback (بازگشت به SQLite)](#۷-برنامه-rollback-بازگشت-به-sqlite)
8. [سوال‌های پرتکرار و ریسک‌ها](#۸-سوال‌های-پرتکرار-و-ریسک‌ها)

---

## ۱) چه چیزهایی تغییر کرد

| فایل | تغییر |
| --- | --- |
| `prisma/schema.prisma` | `provider = "postgresql"` + افزودن `directUrl = env("DIRECT_URL")` |
| `prisma/migrations/20261124015802_init_postgres/` | مهاجرت اولیه (۳۸ جدول) — مبنا برای `migrate deploy` در پروداکشن |
| `.env.example` | نمونه اتصال برای لوکال/داکر/Neon/Supabase/Railway + توضیح `sslmode=require` |
| `src/lib/inventory.ts` | ۴ کوئری خام از `$executeRawUnsafe` (پلیس‌هولدر `?` سبک SQLite) به `$executeRaw` tagged-template با identifierهای نقل‌قول‌شده تبدیل شد — روی هر دو دیتابیس کار می‌کند |
| `scripts/seed.ts` | ساخت پوشه `db/` پیش از نوشتن فایل رمزها (پس از clone تازه) |
| `scripts/migrate-sqlite-to-postgres.ts` | **جدید** — اسکریپت انتقال داده واقعی با حفظ کامل IDها |
| `package.json` | اسکریپت‌های `db:deploy`، `db:status` و `db:migrate-data` اضافه شد |
| `docker-compose.yml` | سرویس `postgres:16-alpine` با Volume پایدار، Healthcheck و `depends_on` + mount پوشه آپلودها |
| `Dockerfile` | اجرای `prisma migrate deploy` پیش از استارت (به‌جای `db push`) + URLهای placeholder زمان بیلد |

**چیزهایی که تغییر نکرد:** منطق کسب‌وکار، UI، APIها، فایل‌های آپلود، مبالغ (همچنان Integer در ریال)، نقش‌ها و مجوزها.

> **قاعده طلایی:** تا وقتی `migrate dev` برای تغییر اسکیما اجرا می‌کنید، `DATABASE_URL` و `DIRECT_URL` در لوکال یکی هستند. فقط در سرویس‌های Pooling‌دار (Neon/Supabase) این دو فرق می‌کنند.

---

## ۲) اجرای لوکال با PostgreSQL

### پیش‌نیاز
PostgreSQL 14+ نصب‌شده روی سیستم (یا از روش ۳ پایین با Docker فقط برای دیتابیس).

### گام‌ها

```bash
# ۱) دیتابیس و کاربر بسازید (رمز را عوض کنید!)
psql -U postgres -c "CREATE ROLE makan LOGIN PASSWORD 'رمز-قوی' CREATEDB"
psql -U postgres -c "CREATE DATABASE makan OWNER makan"
# CREATEDB لازم است چون prisma migrate dev برای محاسبه diff به Shadow DB نیاز دارد

# ۲) فایل محیطی
cp .env.example .env
#   DATABASE_URL="postgresql://makan:رمز-قوی@localhost:5432/makan?schema=public"
#   DIRECT_URL  همان مقدار بالا

# ۳) نصب و مهاجرت و seed
bun install
bun run db:migrate          # prisma migrate dev — اسکیمای PG ساخته می‌شود
bun run db:seed             # داده اولیه + مدیر سیستم

# ۴) اجرا
bun run dev                 # http://localhost:3000
```

### روش جایگزین: فقط دیتابیس با Docker

```bash
docker run -d --name makan-db -p 5432:5432 \
  -e POSTGRES_USER=makan -e POSTGRES_PASSWORD=رمز-قوي -e POSTGRES_DB=makan \
  -v makan-pgdata:/var/lib/postgresql/data postgres:16-alpine
```

---

## ۳) استقرار با Docker روی VPS

`docker-compose.yml` پروژه یک سرویس کامل PostgreSQL 16 (پورت داخلی، Volume پایدار، Healthcheck) دارد و اپ فقط بعد از Healthy شدن دیتابیس بالا می‌آید.

```bash
# ۱) کد را روی سرور ببرید (git clone یا فایل tar)
git clone https://github.com/fionnar13/makanwholesale.git
cd makanwholesale

# ۲) فایل .env کنار docker-compose.yml بسازید:
cat > .env <<'EOF'
POSTGRES_PASSWORD="یک-رمز-قوی-برای-دیتابیس"
EOF

# ۳) بیلد و اجرا
docker compose up -d --build
docker compose logs -f app      # باید ببینید: X migrations found applying / server running

# ۴) اولین داده (فقط یک بار):
docker compose exec app bun run scripts/seed.ts
#   رمز مدیر در db/.initial-admin-password.txt داخل کانتینر:
docker compose exec app cat db/.initial-admin-password.txt
```

**نکته‌ها:**
- پیش از هر استارت، `prisma migrate deploy` خودکار اجرا می‌شود — آپدیت کد = `git pull && docker compose up -d --build`؛ مهاجرت‌های جدید بدون توقف داده اعمال می‌شوند.
- داده‌های PG در Volume با نام `makanwholesale_pgdata` می‌مانند؛ پوشه آپلود کاربران هم روی میزبان در `./public/uploads` است.
- برای دسترسی psql از میزبان: `docker compose exec db psql -U makan -d makan` (پورت ۵۴۳۳ فقط روی `127.0.0.1` میزبان باز است).

---

## ۴) استقرار روی Neon / Supabase

این پلتفرم‌ها دو نوع اتصال می‌دهند؛ باید درست تفاوت‌شان را رعایت کنید:

| پلتفرم | DATABASE_URL (اتصال عادی — Pooler) | DIRECT_URL (مهاجرت‌ها — مستقیم) |
| --- | --- | --- |
| **Neon** | `postgresql://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/makan?sslmode=require` | `postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/makan?sslmode=require` |
| **Supabase** | `postgresql://postgres.REF:PASS@aws-0-REGION.pooler.supabase.com:6543/postgres?sslmode=require` | `postgresql://postgres.REF:PASS@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require` |

- پورت **Pooler** (Neon: 6542 / Supabase: 6543) فقط برای اتصال عادی برنامه؛ **مهاجرت روی Pooler کار نمی‌کند** و باید از `DIRECT_URL` مستقیم برود.
- `sslmode=require` برای هر دو الزامی است.
- اجرای مهاجرت‌ها (یک بار، یا پس از هر تغییر اسکیما):

```bash
# از سیستم خودتان با رشته‌های مستقیم در .env:
bunx prisma migrate deploy
```

یا در CI/CD همین دستور را با secretهای محیطی اجرا کنید. سپس اپ را Deploy کنید (`DATABASE_URL` با پورت Pooler در تنظیمات پلتفرم).

> Railway/Render: فقط `DATABASE_URL` کافی است (Pooling جدا ندارند)؛ هر دو متغیر را یکی بدهید و `prisma migrate deploy` را در start command (یا یک Release Command) بگذارید.

---

## ۵) مهاجرت داده واقعی از SQLite

اگر از قبل با SQLite داده واقعی داشتید (محصولات، مشتریان، سفارش‌ها، تنظیمات سایت، کاربران)، این اسکریپت همه را **با حفظ کامل IDها** به PostgreSQL می‌برد:

```bash
# ۱) دیتابیس PG باید خالی باشد (تازه ساخته‌شده و فقط migrate شده — بدون Seed!)
bunx prisma migrate deploy        # یا db:migrate روی دیتابیس خالی

# ۲) اول فقط آمار را ببینید (dry-run — چیزی نمی‌نویسد):
bun run db:migrate-data -- --source db/custom.db

# ۳) مهاجرت واقعی:
bun run db:migrate-data -- --source db/custom.db --write

# ۴) فایل‌های آپلودی را هم جابه‌جا کنید (در دیتابیس نیستند):
rsync -a public/uploads/  SERVER:/app/public/uploads/
rsync -a public/products/ SERVER:/app/public/products/
```

**جزئیات فنی:**
- ترتیب درج مطابق وابستگی FK و داخل **یک تراکنش** است — یا همه منتقل می‌شود یا هیچ.
- Boolean‌های SQLite (0/1) و تاریخ‌ها (ms epoch) خودکار تبدیل می‌شوند.
- پس از درج، تعداد همه جدول‌ها با مبدا مقایسه و راستی‌آزمایی می‌شود.
- اگر مقصد خالی نباشد (مثلاً قبلاً Seed شده) اسکریپت با خطا متوقف می‌شود تا IDها تداخل نکنند؛ دیتابیس تازه بسازید یا با آگاهی `--allow-non-empty` بدهید.
- کپی `db/custom.db` پیش از هر تغییری در `db/backups/` نگه داشته شده است.

---

## ۶) بکاپ‌گیری و بازگردانی

**Docker:**
```bash
# بکاپ کامل:
docker compose exec db pg_dump -U makan -d makan > backup-$(date +%F).sql
# بکاپ فقط داده:
docker compose exec db pg_dump -U makan -d makan --data-only > data-$(date +%F).sql

# بازگردانی:
cat backup-2026-01-01.sql | docker compose exec -T db psql -U makan -d makan
```

**Neon/Supabase:** از داشبورد (Point-in-time restore / Backups) استفاده کنید یا با `pg_dump` با رشته DIRECT اتصال بزنید.

**زمان‌بندی روزانه با cron روی VPS:**
```
0 3 * * * cd /opt/makanwholesale && docker compose exec db pg_dump -U makan -d makan | gzip > /var/backups/makan-$(date +\%F).sql.gz
```

---

## ۷) برنامه Rollback (بازگشت به SQLite)

اگر به هر دلیل باید به SQLite برگردید:

### حالت الف — بازگشت کد به قبل از مهاجرت (تمیزترین راه)
```bash
git checkout main            # یا کامیتِ قبل از برنچ migrate/sqlite-to-postgres
# .env را به مقدار SQLite برگردانید:
#   DATABASE_URL="file:/مسیر-مطلق/db/custom.db"
bun install && bunx prisma generate && bun run dev
```
فایل `db/custom.db` و بکاپ آن در `db/backups/` دست‌نخورده باقی است و همه داده قبلی سر جایش است.

### حالت ب — بازگشت داده‌ی جدید PG به SQLite (مهاجرت معکوس)
اگر روی PG داده جدید درست شده و باید به SQLite برگردد:
1. خروجی بگیرید: `docker compose exec db pg_dump -U makan -d makan --data-only > pg-data.sql`
2. با یک اسکریپت معکوس (PG → SQLite؛ همان الگوی `scripts/migrate-sqlite-to-postgres.ts` ولی برعکس) وارد `db/custom.db` کنید — به‌صورت دستی می‌توانید کمک بگیرید (AI) تا همان اسکریپت را برعکس بسازد.
3. در `prisma/schema.prisma` موقتاً: `provider = "sqlite"` و حذف `directUrl`، سپس `bunx prisma db push`.

### نکته مهم
مهاجرت به SQLite معکوسِ خودکارِ بی‌دردسر ندارد (SQLite پورت، کاربر و `sslmode` ندارد)؛ برای همین فایل اصلی و بکاپ‌های SQLite را حداقل تا چند هفته بعد از استقرار PG نگه دارید.

---

## ۸) سوال‌های پرتکرار و ریسک‌ها

**Q: `prisma migrate dev` خطای Shadow DB می‌دهد؟**
کاربر دیتابیس باید مجوز `CREATEDB` داشته باشد: `ALTER ROLE makan CREATEDB`.

**Q: `Error validating datasource: the URL must start with postgresql://`؟**
یعنی هنوز `DATABASE_URL` قدیمیِ `file:...` (SQLite) در محیط/process جاری است. فایل `.env` را چک کنید و اگر متغیر در شل export شده، `unset DATABASE_URL DIRECT_URL` کنید.

**Q: پورت ۵۴۳۳ چیست؟**
در docker-compose، PostgreSQL داخل شبکه داخلی است و فقط برای psql از میزبان روی `127.0.0.1:5433` منتشر شده. اپ از طریق `db:5432` وصل می‌شود.

**Q: دیتابیس‌های SQLite و PG می‌توانند هم‌زمان فعال باشند؟**
بله — هر کدام `.env` خودش را دارند. کافی است `DATABASE_URL` را عوض و سرویس را ری‌استارت کنید.

**ریسک‌های باقی‌مانده:**
- اولین اجرای `prisma migrate dev` روی دیتابیس واقعی خالی است و داده‌ای حذف نمی‌کند؛ اما در آینده هر تغییر اسکیما را اول در محیط dev تست کنید.
- در SQLite متن‌ها case-insensitive برای ASCII نبودند و در PG هم پیش‌فرض حساس به حروف است؛ اگر جستجوی فارسی/انگلیسی نتیجه متفاوت داد، می‌توانید در کوئری‌ها از `mode: 'insensitive'` استفاده کنید (اکنون روی PG در دسترس است).
- پوشه `public/uploads` در VPS باید روی volume بماند و برای Neon/Supabase (سرورلس) بهتر است بعداً به S3-compatible منتقل شود (فعلاً روی VPS/Docker مشکلی نیست).
- `log: ['query']` در `src/lib/db.ts` روی پروداکشن لاگ زیادی می‌دهد (رفتار قبلی — خارج از دامنه این مهاجرت).

</div>
