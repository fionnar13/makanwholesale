// خروجی داده — دانلود مستقیم در فرمت CSV/XLSX/JSON/TS
// پارامترها: datasets=customers,products (یا تک) و format
import { NextRequest, NextResponse } from 'next/server'
import { ApiError, handler, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { DATASETS } from '@/lib/integrations/datasets'
import { exportFiles, type ExportFormat } from '@/lib/integrations/exporters'

const FORMATS: ExportFormat[] = ['CSV', 'XLSX', 'JSON', 'TS']

export async function GET(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const url = new URL(req.url)
    const datasetsRaw = url.searchParams.get('datasets') ?? 'customers'
    const formatRaw = (url.searchParams.get('format') ?? 'XLSX').toUpperCase()

    const datasetKeys = datasetsRaw.split(',').map(s => s.trim()).filter(Boolean)
    if (datasetKeys.length === 0) throw new ApiError(400, 'BAD_DATASETS', 'حداقل یک دیتاست را انتخاب کنید')
    const invalid = datasetKeys.filter(k => !DATASETS[k])
    if (invalid.length > 0) throw new ApiError(400, 'BAD_DATASET', `دیتاست ناشناخته: ${invalid.join('، ')}`)
    if (!FORMATS.includes(formatRaw as ExportFormat)) {
      throw new ApiError(400, 'BAD_FORMAT', 'فرمت پشتیبانی نمی‌شود (CSV، XLSX، JSON، TS)')
    }

    const files = await exportFiles(datasetKeys, formatRaw as ExportFormat)
    await audit({
      userId: user.id, action: 'integration.export', entityType: 'Dataset', entityId: datasetKeys.join(','),
      after: { format: formatRaw, count: files.length }, ip: clientIp(req),
    })

    // چند فایل (CSV چند دیتاست) → ZIP نداریم؛ اولین فایل + فهرست در هدر برای درخواست‌های بعدی
    const f = files[0]
    const body = Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body, 'utf8')
    const headers: Record<string, string> = {
      'content-type': f.contentType,
      'content-disposition': `attachment; filename="${encodeURIComponent(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'x-export-file-count': String(files.length),
    }
    if (files.length > 1) {
      headers['x-export-other-files'] = encodeURIComponent(files.slice(1).map(x => x.name).join('|'))
    }
    return new NextResponse(new Uint8Array(body), { headers })
  })
}
