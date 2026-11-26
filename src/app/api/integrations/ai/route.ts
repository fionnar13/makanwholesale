// هوش مصنوعی — پیکربندی (GET/PUT)، اکشن‌های مدیریتی (POST) و لاگ‌ها (GET ?logs=1)
// اکشن‌ها: ask | summarize | categorize | apply-categories
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, handler, ok, parseBody, clientIp } from '@/lib/api'
import { requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getConfigView, saveConfig, AI_PROVIDER_BASE_URLS } from '@/lib/integrations/config'
import { aiAnswerManagementQuestion, aiSummarizeData, aiSuggestCategories, parseCategorySuggestions } from '@/lib/integrations/ai'

export async function GET(req: NextRequest) {
  return handler(async () => {
    await requirePerm(req, 'users.manage')
    const url = new URL(req.url)
    if (url.searchParams.get('logs') === '1') {
      const logs = await db.aiLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
      return ok({ logs })
    }
    const view = await getConfigView('ai')
    return ok({ ...view, providerBaseUrls: AI_PROVIDER_BASE_URLS })
  })
}

const saveSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['openrouter', 'ninerouter', 'custom']).optional(),
  baseUrl: z.string().max(300).optional(),
  apiKey: z.string().max(300).nullable().optional(),
  model: z.string().max(120).optional(),
  systemPrompt: z.string().max(4000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxDataRows: z.number().int().min(10).max(1000).optional(),
})

export async function PUT(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, saveSchema)
    if (body.baseUrl) {
      try { new URL(body.baseUrl) } catch {
        throw new ApiError(400, 'BAD_URL', 'Base URL معتبر نیست — مثال: https://openrouter.ai/api/v1')
      }
    }
    await saveConfig('ai', body)
    await audit({
      userId: user.id, action: 'integration.ai.save', entityType: 'IntegrationConfig', entityId: 'ai',
      after: { provider: body.provider ?? undefined, model: body.model ?? undefined, keyChanged: body.apiKey ? true : undefined, enabled: body.enabled ?? undefined },
      ip: clientIp(req),
    })
    return ok(await getConfigView('ai'))
  })
}

export async function POST(req: NextRequest) {
  return handler(async () => {
    const user = await requirePerm(req, 'users.manage')
    const body = await parseBody(req, z.object({
      action: z.enum(['ask', 'summarize', 'categorize', 'apply-categories']),
      question: z.string().max(2000).optional(),
      suggestions: z.array(z.object({ sku: z.string().max(100), suggestedCategory: z.string().max(200) })).max(500).optional(),
    }))

    switch (body.action) {
      case 'ask': {
        const q = body.question?.trim()
        if (!q) throw new ApiError(400, 'NO_QUESTION', 'پرسش را وارد کنید')
        const res = await aiAnswerManagementQuestion(q)
        return ok(res)
      }
      case 'summarize': {
        const res = await aiSummarizeData(body.question?.trim())
        return ok(res)
      }
      case 'categorize': {
        const res = await aiSuggestCategories()
        if (!res.ok) return ok(res)
        return ok({ ...res, suggestions: parseCategorySuggestions(res.content ?? '') })
      }
      case 'apply-categories': {
        if (!body.suggestions || body.suggestions.length === 0) {
          throw new ApiError(400, 'NO_SUGGESTIONS', 'لیست پیشنهادها خالی است')
        }
        // دسته‌بندی‌ها را لازم می‌کنیم/می‌سازیم و کالاها را به‌روز می‌کنیم
        let applied = 0, failed = 0
        for (const s of body.suggestions) {
          try {
            const product = await db.product.findUnique({ where: { sku: s.sku } })
            if (!product) { failed++; continue }
            const cat = await db.category.upsert({
              where: { name: s.suggestedCategory },
              update: {},
              create: { name: s.suggestedCategory },
            })
            await db.product.update({ where: { id: product.id }, data: { categoryId: cat.id } })
            applied++
          } catch { failed++ }
        }
        await audit({
          userId: user.id, action: 'integration.ai.applyCategories', entityType: 'Product',
          after: { applied, failed }, ip: clientIp(req),
        })
        return ok({ ok: true, applied, failed, message: `${applied} کالا دسته‌بندی شد${failed ? ` — ${failed} مورد ناموفق` : ''}` })
      }
    }
  })
}
