# ماژول پخش و مأموریت راننده (Delivery Partners) — فاز ۱

مستندات فنی ماژول پخش: تخصیص مأموریت به راننده، ثبت تحویل و دریافت وجه در مسیر، مرجوعی، و تسویه مالی.
این ماژول در فاز ۱ افزوده شد؛ چرخهٔ کامل آن: **تخصیص → شروع → تحویل/پرداخت → (مرجوعی) → تسویه → بستن مأموریت**.

---

## ۱. مدل داده

### جدول `DeliveryAssignment`
| ستون | نوع | توضیح |
|---|---|---|
| `id` | cuid | شناسهٔ مأموریت |
| `orderId` | FK → Order | سفارش مورد تحویل (حذف سفارش = حذف cascade مأموریت) |
| `deliveryUserId` | FK → User | رانندهٔ مأمور |
| `assignedById` | FK → User | تخصیص‌دهنده (مدیر/مسئول ارسال) |
| `status` | string | ۷ حالت — جدول پایین |
| `paymentMethod` | string? | `CASH | CARD_TO_CARD | POS | CREDIT | OTHER` — در لحظهٔ ثبت تحویل |
| `paymentReference` | string? | شمارهٔ مرجع کارت‌به‌کارت/POS |
| `failureReason` | string? | کد دلیل مرجوعی یا یادداشت لغو |
| `notes` | string? | یادداشت آزاد |
| `assignedAt / startedAt / completedAt` | DateTime? | خط زمانی مأموریت |

**وضعیت‌های مأموریت:**

| وضعیت | معنی | گذار به |
|---|---|---|
| `PENDING` | تخصیص داده شده، شروع نشده | IN_PROGRESS، CANCELLED |
| `IN_PROGRESS` | راننده در مسیر | DELIVERED، RETURNED، PARTIAL_RETURNED، CANCELLED |
| `DELIVERED` | تحویل ثبت شد (پرداخت در محل یا سفارش اعتباری) | PAID |
| `PAID` | وجه تسویه شد — وضعیت نهایی | — |
| `RETURNED` / `PARTIAL_RETURNED` | مرجوعی کامل/جزئی — وضعیت نهایی | — |
| `CANCELLED` | لغو شده (قابل تخصیص مجدد سفارش) | — |

### `OrderStatusEvent.actorRole`
ستون اختیاری با مقادیر `WAREHOUSE | DELIVERY | SYSTEM`. رویدادهای قدیمی `null` هستند و به‌صورت SYSTEM نمایش داده می‌شوند. رویدادهای ساخته‌شده در مسیر پخش با `DELIVERY` علامت می‌خورند تا لاگ وضعیت، دست سازندهٔ رویداد را نشان دهد.

---

## ۲. مجوزها

| مجوز | توضیح |
|---|---|
| `deliveries.manage` | مدیریت ارسال و رانندگان — تخصیص/لغو/فهرست کامل/خلاصه (DISPATCHER، ADMIN) |
| `deliveries.view.own` | مشاهده مأموریت‌های خود راننده (DRIVER) |
| `deliveries.complete` | ثبت تحویل و دریافت وجه (DRIVER) |
| `deliveries.return` | ثبت مرجوعی (DRIVER) |

سه مجوز دوم در migration `20261127013500_add_driver_permissions` به نصب‌های موجود اضافه می‌شوند (idempotent) و در `scripts/seed.ts` به نقش DRIVER بسته شده‌اند.

---

## ۳. API

| مسیر | متد | نقش |
|---|---|---|
| `/api/deliveries` | GET | فهرست مأموریت‌ها. پارامترها: `driverId`، `status`، `from`، `to` (ISO)، `dateField=assignedAt(پیش‌فرض)|completedAt`، `take` (۱..۵۰۰). راننده همیشه به مأموریت‌های خودش محدود می‌شود؛ بازهٔ معکوس → ۴۰۰ |
| `/api/deliveries` | POST | تخصیص: `{ orderId, driverId }`. سفارش باید `READY_FOR_DISPATCH` یا `DISPATCHED` باشد؛ مأموریت فعالِ تکراری → ۴۰۹ |
| `/api/deliveries/[id]` | GET | جزئیات مأموریت (راننده فقط مأموریت خودش) |
| `/api/deliveries/[id]` | POST | اقدام‌ها: `start`، `complete`، `return`، `cancel` + `idempotencyKey` اختیاری (≤۶۴) |
| `/api/deliveries/summary` | GET | شمارش کارت‌های داشبورد؛ `from/to/driverId` |

**بدنهٔ اقدام‌ها:**
- `start` — بدون پارامتر؛ مأموریت PENDING → IN_PROGRESS و سفارش → DISPATCHED.
- `complete` — `{ paymentMethod, paymentReference? }`؛ مأموریت → DELIVERED، اثرات مالی در همان تراکنش.
- `return` — `{ reason, notes? }`؛ reason یکی از `CUSTOMER_REFUSED | WRONG_ITEM | DAMAGED | NOT_PAID | OTHER`.
- `cancel` — `{ reason? }`؛ فقط توسط `deliveries.manage`؛ سفارش به READY_FOR_DISPATCH برمی‌گردد.

---

## ۴. اثرات مالی و انبار (تراکنش اتمیک)

`completeDelivery` در `src/lib/deliveries.ts` همهٔ موارد زیر را در **یک تراکنش** انجام می‌دهد:

