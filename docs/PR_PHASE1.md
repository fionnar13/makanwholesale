# PR: فاز ۱ — سامانه پخش (Delivery Partners): اپ راننده، داشبورد مدیر پخش و جریان تحویل/تسویه/مرجوعی

> **شاخه:** `feat/delivery-partners-invoice` ← `main`
> **CI:** سبز روی همین شاخه (run [#46046865426](https://github.com/fionnar13/makanwholesale/actions/runs/46046865426) — push روی `feat/**`، همهٔ ۱۴ مرحله موفق)
> **دامنه:** ۲۰ فایل، ‎+3665‎/‎−110‎ خط — بدون تغییر breaking در مدل داده و APIهای موجود

---

## ۱. خلاصه قابلیت‌ها

این PR پیاده‌سازی کامل **فاز ۱ (سامانه پخش)** است: چرخهٔ کامل «تخصیص مأموریت → شروع مسیر → تحویل و دریافت وجه → مرجوعی → تسویه مالی»، با دو تجربهٔ کاربری جدید و سه endpoint جدید، به‌شکل کاملاً additive روی معماری فعلی.

### اپ راننده (DriverApp)
- نمای موبایل‌محور RTL فقط برای کاربران دارای `deliveries.view.own`؛ کاربر بدون دسترسی داشبورد مستقیماً وارد همین اپ می‌شود.
- دو تب: **«مأموریت‌های من»** (PENDING/IN_PROGRESS) و **«تاریخچه»** (DELIVERED/PAID/RETURNED/…).
- **دیالوگ «ثبت تحویل و دریافت وجه»**: ثبت تحویل سفارش، انتخاب روش پرداخت (CASH / CARD_TO_CARD / POS / CREDIT / OTHER)، شمارهٔ مرجع برای کارت‌به‌کارت/POS، ثبت خودکار Receipt و فاکتور `ISSUED` و ردیف دفتر — همه در یک تراکنش اتمیک.
- **پیش‌فرض هوشمند پرداخت:** سفارش تسویه‌شده → دیالوگ اصلاً فرم پرداخت نمی‌گیرد؛ سفارش اعتباری (CREDIT) → پیش‌فرض CREDIT؛ بقیه → پیش‌فرض CASH.
- **مرجوعی با ۵ دلیل کدگذاری‌شده:** `CUSTOMER_REFUSED | WRONG_ITEM | DAMAGED | NOT_PAID | OTHER` (برگشت FEFO به انبار مبدا).
- **دستیابی به قدرت شبکهٔ ضعیف:** کلید idempotency (`crypto.randomUUID`) با هر باز شدن دیالوگ؛ ارسال دوبارهٔ همان درخواست هیچ اثر مالی تکراری نمی‌سازد؛ دکمه پس از موفقیت قفل می‌شود.
- **نگاشت خطای تسویهٔ هم‌زمان:** پاسخ `PAYMENT_ALREADY_SETTLED` از API به پیام شفاف «این سفارش پیش‌تر تسویه شده است — نیازی به دریافت وجه نیست» تبدیل می‌شود.
- گارد آفلاین با `navigator.onLine`، دکمهٔ تماس مستقیم با مشتری، و **خلاصهٔ هفتگی** (از شنبه — آغاز هفتهٔ ایرانی) شامل تعداد تحویل/مرجوعی و مبلغ وصولی.

### داشبورد مدیر پخش (DeliveriesView)
- نمای فقط-خواندن مأموریت‌ها برای `deliveries.manage` (DISPATCHER/ADMIN).
- **۵ کارت خلاصه:** تعداد PENDING، تعداد IN_PROGRESS، تعداد PAIDِ بازه، تعداد مرجوعیِ بازه، تعداد «تحویل‌شدهٔ تسویه‌نشدهٔ اعتباری».
- **فیلتر سه‌گانه:** راننده (لیست از `/api/users?role=DRIVER`)، وضعیت (۷ حالت)، دورهٔ زمانی (امروز / هفتهٔ جاری از شنبه / ماه جاری / بازهٔ دلخواه) با انتخاب فیلد تاریخ (`assignedAt` یا `completedAt`).
- **گزارش «تحویل‌شده بدون تسویه»** (اصلاحیهٔ ۲ فاز ۰): فهرست مأموریت‌های `DELIVERED` با سفارش CREDIT — ستون‌های مشتری/مبلغ/تاریخ تحویل/راننده/روزهای گذشته — مرتب از قدیمی‌ترین؛ هر ردیف دکمهٔ **«ثبت پرداخت»** که همان جریان محافظت‌شدهٔ `markPaid` را صدا می‌زند.
- تخصیص مأموریت فقط برای سفارش‌های `READY_FOR_DISPATCH` یا `DISPATCHED` به راننده‌های فعال؛ **لغو مأموریت** و **تخصیص مجدد** مأموریت لغوشده به رانندهٔ دیگر.

### APIهای جدید
| مسیر | متد | توضیح | دسترسی |
|---|---|---|---|
| `/api/deliveries` | GET | فهرست مأموریت‌ها؛ `driverId`، `status`، `from/to` (ISO)، `dateField=assignedAt|completedAt`، `take` (۱..۵۰۰)؛ بازهٔ معکوس → ۴۰۰ | `deliveries.view.own` (فقط خودش) یا `deliveries.manage` |
| `/api/deliveries` | POST | تخصیص مأموریت به راننده (سفارش باید READY_FOR_DISPATCH/DISPATCHED باشد؛ یک مأموریت فعالِ تکراری → ۴۰۹) | `deliveries.manage` |
| `/api/deliveries/[id]` | GET | جزئیات یک مأموریت (راننده فقط مأموریت خودش) | `deliveries.view.own` / `deliveries.manage` |
| `/api/deliveries/[id]` | POST | اقدام‌ها: `start` / `complete` / `return` / `cancel` + کلید اختیاری `idempotencyKey` (≤۶۴ کاراکتر) که در AuditLog ثبت می‌شود | `deliveries.complete` / `deliveries.return` / `deliveries.manage` (لغو) |
| `/api/deliveries/summary` | GET | شمارش‌های کارت‌های خلاصه؛ `from/to/driverId`؛ بازهٔ معکوس → ۴۰۰ | `deliveries.manage` |

لایهٔ اشتراکی (`src/lib/deliveries.ts` و `src/lib/delivery-shared.ts`): `createAssignment`، `startAssignment`، `completeDelivery`، `recordDeliveryReturn`، `cancelAssignment`، `listMyAssignments`، `listAllAssignments`، `getAssignmentForUser`، ثابت‌ها و برچسب‌های فارسی وضعیت‌ها/روش‌های پرداخت/دلایل مرجوعی و محاسبهٔ بازهٔ دوره‌ها با هفتهٔ شنبه‌شروع.

---

## ۲. تغییرات مدل داده

### مدل جدید: `DeliveryAssignment`
```prisma
model DeliveryAssignment {
  id               String    @id @default(cuid())
  orderId          String
  deliveryUserId   String    // راننده/پخش‌کن
  assignedById     String    // مدیر/مسئول ارسالِ تخصیص‌دهنده
  status           String    @default("PENDING") // PENDING | IN_PROGRESS | DELIVERED | PAID | RETURNED | PARTIAL_RETURNED | CANCELLED
  paymentMethod    String?   // CASH | CARD_TO_CARD | POS | CREDIT | OTHER
  paymentReference String?   // شمارهٔ مرجع کارت‌به‌کارت/POS
  failureReason    String?   // کد دلیل مرجوعی یا یادداشت لغو
  notes            String?
  assignedAt       DateTime  @default(now())
  startedAt        DateTime?
  completedAt      DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  // روابط + ایندکس‌ها
}
```
- ایندکس‌ها: `(deliveryUserId, status)` برای فهرست راننده، `(orderId)` برای یافتن مأموریت سفارش، `(status, assignedAt)` برای داشبورد و گزارش‌ها.
- `onDelete: Cascade` روی سفارش — حذف سفارش مأموریت‌های یتیم نمی‌گذارد.

### تغییر مدل موجود: `OrderStatusEvent.actorRole`
- فیلد اختیاری `String?` با مقادیر `WAREHOUSE | DELIVERY | SYSTEM`.
- **additive و backward-compatible:** رویدادهای قدیمی `null` می‌مانند و در نمایش به‌صورت SYSTEM تفسیر می‌شوند؛ هیچ داده‌ای migrate نمی‌شود.

### اصلاحات وضعیت سفارش (`TRANSITIONS`)
- `complete` اکنون از `DELIVERED` **و** `PAID` قابل انجام است.
- تسویهٔ مأموریت پخش در مسیر `markPaid` سیم‌کشی شد (مأموریت `DELIVERED` با سفارش پرداخت‌شده → `PAID`).

---

## ۳. مجوزهای جدید

| مجوز | توضیح | نقش دارنده |
|---|---|---|
| `deliveries.view.own` | مشاهده مأموریت‌های پخش خود | DRIVER |
| `deliveries.complete` | ثبت تحویل و دریافت وجه در مسیر پخش | DRIVER |
| `deliveries.return` | ثبت مرجوعی در مسیر پخش | DRIVER |

- `deliveries.manage` از قبل برای DISPATCHER (و ADMIN) وجود داشت و در این فاز پشت داشبورد مدیر و endpointهای مدیریتی نشست.
- تغییرات در `scripts/seed.ts` اعمال شده؛ migration دوم این سه مجوز را برای نصب‌های موجود INSERT می‌کند (idempotent).
- نقش DRIVER از «فقط سفارش/پیام» به «اپ کامل پخش» ارتقا یافت.

---

## ۴. جریان‌های اصلی

### جریان موفق (تحویل + پرداخت در محل)
```
READY_FOR_DISPATCH ──(مدیر: تخصیص)──▶ PENDING ──(راننده: شروع)──▶ IN_PROGRESS
  ──(راننده: ثبت تحویل + دریافت وجه CASH/POS/…)──▶ DELIVERED
  ──(اثرات در همان تراکنش: FEFO از انبار، Invoice=ISSUED، Ledger، Receipt، رویداد وضعیت actorRole=DELIVERY)──▶
  سفارش PAID/CREDIT_APPROVED مسیر خودش ──▶ مأموریت PAID
```
- برای سفارش پرداخت‌شدهٔ قبل از تحویل (POS آنلاین و…): تحویل راننده فقط `DELIVERED` ثبت می‌کند و مأموریت با `markPaid` سفارش تسویه می‌شود — بدون Receipt تکراری.

### جریان مرجوعی
- راننده با یکی از ۵ دلیل ثبت می‌کند → `RETURNED` (یا `PARTIAL_RETURNED`)، کالا با **FEFO معکوس** به انبار برمی‌گردد و رویداد وضعیت با `actorRole=DELIVERY` ثبت می‌شود.

### جریان اعتباری (CREDIT)
- سفارش CREDIT: تحویل بدون دریافت وجه؛ ردیف در گزارش «تحویل‌شده بدون تسویه» می‌ماند تا مدیر دکمهٔ **«ثبت پرداخت»** را بزند → `markPaid` محافظت‌شده → مأموریت `PAID`.

### جریان لغو و تخصیص مجدد
- مأموریت PENDING/IN_PROGRESS قابل لغو است (دلیل در `failureReason`) → سفارش به `READY_FOR_DISPATCH` برمی‌گردد → تخصیص مجدد به رانندهٔ دیگر.

### محافظت‌های هم‌زمانی (Concurrency)
- **claim اتمیک:** هر اقدام با `updateMany` مشروط به وضعیت فعلی انجام می‌شود؛ دو درخواست هم‌زمان فقط یکی اثر می‌گذارد و دومی ۴۰۹/۴۰۰ می‌گیرد.
- **idempotency دو لایه:** در API با کلید ذخیره‌شده در AuditLog و در UI با کلید تازه به‌ازای هر باز شدن دیالوگ.
- **`PAYMENT_ALREADY_SETTLED` (400):** اگر بین باز شدن دیالوگ و ثبت، سفارش در مسیر دیگری تسویه شود، اثر مالی دوم رد می‌شود.

---

## ۵. باگ‌های رفع‌شده در همین فاز

| باگ | قبل | بعد |
|---|---|---|
| `markPaid` از وضعیت `DELIVERED` | پرداختِ تحویل‌شدهٔ فروشگاهی فقط از `CONFIRMED/CREDIT_APPROVED` ممکن بود و مسیر پخش گیر می‌کرد | `markPaid` از `DELIVERED` هم مجاز است (`finance.receipts`) |
| تسویهٔ مأموریت هنگام پرداخت سفارشِ `COMPLETED` | سفارش COMPLETED قابل پرداخت نبود و مأموریت DELIVERED راننده تا ابد باز می‌ماند | `markPaid` از `COMPLETED` نیز تسویهٔ مأموریت را انجام می‌دهد (`PAID ← COMPLETED`) |
| پرداختِ در محل روی سفارش تسویه‌شده | امکان ساخت Receipt تکراری در مسیر پخش | گارد صریح `PAYMENT_ALREADY_SETTLED` (400) در API + پیام روشن در UI راننده |
| `complete` فقط از `PAID` | تحویل‌های اعتباری/مرجوعی‌شده نمی‌توانستند بسته شوند | `complete` از `DELIVERED` و `PAID` |

---

## ۶. تست‌ها

**۳۸ تست واحد + ۲۹ تست یکپارچه — همه سبز** (اجرای محلی پس از آخرین commit: `38/38 pass`، `29/29 pass`؛ همین مجموعه در CI روی `7bbd837` سبز است).

- **تست واحد** (`tests/unit/delivery-shared.test.mts` و بقیه): ثابت‌ها، برچسب‌های فارسی، `isOnSpotPayment`، محاسبهٔ بازهٔ دوره‌ها با هفتهٔ شنبه‌شروع.
- **تست یکپارچهٔ API** (`tests/integration/deliveries-api.test.mts`، ۱۲+ سناریو):
  - RBAC: راننده فقط مأموریت خودش، مسیر مدیریتی بدون مجوز → ۴۰۳.
  - جریان کامل تخصیص → شروع → تحویل+پرداخت → بررسی Invoice/Receipt/Ledger/FEFO.
  - مرجوعی با ۵ دلیل و برگشت FEFO انبار.
  - **idempotency دوگانه:** ارسال دوباره با همان کلید → بدون اثر تکراری؛ باز شدن دوبارهٔ دیالوگ با کلید جدید → دقیقاً یک اثر مالی؛ کلید در AuditLog ثبت می‌شود.
  - `PAYMENT_ALREADY_SETTLED` روی پرداختِ در محل برای سفارش تسویه‌شده.
  - فیلتر دوره‌ای `from/to/dateField` و بازهٔ معکوس → ۴۰۰.
  - خلاصهٔ وضعیت (`/api/deliveries/summary`) و گزارش CREDIT تسویه‌نشده.
  - تخصیص مجدد مأموریت لغوشده.
- **تست یکپارچهٔ جریان** (`tests/integration/deliveries-flow.test.mts`): چرخهٔ بلند سفارش تا مأموریت PAID و مسیرهای خطا (claim هم‌زمان، وضعیت نامعتبر).

---

## ۷. Migrationها — ۲ عدد، هر دو additive

| Migration | محتوا | ریسک |
|---|---|---|
| `20261127013054_add_delivery_assignments` | ساخت جدول `DeliveryAssignment` + ایندکس‌ها + افزودن ستون `OrderStatusEvent.actorRole` (nullable) | صفر — فقط ساخت/افزودن؛ هیچ داده‌ای تغییر نمی‌کند |
| `20261127013500_add_driver_permissions` | INSERT سه مجوز جدید (idempotent) | صفر — جدول موجود پر می‌شود |

هیچ ستونی حذف یا تغییر نوع نشده؛ rollback = حذف جدول/ستون جدید.

---

## ۸. UI (توضیح متنی)

- **DriverApp (موبایل، RTL):** هدر با نام راننده و دو تب. هر کارت مأموریت: مشتری/آدرس/مبلغ/وضعیت با Badge رنگی مشترک (`AssignmentStatusBadge`) و دکمهٔ تماس. دیالوگ تحویل: انتخاب روش پرداخت با پیش‌فرض هوشمند، فیلد مرجع مشروط به روش، تأیید دو مرحله‌ای؛ پس از ثبت، کارت از فهرست فعال خارج و در تاریخچه می‌نشیند. دیالوگ مرجوعی: ۵ دلیل به‌صورت لیست انتخابی + یادداشت. خلاصهٔ هفته در پایین تب تاریخچه.
- **DeliveriesView (دسکتاپ، RTL):** ردیف کارت‌های خلاصه بالای صفحه؛ نوار فیلتر سه‌گانه؛ جدول مأموریت‌ها با Badge وضعیت و اکشن‌های زمینه‌ای (تخصیص/لغو/تخصیص مجدد)؛ بخش گزارش «تحویل‌شده بدون تسویه» فقط وقتی ردیف دارد نمایش داده می‌شود؛ دیالوگ تخصیص سفارش + انتخاب راننده با فهرست راننده‌های فعال.
- هر دو نما از الگوی موجود `VisitorApp` (tabs + `useApiData` + کامپوننت‌های `kit`) پیروی می‌کنند؛ برای کاربرِ فاقد `dashboard.view`، لاگین مستقیماً به اپ خودش می‌رود.

---

## ۹. چک‌لیست بازبینی (برای Reviewer)

- [ ] مدل داده: `prisma/schema.prisma` — مدل `DeliveryAssignment` و `OrderStatusEvent.actorRole`؛ additive بودن هر دو migration در `prisma/migrations/`.
- [ ] گاردهای مالی: مسیر `completeDelivery` در `src/lib/deliveries.ts` — claim اتمیک، گارد `PAYMENT_ALREADY_SETTLED`، عدم Receipt تکراری.
- [ ] `markPaid` در `src/lib/orders.ts` — ازهای `DELIVERED`/`COMPLETED` و تسویهٔ مأموریت در همان تراکنش.
- [ ] RBAC: پوشش سه مجوز جدید در `src/lib/auth.ts`/seed و اعمال در هر سه endpoint.
- [ ] idempotency: ثبت کلید در AuditLog و رفتار دوگانه (همان کلید / کلید جدید) در تست `deliveries-api.test.mts`.
- [ ] FEFO: برگشت صحیح کالا در مرجوعی و کسر صحیح در تحویل (`src/lib/delivery-effects.ts`).
- [ ] UI: پیش‌فرض هوشمند پرداخت و نگاشت خطا در `DriverApp.tsx`؛ منطق کارت‌ها/گزارش در `DeliveriesView.tsx`.
- [ ] CI: trigger جدید `[main, 'feat/**']` در `.github/workflows/ci.yml` و سبز بودن run شاخه.
- [ ] هیچ فایل حساسی (.env، کلید، توکن) در diff نیست — تنها `.env.example` در ریپو است و فاز ۱ متغیر محیطی جدیدی نیاز ندارد.

---

## ۱۰. فهرست commitها (به ترتیب)

| Commit | موضوع |
|---|---|
| `3ee3032` | بخش A — مدل DeliveryAssignment + actorRole + مجوزها |
| `e66daae` | بخش B — منطق مشترک تحویل و اصلاح markPaid |
| `585ac0f` | بخش C — تسویه مأموریت در markPaid + claim اتمیک |
| `930b8e9` | بخش C — گارد PAYMENT_ALREADY_SETTLED |
| `b6dedfa` | بخش C — API /api/deliveries و /api/deliveries/[id] |
| `04b4cc1` | بخش D — اپ راننده + نمای مدیریت + فیلتر دوره‌ای |
| `7aa6702` | بخش E — داشبورد مدیر: خلاصه، گزارش تسویه اعتباری، تخصیص مجدد |
| `7bbd837` | CI — اجرای CI روی شاخه‌های feat/** |
| *(این PR)* | مستندات PR و ماژول توزیع |
