// تست API مسیر پخش (فاز ۱ — بخش C) — فراخوانی مستقیم Route Handlerها با NextRequest واقعی
// (بدون نیاز به سرور؛ احراز هویت با نشست واقعی در دیتابیس — همان مسیر getSessionUser)
//
// پوشش مصوبات بخش C:
//   ۱) دسترسی غیرمجاز → 401 بدون نشست، 403 بدون مجوز
//   ۲) scoping سخت‌گیرانه — راننده فقط مأموریت‌های خودش؛ مدیر همه
//   ۳) اعتبارسنجی Zod — اکشن نامعتبر، بدنه ناقص، کد خارج از enum → 400 VALIDATION با خطای ساختاریافته
//   ۴) نگاشت وضعیت — 409 تعارض، 403 مالکیت، 404 غیرقابل‌دسترس
//   ۵) idempotency — تکرار start/complete/return/cancel اثر جدید ثبت نمی‌کند (idempotent:true)
//   ۶) سناریوی PAID ← COMPLETED — تحویل اعتباری از API راننده، تسویه markPaid از API سفارش،
//      مأموریت → PAID، فاکتور → PAID، Ledger دقیقاً یک INVOICE + یک RECEIPT (بدون دوگانه‌ثبتی)
//   ۷) شلیک هم‌زمان دوبار (Promise.allSettled) — فقط یک اثر، نفر دوم 409 (گارد claim اتمیک)
// در CI با PostgreSQL موقت اجرا می‌شود (npm run test:integration)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'

process.env.INTEGRATION_SECRET_KEY = 'test-secret-key-for-integrations-1234567890'

const { db } = await import('../../src/lib/db.ts')
const { createOrder, transitionOrder } = await import('../../src/lib/orders.ts')
const { receiveStock } = await import('../../src/lib/inventory.ts')
const deliveriesRoute = await import('../../src/app/api/deliveries/route.ts')
const deliveriesIdRoute = await import('../../src/app/api/deliveries/[id]/route.ts')
const ordersIdRoute = await import('../../src/app/api/orders/[id]/route.ts')

// ─── کاربران تست (مجوزها از دیتابیس خوانده می‌شود —getSessionUser) ───
const MANAGER_PERMS = ['orders.view', 'orders.create', 'orders.confirm', 'orders.creditApprove', 'finance.receipts', 'inventory.issue', 'deliveries.manage', 'deliveries.view.own']
const DRIVER_PERMS = ['orders.view', 'deliveries.view.own', 'deliveries.complete', 'deliveries.return']

let managerId = '', driverId = '', driver2Id = '', plainId = ''
let tokenManager = '', tokenDriver = '', tokenDriver2 = '', tokenPlain = ''
const createdUserIds: string[] = []

const SFX = `${Date.now()}${Math.floor(Math.random() * 1000)}`
let productId = '', unitId = ''