1. **Claim اتمیک:** `updateMany` مشروط به وضعیت فعلی — درخواست هم‌زمان دوم شکست می‌خورد (۴۰۹/۴۰۰) و هرگز دوباره‌کاری نمی‌کند.
2. **کسر FEFO از انبار** (`applyDeliveryEffects` در `src/lib/delivery-effects.ts`): خروج کالا بر اساس First-Expired-First-Out از ردیف‌های موجودی.
3. **فاکتور:** `Invoice.status = ISSUED` با شماره‌گذاری خودکار.
4. **دفتر (Ledger):** ردیف بدهی مشتری.
5. **رسید:** برای پرداخت در محل (`CASH/POS/CARD_TO_CARD/OTHER`) یک `Receipt` ثبت می‌شود؛ برای سفارش اعتباری هیچ رسیدی ساخته نمی‌شود.
6. **رویداد وضعیت سفارش** با `actorRole=DELIVERY`.

### گاردهای پرداخت
- سفارشی که قبلاً `PAID` شده در مسیر پرداختِ در محل نمی‌پذیرد → خطای `PAYMENT_ALREADY_SETTLED` (400). اپ راننده این کد را به پیام «این سفارش پیش‌تر تسویه شده است — نیازی به دریافت وجه نیست» نگاشت می‌کند.
- تسویهٔ مأموریت در مسیر `markPaid` سفارش نیز انجام می‌شود: وقتی حسابداری سفارشِ تحویل‌شده را پرداخت می‌کند (از `DELIVERED` یا حتی `COMPLETED`)، مأموریت `DELIVERED` به‌صورت خودکار `PAID` می‌شود — راننده نیازی به اقدام جداگانه ندارد.

### Idempotency دو لایه
- **API:** اگر `idempotencyKey` همراه درخواست باشد در AuditLog ثبت می‌شود و اقدام با claim اتمیک فقط یک بار اثر می‌گذارد.
- **UI (اپ راننده):** با هر باز شدن دیالوگ یک کلید `crypto.randomUUID` ساخته می‌شود؛ دکمه پس از موفقیت قفل می‌شود؛ تلاش تکراری پیام «قبلاً ثبت شده» می‌گیرد.

---

## ۵. رابط کاربری

### اپ راننده (`DriverApp.tsx`)
نمای موبایل‌محور با دو تب «مأموریت‌های من» و «تاریخچه»:
- دیالوگ «ثبت تحویل و دریافت وجه» با **پیش‌فرض هوشمند**: سفارش تسویه‌شده فرم پرداخت ندارد؛ سفارش اعتباری پیش‌فرض CREDIT؛ بقیه پیش‌فرض CASH.
- مرجوعی با انتخاب یکی از ۵ دلیل کدگذاری‌شده.
- دکمهٔ تماس با مشتری، گارد آفلاین (`navigator.onLine`).
- خلاصهٔ هفته با آغاز از **شنبه** (هفتهٔ ایرانی): تعداد تحویل/مرجوعی و مبلغ وصولی.
- کاربر دارای `deliveries.view.own` بدون `dashboard.view` پس از ورود مستقیماً به همین اپ می‌رود.

### داشبورد مدیر پخش (`DeliveriesView.tsx`)
- ۵ کارت خلاصه: PENDING، IN_PROGRESS، PAIDِ بازه، مرجوعیِ بازه، تحویل‌شدهٔ تسویه‌نشدهٔ اعتباری.
- فیلتر سه‌گانه: راننده / وضعیت / دوره (امروز، هفتهٔ جاری از شنبه، ماه جاری، بازهٔ دلخواه) با انتخاب فیلد تاریخ.
- تخصیص سفارش‌های READY_FOR_DISPATCH/DISPATCHED به راننده‌های فعال؛ لغو مأموریت؛ **تخصیص مجدد** مأموریت لغوشده.
- گزارش «تحویل‌شده بدون تسویه»: مأموریت‌های DELIVERED با سفارش CREDIT، مرتب از قدیمی‌ترین، با دکمهٔ «ثبت پرداخت» که `markPaid` محافظت‌شده را صدا می‌زند.

---

## ۶. استقرار و مهاجرت

```bash
npx prisma migrate deploy   # دو migration فاز ۱ (هر دو additive و بدون ریسک)
npm run db:seed             # فقط برای نصب تازه — مجوزهای جدید را می‌سازد
```

- نصب‌های موجود: migration دوم خودش مجوزهای جدید را INSERT می‌کند؛ اجرای مجدد seed لازم نیست.
- رول‌بک: حذف جدول `DeliveryAssignment` و ستون `actorRole` (هیچ دادهٔ موجودی دیگری تحت تأثیر نیست).
- متغیر محیطی جدیدی لازم نیست.

## ۷. تست‌ها

```bash
npm run test:unit          # شامل tests/unit/delivery-shared.test.mts
npm run test:integration   # tests/integration/deliveries-api.test.mts + deliveries-flow.test.mts
```

پوشش: RBAC، جریان کامل تحویل/پرداخت، مرجوعی FEFO، idempotency دوگانه، گارد `PAYMENT_ALREADY_SETTLED`، فیلتر دوره‌ای، خلاصهٔ وضعیت، گزارش CREDIT و تخصیص مجدد.
