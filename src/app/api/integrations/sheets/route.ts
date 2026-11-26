// Google Sheets — پیکربندی (GET/PUT) و عملیات (POST: test | sync-export | sync-import-preview | sync-import-apply)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, handler, ok, parseBody, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getConfig, getConfigView, saveConfig } from '@/lib/integrations/config'
import { validateServiceAccountJson, serviceAccountEmail } from '@/lib/integrations/google'
import { syncDatasetToSheets, previewSheetImport, applySheetImport, testSheetsConnection } from '@/lib/integrations/sheets-sync'
import { DATASETS } from '@/lib/integrations/datasets'

export async function GET(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'users.manage')
    return ok(await getConfigView('sheets'))
  })
}

const saveSchema = z.object({
  serviceAccountJson: z.string().max(100_000).nullable().optional(),
  spreadsheetId: z.string().max(200).optional(),
  sheetName: z.string().max(100).optional(),
  syncIntervalMinutes: z.number().int().min(0).max(10080).optional(),
  mappings: z.record(z.string(), z.record(z.string(), z.string())).optional(),
})

export async function PUT(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, saveSchema)

    if (body.serviceAccountJson) {
      const check = validateServiceAccountJson(body.serviceAccountJson)
      if (!check.ok) throw new ApiError(400, 'BAD_SERVICE_ACCOUNT', check.error)
    }

    const patch: Record<string, unknown> = { ...body }
    if (body.serviceAccountJson) patch.serviceAccountEmail = serviceAccountEmail(body.serviceAccountJson)
    if (body.syncIntervalMinutes) {
      // زمان همگام‌سازی بعدی — فوراً پس از ذخیره برنامه‌ریزی می‌شود
      patch.nextSyncAt = new Date(Date.now() + body.syncIntervalMinutes * 60_000).toISOString()
    }

    await saveConfig('sheets', patch)
    await audit({
      userId: user.id, action: 'integration.sheets.save', entityType: 'IntegrationConfig', entityId: 'sheets',
      after: { spreadsheetId: body.spreadsheetId ?? undefined, sheetName: body.sheetName ?? undefined, serviceAccountChanged: body.serviceAccountJson ? true : undefined },
      ip: clientIp(req),
    })
    return ok(await getConfigView('sheets'))
  })
}

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, z.object({
      action: z.enum(['test', 'sync-export', 'sync-import-preview', 'sync-import-apply']),
      dataset: z.string().optional(),
    }))
    const ds = body.dataset ?? ''
    if (['sync-export', 'sync-import-preview', 'sync-import-apply'].includes(body.action) && !DATASETS[ds]) {
      throw new ApiError(400, 'BAD_DATASET', 'دیتاست شناخته‌شده نیست')
    }

    switch (body.action) {
      case 'test': {
        const res = await testSheetsConnection()
        return ok(res)
      }
      case 'sync-export': {
        const res = await syncDatasetToSheets(ds, 'WRITE')
        await audit({ userId: user.id, action: 'integration.sheets.export', entityType: 'Dataset', entityId: ds, after: { rows: res.rows }, ip: clientIp(req) })
        return ok(res)
      }
      case 'sync-import-preview': {
        const res = await previewSheetImport(ds)
        return ok({
          dataset: ds,
          headers: res.headers,
          mapped: res.mapping,
          validRows: res.rows.length,
          errors: res.errors.slice(0, 50),
          sample: res.rows.slice(0, 10),
        })
      }
      case 'sync-import-apply': {
        const res = await applySheetImport(ds, { userId: user.id })
        await audit({ userId: user.id, action: 'integration.sheets.import', entityType: 'Dataset', entityId: ds, after: { rows: res.rows }, ip: clientIp(req) })
        return ok(res)
      }
    }
  })
}
