// ورود داده — تجزیه فایل CSV/XLSX/JSON، اعتبارسنجی و پیش‌نمایش، سپس اعمال نهایی
// جریان کاربر: آپلود فایل → پیش‌نمایش + خطاها → تأیید → اعمال (upsert)
import ExcelJS from 'exceljs'
import { getDataset, coerceValue, type DatasetRow } from './datasets'

export type ParsedRow = { row: Record<string, unknown>; errors: Array<{ field: string; message: string }> }
export type ParseResult = {
  format: string
  rows: ParsedRow[]
  totalRows: number
  validCount: number
  errorCount: number
}

const MAX_IMPORT_ROWS = 2000

// نگاشت برچسب فارسی ↔ نام فیلد انگلیسی — هر دو به‌عنوان ستون پذیرفته می‌شوند
function buildHeaderMap(datasetKey: string): Map<string, string> {
  const ds = getDataset(datasetKey)
  const map = new Map<string, string>()
  if (!ds) return map
  for (const c of ds.columns) {
    map.set(c.label.trim(), c.field)
    map.set(c.field.toLowerCase(), c.field)
  }
  return map
}

export async function parseImportFile(file: { name: string; body: Buffer }, datasetKey: string): Promise<ParseResult> {
  const headerMap = buildHeaderMap(datasetKey)
  const lower = file.name.toLowerCase()
  const buf = file.body
  let rawRows: Array<Record<string, unknown>> = []
  let format = 'CSV'

  if (lower.endsWith('.json')) {
    format = 'JSON'
    const json = JSON.parse(file.body.toString('utf8'))
    if (Array.isArray(json)) {
      rawRows = json as Array<Record<string, unknown>>
    } else if (json && typeof json === 'object' && datasetKey in json) {
      // خروجی JSON سامانه (بکاپ کامل) — ساختار { datasetKey: { rows: [...] } } یا { datasetKey: [...] }
      const dsData = (json as Record<string, unknown>)[datasetKey]
      if (Array.isArray(dsData)) rawRows = dsData as Array<Record<string, unknown>>
      else if (dsData && typeof dsData === 'object' && Array.isArray((dsData as { rows?: unknown[] }).rows)) {
        rawRows = (dsData as { rows: Array<Record<string, unknown>> }).rows
      } else {
        throw new Error('ساختار JSON پشتیبانی نمی‌شود؛ آرایه‌ای از ردیف‌ها یا فایل بکاپ سامانه را بارگذاری کنید')
      }
    } else {
      throw new Error('ساختار JSON پشتیبانی نمی‌شود؛ آرایه‌ای از ردیف‌ها یا فایل بکاپ سامانه را بارگذاری کنید')
    }
  } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    format = 'XLSX'
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer)
    const ws = wb.worksheets[0]
    if (!ws || ws.rowCount === 0) throw new Error('فایل اکسل خالی است')
    const headers: string[] = []
    ws.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value ?? '').trim()
    })
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const obj: Record<string, unknown> = {}
      row.eachCell((cell, colNumber) => {
        const field = headerMap.get(headers[colNumber] ?? '') ?? headers[colNumber]
        if (!field) return
        obj[field] = cell.value instanceof Date ? cell.value.toISOString() : cell.value
      })
      rawRows.push(obj)
    })
  } else {
    // CSV — بر اساس RFC 4180 با پشتیبانی نقل‌قول
    const text = file.body.toString('utf8').replace(/^\uFEFF/, '')
    const lines = parseCSV(text)
    const headers = lines[0]?.map(h => headerMap.get(h.trim()) ?? h.trim()) ?? []
    rawRows = lines.slice(1).map(cells => {
      const obj: Record<string, unknown> = {}
      cells.forEach((v, i) => { if (headers[i]) obj[headers[i]] = v })
      return obj
    })
  }

  return validateRows(rawRows, datasetKey, format)
}

// تجزیه CSV سازگار با RFC 4180 (نقل‌قول، کامای داخل فیلد، CRLF)
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  row.push(field)
  rows.push(row)
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
}

// اعتبارسنجی سطرها بر اساس تعریف دیتاست — هیچ نوشتن انجام نمی‌شود
export function validateRows(rawRows: Array<Record<string, unknown>>, datasetKey: string, format: string): ParseResult {
  const ds = getDataset(datasetKey)
  if (!ds) throw new Error('دیتاست شناخته‌شده نیست')
  if (!ds.importRow) throw new Error(`دیتاست «${ds.label}» فقط خروجی دارد و ورود داده پشتیبانی نمی‌شود`)
  if (rawRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`حداکثر ${MAX_IMPORT_ROWS} سطر در هر بار ورود داده مجاز است`)
  }

  const rows: ParsedRow[] = rawRows.map(raw => {
    const errors: Array<{ field: string; message: string }> = []
    const clean: Record<string, unknown> = {}
    for (const col of ds.columns) {
      if (col.importable === false) continue
      const res = coerceValue(col, raw[col.field])
      if (!res.ok) {
        errors.push({ field: col.field, message: res.error })
      } else if (res.value !== null) {
        clean[col.field] = res.value
      } else if (col.type === 'string' && !col.required) {
        clean[col.field] = null
      }
    }
    return { row: clean, errors }
  })

  return {
    format,
    rows,
    totalRows: rows.length,
    validCount: rows.filter(r => r.errors.length === 0).length,
    errorCount: rows.filter(r => r.errors.length > 0).length,
  }
}

// اعمال نهایی — فقط سطرهای بدون خطا upsert می‌شوند؛ نتیجه هر سطر برمی‌گردد
export async function applyImport(parsed: ParseResult, datasetKey: string, ctx: { userId?: string | null }) {
  const ds = getDataset(datasetKey)
  if (!ds?.importRow) throw new Error('ورود داده برای این دیتاست پشتیبانی نمی‌شود')
  const results: Array<{ index: number; action: string; key: string; error?: string }> = []
  let created = 0, updated = 0, failed = 0, skipped = 0
  for (let i = 0; i < parsed.rows.length; i++) {
    const { row, errors } = parsed.rows[i]
    if (errors.length > 0) {
      failed++
      results.push({ index: i + 1, action: 'FAILED', key: String(row['code'] ?? row['sku'] ?? row['key'] ?? ''), error: errors.map(e => e.message).join('؛ ') })
      continue
    }
    try {
      const r = await ds.importRow(row, ctx)
      if (r.action === 'created') created++
      else if (r.action === 'updated') updated++
      else skipped++
      results.push({ index: i + 1, action: r.action.toUpperCase(), key: r.key })
    } catch (e) {
      failed++
      results.push({ index: i + 1, action: 'FAILED', key: '', error: e instanceof Error ? e.message : 'خطای ناشناخته' })
    }
  }
  return { created, updated, failed, skipped, results }
}

export type { DatasetRow }
