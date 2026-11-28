// تست یکپارچه مسیر پخش (فاز ۱ — بخش B) — سطح کتابخانه، بدون HTTP و بدون سرور
// سناریوها:
//  ۱) تحویل راننده با پرداخت نقدی در محل روی سفارش اعتباری → سفارش COMPLETED، فاکتور PAID،
//     Ledger دقیقاً یک INVOICE + یک RECEIPT، رویدادها با actorRole=DELIVERY
//  ۲) تحویل رانندهٔ اعتباری → سفارش DELIVERED، فاکتور ISSUED؛ سپس markPaid انبار از DELIVERED:
//     فاکتور PAID + Ledger همچنان دقیقاً یک INVOICE و حالا یک RECEIPT (بدون INVOICE تکراری — اصلاحیهٔ ۱)
//  ۳) گارد مسیر انبار: مأموریت PENDING قفل نمی‌کند (اصلاحیهٔ ۴)؛ IN_PROGRESS قفل می‌کند (409)
//  ۴) سفارش نقدی پیش‌پرداخت از مسیر انبار → فاکتور PAID (قاعدهٔ paidAt در افکت‌های مشترک)
//  ۵) مرجوعی راننده: reason پنج‌کدی، disposition=PENDING، سفارش در DISPATCHED، مأموریت مجدد آزاد
//  ۶) scoping و اعتبارسنجی: مأموریت غیرملکی، مجوز ناکافی، reason نامعتبر، مأموریت فعال تکراری
// در CI با PostgreSQL موقت اجرا می‌شود (npm run test:integration)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

process.env.INTEGRATION_SECRET_KEY = 'test-secret-key-for-integrations-1234567890'

const { db } = await import('../../src/lib/db.ts')
const { createOrder, transitionOrder } = await import('../../src/lib/orders.ts')
const { receiveStock } = await import('../../src/lib/inventory.ts')
const {
  createAssignment, startAssignment, completeDelivery, recordDeliveryReturn, cancelAssignment,
} = await import('../../src/lib/deliveries.ts')

const managerUser = { id: '', permissions: ['orders.create', 'orders.confirm', 'orders.creditApprove', 'finance.receipts', 'inventory.issue', 'deliveries.manage', 'deliveries.view.own'] as string[] }
const driverUser = { id: '', permissions: ['orders.view', 'deliveries.view.own', 'deliveries.complete', 'deliveries.return'] as string[] }
const driver2User = { id: '', permissions: ['deliveries.view.own', 'deliveries.complete', 'deliveries.return'] as string[] }

const SFX = `${Date.now()}${Math.floor(Math.random() * 1000)}`
let productId = ''
let unitId = ''

function ledgerCount(customerId: string, entryType: string) {
  return db.customerLedger.count({ where: { customerId, entryType } })
}

/** سفارش را از ثبت تا «ارسال شده» با راننده می‌برد — CASH پیش‌پرداخت یا CREDIT با تأیید اعتبار */
async function createDispatchedOrder(seq: string, payMethod: 'CASH' | 'CREDIT') {
  const customer = await db.customer.create({
    data: { code: `CUS-D${SFX}${seq}`, shopName: `مشتری پخش تست ${seq}`, phone: `062${SFX}${seq}`.slice(0, 20) },
  })
  const { order } = await createOrder(managerUser, {
    customerId: customer.id,
    payMethod,
    items: [{ productId, unitId, qty: 1 }],
  })
  await transitionOrder(managerUser, order.id, 'confirm', {})
  if (payMethod === 'CASH') await transitionOrder(managerUser, order.id, 'markPaid', {})
  else await transitionOrder(managerUser, order.id, 'creditApprove', {})
  await transitionOrder(managerUser, order.id, 'startPicking', {})
  await transitionOrder(managerUser, order.id, 'readyForDispatch', {})
  await transitionOrder(managerUser, order.id, 'dispatch', { driverId: driverUser.id })
  return { orderId: order.id, customerId: customer.id, orderNo: order.orderNo }
}

