// لاگ یکپارچه‌سازی‌ها — برای عیب‌یابی در پنل (بدون داده حساس)
import { NextRequest } from 'next/server'
import { handler, ok } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { recentLogs, type IntegrationKey } from '@/lib/integrations/logs'

export async function GET(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'users.manage')
    const url = new URL(req.url)
    const integration = url.searchParams.get('integration') as IntegrationKey | null
    const take = Math.min(Number(url.searchParams.get('take') ?? 100) || 100, 300)
    const logs = await recentLogs(integration ?? undefined, take)
    return ok(logs.map(l => ({
      id: l.id,
      integration: l.integration,
      level: l.level,
      event: l.event,
      message: l.message,
      data: l.dataJson ? JSON.parse(l.dataJson) : null,
      createdAt: l.createdAt.toISOString(),
    })))
  })
}
