-- مجوزهای مسیر پخش (بار پخش‌کن) — هم‌ارز scripts/seed.ts (PERMISSIONS + ROLE_PERMS.DRIVER)
-- idempotent: ON CONFLICT DO NOTHING — اجرای مکرر بی‌اثر است.
-- نکته: روی پایگاه‌های داده‌ی موجود با `prisma migrate deploy` هم اعمال می‌شود (بدون نیاز به re-seed).

INSERT INTO "Permission" ("id", "code", "label") VALUES
  (md5(random()::text || clock_timestamp()::text || 'deliveries.view.own'),  'deliveries.view.own',  'مشاهده مأموریت‌های پخش خود'),
  (md5(random()::text || clock_timestamp()::text || 'deliveries.complete'), 'deliveries.complete', 'ثبت تحویل و دریافت وجه در مسیر پخش'),
  (md5(random()::text || clock_timestamp()::text || 'deliveries.return'),   'deliveries.return',   'ثبت مرجوعی در مسیر پخش')
ON CONFLICT ("code") DO NOTHING;

-- سهم نقش راننده (DRIVER) — مجوزهای قبلی (orders.view، messages.use) حفظ می‌شوند
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('deliveries.view.own', 'deliveries.complete', 'deliveries.return')
WHERE r."name" = 'DRIVER'
ON CONFLICT DO NOTHING;

-- مدیر کل (ADMIN) — الگوی همه‌مجوزها در seed
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('deliveries.view.own', 'deliveries.complete', 'deliveries.return')
WHERE r."name" = 'ADMIN'
ON CONFLICT DO NOTHING;
