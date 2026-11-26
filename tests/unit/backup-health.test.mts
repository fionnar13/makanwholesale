// تست واحد سلامت بکاپ — آستانه‌های وضعیت رنگی پنل و مبنای هشدار اسکجولر (فاز ۴)
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { computeBackupHealth, BACKUP_STALE_AFTER_HOURS } = await import('../../src/lib/integrations/backup.ts')

const NOW = new Date('2026-11-26T10:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

test('بکاپ خاموش → OFF', () => {
  const h = computeBackupHealth({ enabled: false, lastRun: null, lastSuccessAt: null, now: NOW })
  assert.equal(h.level, 'OFF')
})

test('بدون هیچ اجرای موفق ولی فعال → STALE (قرمز)', () => {
  const h = computeBackupHealth({ enabled: true, lastRun: null, lastSuccessAt: null, now: NOW })
  assert.equal(h.level, 'STALE')
  assert.equal(h.hoursSinceSuccess, null)
})

test('موفقیت ۵ ساعت پیش → OK (سبز)', () => {
  const h = computeBackupHealth({
    enabled: true,
    lastRun: { status: 'SUCCESS', startedAt: hoursAgo(5) },
    lastSuccessAt: hoursAgo(5),
    now: NOW,
  })
  assert.equal(h.level, 'OK')
  assert.equal(h.hoursSinceSuccess, 5)
})

test('موفقیت ۱۹ ساعت پیش → DELAYED (زرد — نزدیک مرز ۲۴ ساعت)', () => {
  const h = computeBackupHealth({
    enabled: true,
    lastRun: { status: 'SUCCESS', startedAt: hoursAgo(19) },
    lastSuccessAt: hoursAgo(19),
    now: NOW,
  })
  assert.equal(h.level, 'DELAYED')
})

test('موفقیت ۲۵ ساعت پیش → STALE (قرمز — بیش از ۲۴ ساعت)', () => {
  assert.equal(BACKUP_STALE_AFTER_HOURS, 24)
  const h = computeBackupHealth({
    enabled: true,
    lastRun: { status: 'SUCCESS', startedAt: hoursAgo(25) },
    lastSuccessAt: hoursAgo(25),
    now: NOW,
  })
  assert.equal(h.level, 'STALE')
})

test('آخرین اجرا FAILED و آخرین موفقیت ۲ ساعت پیش → DELAYED (زرد)', () => {
  const h = computeBackupHealth({
    enabled: true,
    lastRun: { status: 'FAILED', startedAt: hoursAgo(1) },
    lastSuccessAt: hoursAgo(2),
    now: NOW,
  })
  assert.equal(h.level, 'DELAYED')
})

test('آخرین اجرا FAILED و آخرین موفقیت ۱۵ ساعت پیش → FAILED (قرمز)', () => {
  const h = computeBackupHealth({
    enabled: true,
    lastRun: { status: 'FAILED', startedAt: hoursAgo(1) },
    lastSuccessAt: hoursAgo(15),
    now: NOW,
  })
  assert.equal(h.level, 'FAILED')
})

test('آخرین اجرا FAILED ولی بعد از آن موفقیت تازه‌تر → FAILED نیست', () => {
  const h = computeBackupHealth({
    enabled: true,
    lastRun: { status: 'FAILED', startedAt: hoursAgo(20) },
    lastSuccessAt: hoursAgo(2),
    now: NOW,
  })
  assert.equal(h.level, 'OK')
})
