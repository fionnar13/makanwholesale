# فاز ۲ — سامانه فاکتور (Invoice) | سند تحلیل و طراحی (فاز ۰)

> شاخهٔ کاری: `feat/invoice-system` (از `main@d9a74bd`)
> وضعیت: **تحلیل و طراحی — بدون کد.** پیاده‌سازی پس از تأیید شما شروع می‌شود.
> یک مقدمهٔ حیاتی هم دارد: **ریکاوری فاز ۱** (بخش R) چون CI فعلی main قرمز است — جزئیات در بخش ۰.

---

## ۰. پیش‌نیاز فوری: ریکاوری فاز ۱ (بخش R) — نیازمند تأیید شما

پس از merge، CI روی main قرمز است. بازتولید محلی همان tree علت را دقیق مشخص کرد — **دو لایهٔ مستقل**:

### لایهٔ ۱ — خطای syntax در `.github/workflows/ci.yml` (کامیت `22ea13b`)
بلوک اضافه‌شدهٔ `Generate Prisma Client` تورفتگی نادرست دارد (`- name:` با ۸ فاصله به‌جای ۶):
```yaml
      - name: Prepare test database
        run: npx prisma db push --skip-generate

        - name: Generate Prisma Client     ← تورفتگی اشتباه
        run: npx prisma generate           ← تورفتگی اشتباه

      - name: Integration tests
```
نتیجه: **فایل workflow اصلاً parse نمی‌شود** → runهای آخر (`22ea13b` و merge `d9a74bd`) بدون اجرای حتی یک مرحله قرمز شده‌اند.
ایدهٔ اضافه‌کردن `prisma generate` قبل از integration درست است — فقط جایگذاری باید اصلاح شود.

### لایهٔ ۲ — revert ناخواستهٔ بخشی از فاز ۱ در کامیت‌های rewrite (`f0b8827..22ea13b`)
مقایسهٔ tree فعلی با آخرین tree سبز (`4eb1f3b`، در tag محلی `backup/phase1-local-4eb1f3b` محفوظ است) نشان داد این فایل‌ها ناخواسته عقب برگشته یا حذف شده‌اند:

| فایل | وضعیت فعلی | اثر |
|---|---|---|
| `src/lib/orders.ts` | نسخهٔ **قبل از بخش B** برگشته: `markPaid` فقط از `CONFIRMED/CREDIT_APPROVED` (ازهای `DELIVERED` و تسویهٔ مأموریت در markPaid حذف)، `complete` فقط از `DELIVERED` (نه `PAID`) | **۲ تست integration قرمز** (بازتولید محلی: ۱۹/۲۱ سبز، فقط دو تست «markPaid → مأموریت PAID» و «گزارش تسویه» fail) |
| `scripts/seed.ts` | سه مجوز `deliveries.view.own/complete/return` حذف و DRIVER به نسخهٔ قدیمی برگشته | نصب تازه اپ راننده را از دست می‌دهد |
| `prisma/migrations/20261127013054_add_delivery_assignments/` و `20261127013500_add_driver_permissions/` | **دو فایل SQL migration حذف شده** (مدل‌ها هنوز در schema هستند) | `prisma migrate deploy` روی نصب‌های موجود/پروداکشن شکست می‌خورد یا جدول نمی‌سازد — حیاتی |
| `tests/integration/deliveries-flow.test.mts` | حذف (۳۱۵ خط، ~۸ سناریو) | پوشش تست کم می‌شود |
| `tests/unit/delivery-shared.test.mts` | حذف (۴۱ خط، ۵ تست) | unit از ۳۸ به ۳۳ افتاده |

### اقدام پیشنهادی بخش R (فقط پس از تأیید شما)
یک commit واحد `fix(phase1): بازیابی کامل فاز ۱ + اصلاح syntax مربوط به CI` روی `feat/invoice-system`:
1. بازیابی دقیق ۶ فایل از tag `backup/phase1-local-4eb1f3b`: `orders.ts`، `seed.ts`، دو migration، دو فایل تست.
2. بازنویسی `ci.yml`: همان نسخهٔ سبز + بلوک `Generate Prisma Client` شما با تورفتگی صحیح (۶/۸ فاصله).
3. تأیید محلی: tsc/lint/unit ۳۸ + integration ۲۹ سبز → push → تأیید CI سبز روی main بعد از merge بعدی.

