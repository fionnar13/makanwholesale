// همگام‌سازی Google Sheets — نوشتن داده‌های سامانه در شیت و ورود داده از شیت با نگاشت ستون‌ها
// اتصال فقط با Service Account است؛ کاربر ایمیل سرویس‌اکانت را در اشتراک‌گذاری فایل Editor می‌کند
import { getConfig, saveConfig, type SheetsConfig } from './config'
import { DATASETS, getDataset } from './datasets'
import { getServiceAccountToken, sheetsGetValues, sheetsWriteValues, sheetsCheckAccess } from './google'
import { integrationLog } from './logs'
import { emitTelegramEvent } from './telegram'

async function sheetsToken(cfg: SheetsConfig): Promise<string> {
  if (!cfg.serviceAccountJson) throw new Error('فایل Service Account تنظیم نشده است')
  return getServiceAccountToken(cfg.serviceAccountJson, ['https://www.googleapis.com/auth/spreadsheets'])
}

function requireSpreadsheet(cfg: SheetsConfig): string {
  const id = cfg.spreadsheetId.trim()
  if (!id) throw new Error('شناسه Spreadsheet تنظیم نشده است')
  return id
}

export type SyncResult = {
  dataset: string
  direction: 'EXPORT' | 'IMPORT'
  rows: number
  errors: Array<{ row: number; message: string }>
  message: string
}

/** نوشتن دیتاست در Google Sheets — نگاشت فیلد سامانه → ستون شیت از تنظیمات خوانده می‌شود */
export async function syncDatasetToSheets(datasetKey: string, mode: 'WRITE' | 'APPEND' = 'WRITE'): Promise<SyncResult> {
  const cfg = await getConfig('sheets')
  const ds = getDataset(datasetKey)
  if (!ds) throw new Error('دیتاست شناخته‌شده نیست')
  const spreadsheetId = requireSpreadsheet(cfg)
  const token = await sheetsToken(cfg)

  // نگاشت پیش‌فرض: نام ستون = برچسب فارسی فیلد
  const mapping = cfg.mappings[datasetKey] ?? Object.fromEntries(ds.columns.map(c => [c.field, c.label]))
  const usedFields = ds.columns.filter(c => mapping[c.field]?.trim())
  if (usedFields.length === 0) throw new Error('نگاشت فیلدها خالی است — حداقل یک فیلد را نگاشت کنید')

  const header = usedFields.map(c => mapping[c.field].trim())
  const rows = await ds.exportRows()
  const values = rows.map(r => usedFields.map(c => {
    const v = r[c.field]
    return v === null || v === undefined ? '' : String(v)
  }))
  const range = `${cfg.sheetName.trim() || 'Sheet1'}!A1`
  const payload = [header, ...values]
  const updated = await sheetsWriteValues(token, spreadsheetId, range, payload, mode)

  await integrationLog('sheets', `EXPORT_${datasetKey}`, { message: `${rows.length} سطر به Google Sheets نوشته شد`, data: { mode, updated } })
  return {
    dataset: ds.label,
    direction: 'EXPORT',
    rows: rows.length,
    errors: [],
    message: `${rows.length} سطر با موفقیت در شیت نوشته شد`,
  }
}

