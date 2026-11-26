// بکاپ — تنظیمات (GET/PUT) و اجرای دستی (POST action=run)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, handler, ok, parseBody, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getConfig, getConfigView, saveConfig } from '@/lib/integrations/config'
import { DATASETS } from '@/lib/integrations/datasets'
import { runBackup } from '@/lib/integrations/backup'
import { rescheduleBackup } from '@/lib/integrations/scheduler'

export async function GET(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'users.manage')
    const cfg = await getConfigView('backup')
    const runs = await db.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 })
    return ok({
      config: cfg,
      runs: runs.map(r => ({
        id: r.id, status: r.status, trigger: r.trigger, format: r.format,
        scope: JSON.parse(r.scopeJson || '[]'), fileCount: r.fileCount, sizeBytes: r.sizeBytes,
        message: r.message, durationMs: r.durationMs, startedAt: r.startedAt.toISOString(),
        files: r.driveLinksJson ? JSON.parse(r.driveLinksJson) : null,
      })),
    })
  })
}

const saveSchema = z.object({
  enabled: z.boolean().optional(),
  format: z.enum(['JSON', 'CSV', 'XLSX', 'TS']).optional(),
  interval: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  datasets: z.array(z.string()).max(20).optional(),
  retentionCount: z.number().int().min(1).max(100).optional(),
})

export async function PUT(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, saveSchema)

    if (body.datasets) {
      const invalid = body.datasets.filter(k => !DATASETS[k])
      if (invalid.length > 0) throw new ApiError(400, 'BAD_DATASET', `دیتاست ناشناخته: ${invalid.join('، ')}`)
    }

    await saveConfig('backup', body)
    const nextRunAt = await rescheduleBackup()
    await audit({
      userId: user.id, action: 'integration.backup.save', entityType: 'IntegrationConfig', entityId: 'backup',
      after: body, ip: clientIp(req),
    })
    return ok({ ...(await getConfigView('backup')), nextRunAt })
  })
}

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, z.object({ action: z.literal('run') }))
    if (body.action !== 'run') throw new ApiError(400, 'BAD_ACTION', 'عملیات پشتیبانی نمی‌شود')

    const result = await runBackup({ trigger: 'MANUAL', userId: user.id })
    await audit({
      userId: user.id, action: 'integration.backup.run', entityType: 'BackupRun', entityId: result.runId,
      after: { status: result.status, files: result.fileCount }, ip: clientIp(req),
    })
    return ok(result)
  })
}