before(async () => {
  // مدیر تست
  const admin = await db.user.upsert({
    where: { phone: '09120000000' },
    update: {},
    create: { phone: '09120000000', name: 'مدیر تست پخش', passwordHash: 'test', phoneVerified: true },
  })
  managerUser.id = admin.id

  // نقش راننده + دو کاربر راننده (مستقل از وضعیت seed)
  const driverRole = await db.role.upsert({
    where: { name: 'DRIVER' },
    update: {},
    create: { name: 'DRIVER', label: 'راننده', isSystem: true },
  })
  const d1 = await db.user.upsert({
    where: { phone: `0913${SFX.slice(-8)}` },
    update: {},
    create: { phone: `0913${SFX.slice(-8)}`, name: 'راننده تست ۱', passwordHash: 'test', phoneVerified: true },
  })
  await db.userRole.upsert({
    where: { userId_roleId: { userId: d1.id, roleId: driverRole.id } },
    update: {},
    create: { userId: d1.id, roleId: driverRole.id },
  })
  driverUser.id = d1.id

  const d2 = await db.user.upsert({
    where: { phone: `0914${SFX.slice(-8)}` },
    update: {},
    create: { phone: `0914${SFX.slice(-8)}`, name: 'راننده تست ۲', passwordHash: 'test', phoneVerified: true },
  })
  driver2User.id = d2.id

  // کالا + واحد + قیمت DEFAULT
  const product = await db.product.create({
    data: { sku: `TST-DLV-${SFX}`, name: 'کالای تست مسیر پخش', minOrderQtyBase: 1, orderMultipleBase: 1, isActive: true },
  })
  productId = product.id
  const unit = await db.productUnit.create({
    data: { productId: product.id, name: 'کارتن تست پخش', factor: 24, isBase: false },
  })
  unitId = unit.id
  await db.priceRule.create({
    data: { productId: product.id, unitId: unit.id, scope: 'DEFAULT', priceRls: 2_200_000, minQtyBase: 1, isActive: true },
  })

  // انبار پیش‌فرض + ۳۰۰ پایه موجودی (۷ سفارش × ۲۴ پایه در سناریوها)
  let wh = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) wh = await db.warehouse.create({ data: { code: `WH-DLV-${SFX}`, name: 'انبار تست پخش', isDefault: true } })
  await db.$transaction(tx => receiveStock(tx, {
    productId: product.id, warehouseId: wh!.id, qtyBase: 300, lotNo: `LOT-DLV-${SFX}`,
  }, { refType: 'RECEIVE', refId: null, userId: admin.id }))
})

after(async () => {
  // پاکسازی بهترین‌کوشش — داده‌های تست در پایگاه موقت/محلی هستند
  await db.product.delete({ where: { id: productId } }).catch(() => {})
  await db.$disconnect()
})

test('تحویل راننده با پرداخت نقدی در محل → COMPLETED + فاکتور PAID + Ledger دقیقاً یک INVOICE و یک RECEIPT', async () => {
  const o = await createDispatchedOrder('1', 'CREDIT')
  const a = await createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id })
  await startAssignment(driverUser, a.id)

  const res = await completeDelivery(driverUser, a.id, { paymentMethod: 'CASH', paymentReference: 'REF-1234' })

  assert.equal(res.finalOrderStatus, 'COMPLETED')
  assert.equal(res.assignment.status, 'PAID')
  assert.equal(res.effects.invoiceStatus, 'PAID')

  const order = await db.order.findUnique({
    where: { id: o.orderId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  })
  assert.equal(order!.status, 'COMPLETED')
  assert.ok(order!.deliveredAt && order!.completedAt)
  // actorRole راننده روی هر دو رویداد (مصوبهٔ فاز ۰-③)
  const deliveredEvent = order!.events.find(e => e.toStatus === 'DELIVERED')
  assert.equal(deliveredEvent!.actorRole, 'DELIVERY')
  const completedEvent = order!.events.find(e => e.toStatus === 'COMPLETED')
  assert.equal(completedEvent!.actorRole, 'DELIVERY')

  const invoice = await db.invoice.findUnique({ where: { orderId: o.orderId } })
  assert.equal(invoice!.status, 'PAID')

  // قلب اصلاحیهٔ ۱ — Ledger دقیقاً یک INVOICE و یک RECEIPT
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(o.customerId, 'RECEIPT'), 1)

  const receipt = await db.receipt.findFirst({ where: { customerId: o.customerId } })
  assert.equal(receipt!.method, 'CASH')
  assert.equal(receipt!.refNo, 'REF-1234')

  // خروج فیزیکی FEFO — یک کارتن (۲۴ پایه) کم شده است
  const lot = await db.inventoryLot.findFirst({ where: { productId } })
  assert.equal(lot!.remainingQtyBase, 300 - 24)
})