اگر در کامیت‌های خودتان تغییر عمدی دیگری هم بوده که باید حفظ شود، قبل از اجرای R بگویید تا در بازیابی لحاظ کنم.

---

## ۱. تحلیل وضعیت فعلی (چیزی که الان در کد هست)

### ۱.۱ مدل `Invoice` (مصوبهٔ A — نگه‌داشتن)
```prisma
model Invoice {
  id         String    @id @default(cuid())
  invoiceNo  String    @unique
  orderId    String?   @unique      // یک‌به‌یک با سفارش
  customerId String
  totalRls   Int
  status     String    @default("ISSUED") // ISSUED | PAID | CANCELLED
  issuedAt   DateTime  @default(now())
  note       String?
  order      Order?    @relation(...)
  @@index([customerId])
}
```
- `orderId @unique` ⇒ هر سفارش حداکثر یک فاکتور — تضمین ساختاری.
- سه نقطهٔ ساخت فاکتور در کد: `deliver` در `src/lib/orders.ts` (خروج فیزیکی انبار)، `applyDeliveryEffects` در `src/lib/delivery-effects.ts` (تحویل راننده فاز ۱) و `markPaid` (تسویهٔ در محل فاز ۱) — همه با `nextNumber(tx, 'INV')` ⇒ شمارهٔ **روزانهٔ** فعلی `INV-YYYYMMDD-NNNN`.

### ۱.۲ شماره‌گذاری (`src/lib/numbering.ts`)
- فقط `nextNumber(tx, prefix)` روزانه وجود دارد؛ الگوی شمارنده: ردیف در جدول `Setting` با **UPSERT اتمیک** (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) ⇒ مصون از شمارهٔ تکراری در تراکنش هم‌زمان.
- **`nextMonthlyNumber` وجود ندارد** — باید با همان الگوی اتمیک اضافه شود: کلید `seq:MK:YYYYMM`، خروجی `MK-YYMM-0001`.

### ۱.۳ تلگرام (`src/lib/integrations/telegram.ts`)
- `telegramSendDocument(file: {name, body: Buffer, mimeType?}, caption?)` موجود و آزموده (برای بکاپ‌ها).
- **محدودیت:** مقصد از پیکربندی پنل (`getConfig('telegram').chatId`) می‌آید — فقط یک مقصد ثابت (گروه/کانال داخلی). برای ارسال فاکتور به **مشتری** باید `chatId` قابل override باشد ⇒ گسترش additive با پارامتر اختیاری.
- ارسال از طریق `proxyFetch` — پشتیبانی پروکسی (مهم برای ایران) رایگان می‌آید.
- ثبت رویداد خطا در `IntegrationLog` موجود است.

### ۱.۴ سفارش‌ها و UI
- `OrdersView` پنل جزئیات سفارش دارد (دکمه‌های اقدام در یک ردیف) — جای طبیعی «مشاهده فاکتور» + «تاریخچهٔ ارسال».
- `OrderItem` کاملاً snapshot است (`unitName`، `unitPriceRls`، `lineDiscountRls`، `lineTotalRls`) ⇒ فاکتور بدون محاسبهٔ مجدد قیمت رندر می‌شود؛ `Order.discountTotalRls` هم موجود است.
- **مالیات/VAT در سیستم موجود نیست** ⇒ فاکتور MVP همان مبالغ سفارش را نشان می‌دهد؛ منطق مالیات جدید اضافه نمی‌شود (در بخش ۶ پیشنهاد برای آینده).
- ساختار app تک‌صفحه‌ای است (`src/app/page.tsx`)؛ مسیر جدید `/orders/[id]/invoice` یک صفحهٔ مستقل additive می‌شود (`src/app/orders/[id]/invoice/page.tsx`) — تداخلی با SPA ندارد.

