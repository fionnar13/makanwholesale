// تلگرام — پیکربندی (GET/PUT) و آزمایش اتصال (POST action=test)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, parseBody, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getConfigView, saveConfig } from '@/lib/integrations/config'
import { telegramSendMessage, TELEGRAM_EVENTS, TELEGRAM_DEFAULT_TEMPLATES } from '@/lib/integrations/telegram'

export async function GET(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'users.manage')
    const view = await getConfigView('telegram')
    return ok({
      ...view,
      events: TELEGRAM_EVENTS,
      defaultTemplates: TELEGRAM_DEFAULT_TEMPLATES,
    })
  })
}

const saveSchema = z.object({
  botToken: z.string().max(200).nullable().optional(),
  chatId: z.string().max(100).optional(),
  events: z.array(z.string()).max(20).optional(),
  templates: z.record(z.string(), z.string()).optional(),
})

export async function PUT(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, saveSchema)
    await saveConfig('telegram', body)
    await audit({
      userId: user.id, action: 'integration.telegram.save', entityType: 'IntegrationConfig', entityId: 'telegram',
      after: { chatId: body.chatId ?? undefined, events: body.events ?? undefined, tokenChanged: body.botToken ? true : undefined },
      ip: clientIp(req),
    })
    return ok(await getConfigView('telegram'))
  })
}

export async function POST(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'users.manage')
    await parseBody(req, z.object({ action: z.literal('test') }))
    const res = await telegramSendMessage('🔔 پیام آزمایشی از سامانه بنکداری هوشمند — اتصال تلگرام با موفقیت برقرار شد.')
    return ok(res)
  })
}
