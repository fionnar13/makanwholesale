// تولید خروجی در فرمت‌های CSV / XLSX / JSON / TypeScript از دیتاست‌های سامانه
import ExcelJS from 'exceljs'
import { getDataset, type Dataset, type DatasetRow } from './datasets'

export type ExportFormat = 'CSV' | 'XLSX' | 'JSON' | 'TS'

export type ExportFile = {
  name: string
  contentType: string
  body: Buffer | string
}

const ts = (n: number) => String(n).padStart(2, '0')

export function exportFileName(datasets: string[], format: ExportFormat): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${ts(d.getMonth() + 1)}${ts(d.getDate())}-${ts(d.getHours())}${ts(d.getMinutes())}`
  const base = datasets.length === 1 ? datasets[0] : `makan-${datasets.join('_')}`
  const ext = format === 'CSV' ? 'csv' : format === 'XLSX' ? 'xlsx' : format === 'JSON' ? 'json' : 'ts'
  return `${base}-${stamp}.${ext}`
}

// ── CSV (RFC 4180 + BOM برای سازگاری با اکسل فارسی) ──

function csvEscape(v: string | number | boolean | null): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCSV(rows: DatasetRow[], columns: Array<{ label: string; field: string }>): string {
  const header = columns.map(c => c.label).join(',')
  const lines = rows.map(r => columns.map(c => csvEscape(r[c.field] ?? '')).join(','))
  return '\uFEFF' + header + '\r\n' + lines.join('\r\n') + '\r\n'
}

// ── JSON (بکاپ کامل ساختاریافته) ──

export function toJSON(datasets: Array<{ dataset: Dataset; rows: DatasetRow[] | unknown; flat?: DatasetRow[] }>, meta: Record<string, unknown>): string {
  const payload: Record<string, unknown> = {
    meta: { app: 'makan-store', exportedAt: new Date().toISOString(), ...meta },
  }
  for (const { dataset, rows, flat } of datasets) {
    payload[dataset.key] = { columns: dataset.columns.map(c => ({ field: c.field, label: c.label, type: c.type })), rows, flat: flat ?? undefined }
  }
  return JSON.stringify(payload, null, 2)
}

// ── TypeScript (خروجی typed برای استفاده در کد) ──

function tsType(t: string): string {
  return t === 'number' ? 'number' : t === 'boolean' ? 'boolean' : 'string | null'
}

export function toTS(datasets: Array<{ dataset: Dataset; rows: DatasetRow[] }>): string {
  const parts: string[] = [
    '// خروجی خودکار سامانه بنکداری هوشمند — تولیدشده با داده‌های واقعی دیتابیس',
    `// تاریخ: ${new Date().toISOString()}`,
    '// برای استفاده: import { customers } from "@/data/export"',
    '',
  ]
  for (const { dataset, rows } of datasets) {
    const typeName = dataset.key[0].toUpperCase() + dataset.key.slice(1)
    parts.push(`export type ${typeName} = {`)
    for (const c of dataset.columns) {
      parts.push(`  /** ${c.label} */`)
      parts.push(`  ${c.field}: ${tsType(c.type)}`)
    }
    parts.push('}')
    parts.push('')
    parts.push(`export const ${dataset.key}: ${typeName}[] = ${JSON.stringify(rows, null, 2)}`)
    parts.push('')
  }
  return parts.join('\n')
}

// ── XLSX (هر دیتاست یک شیت — مناسب کاربر غیرفنی) ──

async function rowsToSheet(ws: ExcelJS.Worksheet, rows: DatasetRow[], columns: Array<{ label: string; field: string }>): Promise<void> {
  const headerRow = ws.addRow(columns.map(c => c.label))
  headerRow.font = { bold: true }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EE' } }
  for (const r of rows) {
    ws.addRow(columns.map(c => {
      const v = r[c.field]
      return v === null || v === undefined ? '' : v
    }))
  }
  // عرض ستون‌ها بر اساس طول داده‌ها — بدون وابستگی به getter columns
  columns.forEach((c, i) => {
    let max = c.label.length + 4
    for (const r of rows) max = Math.max(max, String(r[c.field] ?? '').length + 2)
    ws.getColumn(i + 1).width = Math.min(max, 46)
  })
}

export async function toXLSX(datasets: Array<{ dataset: Dataset; rows: DatasetRow[] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'makan-store'
  wb.created = new Date()
  for (const { dataset, rows } of datasets) {
    const ws = wb.addWorksheet(dataset.label.slice(0, 30))
    await rowsToSheet(ws, rows, dataset.columns)
  }
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}

// ── نقطه ورود عمومی خروجی ──

export async function exportFiles(datasetKeys: string[], format: ExportFormat): Promise<ExportFile[]> {
  const name = exportFileName(datasetKeys, format)
  if (format === 'JSON') {
    const parts: Array<{ dataset: Dataset; rows: unknown; flat?: DatasetRow[] }> = []
    for (const key of datasetKeys) {
      const ds = getDataset(key)
      if (!ds) continue
      const rows = await ds.jsonExport()
      parts.push({ dataset: ds, rows, flat: await ds.exportRows() })
    }
    return [{ name, contentType: 'application/json; charset=utf-8', body: toJSON(parts, { datasets: datasetKeys, format }) }]
  }

  const parts: Array<{ dataset: Dataset; rows: DatasetRow[] }> = []
  for (const key of datasetKeys) {
    const ds = getDataset(key)
    if (!ds) continue
    parts.push({ dataset: ds, rows: await ds.exportRows() })
  }

  if (format === 'CSV') {
    // CSV تک‌فایلی فقط برای یک دیتاست معنا دارد؛ چند دیتاست = چند فایل
    return parts.map(p => ({
      name: exportFileName([p.dataset.key], 'CSV'),
      contentType: 'text/csv; charset=utf-8',
      body: toCSV(p.rows, p.dataset.columns),
    }))
  }
  if (format === 'TS') {
    return [{ name, contentType: 'text/plain; charset=utf-8', body: toTS(parts) }]
  }
  const buf = await toXLSX(parts)
  return [{ name, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: buf }]
}
