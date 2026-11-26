// تست لایه AI — ساختار snapshot، پیشنهاد دسته‌بندی و اعتبارسنجی پیکربندی (بدون شبکه)
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.INTEGRATION_SECRET_KEY = 'test-secret-key-for-integrations-1234567890'

const { parseCategorySuggestions, buildDataSnapshot, aiChat } = await import('../../src/lib/integrations/ai.ts')

test('parseCategorySuggestions — استخراج JSON از پاسخ AI با متن اضافه', () => {
  const content = 'البته! این پیشنهادها:\n[{"sku":"PRD-1","suggestedCategory":"آبمیوه"},{"sku":"PRD-2","suggestedCategory":"رب"}]\nموفق باشید.'
  const out = parseCategorySuggestions(content)
  assert.deepEqual(out, [
    { sku: 'PRD-1', suggestedCategory: 'آبمیوه' },
    { sku: 'PRD-2', suggestedCategory: 'رب' },
  ])
})

test('parseCategorySuggestions — پاسخ خراب → آرایه خالی', () => {
  assert.deepEqual(parseCategorySuggestions('no json here'), [])
  assert.deepEqual(parseCategorySuggestions('[broken'), [])
})

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
