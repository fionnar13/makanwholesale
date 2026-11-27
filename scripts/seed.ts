/**
 * Seed اولیه سامانه بنکداری — Idempotent
 * اجرا: bun run scripts/seed.ts
 *
 * قوانین امنیتی:
 *  - رمز مدیر اولیه از ADMIN_PASSWORD (env) خوانده می‌شود؛ اگر تنظیم نشده باشد
 *    تصادفی تولید و در db/.initial-admin-password.txt ذخیره می‌شود (خارج از کد).
 *  - رمز کاربران نمایشی از DEMO_USERS_PASSWORD (env) خوانده می‌شود؛ در نبود آن
 *    تصادفی تولید و در db/.initial-demo-passwords.txt ذخیره می‌شود.
 *  - هیچ رمز ثابتی داخل سورس‌کد قرار نمی‌گیرد.
 */
import 'dotenv/config' // خواندن .env — سازگار با هر روش اجرا (npx prisma db seed / tsx / bun)؛ متغیرهای محیطی واقعی اولویت دارند
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync, randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const db = new PrismaClient()

// پوشه db ممکن است پس از clone تازه وجود نداشته باشد (فایل‌هایش گیت نشده‌اند)
function writeSecretFile(name: string, content: string) {
  const dir = join(process.cwd(), 'db')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), content, { mode: 0o600 })
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function genPassword(): string {
  return 'Bw' + randomBytes(6).toString('base64url') + '9!'
}

// ─── مجوزهای سیستم ───
const PERMISSIONS: Array<[string, string]> = [
  ['dashboard.view', 'مشاهده داشبورد'],
  ['products.view', 'مشاهده کاتالوگ'],
  ['products.manage', 'مدیریت کاتالوگ و قیمت‌ها'],
  ['customers.view', 'مشاهده مشتریان'],
  ['customers.manage', 'مدیریت مشتریان و شعب'],
  ['suppliers.view', 'مشاهده تأمین‌کنندگان'],
  ['suppliers.manage', 'مدیریت تأمین‌کنندگان'],
  ['orders.view', 'مشاهده سفارش‌ها'],
  ['orders.create', 'ثبت سفارش'],
  ['orders.confirm', 'تأیید سفارش'],
  ['orders.cancel', 'لغو سفارش'],
  ['orders.creditApprove', 'تأیید اعتبار سفارش'],
  ['inventory.view', 'مشاهده انبار'],
  ['inventory.receive', 'ثبت ورود کالا به انبار'],
  ['inventory.adjust', 'تعدیل موجودی'],
  ['inventory.issue', 'ثبت خروج/پیکینگ و تحویل انبار'],
  ['finance.view', 'مشاهده اطلاعات مالی'],
  ['finance.receipts', 'ثبت دریافت از مشتری'],
  ['finance.payments', 'ثبت پرداخت به تأمین‌کننده'],
  ['returns.view', 'مشاهده مرجوعی'],
  ['returns.manage', 'مدیریت و تأیید مرجوعی'],
  ['deliveries.manage', 'مدیریت ارسال و رانندگان'],
  ['deliveries.view.own', 'مشاهده مأموریت‌های پخش خود'],
  ['deliveries.complete', 'ثبت تحویل و دریافت وجه در مسیر پخش'],
  ['deliveries.return', 'ثبت مرجوعی در مسیر پخش'],
  ['visits.view', 'مشاهده بازدیدها'],
  ['visits.manage', 'ثبت بازدید و حضور'],
  ['reports.view', 'مشاهده گزارش‌ها'],
  ['users.manage', 'مدیریت کاربران و نقش‌ها'],
  ['territories.manage', 'مدیریت مناطق فروش'],
  ['audit.view', 'مشاهده Audit Log'],
  ['messages.use', 'پیام‌رسانی داخلی'],
]

// ─── نقش‌ها و مجوزها ───
const ROLE_PERMS: Record<string, string[]> = {
  ADMIN: PERMISSIONS.map(p => p[0]),
  SALES_MANAGER: ['dashboard.view','products.view','customers.view','customers.manage','suppliers.view','orders.view','orders.create','orders.confirm','orders.cancel','orders.creditApprove','inventory.view','finance.view','returns.view','returns.manage','deliveries.manage','visits.view','visits.manage','reports.view','messages.use','territories.manage'],
  FINANCE_MANAGER: ['dashboard.view','customers.view','orders.view','inventory.view','finance.view','finance.receipts','finance.payments','reports.view','returns.view','messages.use'],
  WAREHOUSE_MANAGER: ['dashboard.view','products.view','products.manage','inventory.view','inventory.receive','inventory.adjust','inventory.issue','orders.view','returns.view','returns.manage','deliveries.manage','reports.view','messages.use'],
  PURCHASING_OFFICER: ['dashboard.view','products.view','products.manage','suppliers.view','suppliers.manage','inventory.view','inventory.receive','finance.view','messages.use'],
  VISITOR: ['dashboard.view','products.view','customers.view','orders.view','orders.create','inventory.view','visits.manage','visits.view','finance.receipts','messages.use'],
  ACCOUNTANT: ['dashboard.view','customers.view','orders.view','finance.view','finance.receipts','finance.payments','reports.view','messages.use'],
  DISPATCHER: ['dashboard.view','orders.view','inventory.view','inventory.issue','deliveries.manage','visits.view','messages.use'],
  DRIVER: ['orders.view', 'messages.use', 'deliveries.view.own', 'deliveries.complete', 'deliveries.return'],
  SUPPORT: ['dashboard.view','customers.view','orders.view','products.view','messages.use','visits.view'],
  // کاربرانی که با حساب گوگل وارد می‌شوند — حداقل دسترسی: داشبورد، فروشگاه و سفارش‌ها
  ONLINE_USER: ['dashboard.view','products.view','orders.view','messages.use'],
}

