// تست واحد ثابت‌ها و توابع خالص مسیر پخش — بدون دیتابیس (بخش B فاز ۱)
import { test } from 'node:test'
import assert from 'node:assert/strict'

const shared = await import('../../src/lib/delivery-shared.ts')

test('isOnSpotPayment — فقط CREDIT و نبودِ روش، پرداخت در محل محسوب نمی‌شود', () => {
  assert.equal(shared.isOnSpotPayment('CASH'), true)
  assert.equal(shared.isOnSpotPayment('CARD_TO_CARD'), true)
  assert.equal(shared.isOnSpotPayment('POS'), true)
  assert.equal(shared.isOnSpotPayment('OTHER'), true)
  assert.equal(shared.isOnSpotPayment('CREDIT'), false)
  assert.equal(shared.isOnSpotPayment(undefined), false)
  assert.equal(shared.isOnSpotPayment(null), false)
})

test('RETURN_REASONS — دقیقاً پنج کد مصوب اصلاحیهٔ ۵', () => {
  assert.deepEqual(
    [...shared.RETURN_REASONS],
    ['CUSTOMER_REFUSED', 'WRONG_ITEM', 'DAMAGED', 'NOT_PAID', 'OTHER'],
  )
})

test('ACTIVE_ASSIGNMENT_STATUSES — فقط PENDING و IN_PROGRESS', () => {
  assert.deepEqual([...shared.ACTIVE_ASSIGNMENT_STATUSES], ['PENDING', 'IN_PROGRESS'])
})

test('DRIVER_PAYMENT_METHODS — پنج روش مصوب', () => {
  assert.deepEqual(
    [...shared.DRIVER_PAYMENT_METHODS],
    ['CASH', 'CARD_TO_CARD', 'POS', 'CREDIT', 'OTHER'],
  )
})

test('actorRoleLabel — دادهٔ قدیمی (null/undefined) به‌عنوان SYSTEM نمایش داده می‌شود (مصوبهٔ فاز ۰-③)', () => {
  assert.equal(shared.actorRoleLabel(null), 'سیستم')
  assert.equal(shared.actorRoleLabel(undefined), 'سیستم')
  assert.equal(shared.actorRoleLabel('SYSTEM'), 'سیستم')
  assert.equal(shared.actorRoleLabel('WAREHOUSE'), 'انبار')
  assert.equal(shared.actorRoleLabel('DELIVERY'), 'راننده')
})
