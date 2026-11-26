// رجیستری دیتاست‌ها — منبع مشترک برای بکاپ، خروجی/ورودی داده و همگام‌سازی Google Sheets
// هر دیتاست: ستون‌های مستندشده (فارسی برای CSV/XLSX)، خروجی سطرها، ورود اعتبارسنجی‌شده
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export type ColumnType = 'string' | 'number' | 'boolean'

export type DatasetColumn = {
  field: string // نام فیلد در JSON/TS
  label: string // برچسب فارسی ستون در CSV/XLSX و Google Sheets
  type: ColumnType
  required?: boolean // اجباری در ورود داده
  importable?: boolean // در ورود داده قابل تنظیم است (پیش‌فرض true)
}

export type DatasetRow = Record<string, string | number | boolean | null>

export type ImportContext = { userId?: string | null }

export type ImportResultRow = { action: 'created' | 'updated' | 'skipped'; key: string }

export type Dataset = {
  key: string
  label: string
  exportOnly?: boolean // فقط خروجی (مثل سفارش‌ها که ساختار آن‌ها رابطه‌ای است)
  columns: DatasetColumn[]
  exportRows: () => Promise<DatasetRow[]>
  jsonExport: () => Promise<unknown> // ساختار کامل با روابط — برای بکاپ JSON
  importRow?: (row: Record<string, unknown>, ctx: ImportContext) => Promise<ImportResultRow>
}

// ── تبدیل مقدار خام به نوع درست + اعتبارسنجی اولیه ──

export function coerceValue(col: DatasetColumn, raw: unknown): { ok: true; value: string | number | boolean | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') {
    if (col.required) return { ok: false, error: `فیلد «${col.label}» الزامی است` }
    return { ok: true, value: col.type === 'number' ? 0 : null }
  }
  if (col.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s٬]/g, '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))))
    if (!Number.isFinite(n)) return { ok: false, error: `فیلد «${col.label}» باید عدد باشد` }
    if (!Number.isInteger(n)) return { ok: false, error: `فیلد «${col.label}» باید عدد صحیح باشد` }
    return { ok: true, value: Math.trunc(n) }
  }
  if (col.type === 'boolean') {
    const s = String(raw).trim().toLowerCase()
    if (['true', '1', 'yes', 'فعال', 'بله'].includes(s)) return { ok: true, value: true }
    if (['false', '0', 'no', 'غیرفعال', 'خیر'].includes(s)) return { ok: true, value: false }
    return { ok: false, error: `فیلد «${col.label}» باید فعال/غیرفعال باشد` }
  }
  return { ok: true, value: String(raw).trim() }
}

// ── راهنمای فیلدهای قابل ورود برای دیتاست‌های فروشگاهی ──

const PRODUCT_COLUMNS: DatasetColumn[] = [
  { field: 'sku', label: 'کد کالا (SKU)', type: 'string', required: true },
  { field: 'name', label: 'نام کالا', type: 'string', required: true },
  { field: 'description', label: 'توضیحات', type: 'string' },
  { field: 'brand', label: 'برند', type: 'string' },
  { field: 'category', label: 'دسته‌بندی', type: 'string' },
  { field: 'imageUrl', label: 'تصویر', type: 'string' },
  { field: 'baseUnitName', label: 'واحد پایه', type: 'string' },
  { field: 'weightG', label: 'وزن (گرم)', type: 'number' },
  { field: 'volumeMl', label: 'حجم (میلی‌لیتر)', type: 'number' },
  { field: 'packagingType', label: 'نوع بسته‌بندی', type: 'string' },
  { field: 'minOrderQtyBase', label: 'حداقل سفارش', type: 'number' },
  { field: 'orderMultipleBase', label: 'مضرب سفارش', type: 'number' },
  { field: 'reorderPointBase', label: 'نقطه سفارش', type: 'number' },
  { field: 'isActive', label: 'فعال', type: 'boolean' },
]