### ۱.۵ زیرساخت PDF و فونت
- **هیچ وابستگی PDF در پروژه نیست؛ هیچ فایل فونت هم track نشده.** هر دو باید اضافه شوند.
- پیشنهاد فونت: **Vazirmatn** (اجازهٔ SIL OFL — استفاده/توزیع آزاد، مناسب ریپوی عمومی) — فایل‌های Regular و Bold (~۱MB مجموع) در `public/fonts/` (برای صفحهٔ چاپی وب) و همان فایل‌ها برای embed در PDF.

---

## ۲. Gap Analysis — چه هست، چه نیست

| قابلیت | وضعیت | اقدام |
|---|---|---|
| مدل Invoice با `orderId` یکتا | ✅ هست | دست نمی‌خوریم (مصوبهٔ A) |
| شماره‌گذاری ماهانه `MK-YYMM-0001` | ❌ نیست | `nextMonthlyNumber(tx,'MK')` به numbering.ts (الگوی اتمیک موجود) |
| اتصال مسیرهای فعلی صدور فاکتور به شمارهٔ ماهانه | ❌ `INV` روزانه | دو نقطهٔ صدور به `nextMonthlyNumber` تغییر می‌کنند (فقط prefix — additive از نظر رفتار) |
| صفحهٔ فاکتور قابل چاپ | ❌ نیست | `/orders/[id]/invoice` + `@media print` |
| تولید PDF سروری با فونت فارسی | ❌ نیست | موتور PDF + فونت Vazirmatn + اسپایک bidi (بخش ۷) |
| ارسال فایل به تلگرام | ◑ نیمه | `telegramSendDocument` هست؛ پارامتر `chatId` override اضافه می‌شود |
| ثبت تاریخچهٔ ارسال | ❌ نیست | مدل `InvoiceDeliveryLog` + migration additive |
| دکمهٔ «مشاهده فاکتور» و پنل تاریخچه | ❌ نیست | OrdersView |
| API فاکتور (داده/PDF/ارسال) | ❌ نیست | سه endpoint جدید (بخش ۴) |
| RBAC فاکتور | ◑ | مشاهده = گارد دسترسی سفارش موجود؛ ارسال = `finance.receipts` |
| Rubika / Gmail | ❌ (طبق MVP: فاز بعد) | فقط channel رزرو می‌شود در enum و معماری adapter |

---

## ۳. طرح مدل داده (مصوبهٔ A: مدل Invoice دست‌نخورده)

### ۳.۱ مدل جدید `InvoiceDeliveryLog`
```prisma
model InvoiceDeliveryLog {
  id        String   @id @default(cuid())
  invoiceId String
  channel   String   // TELEGRAM | PRINT | PDF | (رزرو: RUBIKA | GMAIL)
  status    String   // SENT | FAILED
  error     String?  // متن خطا در صورت FAILED
  chatId    String?  // مقصد تلگرام (وقتی مرتبط)
  sentById  String?  // کاربر ارسال‌کننده
  createdAt DateTime @default(now())
  invoice   Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  @@index([invoiceId, createdAt])
}
```
- در `Invoice` فقط یک relation معکوس `logs InvoiceDeliveryLog[]` اضافه می‌شود.
- **Migration واحد additive**: ساخت جدول + ایندکس — هیچ ستون موجودی تغییر نمی‌کند، ریسک صفر.
- `VIEWED` به‌صورت رویداد لاگ نمی‌شود (MVP)؛ فقط SENT/FAILED.

### ۳.۲ شماره‌گذاری ماهانه — `nextMonthlyNumber(tx, 'MK')`
```ts
// در src/lib/numbering.ts — همان الگوی UPSERT اتمیک موجود
// key: seq:MK:YYYYMM  →  خروجی: MK-YYMM-0001
```
- YYMM بر اساس تاریخ صدور (ماه میلادی؛ در صفحهٔ فاکتور تاریخ شمسی جدا نمایش داده می‌شود).
- تغییر دو نقطهٔ صدور فعلی به `nextMonthlyNumber(tx,'MK')`: فاکتورهای جدید از این پس MK هستند؛ فاکتورهای قدیمی `INV-…` دست‌نخورده می‌مانند. `invoiceNo @unique` بدون تغییر.
- نکتهٔ هم‌زمانی: دو تراکنش هم‌زمان روی ردیف شمارندهٔ ماه قفل می‌شوند — دقیقاً همان گارانتی‌ای که الگوی موجود برای سفارش‌ها می‌دهد.

