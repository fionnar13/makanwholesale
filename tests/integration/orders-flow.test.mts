// تست یکپارچه جریان حیاتی سفارش ویزیتور — سطح کتابخانه (بدون HTTP و بدون نیاز به سرور در حال اجرا)
// سناریو: آماده‌سازی کالا/قیمت/انبار → مشتریِ ویزیتور → ثبت سفارش → Idempotency →
//         ممنوعیت سفارش برای مشتری غیرمرتبط → مشاهده سفارش توسط مدیر → پاکسازی
// در CI با PostgreSQL موقت اجرا می‌شود (npm run test:integration)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

process.env.INTEGRATION_SECRET_KEY = 'test-secret-key-for-integrations-1234567890'

const { db } = await import('../../src/lib/db.ts')
const { createOrder, transitionOrder } = await import('../../src/lib/orders.ts')
const { receiveStock } = await import('../../src/lib/inventory.ts')

// کاربر ویزیتور میدانی: orders.create دارد ولی orders.confirm و customers.manage ندارد
const visitorUser = { id: '', permissions: ['orders.create'] as string[] }
const managerUser = { id: '', permissions: ['orders.create', 'orders.confirm', 'orders.cancel', 'customers.manage'] as string[] }

const SFX = `${Date.now()}${Math.floor(Math.random() * 1000)}`
let productId = ''
let unitId = ''
let ownCustomerId = ''
let foreignCustomerId = ''
let orderId = ''

before(async () => {
  // کاربران دمو اگر seed شده‌اند استفاده می‌شوند؛ وگرنه ساخته می‌شوند
  const admin = await db.user.upsert({
    where: { phone: '09120000000' },
    update: {},
    create: { phone: '09120000000', name: 'مدیر تست', passwordHash: 'test', phoneVerified: true },
  })
  managerUser.id = admin.id

  const visitor = await db.user.upsert({
    where: { phone: `0918${SFX.slice(-7).padStart(7, '0')}` },
    update: {},
    create: { phone: `0918${SFX.slice(-7).padStart(7, '0')}`, name: 'ویزیتور تست', passwordHash: 'test', phoneVerified: true },
  })
  visitorUser.id = visitor.id

  // کالا + واحد + قاعدهٔ قیمت DEFAULT
  const product = await db.product.create({
    data: { sku: `TST-${SFX}`, name: 'کالای تست جریان سفارش', minOrderQtyBase: 1, orderMultipleBase: 1, isActive: true },
  })
  productId = product.id
  const unit = await db.productUnit.create({
    data: { productId: product.id, name: 'کارتن تست', factor: 24, isBase: false },
  })
  unitId = unit.id
  await db.priceRule.create({
    data: { productId: product.id, unitId: unit.id, scope: 'DEFAULT', priceRls: 2_200_000, minQtyBase: 1, isActive: true },
  })

  // انبار پیش‌فرض (اگر نیست) + ورود ۱۰۰ پایه موجودی
  let wh = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) wh = await db.warehouse.create({ data: { code: `WH-TEST-${SFX}`, name: 'انبار تست', isDefault: true } })
  await db.$transaction(tx => receiveStock(tx, {
    productId: product.id, warehouseId: wh!.id, qtyBase: 100, lotNo: `LOT-${SFX}`,
  }, { refType: 'RECEIVE', refId: null, userId: admin.id }))

  // مشتریِ خودِ ویزیتور (salesRep = ویزیتور) و مشتری غیرمرتبط
  const own = await db.customer.create({
    data: { code: `CUS-T${SFX}A`, shopName: 'فروشگاه ویزیتور تست', phone: `061${SFX}1`, salesRepId: visitor.id, createdById: visitor.id },
  })
  ownCustomerId = own.id
  const foreign = await db.customer.create({
    data: { code: `CUS-T${SFX}B`, shopName: 'فروشگاه غیرمرتبط تست', phone: `061${SFX}2` },
  })
  foreignCustomerId = foreign.id
})

after(async () => {
  // پاکسازی: لغو سفارش برای آزادسازی رزرو و حذف داده‌های تست
  try { if (orderId) await transitionOrder(managerUser, orderId, 'cancel', { note: 'پاکسازی تست' }) } catch { /* رزرو شاید آزاد شده باشد */ }
  await db.product.delete({ where: { id: productId } }).catch(() => {})
  await db.customer.delete({ where: { id: ownCustomerId } }).catch(() => {})
  await db.customer.delete({ where: { id: foreignCustomerId } }).catch(() => {})
  await db.$disconnect()
})

test('ثبت سفارش ویزیتور برای مشتری خودش → RESERVED با قیمت سرور و snapshot', async () => {
  const res = await createOrder(visitorUser, {
    customerId: ownCustomerId,
    payMethod: 'CASH',
    idempotencyKey: `flow-key-${SFX}`,
    items: [{ productId, unitId, qty: 1 }],
  })
  assert.equal(res.idempotent, false)
  assert.equal(res.order.status, 'RESERVED')
  assert.equal(res.order.createdById, visitorUser.id)
  assert.equal(res.order.totalRls, 2_200_000) // ۱ کارتن × قیمت DEFAULT
  orderId = res.order.id

  // snapshot قیمت در اقلام — اصل «قیمت آینده فاکتور گذشته را عوض نمی‌کند»
  const item = await db.orderItem.findFirst({ where: { orderId: res.order.id } })
  assert.ok(item)
  assert.equal(item!.qtyBase, 24)
  const snap = JSON.parse(item!.priceSnapshotJson) as { ruleId: string | null; scope: string; unitFactor: number }
  assert.equal(snap.scope, 'DEFAULT')
  assert.equal(snap.unitFactor, 24)
  assert.ok(snap.ruleId !== undefined)
})

test('ارسال مجدد با همان idempotencyKey → سفارش تکراری ساخته نمی‌شود', async () => {
  const res = await createOrder(visitorUser, {
    customerId: ownCustomerId,
    payMethod: 'CASH',
    idempotencyKey: `flow-key-${SFX}`,
    items: [{ productId, unitId, qty: 1 }],
  })
  assert.equal(res.idempotent, true)
  assert.equal(res.order.id, orderId)
})

test('ویزیتور برای مشتری غیرمرتبط سفارش ثبت نمی‌کند → CUSTOMER_NOT_ASSIGNED', async () => {
  await assert.rejects(
    () => createOrder(visitorUser, {
      customerId: foreignCustomerId,
      payMethod: 'CASH',
      items: [{ productId, unitId, qty: 1 }],
    }),
    (e: { code?: string }) => e.code === 'CUSTOMER_NOT_ASSIGNED',
  )
})

test('مدیر سفارش ویزیتور را با مشتری، ویزیتور و اقلام می‌بیند', async () => {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, customer: true },
  })
  assert.ok(order)
  assert.ok(order!.orderNo)                       // مدیر شماره سفارش را می‌بیند
  assert.equal(order!.createdById, visitorUser.id) // ویزیتور ثبت‌کننده
  assert.equal(order!.customer.id, ownCustomerId)  // مشتریِ ساخته‌شده در جریان
  assert.equal(order!.items.length, 1)
  assert.equal(order!.items[0]!.qtyBase, 24)
})
