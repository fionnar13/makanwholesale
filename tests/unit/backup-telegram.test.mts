// تست بکاپ (ریاضیات اسکجول) و تلگرام (قالب پیام و ساخت درخواست) — بدون شبکه
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { computeNextRunAt } = await import('../../src/lib/integrations/backup.ts')
const { renderTemplate, TELEGRAM_DEFAULT_TEMPLATES } = await import('../../src/lib/integrations/telegram.ts')

// ── اسکجول بکاپ ──

// تهران = UTC+3:30 — ۱۲:۰۰ تهران = 08:30 UTC
const T0 = new Date('2026-11-26T08:30:00Z') // ۱۲:۰۰ تهران روز پنجشنبه

test('DAILY — اگر ساعت اجرا نرسیده، امروز؛ وگرنه فردا', () => {
  const today = computeNextRunAt('DAILY', 15, T0) // ساعت ۱۵ تهران هنوز نرسیده (۱۲:۰۰ تهران)
  assert.equal(today.toISOString().slice(0, 13), '2026-11-26T11', '۱۵:۰۰ تهران = ۱۱:۳۰ UTC')

  const tomorrow = computeNextRunAt('DAILY', 9, T0) // ساعت ۹ تهران گذشته
  assert.equal(tomorrow.toISOString().slice(0, 13), '2026-11-27T05', '۹:۰۰ تهران فردا = ۵:۳۰ UTC')
})

test('WEEKLY — لنگر بر روز هفته امروز: امروز اگر ساعت نرسیده، وگرنه هفته بعد', () => {
  const next = computeNextRunAt('WEEKLY', 15, T0) // ۱۵:۰۰ تهران هنوز نرسیده → امروز پنجشنبه ۱۵:۰۰
  const tehran = new Date(next.getTime() + 3.5 * 3600 * 1000)
  assert.equal(tehran.getUTCDay(), 4, 'همان روز هفته امروز (پنجشنبه)')
  assert.equal(tehran.getUTCHours(), 15, 'ساعت ۱۵ تهران')

  const nextWeek = computeNextRunAt('WEEKLY', 9, T0) // ساعت ۹ گذشته → هفته بعد
  const tehran2 = new Date(nextWeek.getTime() + 3.5 * 3600 * 1000)
  assert.equal(tehran2.getUTCDay(), 4, 'همان روز هفته')
  assert.equal(tehran2.getUTCDate(), 3, 'دسامبر ۳ — هفته بعد')
})

test('MONTHLY — روز اول ماه بعد (یا همین ماه اگر امروز روز اول و ساعت نرسیده)', () => {
  const next = computeNextRunAt('MONTHLY', 15, T0)
  const tehran = new Date(next.getTime() + 3.5 * 3600 * 1000)
  assert.equal(tehran.getUTCDate(), 1)
  assert.equal(tehran.getUTCMonth(), 11, 'دسامبر — روز اول ماه بعد')
  assert.equal(tehran.getUTCHours(), 15, 'ساعت ۱۵ تهران')
})

test('خروجی همیشه در آینده است', () => {
  for (const interval of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) {
    for (let h = 0; h <= 23; h++) {
      assert.ok(computeNextRunAt(interval, h, T0).getTime() > T0.getTime(), `${interval} ساعت ${h}`)
    }
  }
})

// ── تلگرام ──

test('renderTemplate — جایگذاری متغیرها', () => {
  const out = renderTemplate('سفارش {{orderNo}} برای {{customerName}} به مبلغ {{total}}', {
    orderNo: 'ORD-1001', customerName: 'کاوه', total: '۱٬۲۰۰٬۰۰۰',
  })
  assert.equal(out, 'سفارش ORD-1001 برای کاوه به مبلغ ۱٬۲۰۰٬۰۰۰')
})

test('renderTemplate — متغیر ناموجود خالی می‌شود و فاصله‌ها پاک می‌شوند', () => {
  assert.equal(renderTemplate('سلام {{name}} {{age}}', { name: 'علی' }), 'سلام علی ')
  assert.equal(renderTemplate('{{a}}', { a: 42 }), '42')
})

test('الگوهای پیش‌فرض رویدادها موجودند', () => {
  for (const key of ['ORDER_NEW', 'BACKUP_SUCCESS', 'BACKUP_ERROR', 'LOW_STOCK', 'RETURN_NEW', 'SHEETS_SYNC_ERROR']) {
    assert.ok(TELEGRAM_DEFAULT_TEMPLATES[key], `الگوی ${key}`)
  }
})
