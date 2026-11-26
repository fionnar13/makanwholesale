// تست یکپارچه لایه AI — مسیرهای وابسته به دیتابیس (پیکربندی + snapshot دیتاست‌ها)
// در CI با PostgreSQL موقت اجرا می‌شود (npm run test:integration)
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.INTEGRATION_SECRET_KEY = 'test-secret-key-for-integrations-1234567890'

const { buildDataSnapshot, aiChat } = await import('../../src/lib/integrations/ai.ts')

test('aiChat — وقتی غیرفعال است، پیام واضح بدون فراخوانی شبکه', async () => {
  // ai.enabled پیش‌فرض false است و پیکربندی در DB هم نیست
  const res = await aiChat([{ role: 'user', content: 'سلام' }], 'TEST')
  assert.equal(res.ok, false)
  assert.ok(res.error?.includes('غیرفعال'))
})

test('buildDataSnapshot — snapshot ساختاریافته از دیتاست‌ها می‌سازد', async () => {
  const snap = await buildDataSnapshot(50)
  assert.ok(snap.includes('## مشتریان'))
  assert.ok(snap.includes('## محصولات'))
  assert.ok(snap.includes('## سفارش‌ها'))
  assert.ok(snap.includes('ستون‌ها:'))
})
