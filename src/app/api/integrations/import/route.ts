// ورود داده — آپلود فایل CSV/XLSX/JSON
// mode=preview → فقط تجزیه و اعتبارسنجی + پیش‌نمایش (بدون نوشتن)
// mode=apply   → اعمال نهایی سطرهای معتبر (upsert)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, handler, ok, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { DATASETS } from '@/lib/integrations/datasets'
import { parseImportFile, applyImport } from '@/lib/integrations/importers'
import { integrationLog } from '@/lib/integrations/logs'

const MAX_FILE_BYTES = 10 * 1024 * 1024 // ۱۰ مگابایت

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')

    const form = await req.formData().catch(() => null)
    if (!form) throw new ApiError(400, 'BAD_FORM', 'فایل multipart ارسال نشده است')
    const file = form.get('file')
    if (!(file instanceof File)) throw new ApiError(400, 'NO_FILE', 'فایلی پیوست نشده است')
    if (file.size > MAX_FILE_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE', 'حجم فایل بیش از ۱۰ مگابایت است')

    const datasetKey = String(form.get('dataset') ?? '')
    if (!DATASETS[datasetKey]) throw new ApiError(400, 'BAD_DATASET', 'دیتاست شناخته‌شده نیست')
    const modeRaw = z.enum(['preview', 'apply']).safeParse(String(form.get('mode') ?? 'preview'))
    if (!modeRaw.success) throw new ApiError(400, 'BAD_MODE', 'حالت باید preview یا apply باشد')
    const mode = modeRaw.data

    if (DATASETS[datasetKey].exportOnly) {
      throw new ApiError(400, 'EXPORT_ONLY', `دیتاست «${DATASETS[datasetKey].label}» فقط خروجی دارد و ورود داده پشتیبانی نمی‌شود`)
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const parsed = await parseImportFile({ name: file.name, body: buf }, datasetKey)

    if (mode === 'preview') {
      return ok({
        dataset: datasetKey,
        format: parsed.format,
        totalRows: parsed.totalRows,
        validCount: parsed.validCount,
        errorCount: parsed.errorCount,
        // پیش‌نمایش ۱۰ سطر اول معتبر + همه خطاها (تا ۵۰)
        sample: parsed.rows.filter(r => r.errors.length === 0).slice(0, 10).map(r => r.row),
        errors: parsed.rows.flatMap((r, i) => r.errors.map(e => ({ row: i + 1, field: e.field, message: e.message }))).slice(0, 50),
      })
    }

    const result = await applyImport(parsed, datasetKey, { userId: user.id })
    await audit({
      userId: user.id, action: 'integration.import', entityType: 'Dataset', entityId: datasetKey,
      after: { file: file.name, created: result.created, updated: result.updated, failed: result.failed },
      ip: clientIp(req),
    })
    await integrationLog('sheets', `FILE_IMPORT_${datasetKey}`, {
      message: `ورود فایل ${file.name}: ${result.created} جدید، ${result.updated} به‌روزرسانی، ${result.failed} ناموفق`,
    })
    return ok({ dataset: datasetKey, ...result })
  })
}