test('تحویل رانندهٔ اعتباری → DELIVERED/ISSUED؛ سپس markPaid انبار از DELIVERED → فاکتور PAID بدون INVOICE تکراری', async () => {
  const o = await createDispatchedOrder('2', 'CREDIT')
  const a = await createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id })
  await startAssignment(driverUser, a.id)

  const res = await completeDelivery(driverUser, a.id, {}) // اعتباری — بدون پرداخت در محل

  assert.equal(res.finalOrderStatus, 'DELIVERED')
  assert.equal(res.assignment.status, 'DELIVERED')
  assert.equal(res.effects.invoiceStatus, 'ISSUED')
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(o.customerId, 'RECEIPT'), 0)

  // تسویه مالی از وضعیت DELIVERED — markPaid اصلاح‌شده (from + DELIVERED)
  const paid = await transitionOrder(managerUser, o.orderId, 'markPaid', {})
  assert.equal(paid.status, 'PAID')

  const invoice = await db.invoice.findUnique({ where: { orderId: o.orderId } })
  assert.equal(invoice!.status, 'PAID')
  // سناریوی مصوب کاربر — پس از markPaid: دقیقاً یک INVOICE + یک RECEIPT
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(o.customerId, 'RECEIPT'), 1)

  // بستن سفارش توسط انبار — رویداد با actorRole=WAREHOUSE
  const completed = await transitionOrder(managerUser, o.orderId, 'complete', {})
  assert.equal(completed.status, 'COMPLETED')
  const ev = await db.orderStatusEvent.findFirst({ where: { orderId: o.orderId, toStatus: 'COMPLETED' } })
  assert.equal(ev!.actorRole, 'WAREHOUSE')
})

test('گارد مسیر انبار — مأموریت PENDING قفل نمی‌کند؛ deliver انبار مجاز و فاکتور ISSUED است', async () => {
  const o = await createDispatchedOrder('3', 'CREDIT')
  const a = await createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id })
  assert.equal(a.status, 'PENDING')

  // اصلاحیهٔ ۴ — تخصیص ≠ شروع فیزیکی؛ مسیر انبار باز است
  const delivered = await transitionOrder(managerUser, o.orderId, 'deliver', {})
  assert.equal(delivered.status, 'DELIVERED')

  const invoice = await db.invoice.findUnique({ where: { orderId: o.orderId } })
  assert.equal(invoice!.status, 'ISSUED')
  const ev = await db.orderStatusEvent.findFirst({ where: { orderId: o.orderId, toStatus: 'DELIVERED' } })
  assert.equal(ev!.actorRole, 'WAREHOUSE')

  // پاکسازی مأموریت معلق — لغو توسط مدیر
  const cancelled = await cancelAssignment(managerUser, a.id, { reason: 'تحویل از مسیر انبار ثبت شد' })
  assert.equal(cancelled.status, 'CANCELLED')
})

test('گارد مسیر انبار — مأموریت IN_PROGRESS تحویل انبار را با 409 ACTIVE_DELIVERY_ASSIGNMENT قفل می‌کند', async () => {
  const o = await createDispatchedOrder('4', 'CREDIT')
  const a = await createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id })
  await startAssignment(driverUser, a.id)

  await assert.rejects(
    () => transitionOrder(managerUser, o.orderId, 'deliver', {}),
    (e: { code?: string; status?: number }) => e.code === 'ACTIVE_DELIVERY_ASSIGNMENT' && e.status === 409,
  )

  // بستن جریان توسط راننده — اعتباری بدون پرداخت
  const res = await completeDelivery(driverUser, a.id, {})
  assert.equal(res.finalOrderStatus, 'DELIVERED')
})

test('سفارش نقدیِ پیش‌پرداخت از مسیر انبار → فاکتور PAID (قاعدهٔ paidAt در افکت‌های مشترک)', async () => {
  // نقدی: markPaid در CONFIRMED → paidAt ثبت می‌شود؛ فاکتور هنگام تحویل باید PAID صادر شود
  const o = await createDispatchedOrder('8', 'CASH')
  const delivered = await transitionOrder(managerUser, o.orderId, 'deliver', {})
  assert.equal(delivered.status, 'DELIVERED')

  const invoice = await db.invoice.findUnique({ where: { orderId: o.orderId } })
  assert.equal(invoice!.status, 'PAID')
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(o.customerId, 'RECEIPT'), 1) // از markPaid پیشین
})