const CUSTOMER_COLUMNS: DatasetColumn[] = [
  { field: 'code', label: 'کد مشتری', type: 'string', required: true },
  { field: 'shopName', label: 'نام فروشگاه', type: 'string', required: true },
  { field: 'businessType', label: 'نوع کسب‌وکار', type: 'string' },
  { field: 'groupKey', label: 'گروه قیمتی', type: 'string' },
  { field: 'ownerName', label: 'نام مالک', type: 'string' },
  { field: 'phone', label: 'تلفن', type: 'string', required: true },
  { field: 'taxId', label: 'شناسه مالیاتی', type: 'string' },
  { field: 'address', label: 'آدرس', type: 'string' },
  { field: 'territory', label: 'کد منطقه فروش', type: 'string' },
  { field: 'creditLimitRls', label: 'سقف اعتبار (ریال)', type: 'number' },
  { field: 'creditDays', label: 'مهلت پرداخت (روز)', type: 'number' },
  { field: 'status', label: 'وضعیت', type: 'string' },
]

const SUPPLIER_COLUMNS: DatasetColumn[] = [
  { field: 'code', label: 'کد تأمین‌کننده', type: 'string', required: true },
  { field: 'name', label: 'نام تأمین‌کننده', type: 'string', required: true },
  { field: 'type', label: 'نوع', type: 'string' },
  { field: 'phone', label: 'تلفن', type: 'string' },
  { field: 'contactName', label: 'رابط', type: 'string' },
  { field: 'address', label: 'آدرس', type: 'string' },
  { field: 'terms', label: 'شرایط پرداخت', type: 'string' },
  { field: 'status', label: 'وضعیت', type: 'string' },
]

const SETTINGS_COLUMNS: DatasetColumn[] = [
  { field: 'key', label: 'کلید', type: 'string', required: true },
  { field: 'value', label: 'مقدار', type: 'string' },
]

// ── توابع ورود ردیف (upsert) ──

async function importProduct(row: Record<string, unknown>, ctx: ImportContext): Promise<ImportResultRow> {
  const val = (f: string) => row[f]
  const sku = String(val('sku')).trim()
  const brandName = val('brand') ? String(val('brand')).trim() : null
  const categoryName = val('category') ? String(val('category')).trim() : null

  let categoryId: string | null = null
  if (categoryName) {
    const cat = await db.category.upsert({
      where: { name: categoryName },
      update: {},
      create: { name: categoryName },
    })
    categoryId = cat.id
  }
  let brandId: string | null = null
  if (brandName) {
    let brand = await db.brand.findUnique({ where: { name: brandName } })
    if (!brand) {
      brand = await db.brand.create({ data: { name: brandName, categoryId, isConfirmed: Boolean(ctx.userId) } })
    } else if (categoryId && !brand.categoryId) {
      brand = await db.brand.update({ where: { id: brand.id }, data: { categoryId } })
    }
    brandId = brand.id
  }

  const existing = await db.product.findUnique({ where: { sku } })
  const data: Prisma.ProductUncheckedCreateInput = {
    sku,
    name: String(val('name')).trim(),
    description: val('description') ? String(val('description')) : null,
    brandId,
    categoryId,
    imageUrl: val('imageUrl') ? String(val('imageUrl')) : null,
    baseUnitName: val('baseUnitName') ? String(val('baseUnitName')) : 'عدد',
    weightG: val('weightG') != null && val('weightG') !== '' ? Number(val('weightG')) : null,
    volumeMl: val('volumeMl') != null && val('volumeMl') !== '' ? Number(val('volumeMl')) : null,
    packagingType: val('packagingType') ? String(val('packagingType')) : null,
    minOrderQtyBase: val('minOrderQtyBase') != null ? Number(val('minOrderQtyBase')) : 1,
    orderMultipleBase: val('orderMultipleBase') != null ? Number(val('orderMultipleBase')) : 1,
    reorderPointBase: val('reorderPointBase') != null ? Number(val('reorderPointBase')) : 20,
    isActive: val('isActive') !== false && val('isActive') !== 'false',
  }
  if (existing) {
    // واحد پایه موجود را بازنویسی نمی‌کنیم — فقط ویژگی‌های کالا به‌روز می‌شود
    await db.product.update({ where: { sku }, data })
    return { action: 'updated', key: sku }
  }
  await db.product.create({ data })
  return { action: 'created', key: sku }
}