const ROLES: Array<[string, string]> = [
  ['ADMIN', 'مدیر کل'],
  ['SALES_MANAGER', 'مدیر فروش'],
  ['FINANCE_MANAGER', 'مدیر مالی'],
  ['WAREHOUSE_MANAGER', 'مدیر انبار'],
  ['PURCHASING_OFFICER', 'مسئول خرید'],
  ['VISITOR', 'ویزیتور'],
  ['ACCOUNTANT', 'حسابدار'],
  ['DISPATCHER', 'مسئول ارسال'],
  ['DRIVER', 'راننده'],
  ['SUPPORT', 'کاربر پشتیبانی'],
  ['ONLINE_USER', 'کاربر آنلاین (ورود با گوگل)'],
]

// ─── کاتالوگ نمونه (۱۶ محصول با تصویر واقعی) — همه با پرچم DEMO_SEED ───
type UnitDef = { name: string; factor: number; isBase?: boolean; price?: number }
type ProdDef = {
  sku: string; name: string; brand: string; brandConfirmed?: boolean;
  category: string; desc: string; imageUrl?: string;
  weightG?: number; volumeMl?: number; packaging?: string;
  reorder?: number; units: UnitDef[];
}

const IMG = '/products/'

const CATALOG: ProdDef[] = [
  {
    sku: 'TOM-CC-800', name: 'رب گوجه‌فرنگی چین‌چین — شیشه ۷۰۰ گرمی', brand: 'چین‌چین', brandConfirmed: true,
    category: 'رب گوجه‌فرنگی', imageUrl: IMG + 'tomato-paste-chinchin.jpg', packaging: 'شیشه/کارتن',
    desc: 'رب گوجه‌فرنگی غلیظ چین‌چین در شیشه‌ای دربِ فلزی؛ تهیه‌شده از گوجه‌فرنگی رسیده تازه با رنگ و عطر کاملاً طبیعی، بدون افزودن رنگ و نگهدارنده. مناسب انواع خورشت، دُم‌پخت و غذاهای خانگی. عرضه عمده در کارتن ۲۴ عددی برای بنکداران و فروشگاه‌ها.',
    weightG: 700, reorder: 120,
    units: [
      { name: 'شیشه ۷۰۰ گرمی', factor: 1, isBase: true, price: 98000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 2200000 },
    ],
  },
  {
    sku: 'TOM-MT-800', name: 'رب گوجه‌فرنگی میت (DIMOMET) — شیشه ۸۰۰ گرمی', brand: 'میت', brandConfirmed: true,
    category: 'رب گوجه‌فرنگی', imageUrl: IMG + 'tomato-paste-mit.jpg', packaging: 'شیشه/کارتن',
    desc: 'رب گوجه‌فرنگی میت (DIMOMET) تولیدی Mataim در شیشه ۸۰۰ گرمی؛ رنگ درخشان، غلظت مناسب و طعم گوجه‌فرنگی رسیده. انتخاب اقتصادی و پرتکرار برای سبد مصرف خانوار و مصارف صنفی.',
    weightG: 800, reorder: 120,
    units: [
      { name: 'شیشه ۸۰۰ گرمی', factor: 1, isBase: true, price: 92000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 2100000 },
    ],
  },
  {
    sku: 'TOM-SPD-800', name: 'رب گوجه‌فرنگی اسپادانا — قوطی ۸۰۰ گرمی', brand: 'اسپادانا', brandConfirmed: true,
    category: 'رب گوجه‌فرنگی', imageUrl: IMG + 'tomato-paste-spadana.jpg', packaging: 'قوطی/کارتن',
    desc: 'کنسرو رب گوجه‌فرنگی اسپادانا در قوطی ۸۰۰ گرمی با درپوش پلاستیکی؛ بریکس بالا، رنگ طبیعی و ماندگاری مطمئن. مناسب رستوران، آشپزخانه صنعتی و مصرف روزانه خانگی.',
    weightG: 800, reorder: 120,
    units: [
      { name: 'قوطی ۸۰۰ گرمی', factor: 1, isBase: true, price: 95000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 2150000 },
    ],
  },
  {
    sku: 'TUN-BBR-180', name: 'تن ماهی بابارار در روغن گیاهی — قوطی ۱۸۰ گرمی', brand: 'بابارار', brandConfirmed: true,
    category: 'کنسرو ماهی', imageUrl: IMG + 'tuna-babarar-180.jpg', packaging: 'قوطی/کارتن',
    desc: 'تن ماهی بابارار (BABARAR) در روغن گیاهی، قوطی ۱۸۰ گرمی؛ گوشت سفید تُن بافت‌دار، سرشار از پروتئین و امگا۳. آماده مصرف در سالاد، ساندویچ و نان‌و‌پنیر؛ ماندگاری بالا در دمای محیط.',
    weightG: 180, reorder: 100,
    units: [
      { name: 'قوطی ۱۸۰ گرمی', factor: 1, isBase: true, price: 145000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 3300000 },
    ],
  },
  {
    sku: 'CNS-ENT-LQ-400', name: 'کنسرو لوبیا چیتی با قارچ انتخاب — قوطی ۴۰۰ گرمی', brand: 'انتخاب', brandConfirmed: true,
    category: 'کنسرو حبوبات و غذای آماده', imageUrl: IMG + 'beans-mushroom-entekhab.jpg', packaging: 'قوطی/کارتن',
    desc: 'کنسرو لوبیا چیتی با قارچ انتخاب (ENTEKHAB) قوطی ۴۰۰ گرمی؛ دانه‌های لوبیای یکدست با سس گوجه‌فرنگی خوش‌طعم و تکه‌های قارچ تازه. غذای آماده و پرطرفدار قفسه فروشگاه‌ها.',
    weightG: 400, reorder: 80,
    units: [
      { name: 'قوطی ۴۰۰ گرمی', factor: 1, isBase: true, price: 78000 },
      { name: 'کارتن ۱۲ عددی', factor: 12, price: 880000 },
    ],
  },
  {
    sku: 'CNS-VAR-LC-400', name: 'کنسرو لوبیا چیتی وای در سس گوجه‌فرنگی — قوطی ۳۳۸ گرمی', brand: 'وای', brandConfirmed: true,
    category: 'کنسرو حبوبات و غذای آماده', imageUrl: IMG + 'beans-chiti-vay.jpg', packaging: 'قوطی/کارتن',
    desc: 'کنسرو لوبیا چیتی وای در سس گوجه‌فرنگی، قوطی ۳۳۸ گرمی؛ لوبیای درشت و ترد در سس غلیظ با طعم خانگی. منبع پروتئین و فیبر گیاهی — غذای آماده مقوی برای همه اعضای خانواده.',
    weightG: 338, reorder: 80,
    units: [
      { name: 'قوطی ۳۳۸ گرمی', factor: 1, isBase: true, price: 74000 },
      { name: 'کارتن ۱۲ عددی', factor: 12, price: 840000 },
    ],
  },
  {
    sku: 'BEV-SS-FR-300', name: 'نوشیدنی میوه‌ای سانی نایس ناتفیلز — قوطی ۳۳۰ میلی‌لیتری', brand: 'سانی نایس', brandConfirmed: true,
    category: 'نوشیدنی', imageUrl: IMG + 'sani-nice-notfilz.jpg', packaging: 'قوطی/کارتن',
    desc: 'نوشیدنی میوه‌ای سانی نایس (Sani Nice) سری ناتفیلز در چهار طعم پرتقال، انبه، آناناس و هلو؛ قوطی ۳۳۰ میلی‌لیتری خنک و طراوت‌بخش. پرفروش فصل گرم و محبوب نوجوانان.',
    volumeMl: 330, reorder: 150,
    units: [
      { name: 'قوطی ۳۳۰ میلی‌لیتری', factor: 1, isBase: true, price: 42000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 950000 },
    ],
  },
  {
    sku: 'BEV-FP-EN-250', name: 'نوشیدنی انرژی‌زای فایر پاور (Fire Power) — قوطی ۲۵۰ میلی‌لیتری', brand: 'Fire Power', brandConfirmed: true,
    category: 'نوشیدنی', imageUrl: IMG + 'fire-power-energy.jpg', packaging: 'قوطی/کارتن',
    desc: 'نوشیدنی انرژی‌زای فایر پاور (FIRE POWER) قوطی ۲۵۰ میلی‌لیتری؛ ترکیب کافئین، تائورین و ویتامین‌های گروه B برای انرژی فوری و تمرکز بیشتر. طرح آتشین چشم‌نواز — پرفروش فروشگاه‌های رفاهی و باشگاهی.',
    volumeMl: 250, reorder: 150,
    units: [
      { name: 'قوطی ۲۵۰ میلی‌لیتری', factor: 1, isBase: true, price: 68000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 1550000 },
    ],
  },
  {
    sku: 'BEV-VTC-250', name: 'نوشیدنی ویتامین C ویتامین ۲۴ — شیشه ۲۵۰ میلی‌لیتری', brand: 'ویتامین ۲۴', brandConfirmed: true,
    category: 'نوشیدنی', imageUrl: IMG + 'vitamin-c-24.jpg', packaging: 'شیشه/کارتن',
    desc: 'نوشیدنی ویتامین C برند ویتامین ۲۴ در شیشه ۲۵۰ میلی‌لیتری با درب فلزی؛ دوز مؤثر ویتامین C با طعم مرکبات برای تقویت سیستم ایمنی. فصلی‌ترین محصول قفسه نوشیدنی در روزهای سرد.',
    volumeMl: 250, reorder: 150,
    units: [
      { name: 'شیشه ۲۵۰ میلی‌لیتری', factor: 1, isBase: true, price: 45000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 1020000 },
    ],
  },
  {
    sku: 'BEV-HER-JU-500', name: 'آبمیوه هیرو (HERO) — بطری ۵۰۰ میلی‌لیتری', brand: 'هیرو', brandConfirmed: true,
    category: 'نوشیدنی', imageUrl: IMG + 'juice-hero-500.jpg', packaging: 'بطری/کارتن',
    desc: 'آبمیوه هیرو (HERO) با محتوای میوه ۱۰۰٪، بطری ۵۰۰ میلی‌لیتری در چهار طعم پرتقال، هلو، آناناس و انبه؛ رنگ سبز چشم‌نواز و برچسب Premium Quality. منبع طبیعی ویتامین‌ها برای سبد خانوار.',
    volumeMl: 500, reorder: 150,
    units: [
      { name: 'بطری ۵۰۰ میلی‌لیتری', factor: 1, isBase: true, price: 55000 },
      { name: 'کارتن ۱۲ عددی', factor: 12, price: 620000 },
    ],
  },
  {
    sku: 'BEV-RZT-BS-290', name: 'نوشیدنی دانه ریحان رزوتی (REZOTI) — بطری شیشه‌ای ۲۹۰ میلی‌لیتری', brand: 'رزوتی', brandConfirmed: true,
    category: 'نوشیدنی', imageUrl: IMG + 'basil-seed-rezoti.jpg', packaging: 'شیشه/کارتن',
    desc: 'نوشیدنی دانه ریحان رزوتی (REZOTI) در بطری شیشه‌ای درب‌کلیپسی در چهار طعم سیب، آناناس، انبه و گیلاس؛ دانه‌های ریحان معلق با طعم میوه‌ای خنک و متفاوت — محصولی خاص با مشتریان وفادار.',
    volumeMl: 290, reorder: 150,
    units: [
      { name: 'بطری ۲۹۰ میلی‌لیتری', factor: 1, isBase: true, price: 45000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 990000 },
    ],
  },
  {
    sku: 'BEV-URN-WT-500', name: 'آب معدنی طبیعی اورانوس (URANUS) — بطری ۵۰۰ میلی‌لیتری', brand: 'اورانوس', brandConfirmed: true,
    category: 'نوشیدنی', imageUrl: IMG + 'water-uranus-500.jpg', packaging: 'بطری/کارتن',
    desc: 'آب معدنی طبیعی اورانوس (URANUS) از چشمه کوهستانی، بطری ۵۰۰ میلی‌لیتری PET؛ املاح معدنی متعادل و طعم خالص و سبک. کالای پرگردش و پرفروشِ همیشگی قفسه فروشگاه.',
    volumeMl: 500, reorder: 300,
    units: [
      { name: 'بطری ۵۰۰ میلی‌لیتری', factor: 1, isBase: true, price: 12000 },
      { name: 'کارتن ۲۴ عددی', factor: 24, price: 250000 },
    ],
  },
  {
    sku: 'CMP-BMD-CH-450', name: 'کمپوت گیلاس بمدیس — قوطی ۴۵۰ گرمی', brand: 'بمدیس', brandConfirmed: true,
    category: 'کمپوت میوه', imageUrl: IMG + 'compote-cherry-bamdis.jpg', packaging: 'قوطی/کارتن',
    desc: 'کمپوت گیلاس بمدیس در قوطی ۴۵۰ گرمی؛ گیلاس‌های درشت و رسیده در شیره غلیظ، بدون رنگ و طعم‌دهنده مصنوعی. دسر سنتی و پذیرایی سفره — ماندگاری بالا در دمای محیط.',
    weightG: 450, reorder: 80,
    units: [
      { name: 'قوطی ۴۵۰ گرمی', factor: 1, isBase: true, price: 62000 },
      { name: 'کارتن ۱۲ عددی', factor: 12, price: 700000 },
    ],
  },
  {
    sku: 'VGR-DST-AP-750', name: 'سرکه سیب دست‌چین — بطری ۷۵۰ میلی‌لیتری', brand: 'دست‌چین', brandConfirmed: true,
    category: 'سرکه و آبلیمو', imageUrl: IMG + 'vinegar-apple-dastchin.jpg', packaging: 'بطری/کارتن',
    desc: 'سرکه سیب دست‌چین در بطری ۷۵۰ میلی‌لیتری با برچسب برگ‌مانند؛ طعم ملایم اسیدی طبیعی از سیب رسیده. همراه با سرکه سفید هم‌خانواده آن، مناسب سالاد، ترشیجات و آشپزی.',
    volumeMl: 750, reorder: 80,
    units: [
      { name: 'بطری ۷۵۰ میلی‌لیتری', factor: 1, isBase: true, price: 45000 },
      { name: 'کارتن ۱۲ عددی', factor: 12, price: 480000 },
    ],
  },
  {
    sku: 'VGR-DST-GR-1500', name: 'سرکه انگوری دست‌چین — بطری ۱.۵ لیتری', brand: 'دست‌چین', brandConfirmed: true,
    category: 'سرکه و آبلیمو', imageUrl: IMG + 'vinegar-grape-dastchin.jpg', packaging: 'بطری/کارتن',
    desc: 'سرکه انگوری دست‌چین در بطری ۱.۵ لیتری؛ حاصل تخمیر طبیعی انگور رسیده با اسیدیته متعادل و عطر میوه‌ای. اقتصادی‌ترین حجم برای مصارف خانگی و صنفی آشپزخانه.',
    volumeMl: 1500, reorder: 80,
    units: [
      { name: 'بطری ۱.۵ لیتری', factor: 1, isBase: true, price: 78000 },
      { name: 'کارتن ۶ عددی', factor: 6, price: 430000 },
    ],
  },
  {
    sku: 'LMJ-DST-1000', name: 'آبلیموی ترش دست‌چین — بطری ۱ لیتری', brand: 'دست‌چین', brandConfirmed: true,
    category: 'سرکه و آبلیمو', imageUrl: IMG + 'lime-juice-dastchin.jpg', packaging: 'بطری/کارتن',
    desc: 'آبلیموی ترش دست‌چین در بطری ۱ لیتری؛ طعم اسیدی قوی و عطر لیموی تازه برای آش، سالاد و دُم‌پخت. تهیه‌شده از آب لیموی مرغوب — چاشنی ضروری آشپزخانه ایرانی.',
    volumeMl: 1000, reorder: 100,
    units: [
      { name: 'بطری ۱ لیتری', factor: 1, isBase: true, price: 52000 },
      { name: 'کارتن ۱۲ عددی', factor: 12, price: 560000 },
    ],
  },
]