### ۳.۳ صدور روی تقاضا (lazy issuance) — `ensureInvoice(tx, orderId)`
سفارش‌های قدیمی یا مسیرهایی که فاکتور نگرفته‌اند (مثلاً سفارش فروشگاهی قبل از فاز ۱): با اولین مشاهده/PDF/ارسال، در تراکنش اگر فاکتور نبود با شمارهٔ MK جدید ساخته می‌شود — idempotent به لطف `orderId @unique` + claim اتمیک. هیچ سرصفحهٔ «صدور دستی» لازم نیست.

---

## ۴. طرح API

همهٔ مسیرها زیر `/api/orders/[id]/invoice` با **همان گارد دسترسی سفارش موجود** در `/api/orders/[id]` (کارمند با `orders.view`؛ VISITOR/ONLINE_USER فقط سفارش مرتبط به خودشان).

| مسیر | متد | خروجی | توضیح |
|---|---|---|---|
| `/api/orders/[id]/invoice` | GET | JSON: `{ invoice, order{…items,customer,branch}, logs[] }` | `ensureInvoice` داخلش؛ `logs` هم همین‌جا برمی‌گردد (endpoint کمتر) |
| `/api/orders/[id]/invoice.pdf` | GET | `application/pdf` (باینری) | تولید با موتور PDF + فونت؛ همان دادهٔ GET؛ نام فایل `MK-YYMM-NNNN.pdf` |
| `/api/orders/[id]/invoice/send` | POST | `{ ok, logId }` | بدنه: `{ channel:'TELEGRAM', chatId }`؛ تولید PDF → `telegramSendDocument(chatId override)` → ثبت `InvoiceDeliveryLog`؛ **مجوز اضافه: `finance.receipts`** (ارسال به بیرون = کار مالی) |

- قواعد خطا: الگوی موجود `ApiError(400, 'CODE', 'پیام فارسی')` — مثلاً بدون توکن بات → `TELEGRAM_NOT_CONFIGURED`، chatId خالی → `VALIDATION`.
- AuditLog برای `invoice.send` ثبت می‌شود (الگوی موجود).
- PDF هرگز کش نمی‌شود (`Cache-Control: no-store`) — چون هر باز شدن ممکن است فاکتور تازه صادر کند.

---

## ۵. طرح UI

### ۵.۱ صفحهٔ فاکتور `/orders/[id]/invoice`
- صفحهٔ مستقل RTL با فونت Vazirmatn؛ client component که با `apiFetch` دادهٔ GET را می‌گیرد (RBAC از همان endpoint).
- چیدمان فاکتور فروش ایرانی: سربرگ (نام فروشگاه/لوگو از site-settings موجود) — شمارهٔ فاکتور `MK-YYMM-NNNN` — تاریخ شمسی صدور (JDate موجود) — اطلاعات مشتری و شعبه — جدول اقلام (شرح/واحد/تعداد/فی/تخفیف/جمع) — `discountTotalRls` و `totalRls` — وضعیت پرداخت (PAID/ISSUED) — یادداشت — محل مهر و امضا.
- ارقام فارسی با `formatFaNumber` موجود؛ تاریخ شمسی با `JDate` موجود.
- **چاپ:** دکمهٔ «چاپ» + CSS `@media print` (حذف هدر/دکمه‌ها، `size: A4`، رنگ‌های print-safe)؛ `window.print()`.
- حالت‌های خطا: ۴۰۳ → «دسترسی ندارید»، ۴۰۴ → «سفارش یافت نشد» — الگوی `ErrorState` موجود.

