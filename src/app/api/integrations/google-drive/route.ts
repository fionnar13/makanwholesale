// پیکربندی Google Drive — ذخیره تنظیمات، آزمایش اتصال و قطع اتصال
// دو حالت: oauth (حساب شخصی متصل‌شده) و service (Service Account)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, handler, ok, parseBody, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getConfig, getConfigView, saveConfig, resetConfig } from '@/lib/integrations/config'
import { validateServiceAccountJson, serviceAccountEmail, driveListBackups, getValidAccessToken, getServiceAccountToken } from '@/lib/integrations/google'
import { integrationLog } from '@/lib/integrations/logs'

export async function GET(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'users.manage')
    const view = await getConfigView('google')
    return ok(view)
  })
}

const saveSchema = z.object({
  mode: z.enum(['oauth', 'service']),
  serviceAccountJson: z.string().max(100_000).nullable().optional(),
  folderId: z.string().max(200).nullable().optional(),
  retentionCount: z.number().int().min(1).max(100).optional(),
})

export async function PUT(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, saveSchema)

    if (body.serviceAccountJson) {
      const check = validateServiceAccountJson(body.serviceAccountJson)
      if (!check.ok) throw new ApiError(400, 'BAD_SERVICE_ACCOUNT', check.error)
    }

    const patch: Record<string, unknown> = { mode: body.mode }
    if (body.serviceAccountJson !== undefined) patch.serviceAccountJson = body.serviceAccountJson
    if (body.folderId !== undefined) patch.folderId = body.folderId
    if (body.retentionCount !== undefined) patch.retentionCount = body.retentionCount
    if (body.serviceAccountJson) patch.serviceAccountEmail = serviceAccountEmail(body.serviceAccountJson)

    await saveConfig('google', patch)
    await audit({
      userId: user.id, action: 'integration.google.save', entityType: 'IntegrationConfig', entityId: 'google',
      after: { mode: body.mode, folderId: body.folderId ?? null, serviceAccountChanged: body.serviceAccountJson ? true : undefined },
      ip: clientIp(req),
    })
    await integrationLog('google', 'CONFIG_SAVED', { message: 'تنظیمات Google Drive ذخیره شد', data: { mode: body.mode } })
    return ok(await getConfigView('google'))
  })
}

// POST — action: test | disconnect | set-backup-target
export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, z.object({
      action: z.enum(['test', 'disconnect', 'set-backup-target']),
      accountId: z.string().max(100).optional(),
    }))

    if (body.action === 'set-backup-target') {
      if (!body.accountId) throw new ApiError(400, 'NO_ACCOUNT', 'شناسه حساب لازم است')
      const account = await db.googleAccount.findUnique({ where: { id: body.accountId } })
      if (!account) throw new ApiError(404, 'NOT_FOUND', 'حساب یافت نشد')
      await db.googleAccount.updateMany({ data: { isBackupTarget: false } })
      await db.googleAccount.update({ where: { id: account.id }, data: { isBackupTarget: true } })
      await saveConfig('google', { mode: 'oauth' })
      await audit({
        userId: user.id, action: 'integration.google.setBackupTarget', entityType: 'GoogleAccount', entityId: account.email,
        ip: clientIp(req),
      })
      return ok({ ok: true, message: `حساب ${account.email} مقصد بکاپ شد` })
    }

    if (body.action === 'test') {
      const cfg = await getConfig('google')
      try {
        let token: string
        let who: string
        if (cfg.mode === 'service') {
          if (!cfg.serviceAccountJson) throw new ApiError(400, 'NOT_CONFIGURED', 'فایل Service Account تنظیم نشده است')
          token = await getServiceAccountToken(cfg.serviceAccountJson, ['https://www.googleapis.com/auth/drive.file'])
          who = cfg.serviceAccountEmail ?? 'service-account'
        } else {
          const account = await db.googleAccount.findFirst({ where: { isBackupTarget: true, isActive: true } })
            ?? await db.googleAccount.findFirst({ where: { isActive: true } })
          if (!account) throw new ApiError(400, 'NOT_CONNECTED', 'حساب شخصی گوگلی متصل نیست — از دکمه «اتصال حساب Google» استفاده کنید')
          token = await getValidAccessToken(account)
          who = account.email
        }
        const files = await driveListBackups(token, cfg.folderId?.trim() || null)
        await integrationLog('google', 'TEST_OK', { message: `اتصال موفق (${who}) — ${files.length} فایل بکاپ موجود` })
        return ok({ ok: true, message: `اتصال موفق — حساب ${who}؛ ${files.length} فایل بکاپ در مقصد موجود است` })
      } catch (e) {
        const message = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'خطای ناشناخته')
        await integrationLog('google', 'TEST_FAILED', { level: 'ERROR', message })
        return ok({ ok: false, message })
      }
    }

    // disconnect — حذف کامل حساب‌ها و پاک‌سازی پیکربندی حساس
    await db.googleAccount.deleteMany({})
    await resetConfig('google')
    await audit({ userId: user.id, action: 'integration.google.disconnect', entityType: 'IntegrationConfig', entityId: 'google', ip: clientIp(req) })
    await integrationLog('google', 'DISCONNECTED', { message: 'اتصال گوگل قطع و داده‌های حساس حذف شد' })
    return ok({ ok: true, message: 'اتصال گوگل قطع شد و همه توکن‌ها حذف شدند' })
  })
}