const DEMO_EXPIRY = '2027-11-22T00:00:00.000Z' // تاریخ نمونه — DEMO_SEED
const DEMO_LOT_QTY = 100 // موجودی نمونه — DEMO_SEED

async function main() {
  console.log('== شروع Seed ==')

  // ۱) مجوزها و نقش‌ها
  const permIdByCode: Record<string, string> = {}
  for (const [code, label] of PERMISSIONS) {
    const p = await db.permission.upsert({
      where: { code }, update: { label }, create: { code, label },
    })
    permIdByCode[code] = p.id
  }
  const roleIdByName: Record<string, string> = {}
  for (const [name, label] of ROLES) {
    const r = await db.role.upsert({ where: { name }, update: { label }, create: { name, label, isSystem: true } })
    roleIdByName[name] = r.id
    for (const code of ROLE_PERMS[name] ?? []) {
      const existing = await db.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: r.id, permissionId: permIdByCode[code] } },
      })
      if (!existing) {
        await db.rolePermission.create({ data: { roleId: r.id, permissionId: permIdByCode[code] } })
      }
    }
  }

  // ۲) کاربران — رمزها از env یا تصادفی + ذخیره در فایل محلی
  const adminPass = process.env.ADMIN_PASSWORD || genPassword()
  const demoPass = process.env.DEMO_USERS_PASSWORD || genPassword()
  if (!process.env.ADMIN_PASSWORD) {
    writeSecretFile('.initial-admin-password.txt', adminPass)
  }
  if (!process.env.DEMO_USERS_PASSWORD) {
    writeSecretFile('.initial-demo-passwords.txt', demoPass)
  }

  const users: Array<{ phone: string; name: string; roles: string[]; demo?: boolean }> = [
    { phone: '09120000000', name: 'مدیر سیستم', roles: ['ADMIN'] },
    { phone: '09120000001', name: 'علی رضایی — مدیر فروش', roles: ['SALES_MANAGER'], demo: true },
    { phone: '09120000002', name: 'مریم حسینی — مدیر مالی', roles: ['FINANCE_MANAGER'], demo: true },
    { phone: '09120000003', name: 'رضا کریمی — مدیر انبار', roles: ['WAREHOUSE_MANAGER'], demo: true },
    { phone: '09120000004', name: 'حسن موسوی — مسئول خرید', roles: ['PURCHASING_OFFICER'], demo: true },
    { phone: '09120000005', name: 'سمیرا احمدی — ویزیتور اهواز', roles: ['VISITOR'], demo: true },
    { phone: '09120000006', name: 'زهرا نادری — حسابدار', roles: ['ACCOUNTANT'], demo: true },
    { phone: '09120000007', name: 'مهدی قاسمی — مسئول ارسال', roles: ['DISPATCHER'], demo: true },
    { phone: '09120000008', name: 'امیر صادقی — راننده', roles: ['DRIVER'], demo: true },
    { phone: '09120000009', name: 'نگار توکلی — پشتیبانی', roles: ['SUPPORT'], demo: true },
  ]

  for (const u of users) {
    const pass = u.demo ? demoPass : adminPass
    const user = await db.user.upsert({
      where: { phone: u.phone },
      // توجه: در هر اجرای seed فقط کاربران جدید ساخته می‌شوند؛ رمز کاربران موجود
      // هرگز بازنویسی نمی‌شود تا اجرای seed روی محیط واقعی، دسترسی‌ها را نشکند.
      update: {},
      create: { phone: u.phone, name: u.name, passwordHash: hashPassword(pass), phoneVerified: true },
    })
    for (const r of u.roles) {
      await db.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: roleIdByName[r] } },
        update: {},
        create: { userId: user.id, roleId: roleIdByName[r] },
      })
    }
    if (u.roles[0] === 'VISITOR') {
      await db.employee.upsert({
        where: { code: 'EMP-1001' },
        update: { userId: user.id },
        create: { code: 'EMP-1001', fullName: u.name, phone: u.phone, position: 'ویزیتور فروش', userId: user.id, status: 'ACTIVE' },
      })
    }
  }
  console.log(`   کاربران: ${users.length} (مدیر: ${users[0].phone})`)

  // ۳) انبار پیش‌فرض
  const wh = await db.warehouse.upsert({
    where: { code: 'WH-MAIN' },
    update: {},
    create: { code: 'WH-MAIN', name: 'انبار اصلی بنکداری', isDefault: true },
  })

  // ۴) مناطق فروش — بدون حدس GIS؛ ترسیم/ورود رسمی بر عهده مدیر
  const territories: Array<[string, string]> = [
    ['TZ-1', 'منطقه شماره ۱ اهواز (نیازمند ترسیم مدیر)'],
    ['TZ-2', 'منطقه شماره ۲ اهواز (نیازمند ترسیم مدیر)'],
    ['TZ-3', 'منطقه شماره ۳ اهواز (نیازمند ترسیم مدیر)'],
  ]
  const territoryIds: Record<string, string> = {}
  for (const [code, name] of territories) {
    const t = await db.territory.upsert({ where: { code }, update: {}, create: { code, name } })
    territoryIds[code] = t.id
  }
  const visitorUser = await db.user.findUnique({ where: { phone: '09120000005' } })
  if (visitorUser) {
    await db.territory.update({ where: { code: 'TZ-1' }, data: { visitorId: visitorUser.id } })
  }

  // ۵) دسته‌بندی‌ها و برندها
  const catIds: Record<string, string> = {}
  for (const c of ['رب گوجه‌فرنگی', 'کنسرو ماهی', 'کنسرو حبوبات و غذای آماده', 'نوشیدنی', 'کمپوت میوه', 'سرکه و آبلیمو']) {
    const cat = await db.category.upsert({ where: { name: c }, update: {}, create: { name: c } })
    catIds[c] = cat.id
  }
  const brandIds: Record<string, string> = {}
  for (const p of CATALOG) {
    // برندها وابسته به دسته‌بندی‌اند — دسته‌ی هر برند از محصولات کاتالوگ استخراج می‌شود
    const catId = catIds[p.category] ?? null
    const b = await db.brand.upsert({
      where: { name: p.brand },
      update: { categoryId: catId }, // برای برندهای DEMO قبلی هم دسته را تکمیل می‌کند
      create: { name: p.brand, isConfirmed: !!p.brandConfirmed, isDemo: true, categoryId: catId },
    })
    brandIds[p.brand] = b.id
  }

  // ۶) محصولات + واحدها + قواعد قیمت DEMO_SEED
  const seedNote = 'DEMO_SEED — قیمت نمونه؛ نیازمند تأیید/اصلاح مدیر'
  for (const p of CATALOG) {
    const prod = await db.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        sku: p.sku, name: p.name, description: p.desc,
        brandId: brandIds[p.brand], categoryId: catIds[p.category],
        imageUrl: p.imageUrl ?? null,
        baseUnitName: p.units.find(u => u.isBase)!.name,
        weightG: p.weightG ?? null, volumeMl: p.volumeMl ?? null,
        packagingType: p.packaging ?? 'قوطی',
        minOrderQtyBase: 1, orderMultipleBase: 1,
        reorderPointBase: p.reorder ?? 100,
        isDemo: true, isActive: true,
      },
    })
    for (const u of p.units) {
      let unit = await db.productUnit.findFirst({ where: { productId: prod.id, name: u.name } })
      if (!unit) {
        unit = await db.productUnit.create({
          data: { productId: prod.id, name: u.name, factor: u.factor, isBase: !!u.isBase },
        })
      }
      // قاعده قیمت پیش‌فرض DEMO
      const rule = await db.priceRule.findFirst({
        where: { productId: prod.id, unitId: unit.id, scope: 'DEFAULT' },
      })
      if (!rule && u.price) {
        await db.priceRule.create({
          data: { productId: prod.id, unitId: unit.id, scope: 'DEFAULT', priceRls: u.price, minQtyBase: 1, note: seedNote },
        })
      }
    }
  }
  console.log(`   محصولات: ${CATALOG.length} (DEMO_SEED — همگی با تصویر)`)

  // ۷) تأمین‌کنندگان نمونه
  const suppliers: Array<[string, string, string]> = [
    ['SUP-001', 'شرکت صنایع غذایی چین‌چین', 'PRODUCER'],
    ['SUP-002', 'بازرگانی اسپادانا', 'PRODUCER'],
    ['SUP-003', 'شرکت کنسرو جنوب', 'WHOLESALER'],
  ]
  const supplierIds: Record<string, string> = {}
  for (const [code, name, type] of suppliers) {
    const s = await db.supplier.upsert({
      where: { code }, update: {}, create: { code, name, type, isDemo: true, status: 'ACTIVE' },
    })
    supplierIds[code] = s.id
  }

  // ۸) لات‌های DEMO_SEED با موجودی نمونه و انقضای نمونه + موجودی فیزیکی
  let lotsCreated = 0
  for (const p of CATALOG) {
    const prod = await db.product.findUnique({ where: { sku: p.sku } })
    if (!prod) continue
    const existing = await db.inventoryLot.findFirst({
      where: { productId: prod.id, warehouseId: wh.id, refType: 'SEED' },
    })
    if (existing) continue
    const basePrice = p.units.find(u => u.isBase)?.price ?? 0
    const costRls = Math.round((basePrice * 0.82) / 10) * 10 // بهای تمام‌شده نمونه DEMO_SEED
    const lot = await db.inventoryLot.create({
      data: {
        productId: prod.id, warehouseId: wh.id,
        lotNo: `LOT-SEED-${p.sku}-${randomUUID().slice(0, 6).toUpperCase()}`,
        producedAt: new Date('2026-09-01T00:00:00.000Z'),
        expiresAt: new Date(DEMO_EXPIRY),
        supplierId: supplierIds['SUP-001'],
        initialQtyBase: DEMO_LOT_QTY, remainingQtyBase: DEMO_LOT_QTY,
        costRls,
        refType: 'SEED', isDemo: true,
      },
    })
    await db.inventoryBalance.upsert({
      where: { productId_warehouseId: { productId: prod.id, warehouseId: wh.id } },
      update: { physicalQtyBase: { increment: DEMO_LOT_QTY } },
      create: { productId: prod.id, warehouseId: wh.id, physicalQtyBase: DEMO_LOT_QTY, reservedQtyBase: 0 },
    })
    await db.inventoryLedger.create({
      data: {
        productId: prod.id, warehouseId: wh.id, lotId: lot.id,
        movement: 'RECEIVE', physDelta: DEMO_LOT_QTY,
        refType: 'SEED', note: 'موجودی نمونه DEMO_SEED — قابل اصلاح/حذف مدیر',
      },
    })
    lotsCreated++
  }
  console.log(`   لات‌های نمونه: ${lotsCreated} (انقضای نمونه ${DEMO_EXPIRY.slice(0, 10)}، موجودی ${DEMO_LOT_QTY} واحد پایه)`)

  // ۹) مشتریان و شعب نمونه
  const customers: Array<{ code: string; shopName: string; businessType: string; groupKey: string; ownerName: string; phone: string; address: string; creditLimitRls: number; creditDays: number; territory: string; branches: Array<{ name: string; address: string }> }> = [
    {
      code: 'CUS-1001', shopName: 'سوپرمارکت کاوه', businessType: 'SUPERMARKET', groupKey: 'GOLD',
      ownerName: 'محمود کاوه', phone: '06133330001', address: 'اهواز — کیانپارس، خیابان ۱۲ شرقی',
      creditLimitRls: 500000000, creditDays: 30, territory: 'TZ-1',
      branches: [{ name: 'شعبه کیانپارس', address: 'کیانپارس، خیابان ۱۲ شرقی' }, { name: 'شعبه امانیه', address: 'اهواز — امانیه، بلوار گلستان' }],
    },
    {
      code: 'CUS-1002', shopName: 'خواربارفروشی سحر', businessType: 'GROCERY', groupKey: 'REGULAR',
      ownerName: 'فاطمه سحر', phone: '06133330002', address: 'اهواز — زیتون کارمندی، فاز ۲',
      creditLimitRls: 100000000, creditDays: 15, territory: 'TZ-2',
      branches: [{ name: 'فروشگاه اصلی', address: 'زیتون کارمندی، فاز ۲' }],
    },
    {
      code: 'CUS-1003', shopName: 'سوپرمارکت زیتون کارون', businessType: 'SUPERMARKET', groupKey: 'WHOLESALE',
      ownerName: 'قاسم کارون', phone: '06133330003', address: 'اهواز — زیتون کارمندی، فاز ۴',
      creditLimitRls: 800000000, creditDays: 30, territory: 'TZ-2',
      branches: [{ name: 'شعبه فاز ۴', address: 'زیتون کارمندی، فاز ۴' }],
    },
    {
      code: 'CUS-1004', shopName: 'فروشگاه برادران احمدی', businessType: 'GROCERY', groupKey: 'REGULAR',
      ownerName: 'سعید احمدی', phone: '06133330004', address: 'اهواز — کوی عبدالراسول',
      creditLimitRls: 50000000, creditDays: 0, territory: 'TZ-3',
      branches: [{ name: 'فروشگاه مرکزی', address: 'کوی عبدالراسول' }],
    },
  ]
  for (const c of customers) {
    const existing = await db.customer.findUnique({ where: { code: c.code } })
    if (!existing) {
      const cust = await db.customer.create({
        data: {
          code: c.code, shopName: c.shopName, businessType: c.businessType, groupKey: c.groupKey,
          ownerName: c.ownerName, phone: c.phone, address: c.address,
          creditLimitRls: c.creditLimitRls, creditDays: c.creditDays,
          territoryId: territoryIds[c.territory],
          // مسئول فروش = ویزیتور همان منطقه — فقط TZ-1 ویزیتور دارد (سمیرا)؛
          // سایر مناطق بدون ویزیتورند تا scoping «مشتریان خود ویزیتور» قابل نمایش باشد
          salesRepId: c.territory === 'TZ-1' ? (visitorUser?.id ?? null) : null,
          isDemo: true,
        },
      })
      for (const b of c.branches) {
        await db.customerBranch.create({ data: { customerId: cust.id, name: b.name, address: b.address, phone: c.phone } })
      }
    }
  }
  console.log(`   مشتریان نمونه: ${customers.length}`)

  // بهای تمام‌شده لات‌های SEED موجود از اجرای قبلی (Idempotent)
  for (const p of CATALOG) {
    const prod = await db.product.findUnique({ where: { sku: p.sku } })
    if (!prod) continue
    const basePrice = p.units.find(u => u.isBase)?.price ?? 0
    const costRls = Math.round((basePrice * 0.82) / 10) * 10
    await db.inventoryLot.updateMany({
      where: { productId: prod.id, refType: 'SEED', costRls: null },
      data: { costRls },
    })
  }

  // ۱۰) قیمت اختصاصی نمونه برای یک مشتری (نمایش اولویت قیمت)
  const kaveh = await db.customer.findUnique({ where: { code: 'CUS-1001' } })
  const tomCC = await db.product.findUnique({ where: { sku: 'TOM-CC-800' } })
  if (kaveh && tomCC) {
    const carton = await db.productUnit.findFirst({ where: { productId: tomCC.id, factor: 24 } })
    if (carton) {
      const exists = await db.priceRule.findFirst({
        where: { productId: tomCC.id, unitId: carton.id, scope: 'CUSTOMER', refId: kaveh.id },
      })
      if (!exists) {
        await db.priceRule.create({
          data: { productId: tomCC.id, unitId: carton.id, scope: 'CUSTOMER', refId: kaveh.id, priceRls: 2100000, minQtyBase: 1, note: 'DEMO_SEED — قیمت اختصاصی سوپرمارکت کاوه' },
        })
      }
    }
  }

  // ۱۱) تنظیمات
  await db.setting.upsert({ where: { key: 'store.name' }, update: {}, create: { key: 'store.name', value: 'بنکداری هوشمند — سامانه مدیریت بنکداری مواد غذایی' } })
  await db.setting.upsert({ where: { key: 'currency.unit' }, update: {}, create: { key: 'currency.unit', value: 'RLS' } })

  console.log('== Seed با موفقیت انجام شد ==')
  console.log(`   ورود مدیر: ${users[0].phone} (رمز از ADMIN_PASSWORD یا db/.initial-admin-password.txt)`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