// ─── فراخوانی مستقیم هندلرها ───
type ApiOpts = { method?: string; token?: string | null; body?: unknown }
function apiReq(path: string, opts: ApiOpts = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.token) headers['cookie'] = `bwh_session=${opts.token}`
  return new NextRequest(new Request(`http://localhost:3000${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  }))
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) })

async function callList(token?: string | null, query = '') {
  const res = await deliveriesRoute.GET(apiReq(`/api/deliveries${query}`, { token }))
  return { status: res.status, body: await res.json() }
}
async function callCreate(token: string | null, body: unknown) {
  const res = await deliveriesRoute.POST(apiReq('/api/deliveries', { method: 'POST', token, body }))
  return { status: res.status, body: await res.json() }
}
async function callDetail(token: string | null, id: string) {
  const res = await deliveriesIdRoute.GET(apiReq(`/api/deliveries/${id}`, { token }), idCtx(id))
  return { status: res.status, body: await res.json() }
}
async function callAction(token: string | null, id: string, body: unknown) {
  const res = await deliveriesIdRoute.POST(apiReq(`/api/deliveries/${id}`, { method: 'POST', token, body }), idCtx(id))
  return { status: res.status, body: await res.json() }
}
async function callOrderAction(token: string | null, orderId: string, action: string) {
  const res = await ordersIdRoute.POST(apiReq(`/api/orders/${orderId}`, { method: 'POST', token, body: { action } }), idCtx(orderId))
  return { status: res.status, body: await res.json() }
}

function ledgerCount(customerId: string, entryType: string) {
  return db.customerLedger.count({ where: { customerId, entryType } })
}

/** سفارش از ثبت تا «ارسال شده» — CREDIT با تأیید اعتبار یا CASH با پیش‌پرداخت */
async function createDispatchedOrder(seq: string, payMethod: 'CASH' | 'CREDIT') {
  const customer = await db.customer.create({
    data: { code: `CUS-C${SFX}${seq}`, shopName: `مشتری API پخش ${seq}`, phone: `072${SFX}${seq}`.slice(0, 20) },
  })
  const { order } = await createOrder({ id: managerId, permissions: MANAGER_PERMS }, {
    customerId: customer.id, payMethod, items: [{ productId, unitId, qty: 1 }],
  })
  await transitionOrder({ id: managerId, permissions: MANAGER_PERMS }, order.id, 'confirm', {})
  if (payMethod === 'CASH') await transitionOrder({ id: managerId, permissions: MANAGER_PERMS }, order.id, 'markPaid', {})
  else await transitionOrder({ id: managerId, permissions: MANAGER_PERMS }, order.id, 'creditApprove', {})
  await transitionOrder({ id: managerId, permissions: MANAGER_PERMS }, order.id, 'startPicking', {})
  await transitionOrder({ id: managerId, permissions: MANAGER_PERMS }, order.id, 'readyForDispatch', {})
  await transitionOrder({ id: managerId, permissions: MANAGER_PERMS }, order.id, 'dispatch', { driverId })
  return { orderId: order.id, customerId: customer.id, orderNo: order.orderNo }
}

before(async () => {
  // مجوزهای لازم — مستقل از seed (در CI تست‌ها پیش از seed اجرا می‌شوند)
  const needed = [...new Set([...MANAGER_PERMS, ...DRIVER_PERMS, 'deliveries.return'])]
  for (const code of needed) {
    await db.permission.upsert({ where: { code }, update: {}, create: { code, label: code } })
  }
  // نقش‌های تست + اتصال مجوزها
  const mgrRole = await db.role.upsert({
    where: { name: `MGR_C_${SFX}` }, update: {},
    create: { name: `MGR_C_${SFX}`, label: 'مدیر پخش تست API', isSystem: false },
  })
  // نقش راننده — نام 'DRIVER' الزامی است (createAssignment نقش راننده را با نام کنترل می‌کند)
  const drvRole = await db.role.upsert({
    where: { name: 'DRIVER' }, update: {},
    create: { name: 'DRIVER', label: 'راننده', isSystem: true },
  })
  for (const code of MANAGER_PERMS) {
    const p = await db.permission.findUnique({ where: { code } })
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: mgrRole.id, permissionId: p!.id } }, update: {}, create: { roleId: mgrRole.id, permissionId: p!.id } })
  }
  for (const code of DRIVER_PERMS) {
    const p = await db.permission.findUnique({ where: { code } })
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: drvRole.id, permissionId: p!.id } }, update: {}, create: { roleId: drvRole.id, permissionId: p!.id } })
  }

  // کاربران + نشست واقعی (توکن خام فقط در کوکی تست؛ Hash در DB — همان قرارداد auth.ts)
  const mkUser = async (phone: string, name: string, roleId: string) => {
    const u = await db.user.upsert({
      where: { phone }, update: {},
      create: { phone, name, passwordHash: 'test', phoneVerified: true },
    })
    await db.userRole.upsert({ where: { userId_roleId: { userId: u.id, roleId } }, update: {}, create: { userId: u.id, roleId } })
    const token = randomBytes(24).toString('hex')
    await db.session.create({
      data: { userId: u.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600_000), ip: 'test', userAgent: 'node-test' },
    })
    createdUserIds.push(u.id)
    return { id: u.id, token }
  }
  const m = await mkUser(`0931${SFX.slice(-8)}`, 'مدیر API پخش', mgrRole.id)
  managerId = m.id; tokenManager = m.token
  const d1 = await mkUser(`0932${SFX.slice(-8)}`, 'راننده API ۱', drvRole.id)
  driverId = d1.id; tokenDriver = d1.token
  const d2 = await mkUser(`0933${SFX.slice(-8)}`, 'راننده API ۲', drvRole.id)
  driver2Id = d2.id; tokenDriver2 = d2.token
  const pl = await mkUser(`0934${SFX.slice(-8)}`, 'کاربر بی‌مجوز', mgrRole.id)
  plainId = pl.id; tokenPlain = pl.token
  // کاربر بی‌مجوز — نقش مدیر را می‌گیرد ولی مجوزها را از دست می‌دهیم (سطر نقش را حذف می‌کنیم)
  await db.userRole.deleteMany({ where: { userId: plainId } })

  // کالا + واحد + قیمت DEFAULT + انبار پیش‌فرض + ۳۰۰ پایه موجودی
  const product = await db.product.create({
    data: { sku: `TST-API-${SFX}`, name: 'کالای تست API پخش', minOrderQtyBase: 1, orderMultipleBase: 1, isActive: true },
  })
  productId = product.id
  const unit = await db.productUnit.create({
    data: { productId, name: 'کارتن API', factor: 24, isBase: false },
  })
  unitId = unit.id
  await db.priceRule.create({
    data: { productId, unitId, scope: 'DEFAULT', priceRls: 2_200_000, minQtyBase: 1, isActive: true },
  })
  let wh = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!wh) wh = await db.warehouse.create({ data: { code: `WH-API-${SFX}`, name: 'انبار تست API', isDefault: true } })
  await db.$transaction(tx => receiveStock(tx, {
    productId, warehouseId: wh!.id, qtyBase: 300, lotNo: `LOT-API-${SFX}`,
  }, { refType: 'RECEIVE', refId: null, userId: managerId }))
})

after(async () => {
  await db.session.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
  await db.userRole.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {})
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {})
  // فقط نقش سفارشی مدیر این فایل حذف می‌شود — نقش مشترک 'DRIVER' دست‌نخورده می‌ماند
  await db.role.deleteMany({ where: { name: `MGR_C_${SFX}` } }).catch(() => {})
  await db.product.delete({ where: { id: productId } }).catch(() => {})
  await db.$disconnect()
})

// ═══ ۱) دسترسی غیرمجاز ═══
test('بدون نشست → 401 روی فهرست، جزئیات، تخصیص و اکشن', async () => {
  const list = await callList(null)
  assert.equal(list.status, 401)
  assert.equal(list.body.error.code, 'UNAUTHENTICATED')

  const detail = await callDetail(null, 'unknown-id')
  assert.equal(detail.status, 401)

  const create = await callCreate(null, { orderId: 'x', deliveryUserId: 'y' })
  assert.equal(create.status, 401)

  const action = await callAction(null, 'unknown-id', { action: 'start' })
  assert.equal(action.status, 401)
})

test('کاربر بدون مجوز پخش → 403 روی فهرست؛ راننده بدون deliveries.manage → 403 روی تخصیص', async () => {
  const plain = await callList(tokenPlain)
  assert.equal(plain.status, 403)
  assert.equal(plain.body.error.code, 'FORBIDDEN')

  const o = await createDispatchedOrder('1', 'CREDIT')
  const asDriver = await callCreate(tokenDriver, { orderId: o.orderId, deliveryUserId: driverId })
  assert.equal(asDriver.status, 403)
  assert.equal(asDriver.body.error.code, 'FORBIDDEN')
})

// ═══ ۲) تخصیص مأموریت — اعتبارسنجی و تعارض ═══
test('تخصیص — بدنه ناقص 400 ساختاریافته، سفارش ناشناخته 404، غیر-راننده 400، موفق 201، تکرار 409', async () => {
  const o = await createDispatchedOrder('2', 'CREDIT')

  // بدنه ناقص — orderId غایب → 400 VALIDATION با fieldErrors
  const bad = await callCreate(tokenManager, { deliveryUserId: driverId })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'VALIDATION')
  assert.ok(bad.body.error.details?.fieldErrors?.orderId?.length >= 1)

  // سفارش ناشناخته → 404
  const noOrder = await callCreate(tokenManager, { orderId: 'nonexistent-order', deliveryUserId: driverId })
  assert.equal(noOrder.status, 404)
  assert.equal(noOrder.body.error.code, 'ORDER_NOT_FOUND')

  // تخصیص به غیر-راننده → 400
  const notDriver = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: managerId })
  assert.equal(notDriver.status, 400)
  assert.equal(notDriver.body.error.code, 'NOT_A_DRIVER')

  // موفق → 201 PENDING
  const okCreate = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: driverId, notes: 'تحویل صبح' })
  assert.equal(okCreate.status, 201)
  assert.equal(okCreate.body.data.status, 'PENDING')
  assert.equal(okCreate.body.data.statusLabel, 'تخصیص داده‌شده')

  // تخصیص دوم وقتی مأموریت فعال داریم → 409 تعارض
  const dup = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: driverId })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.error.code, 'ASSIGNMENT_ACTIVE')
})

// ═══ ۳) scoping فهرست ═══
test('فهرست — راننده فقط مأموریت‌های خودش؛ مدیر همه + فیلتر وضعیت؛ status نامعتبر 400', async () => {
  const o2 = await createDispatchedOrder('3', 'CREDIT')
  const a2 = await callCreate(tokenManager, { orderId: o2.orderId, deliveryUserId: driver2Id })
  assert.equal(a2.status, 201)

  // راننده ۱ — فقط مأموریت خودش (مأموریت راننده ۲ غایب است)
  const d1 = await callList(tokenDriver)
  assert.equal(d1.status, 200)
  assert.ok(d1.body.data.length >= 1)
  assert.ok(d1.body.data.every((a: { deliveryUserId: string }) => a.deliveryUserId === driverId))
  assert.ok(!d1.body.data.some((a: { deliveryUserId: string }) => a.deliveryUserId === driver2Id))

  // مدیر — همهٔ مأموریت‌ها (شامل راننده ۲)
  const mgr = await callList(tokenManager)
  assert.equal(mgr.status, 200)
  assert.ok(mgr.body.data.some((a: { deliveryUserId: string }) => a.deliveryUserId === driverId))
  assert.ok(mgr.body.data.some((a: { deliveryUserId: string }) => a.deliveryUserId === driver2Id))

  // فیلتر وضعیت فعال
  const pending = await callList(tokenManager, '?status=PENDING')
  assert.equal(pending.status, 200)
  assert.ok(pending.body.data.length >= 1)
  assert.ok(pending.body.data.every((a: { status: string }) => a.status === 'PENDING'))

  // status خارج از enum → 400 ساختاریافته
  const badStatus = await callList(tokenManager, '?status=NOT_A_STATUS')
  assert.equal(badStatus.status, 400)
  assert.equal(badStatus.body.error.code, 'VALIDATION')
})

// ═══ ۴) جزئیات — مالکیت و 404 ═══
test('جزئیات — راننده مأموریت خودش 200؛ رانندهٔ دیگر 403 ASSIGNMENT_NOT_YOURS؛ ناشناخته 404', async () => {
  const mine = await callList(tokenDriver)
  const myAssignmentId = mine.body.data[0].id

  const own = await callDetail(tokenDriver, myAssignmentId)
  assert.equal(own.status, 200)
  assert.equal(own.body.data.id, myAssignmentId)
  assert.ok(own.body.data.order.orderNo)
  assert.ok(own.body.data.order.items.length >= 1)
  assert.equal(own.body.data.order.items[0].productName, 'کالای تست API پخش')

  const other = await callDetail(tokenDriver2, myAssignmentId)
  assert.equal(other.status, 403)
  assert.equal(other.body.error.code, 'ASSIGNMENT_NOT_YOURS')

  const missing = await callDetail(tokenManager, 'nonexistent-assignment')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.error.code, 'ASSIGNMENT_NOT_FOUND')
})

// ═══ ۵) اکشن نامعتبر و بدنه ناقص ═══
test('اکشن — action نامعتبر 400، reason خارج از enum 400، paymentMethod خارج از enum 400، اکشن ناشناخته 404', async () => {
  const mine = await callList(tokenDriver)
  const aId = mine.body.data[0].id

  const badAction = await callAction(tokenDriver, aId, { action: 'fly-to-moon' })
  assert.equal(badAction.status, 400)
  assert.equal(badAction.body.error.code, 'VALIDATION')

  const noReason = await callAction(tokenDriver, aId, { action: 'return' })
  assert.equal(noReason.status, 400)
  assert.equal(noReason.body.error.code, 'VALIDATION')

  const badMethod = await callAction(tokenDriver, aId, { action: 'complete', paymentMethod: 'BITCOIN' })
  assert.equal(badMethod.status, 400)
  assert.equal(badMethod.body.error.code, 'VALIDATION')

  const missing = await callAction(tokenDriver, 'nonexistent-assignment', { action: 'start' })
  assert.equal(missing.status, 404)
  assert.equal(missing.body.error.code, 'ASSIGNMENT_NOT_FOUND')
})

// ═══ ۶) start + idempotency + تحویل اعتباری + سناریوی PAID ← COMPLETED ═══
test('جریان کامل API — complete پیش از start 409؛ start و تکرارش idempotent؛ تحویل اعتباری؛ markPaid → مأموریت PAID؛ complete انبار → COMPLETED', async () => {
  // سفارش ۲ — مأموریت PENDING از تست تخصیص
  const list = await callList(tokenDriver, '?status=PENDING')
  assert.ok(list.body.data.length >= 1)
  const a = list.body.data[0]
  const aId = a.id
  const oId = a.orderId

  // complete پیش از start → 409 تعارض وضعیت
  const early = await callAction(tokenDriver, aId, { action: 'complete' })
  assert.equal(early.status, 409)
  assert.equal(early.body.error.code, 'BAD_STATE')

  // start → 200 IN_PROGRESS
  const start = await callAction(tokenDriver, aId, { action: 'start' })
  assert.equal(start.status, 200)
  assert.equal(start.body.data.status, 'IN_PROGRESS')

  // دوبار کلیک روی start → همان وضعیت، بدون اثر مجدد
  const startAgain = await callAction(tokenDriver, aId, { action: 'start' })
  assert.equal(startAgain.status, 200)
  assert.equal(startAgain.body.data.idempotent, true)
  assert.equal(startAgain.body.data.status, 'IN_PROGRESS')

  // تحویل اعتباری — سفارش CREDIT پرداخت‌نشده → CREDIT پیش‌فرض، بدون دریافت وجه
  const done = await callAction(tokenDriver, aId, { action: 'complete', notes: 'بسته سالم تحویل شد' })
  assert.equal(done.status, 200)
  assert.equal(done.body.data.status, 'DELIVERED')
  assert.equal(done.body.data.orderStatus, 'DELIVERED')
  assert.equal(done.body.data.invoiceStatus, 'ISSUED')

  const orderRow = await db.order.findUnique({ where: { id: oId } })
  const customerId = orderRow!.customerId
  assert.equal(await ledgerCount(customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(customerId, 'RECEIPT'), 0)

  // دوبار کلیک روی complete → idempotent، Ledger دست‌نخورده
  const doneAgain = await callAction(tokenDriver, aId, { action: 'complete', paymentMethod: 'CASH' })
  assert.equal(doneAgain.status, 200)
  assert.equal(doneAgain.body.data.idempotent, true)
  assert.equal(await ledgerCount(customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(customerId, 'RECEIPT'), 0)

  // سناریوی PAID ← COMPLETED — تسویه از API سفارش (markPaid اصلاح‌شدهٔ بخش B)
  const paid = await callOrderAction(tokenManager, oId, 'markPaid')
  assert.equal(paid.status, 200)
  assert.equal(paid.body.data.status, 'PAID')

  // مأموریت تحویل‌شدهٔ اعتباری با تسویه → PAID
  const detail = await callDetail(tokenDriver, aId)
  assert.equal(detail.body.data.status, 'PAID')
  assert.equal(detail.body.data.statusLabel, 'تحویل و تسویه‌شده')
  const invoice = await db.invoice.findUnique({ where: { orderId: oId } })
  assert.equal(invoice!.status, 'PAID')

  // قلب اصلاحیهٔ ۱ — دقیقاً یک INVOICE + یک RECEIPT، بدون دوگانه‌ثبتی
  assert.equal(await ledgerCount(customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(customerId, 'RECEIPT'), 1)

  // بستن سفارش از API انبار
  const closed = await callOrderAction(tokenManager, oId, 'complete')
  assert.equal(closed.status, 200)
  assert.equal(closed.body.data.status, 'COMPLETED')
})

// ═══ ۷) مرجوعی + تکرار + لغو ═══
test('مرجوعی — DAMAGED ثبت، سفارش در DISPATCHED، تکرار idempotent، reason نامعتبر 400، لغو و تکرارش idempotent', async () => {
  const o = await createDispatchedOrder('4', 'CREDIT')
  const a = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: driverId })
  const aId = a.body.data.id
  await callAction(tokenDriver, aId, { action: 'start' })

  // reason نامعتبر (خارج از پنج کد مصوب) → 400
  const badReason = await callAction(tokenDriver, aId, { action: 'return', reason: 'RESTOCK' })
  assert.equal(badReason.status, 400)
  assert.equal(badReason.body.error.code, 'VALIDATION')

  // مرجوعی موفق → RETURNED + شماره درخواست
  const ret = await callAction(tokenDriver, aId, { action: 'return', reason: 'DAMAGED', notes: 'بسته‌بندی آسیب دیده' })
  assert.equal(ret.status, 200)
  assert.equal(ret.body.data.status, 'RETURNED')
  assert.ok(ret.body.data.returnNo)

  // سفارش در DISPATCHED می‌ماند (مصوبهٔ فاز ۱) — امکان مأموریت مجدد
  const orderRow = await db.order.findUnique({ where: { id: o.orderId } })
  assert.equal(orderRow!.status, 'DISPATCHED')
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 0)

  // دوبار کلیک روی return → idempotent؛ درخواست مرجوعی تکراری ثبت نمی‌شود
  const retAgain = await callAction(tokenDriver, aId, { action: 'return', reason: 'DAMAGED' })
  assert.equal(retAgain.status, 200)
  assert.equal(retAgain.body.data.idempotent, true)
  assert.equal(await db.returnRequest.count({ where: { orderId: o.orderId } }), 1)

  // اکشن مرجوعی توسط رانندهٔ دیگر → 403 مالکیت
  const notMine = await callAction(tokenDriver2, aId, { action: 'return', reason: 'OTHER' })
  assert.equal(notMine.status, 403)
  assert.equal(notMine.body.error.code, 'ASSIGNMENT_NOT_YOURS')

  // مأموریت مجدد آزاد است → لغو مدیر + تکرار idempotent
  const a2 = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: driverId })
  assert.equal(a2.status, 201)
  const cancelled = await callAction(tokenManager, a2.body.data.id, { action: 'cancel', reason: 'مشتری انصراف داد' })
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.body.data.status, 'CANCELLED')
  const cancelAgain = await callAction(tokenManager, a2.body.data.id, { action: 'cancel', reason: 'مشتری انصراف داد' })
  assert.equal(cancelAgain.status, 200)
  assert.equal(cancelAgain.body.data.idempotent, true)
})

// ═══ ۸) شلیک هم‌زمان — گارد claim اتمیک ═══
test('شلیک هم‌زمان دو complete — فقط یکی 200؛ دیگری 409؛ Ledger دقیقاً یک INVOICE و یک RECEIPT و FEFO یک‌بار', async () => {
  const o = await createDispatchedOrder('5', 'CREDIT') // اعتباری — وجه در محل نقدی دریافت می‌شود
  const a = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: driverId })
  const aId = a.body.data.id
  await callAction(tokenDriver, aId, { action: 'start' })

  const [r1, r2] = await Promise.all([
    callAction(tokenDriver, aId, { action: 'complete', paymentMethod: 'CASH', paymentReference: 'REF-API-1' }),
    callAction(tokenDriver, aId, { action: 'complete', paymentMethod: 'CASH', paymentReference: 'REF-API-1' }),
  ])
  const statuses = [r1.status, r2.status].sort()
  assert.deepEqual(statuses, [200, 409])
  const winner = r1.status === 200 ? r1 : r2
  assert.equal(winner.body.data.status, 'PAID')
  assert.equal(winner.body.data.orderStatus, 'COMPLETED')
  assert.equal(winner.body.data.invoiceStatus, 'PAID')

  // دقیقاً یک اثر مالی — بدون دوگانه‌ثبتی
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(o.customerId, 'RECEIPT'), 1)
  const receipts = await db.receipt.findMany({ where: { customerId: o.customerId } })
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0]!.method, 'CASH')

  // خروج فیزیکی FEFO فقط یک‌بار — دو سفارش تحویل‌شده تا این‌جا (سفارش ۲ و سفارش ۵)
  const lot = await db.inventoryLot.findFirst({ where: { productId } })
  assert.equal(lot!.remainingQtyBase, 300 - 48)
})

// ═══ ۹) سفارش پیش‌پرداخت — ثبت پرداخت در محل ممنوع (ضد دوگانه‌ثبتی وجه) ═══
test('سفارش پیش‌پرداخت‌شده — complete با paymentMethod → 400 PAYMENT_ALREADY_SETTLED؛ بدون پرداخت → PAID/COMPLETED بدون رسید تکراری', async () => {
  const o = await createDispatchedOrder('6', 'CASH') // markPaid پیشین → paidAt ثبت شده
  const a = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: driverId })
  const aId = a.body.data.id
  await callAction(tokenDriver, aId, { action: 'start' })

  // راننده نمی‌تواند برای سفارشِ تسویه‌شده وجه «دوباره» دریافت کند
  const dup = await callAction(tokenDriver, aId, { action: 'complete', paymentMethod: 'CASH', paymentReference: 'REF-X' })
  assert.equal(dup.status, 400)
  assert.equal(dup.body.error.code, 'PAYMENT_ALREADY_SETTLED')

  // تحویل بدون پرداختِ مجدد — سفارش تا COMPLETED می‌رود و فاکتور PAID است (قاعدهٔ paidAt)
  const done = await callAction(tokenDriver, aId, { action: 'complete' })
  assert.equal(done.status, 200)
  assert.equal(done.body.data.status, 'PAID')
  assert.equal(done.body.data.orderStatus, 'COMPLETED')
  assert.equal(done.body.data.invoiceStatus, 'PAID')

  // فقط رسیدِ پیش‌پرداخت — بدون رسید تکراری در محل
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(o.customerId, 'RECEIPT'), 1)

  // خروج FEFO تجمعی — سه سفارش تحویل‌شده تا این نقطه (۲۴×۳)
  const lot = await db.inventoryLot.findFirst({ where: { productId } })
  assert.equal(lot!.remainingQtyBase, 300 - 72)
})

// ═══ ۱۰) بخش D — شبیه‌سازی رفتار دکمهٔ «ثبت تحویل» در اپ راننده (fetch تکراری با idempotencyKey) ═══
// دقیقاً همان چیزی که UI می‌فرستد: کلید ایدمپوتنت با هر request؛ پس از موفقیت، تکرار کلیک
// (همان کلید یا کلید تازه از باز شدن مجدد دیالوگ) نباید اثر جدیدی ثبت کند.
test('رفتار دکمهٔ ثبت تحویل — ارسال مجدد با همان کلید و کلید تازه → idempotent؛ دقیقاً یک Receipt/INVOICE؛ کلید در AuditLog', async () => {
  const o = await createDispatchedOrder('7', 'CREDIT')
  const a = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: driverId })
  const aId = a.body.data.id
  await callAction(tokenDriver, aId, { action: 'start', idempotencyKey: 'UI-KEY-S-1' })

  // کلیک اول — دکمهٔ «ثبت تحویل و دریافت وجه» با کلید ایدمپوتنت دیالوگ
  const KEY = 'UI-KEY-D-1'
  const first = await callAction(tokenDriver, aId, {
    action: 'complete', paymentMethod: 'CASH', paymentReference: 'REF-UI-1', idempotencyKey: KEY,
  })
  assert.equal(first.status, 200)
  assert.equal(first.body.data.status, 'PAID')
  assert.equal(first.body.data.orderStatus, 'COMPLETED')
  assert.ok(first.body.data.invoiceNo)

  // کلیک دوم همان submit (شبکهٔ ناپایدار/دوبار کلیک) — همان کلید → idempotent:true بدون اثر
  const retrySameKey = await callAction(tokenDriver, aId, {
    action: 'complete', paymentMethod: 'CASH', paymentReference: 'REF-UI-1', idempotencyKey: KEY,
  })
  assert.equal(retrySameKey.status, 200)
  assert.equal(retrySameKey.body.data.idempotent, true)

  // باز شدن مجدد دیالوگ و کلیک با کلید تازه — باز هم بدون اثر (پیش‌خوانی وضعیت در route)
  const retryNewKey = await callAction(tokenDriver, aId, {
    action: 'complete', paymentMethod: 'CASH', idempotencyKey: 'UI-KEY-D-2-FRESH',
  })
  assert.equal(retryNewKey.status, 200)
  assert.equal(retryNewKey.body.data.idempotent, true)

  // دقیقاً یک اثر مالی — رسید و فاکتور و Ledger دوگانه ثبت نشده‌اند
  assert.equal(await ledgerCount(o.customerId, 'INVOICE'), 1)
  assert.equal(await ledgerCount(o.customerId, 'RECEIPT'), 1)
  const receipts = await db.receipt.findMany({ where: { customerId: o.customerId } })
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0]!.method, 'CASH')

  // کلید ایدمپوتنت در AuditLog ثبت شده (ردیابی تلاش‌های تکراری)
  const auditRow = await db.auditLog.findFirst({
    where: { action: 'delivery.complete', entityId: aId },
    orderBy: { createdAt: 'desc' },
  })
  assert.ok(auditRow)
  const after = JSON.parse(auditRow!.afterJson ?? '{}') as { idempotencyKey?: string }
  assert.equal(after.idempotencyKey, KEY)

  // خروج FEFO تجمعی — چهار سفارش تحویل‌شده تا این نقطه (۲۴×۴)
  const lot = await db.inventoryLot.findFirst({ where: { productId } })
  assert.equal(lot!.remainingQtyBase, 300 - 96)
})

// ═══ ۱۱) بخش D — فیلترهای از/تا و dateField و take در فهرست ═══
test('فیلتر دوره‌ای — from/to روی assignedAt پیش‌فرض؛ dateField=completedAt پس از تحویل؛ بازهٔ معکوس 400؛ take', async () => {
  const o = await createDispatchedOrder('8', 'CREDIT')
  const a = await callCreate(tokenManager, { orderId: o.orderId, deliveryUserId: driverId })
  const aId = a.body.data.id

  const winFrom = new Date(Date.now() - 3600_000).toISOString()
  const winTo = new Date(Date.now() + 3600_000).toISOString()
  const futureFrom = new Date(Date.now() + 7200_000).toISOString()

  // بازهٔ جاری شامل مأموریت جدید است (assignedAt = اکنون)
  const inWindow = await callList(tokenDriver, `?from=${encodeURIComponent(winFrom)}&to=${encodeURIComponent(winTo)}`)
  assert.equal(inWindow.status, 200)
  assert.ok(inWindow.body.data.some((x: { id: string }) => x.id === aId))

  // از آیندهٔ دور — مأموریت غایب است
  const outWindow = await callList(tokenDriver, `?from=${encodeURIComponent(futureFrom)}&to=${encodeURIComponent(new Date(Date.now() + 10800_000).toISOString())}`)
  assert.equal(outWindow.status, 200)
  assert.ok(!outWindow.body.data.some((x: { id: string }) => x.id === aId))

  // بازهٔ معکوس → 400 ساختاریافته
  const inverted = await callList(tokenDriver, `?from=${encodeURIComponent(winTo)}&to=${encodeURIComponent(winFrom)}`)
  assert.equal(inverted.status, 400)
  assert.equal(inverted.body.error.code, 'VALIDATION')

  // dateField=completedAt — پیش از تحویل (completedAt=null) غایب است
  await callAction(tokenDriver, aId, { action: 'start' })
  const beforeComplete = await callList(tokenDriver, `?from=${encodeURIComponent(winFrom)}&to=${encodeURIComponent(winTo)}&dateField=completedAt`)
  assert.ok(!beforeComplete.body.data.some((x: { id: string }) => x.id === aId))

  // پس از تحویل (CASH در محل → completedAt ثبت می‌شود) در بازهٔ completedAt ظاهر می‌شود
  const done = await callAction(tokenDriver, aId, { action: 'complete', paymentMethod: 'CASH', idempotencyKey: 'UI-KEY-D-3' })
  assert.equal(done.status, 200)
  const afterComplete = await callList(tokenDriver, `?from=${encodeURIComponent(winFrom)}&to=${encodeURIComponent(winTo)}&dateField=completedAt`)
  assert.ok(afterComplete.body.data.some((x: { id: string }) => x.id === aId))

  // take=1 — دقیقاً یک سطر
  const limited = await callList(tokenDriver, '?take=1')
  assert.equal(limited.status, 200)
  assert.equal(limited.body.data.length, 1)

  // خروج FEFO تجمعی — پنج سفارش تحویل‌شده تا پایان فایل (۲۴×۵)
  const lot = await db.inventoryLot.findFirst({ where: { productId } })
  assert.equal(lot!.remainingQtyBase, 300 - 120)
})