test('مرجوعی راننده — reason پنج‌کدی، disposition=PENDING، سفارش در DISPATCHED و مأموریت مجدد آزاد', async () => {
  const o = await createDispatchedOrder('5', 'CREDIT')
  const a = await createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id })
  await startAssignment(driverUser, a.id)

  const res = await recordDeliveryReturn(driverUser, a.id, { reason: 'DAMAGED', notes: 'بسته‌بندی آسیب دیده' })
  assert.equal(res.assignment.status, 'RETURNED')
  assert.equal(res.assignment.failureReason, 'DAMAGED')

  // مصوبه — سفارش در DISPATCHED می‌ماند (بدون رویداد وضعیت جدید)
  const order = await db.order.findUnique({ where: { id: o.orderId } })
  assert.equal(order!.status, 'DISPATCHED')

  // درخواست مرجوعی با اقلام PENDING برای بررسی انبار (اصلاحیهٔ ۵)
  const rr = await db.returnRequest.findFirst({ where: { orderId: o.orderId }, include: { items: true } })
  assert.ok(rr)
  assert.equal(rr!.status, 'REQUESTED')
  assert.equal(rr!.reason, 'DAMAGED')
  assert.equal(rr!.items.length, 1)
  assert.equal(rr!.items[0]!.disposition, 'PENDING')
  assert.equal(rr!.items[0]!.qtyBase, 24)

  // بدون ثبت مالی
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 0)
  assert.equal(await ledgerCount(o.customerId, 'RECEIPT'), 0)

  // مأموریت مجدد (تلاش دوم) آزاد است
  const a2 = await createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id })
  assert.equal(a2.status, 'PENDING')
  await cancelAssignment(managerUser, a2.id, {})
})

test('اعتبارسنجی مرجوعی — reason خارج از پنج کد مصوب رد می‌شود', async () => {
  const o = await createDispatchedOrder('6', 'CREDIT')
  const a = await createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id })
  await startAssignment(driverUser, a.id)

  await assert.rejects(
    () => recordDeliveryReturn(driverUser, a.id, { reason: 'RESTOCK' as never }),
    (e: { code?: string }) => e.code === 'BAD_RETURN_REASON',
  )

  // بستن جریان — تحویل اعتباری
  await completeDelivery(driverUser, a.id, {})
})

test('scoping و اعتبارسنجی مأموریت — غیرملکی، مجوز ناکافی، تکمیل پیش از شروع، تخصیص تکراری، غیر-راننده', async () => {
  const o = await createDispatchedOrder('7', 'CREDIT')
  const a = await createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id })

  // رانندهٔ دیگر مأموریت دیگری را نمی‌تواند شروع کند
  await assert.rejects(
    () => startAssignment(driver2User, a.id),
    (e: { code?: string }) => e.code === 'ASSIGNMENT_NOT_YOURS',
  )

  // کاربر بدون deliveries.complete → 403
  const noPerm = { id: driver2User.id, permissions: ['deliveries.view.own'] as string[] }
  await assert.rejects(
    () => startAssignment(noPerm, a.id),
    (e: { code?: string }) => e.code === 'FORBIDDEN',
  )

  // تکمیل قبل از شروع → 409
  await assert.rejects(
    () => completeDelivery(driverUser, a.id, {}),
    (e: { code?: string }) => e.code === 'BAD_STATE',
  )

  // تخصیص دوم وقتی مأموریت فعال هست → 409
  await assert.rejects(
    () => createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: driverUser.id }),
    (e: { code?: string }) => e.code === 'ASSIGNMENT_ACTIVE',
  )

  // تخصیص به کاربری بدون نقش راننده → 400
  await assert.rejects(
    () => createAssignment(managerUser, { orderId: o.orderId, deliveryUserId: managerUser.id }),
    (e: { code?: string }) => e.code === 'NOT_A_DRIVER',
  )

  // سفارش اعتباری بدون ثبت روش پرداختِ پرداخت‌نشده → در تکمیل الزام پرداخت فقط برای paidAt==null است؛
  // این سفارش اعتباری است → CREDIT پیش‌فرض؛ پس لغو مأموریت برای پاکسازی
  await cancelAssignment(managerUser, a.id, {})
})