### ۵.۲ OrdersView
- در پنل جزئیات سفارش، ردیف اقدام جدید: **«مشاهدهٔ فاکتور»** (لینک به `/orders/[id]/invoice` در tab جدید — برای نقش‌های دارای دسترسی سفارش).
- **بخش «تاریخچهٔ ارسال فاکتور»** در انتهای پنل: فهرست `logs` (کانال با آیکن، وضعیت، زمان شمسی، ارسال‌کننده) + دکمهٔ **«ارسال به تلگرام»** → دیالوگ با ورودی Chat ID (راهنمای کوتاه: «مشتری باید ابتدا به بات پیام داده باشد؛ Chat ID عددی از @userinfobot») → پس از ارسال، toast نتیجه + تازه‌سازی تاریخچه.
- دکمهٔ ارسال فقط برای کاربران دارای `finance.receipts` نمایش داده می‌شود (الگوی permission-check موجود در پنل).

### ۵.۳ زبان طراحی
دقیقاً همان کامپوننت‌های `kit` (PageHeader/Field/Money/JDate/EmptyState/ErrorState + shadcn Dialog/Button) — هیچ کتابخانهٔ UI جدیدی وارد نمی‌شود.

---

## ۶. پیشنهادهای اختیاری (خارج از MVP — فقط برای تصمیم‌گیری شما)

1. **ذخیرهٔ Chat ID تلگرام مشتری روی `Customer.telegramChatId`** — ارسال بعدی بدون تایپ دستی. یک ستون nullable additive؛ ارزان و مفید. (پیشنهاد: داخل همین فاز به‌عنوان فیلد اختیاری دیالوگ ارسال «به‌خاطر سپردن».)
2. **رویداد تلگرام جدید `INVOICE_SENT`** با قالب پیام در پنل یکپارچه‌سازی — هماهنگ با `TELEGRAM_EVENTS` موجود.
3. **شمارهٔ فاکتور در جستجو/فیلتر OrdersView** — چون invoiceNo دیگر MK-YYMM است، جستجوی «MK-2602-0007» مستقیم سفارش را می‌آورد.
4. **صورتحساب تجمیعی ماهانه** برای مشتری‌های اعتباری (خروجی PDF از مجموع فاکتورهای ماه) — کاندیدای فاز ۳.
5. **استورنو (credit note)** برای مرجوعی‌های پس از صدور فاکتور — مدل و جریان جدا دارد؛ حداقل در این فاز فیلد `note` روی مرجوعیِ فاکتوردار، ارجاع شمارهٔ فاکتور را درج کند.
6. **مالیات بر ارزش افزوده** به‌صورت فیلد پیکربندی (نرخ پیش‌فرض ۰ تا تصمیم تجاری) — الان سیستم VAT ندارد و MVP به آن دست نمی‌زند.
7. Rubika و Gmail: از همین حالا `channel` enum رزرو می‌شود و ارسال در آینده فقط یک adapter جدید است — طبق MVP فاز ۲ پیاده‌سازی نمی‌شوند.

---

## ۷. ریسک‌ها و تصمیم‌های باز

### ریسک اصلی: متن فارسی در PDF (bidi + glyph joining)
- **گزینهٔ ۱ (پیشنهاد اولیه): `@react-pdf/renderer`** — کامپوننت‌محور (مثل React)، خروجی Buffer سمت سرور، جدول/استایل راحت، رجیستر فونت TTF ساده. موتور متنش bidi و shaping را انجام می‌دهد، اما کیفیت رندر فارسی باید با اسپایک تأیید شود.
- **گزینهٔ ۲: `pdfkit`** — پایین‌تر‌سطح؛ shaping با fontkit انجام می‌شود ولی ترتیب bidi را باید با `bidi-js` دستی اصلاح کرد؛ کنترل بیشتر، کد بیشتر.
- **اسپایک (اولین کار بخش D):** رندر نمونهٔ فارسی واقعی — جملهٔ ترکیبی (فارسی + عدد + لاتین + نیم‌فاصلهٔ «می‌شود») با هر دو گزینه، بازبینی بصری، انتخاب نهایی؛ هزینهٔ اسپایک ≈ ۱ ساعت و قبل از commit شدن مسیر اصلی انجام می‌شود تا اگر گزینهٔ ۱ در فارسی لَنگ زد، بی‌هزینه سوئیچ کنیم.
- فونت‌ها: Vazirmatn Regular + Bold (OFL) — فایل‌ها کامیت می‌شوند تا build از CDN وابسته نباشد.

