// شماره‌گذاری اسناد — ORD-20261122-0001 / INV-... / RCP-... / PAY-... / RET-...
// داخل Transaction استفاده شود.
//
// نکتهٔ هم‌زمانی (Concurrency): تخصیص شماره با UPSERT اتمیک PostgreSQL انجام می‌شود
// (INSERT … ON CONFLICT DO UPDATE … RETURNING). دو تراکنش هم‌زمان روی ردیف شمارنده
// قفل می‌شوند و هر کدام عدد یکتای خود را می‌گیرند — بدون شمارهٔ تکراری و بدون خطای
// Unique constraint روی orderNo/invoiceNo/… در سفارش‌های هم‌زمان.
import { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export async function nextNumber(tx: Tx, prefix: string): Promise<string> {
  const today = new Date()
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const key = `seq:${prefix}:${ymd}`

  // افزایش اتمیک شمارنده روزانه — مقدار برگشتی برای هر تراکنش یکتاست
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Setting" ("key", "value", "updatedAt")
    VALUES (${key}, '1', NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "value" = (CAST("Setting"."value" AS INTEGER) + 1)::TEXT, "updatedAt" = NOW()
    RETURNING CAST("value" AS INTEGER) AS "value"
  `
  const n = rows[0]?.value ?? 1
  return `${prefix}-${ymd}-${String(n).padStart(4, '0')}`
}
