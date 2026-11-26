// تست واحد لایه AI — پارس پیشنهاد دسته‌بندی (کاملاً بدون شبکه و بدون دیتابیس)
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.INTEGRATION_SECRET_KEY = 'test-secret-key-for-integrations-1234567890'

const { parseCategorySuggestions } = await import('../../src/lib/integrations/ai.ts')

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