### ریسک‌های کوچک
- حجم فونت (~1MB) در ریپو — قابل قبول؛ بعداً می‌شود subset گرفت.
- `sendDocument` محدودیت ۵۰MB دارد — PDF فاکتور کیلوبایتی است، بی‌اثر.
- ارسال به chatId اشتباه → خطای تلگرام در log ثبت می‌شود؛ پیام واضح به کاربر.
- صفحهٔ چاپی خارج از SPA است → باید در `middleware`/گارد صفحه، نشست چک شود (الگوی API).

---

## ۸. برنامهٔ اجرایی دقیق (پس از تأیید فاز ۰)

هر بخش = یک commit جدا + گیت‌های کیفیت سبز (tsc/lint/unit/integration) — همان ریتم فاز ۱.

| بخش | محتوا | فایل‌های اصلی | تخمین |
|---|---|---|---|
| **R** | ریکاوری فاز ۱ + اصلاح ci.yml (بخش ۰) — **فوری، مستقل از بقیه** | ۶ فایل بازیابی + ci.yml | ۰٫۵ ساعت + چرخهٔ CI |
| **A** | مدل `InvoiceDeliveryLog` + migration additive + `nextMonthlyNumber` + تغییر دو نقطهٔ صدور به MK | schema، migration جدید، numbering.ts، delivery-effects.ts، orders.ts | ۱٫۵ ساعت |
| **B** | سرویس فاکتور مشترک: `ensureInvoice`، `buildInvoiceView`، RBAC — و سه endpoint API | `src/lib/invoice.ts` + `src/app/api/orders/[id]/invoice/**` | ۲ ساعت |
| **C** | صفحهٔ چاپی `/orders/[id]/invoice` + فونت وب Vazirmatn + `@media print` | page.tsx جدید + `public/fonts/*` | ۲٫۵ ساعت |
| **D** | اسپایک PDF (فارسی) → انتخاب موتور → تولید PDF سروری | `src/lib/invoice-pdf.ts` | ۲٫۵ ساعت |
| **E** | ارسال تلگرام (chatId override) + ثبت log + دکمهٔ OrdersView + پنل تاریخچهٔ ارسال | telegram.ts، OrdersView.tsx | ۲ ساعت |
| **F** | تست‌ها: شماره‌گذاری ماهانه (اتمیک/مرز ماه)، ensureInvoice idempotent، PDF (بایت‌ساز و نام فایل)، ارسال+لاگ+خطاها، RBAC | unit + integration جدید | ۲٫۵ ساعت |
| **G** | مستندات (`docs/invoice.md`)، به‌روزرسانی STATUS، بازبینی نهایی، باندل | docs | ۱ ساعت |

**جمع تقریبی: ~۱۴ ساعت کاری متمرکز** (معادل ۶–۷ session کاری با ریتم فاز ۱) + دو چرخهٔ CI (بعد از R و در پایان).

### ترتیب وابستگی‌ها
```
R (ریکاروی فاز ۱) ──▶ A (مدل+شماره‌گذاری) ──▶ B (سرویس+API) ──▶ C (صفحه چاپی)
                                        └──────▶ D (PDF) ──▶ E (ارسال+UI پنل) ──▶ F (تست‌ها) ──▶ G
```
- R را می‌توان همین حالا به‌صورت مستقل اجرا کرد و CI را سبز کرد، حتی اگر باقی فاز ۲ منتظر بحث شما بماند.
- C و D موازی‌پذیرند (هر دو فقط به B وابسته‌اند).

### تعریف «تمام‌شده» (Definition of Done) فاز ۲
- CI سبز روی `feat/**` و merge بعدی روی main سبز.
- فاکتور یک سفارش واقعی: مشاهده در مرورگر، چاپ بدون عناصر اضافه، PDF با فارسی بی‌نقص، ارسال تلگرام موفق و ثبت در تاریخچه — همه با تست integration پشتیبان.
- هیچ migration breaking؛ فاکتورهای قدیمی `INV-` سالم و نمایش‌پذیر می‌مانند.
