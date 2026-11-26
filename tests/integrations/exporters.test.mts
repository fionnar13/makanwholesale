// تست خروجی‌ها — CSV / XLSX / JSON / TS
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'

const { toCSV, toTS, toXLSX, toJSON } = await import('../../src/lib/integrations/exporters.ts')

const columns = [
  { field: 'code', label: 'کد مشتری' },
  { field: 'name', label: 'نام فروشگاه' },
  { field: 'total', label: 'مبلغ' },
]
const rows = [
  { code: 'CUS-1001', name: 'سوپرمارکت کاوه', total: 1200000 },
  { code: 'CUS-1002', name: 'خواربارفروشی "سحر"، مرکزی', total: 95000 },
]

test('CSV — header فارسی، BOM، escape درست با نقل‌قول و کاما', () => {
  const csv = toCSV(rows, columns)
  assert.ok(csv.startsWith('\uFEFF'), 'BOM برای اکسل فارسی لازم است')
  assert.ok(csv.includes('کد مشتری,نام فروشگاه,مبلغ'))
  assert.ok(csv.includes('"خواربارفروشی ""سحر"""، مرکزی"') === false, 'نقل‌قول دوتایی صحیح')
  assert.ok(csv.includes('"خواربارفروشی ""سحر""، مرکزی"'), 'فیلد دارای کاما و نقل‌قول باید escape شود')
  const lines = csv.split('\r\n').filter(l => l !== '')
  assert.equal(lines.length, 3, 'سطر سربرگ + دو سطر داده')
})

test('TS — تایپ و مقدار تولید می‌شود', () => {
  const ts = toTS([{ dataset: { key: 'customers', label: 'مشتریان', columns: [], exportRows: async () => [], jsonExport: async () => null }, rows }])
  assert.ok(ts.includes('export type Customers'))
  assert.ok(ts.includes('export const customers: Customers[]'))
  assert.ok(ts.includes('سوپرمارکت کاوه'))
})

test('JSON — meta و ساختار دیتاست', () => {
  const json = JSON.parse(toJSON(
    [{ dataset: { key: 'customers', label: 'مشتریان', columns: [], exportRows: async () => [], jsonExport: async () => null }, rows, flat: rows }],
    { datasets: ['customers'] },
  ))
  assert.equal(json.meta.datasets[0], 'customers')
  assert.ok(json.meta.exportedAt)
  assert.ok(Array.isArray(json.customers.rows))
  assert.equal(json.customers.rows[0].name, 'سوپرمارکت کاوه')
})

test('XLSX — فایل معتبر با شیت فارسی و داده', async () => {
  const ds = { key: 'customers', label: 'مشتریان', columns, exportRows: async () => [], jsonExport: async () => null }
  const buf = await toXLSX([{ dataset: ds, rows }])
  assert.ok(buf.length > 500)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer)
  assert.equal(wb.worksheets.length, 1)
  const ws = wb.worksheets[0]
  assert.equal(ws.rowCount, 3)
  assert.equal(ws.getRow(1).getCell(1).value, 'کد مشتری')
  assert.equal(ws.getRow(2).getCell(1).value, 'CUS-1001')
})