async function importCustomer(row: Record<string, unknown>, ctx: ImportContext): Promise<ImportResultRow> {
  const code = String(row['code']).trim()
  const territoryCode = row['territory'] ? String(row['territory']).trim() : null
  let territoryId: string | null = null
  if (territoryCode) {
    const t = await db.territory.upsert({
      where: { code: territoryCode },
      update: {},
      create: { code: territoryCode, name: territoryCode },
    })
    territoryId = t.id
  }
  const existing = await db.customer.findUnique({ where: { code } })
  const data: Prisma.CustomerUncheckedCreateInput = {
    code,
    shopName: String(row['shopName']).trim(),
    businessType: row['businessType'] ? String(row['businessType']) : 'GROCERY',
    groupKey: row['groupKey'] ? String(row['groupKey']) : 'REGULAR',
    ownerName: row['ownerName'] ? String(row['ownerName']) : null,
    phone: String(row['phone']).trim(),
    taxId: row['taxId'] ? String(row['taxId']) : null,
    address: row['address'] ? String(row['address']) : null,
    territoryId,
    creditLimitRls: row['creditLimitRls'] != null ? Number(row['creditLimitRls']) : 0,
    creditDays: row['creditDays'] != null ? Number(row['creditDays']) : 0,
    status: row['status'] ? String(row['status']) : 'ACTIVE',
    createdById: ctx.userId ?? null,
  }
  if (existing) {
    await db.customer.update({ where: { code }, data })
    return { action: 'updated', key: code }
  }
  await db.customer.create({ data })
  return { action: 'created', key: code }
}

async function importSupplier(row: Record<string, unknown>, ctx: ImportContext): Promise<ImportResultRow> {
  const code = String(row['code']).trim()
  const existing = await db.supplier.findUnique({ where: { code } })
  const data: Prisma.SupplierUncheckedCreateInput = {
    code,
    name: String(row['name']).trim(),
    type: row['type'] ? String(row['type']) : 'PRODUCER',
    phone: row['phone'] ? String(row['phone']) : null,
    contactName: row['contactName'] ? String(row['contactName']) : null,
    address: row['address'] ? String(row['address']) : null,
    terms: row['terms'] ? String(row['terms']) : null,
    status: row['status'] ? String(row['status']) : 'ACTIVE',
  }
  if (existing) {
    await db.supplier.update({ where: { code }, data })
    return { action: 'updated', key: code }
  }
  await db.supplier.create({ data })
  return { action: 'created', key: code }
}

async function importSetting(row: Record<string, unknown>): Promise<ImportResultRow> {
  const key = String(row['key']).trim()
  if (key.startsWith('seq:')) return { action: 'skipped', key } // شمارنده‌های داخلی قابل ورود نیستند
  const value = String(row['value'] ?? '')
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  return { action: 'updated', key }
}

// ── رجیستری ──

