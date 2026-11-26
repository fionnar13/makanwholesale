// تست ورود داده — تجزیه CSV، اعتبارسنجی و نگاشت سربرگ فارسی/انگلیسی
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { parseCSV, validateRows } = await import('../../src/lib/integrations/importers.ts')
const { DATASETS } = await import('../../src/lib/integrations/datasets.ts')

test('parseCSV — نقل‌قول، کامای داخل فیلد و سطرهای خالی', () => {
  const text = 'a,"b,c","d""e"\n1,2,3\n\n'
  const rows = parseCSV(text)
  assert.deepEqual(rows[0], ['a', 'b,c', 'd"e'])
  assert.deepEqual(rows[1], ['1', '2', '3'])
})

test('validateRows — اعتبارسنجی مشتریان: سطر معتبر و سطر با خطا', () => {
  const raw = [
    { code: 'CUS-2001', shopName: 'فروشگاه تست', phone: '09121112233', creditLimitRls: '1500000', creditDays: '30' },
    { code: '', shopName: 'بدون کد', phone: '09120000000' },
    { code: 'CUS-2002', shopName: 'عدد نامعتبر', phone: '091222223333', creditLimitRls: 'abc' },
  ]
  const res = validateRows(raw, 'customers', 'CSV')
  assert.equal(res.totalRows, 3)
  assert.equal(res.validCount, 1)
  assert.equal(res.errorCount, 2)
  assert.ok(res.rows[0].row.creditLimitRls === 1500000, 'تبدیل رشته عددی به عدد')
})

test('validateRows — تبدیل عدد فارسی و بولین', () => {
  const raw = [{
    sku: 'PRD-1', name: 'کالا', minOrderQtyBase: '۱۲', orderMultipleBase: '6',
    isActive: 'فعال', reorderPointBase: '0',
  }]
  const res = validateRows(raw, 'products', 'CSV')
  assert.equal(res.validCount, 1)
  assert.equal(res.rows[0].row.minOrderQtyBase, 12, 'عدد فارسی ۱۲ باید ۱۲ شود')
  assert.equal(res.rows[0].row.isActive, true)
})

test('validateRows — سقف تعداد سطر', () => {
  const raw = Array.from({ length: 2001 }, (_, i) => ({ code: `CUS-X${i}`, shopName: 'x', phone: '09120000000' }))
  assert.throws(() => validateRows(raw, 'customers', 'CSV'), /۲۰۰۰|2000/)
})

test('رجیستری دیتاست‌ها — کلیدها و ستون‌های مستندشده', () => {
  const keys = Object.keys(DATASETS)
  assert.ok(keys.includes('customers') && keys.includes('products') && keys.includes('orders') && keys.includes('suppliers') && keys.includes('settings'))
  assert.equal(DATASETS.orders.exportOnly, true, 'سفارش‌ها فقط خروجی')
  const custCols = DATASETS.customers.columns
  assert.ok(custCols.some(c => c.required && c.field === 'code'))
  // هر دیتاست برچسب فارسی ستون دارد — برای کاربر غیرفنی
  for (const d of Object.values(DATASETS)) {
    for (const c of d.columns) assert.ok(c.label.length > 0, `برچسب ستون ${c.field} در ${d.key}`)
  }
})

test('نگاشت سربرگ فارسی به فیلد — buildHeaderMap', async () => {
  const { parseImportFile } = await import('../../src/lib/integrations/importers.ts')
  const header = 'کد مشتری,نام فروشگاه,تلفن\nCUS-9001,فروشگاه شیت,09110000000\n'
  const res = await parseImportFile({ name: 'customers.csv', body: Buffer.from(header, 'utf8') }, 'customers')
  assert.equal(res.validCount, 1)
  assert.equal(res.rows[0].row.code, 'CUS-9001')
})

test('ورود JSON از فایل بکاپ سامانه', async () => {
  const { parseImportFile } = await import('../../src/lib/integrations/importers.ts')
  const backup = JSON.stringify({ meta: {}, customers: { columns: [], rows: [{ code: 'CUS-J1', shopName: 'فروشگاه جیسون', phone: '09130000000' }] } })
  const res = await parseImportFile({ name: 'backup.json', body: Buffer.from(backup, 'utf8') }, 'customers')
  assert.equal(res.format, 'JSON')
  assert.equal(res.validCount, 1)
})