/** خواندن داده از Google Sheets و اعتبارسنجی — بدون نوشتن (پیش‌نمایش) */
export async function previewSheetImport(datasetKey: string): Promise<{
  headers: string[]
  rows: Array<Record<string, unknown>>
  mapping: Record<string, string>
  errors: Array<{ row: number; message: string }>
}> {
  const cfg = await getConfig('sheets')
  const ds = getDataset(datasetKey)
  if (!ds?.importRow) throw new Error('ورود داده از شیت برای این دیتاست پشتیبانی نمی‌شود')
  const spreadsheetId = requireSpreadsheet(cfg)
  const token = await sheetsToken(cfg)

  const range = `${cfg.sheetName.trim() || 'Sheet1'}!A:ZZ`
  const values = await sheetsGetValues(token, spreadsheetId, range)
  if (values.length === 0) throw new Error('شیت خالی است')

  const sheetHeaders = values[0].map(h => String(h).trim())
  // نگاشت نام ستون شیت → فیلد سامانه (پیش‌فرض: برچسب فارسی)
  const labelToField = Object.fromEntries(ds.columns.map(c => [c.label, c.field]))
  const mapping: Record<string, string> = {}
  sheetHeaders.forEach(h => { if (labelToField[h]) mapping[h] = labelToField[h] })

  const errors: Array<{ row: number; message: string }> = []
  const rows: Array<Record<string, unknown>> = []
  const { coerceValue } = await import('./datasets')
  for (let i = 1; i < values.length; i++) {
    const obj: Record<string, unknown> = {}
    values[i].forEach((v, col) => {
      const field = mapping[sheetHeaders[col]]
      if (field) obj[field] = v
    })
    // اعتبارسنجی سطر با coerce — خطاها جمع می‌شوند
    let rowOk = true
    const rowErrors: string[] = []
    for (const c of ds.columns) {
      if (obj[c.field] === undefined) continue
      const res = coerceValue(c, obj[c.field])
      if (!res.ok) { rowOk = false; rowErrors.push(res.error) }
    }
    for (const c of ds.columns) {
      if (c.required && (obj[c.field] === undefined || obj[c.field] === null || obj[c.field] === '')) {
        rowOk = false
        rowErrors.push(`فیلد «${c.label}» الزامی است`)
      }
    }
    if (!rowOk) errors.push({ row: i + 1, message: rowErrors.join('؛ ') })
    else rows.push(obj)
  }
  return { headers: sheetHeaders, rows, mapping, errors }
}

/** اعمال داده خوانده‌شده از شیت — upsert سطرهای معتبر */
export async function applySheetImport(datasetKey: string, ctx: { userId?: string | null }): Promise<SyncResult> {
  const preview = await previewSheetImport(datasetKey)
  const ds = getDataset(datasetKey)!
  let created = 0, updated = 0
  for (const row of preview.rows) {
    const r = await ds.importRow!(row, ctx)
    if (r.action === 'created') created++
    if (r.action === 'updated') updated++
  }
  await integrationLog('sheets', `IMPORT_${datasetKey}`, { message: `${created + updated} سطر از Google Sheets وارد شد` })
  return {
    dataset: ds.label,
    direction: 'IMPORT',
    rows: created + updated,
    errors: preview.errors,
    message: `${created} سطر جدید و ${updated} سطر به‌روزرسانی شد${preview.errors.length ? ` — ${preview.errors.length} سطر نامعتبر نادیده گرفته شد` : ''}`,
  }
}

/** آزمایش اتصال — بررسی دسترسی سرویس‌اکانت به Spreadsheet */
export async function testSheetsConnection(): Promise<{ ok: boolean; message: string; sheets?: string[] }> {
  const cfg = await getConfig('sheets')
  if (!cfg.serviceAccountJson) return { ok: false, message: 'فایل Service Account تنظیم نشده است' }
  const id = cfg.spreadsheetId.trim()
  if (!id) return { ok: false, message: 'شناسه Spreadsheet تنظیم نشده است' }
  try {
    const token = await sheetsToken(cfg)
    const res = await sheetsCheckAccess(token, id)
    if (!res.ok) return { ok: false, message: res.error }
    return { ok: true, message: `اتصال موفق — فایل «${res.title}» با ${res.sheets.length} تب`, sheets: res.sheets }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'خطای ناشناخته' }
  }
}

// ── همگام‌سازی خودکار (اسکجولر) ──

export async function runSheetsAutoSync(): Promise<void> {
  const cfg = await getConfig('sheets')
  if (cfg.syncIntervalMinutes <= 0 || !cfg.serviceAccountJson || !cfg.spreadsheetId.trim()) return
  const autoSyncDatasets = Object.keys(DATASETS).filter(k => !DATASETS[k].exportOnly)
  for (const key of autoSyncDatasets) {
    if (!cfg.mappings[key] || Object.keys(cfg.mappings[key]).length === 0) continue // فقط دیتاست‌های نگاشت‌شده
    try {
      await syncDatasetToSheets(key, 'WRITE')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'خطای ناشناخته'
      await integrationLog('sheets', 'AUTO_SYNC_FAILED', { level: 'ERROR', message, data: { dataset: key } })
      await emitTelegramEvent('SHEETS_SYNC_ERROR', { error: message.slice(0, 200) })
    }
  }
  await saveConfig('sheets', { nextSyncAt: new Date(Date.now() + cfg.syncIntervalMinutes * 60_000).toISOString() })
}