export const DATASETS: Record<string, Dataset> = {
  customers: {
    key: 'customers',
    label: 'مشتریان',
    columns: CUSTOMER_COLUMNS,
    async exportRows() {
      const rows = await db.customer.findMany({
        include: { territory: true },
        orderBy: { code: 'asc' },
      })
      return rows.map(c => ({
        code: c.code, shopName: c.shopName, businessType: c.businessType, groupKey: c.groupKey,
        ownerName: c.ownerName, phone: c.phone, taxId: c.taxId, address: c.address,
        territory: c.territory?.code ?? null, creditLimitRls: c.creditLimitRls, creditDays: c.creditDays, status: c.status,
      }))
    },
    async jsonExport() {
      return db.customer.findMany({ include: { territory: true, branches: true }, orderBy: { code: 'asc' } })
    },
    importRow: importCustomer,
  },
  products: {
    key: 'products',
    label: 'محصولات',
    columns: PRODUCT_COLUMNS,
    async exportRows() {
      const rows = await db.product.findMany({
        include: { brand: true, category: true },
        orderBy: { sku: 'asc' },
      })
      return rows.map(p => ({
        sku: p.sku, name: p.name, description: p.description,
        brand: p.brand?.name ?? null, category: p.category?.name ?? null,
        imageUrl: p.imageUrl, baseUnitName: p.baseUnitName,
        weightG: p.weightG, volumeMl: p.volumeMl, packagingType: p.packagingType,
        minOrderQtyBase: p.minOrderQtyBase, orderMultipleBase: p.orderMultipleBase,
        reorderPointBase: p.reorderPointBase, isActive: p.isActive,
      }))
    },
    async jsonExport() {
      return db.product.findMany({
        include: { brand: { select: { name: true } }, category: { select: { name: true } }, units: true, prices: true },
        orderBy: { sku: 'asc' },
      })
    },
    importRow: importProduct,
  },
  suppliers: {
    key: 'suppliers',
    label: 'تأمین‌کنندگان',
    columns: SUPPLIER_COLUMNS,
    async exportRows() {
      const rows = await db.supplier.findMany({ orderBy: { code: 'asc' } })
      return rows.map(s => ({
        code: s.code, name: s.name, type: s.type, phone: s.phone,
        contactName: s.contactName, address: s.address, terms: s.terms, status: s.status,
      }))
    },
    async jsonExport() {
      return db.supplier.findMany({ orderBy: { code: 'asc' } })
    },
    importRow: importSupplier,
  },
  orders: {
    key: 'orders',
    label: 'سفارش‌ها',
    exportOnly: true,
    columns: [
      { field: 'orderNo', label: 'شماره سفارش', type: 'string' },
      { field: 'customerCode', label: 'کد مشتری', type: 'string' },
      { field: 'customerName', label: 'نام مشتری', type: 'string' },
      { field: 'status', label: 'وضعیت', type: 'string' },
      { field: 'payMethod', label: 'روش پرداخت', type: 'string' },
      { field: 'totalRls', label: 'مبلغ کل (ریال)', type: 'number' },
      { field: 'discountTotalRls', label: 'تخفیف کل (ریال)', type: 'number' },
      { field: 'itemsCountBase', label: 'تعداد اقلام پایه', type: 'number' },
      { field: 'createdAt', label: 'تاریخ ثبت', type: 'string' },
    ],
    async exportRows() {
      const rows = await db.order.findMany({ include: { customer: true }, orderBy: { createdAt: 'desc' } })
      return rows.map(o => ({
        orderNo: o.orderNo, customerCode: o.customer.code, customerName: o.customer.shopName,
        status: o.status, payMethod: o.payMethod, totalRls: o.totalRls,
        discountTotalRls: o.discountTotalRls, itemsCountBase: o.itemsCountBase,
        createdAt: o.createdAt.toISOString(),
      }))
    },
    async jsonExport() {
      return db.order.findMany({ include: { items: true, customer: { select: { code: true, shopName: true } } }, orderBy: { createdAt: 'desc' } })
    },
  },
  settings: {
    key: 'settings',
    label: 'تنظیمات سیستمی',
    columns: SETTINGS_COLUMNS,
    async exportRows() {
      const rows = await db.setting.findMany({ orderBy: { key: 'asc' } })
      return rows.map(s => ({ key: s.key, value: s.value }))
    },
    async jsonExport() {
      return db.setting.findMany({ orderBy: { key: 'asc' } })
    },
    importRow: async (row, ctx) => importSetting(row),
  },
}

export function getDataset(key: string): Dataset | null {
  return DATASETS[key] ?? null
}

export function datasetList(): Array<{ key: string; label: string; exportOnly: boolean; columns: DatasetColumn[] }> {
  return Object.values(DATASETS).map(d => ({ key: d.key, label: d.label, exportOnly: Boolean(d.exportOnly), columns: d.columns }))
}
