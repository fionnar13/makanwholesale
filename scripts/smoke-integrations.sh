#!/usr/bin/env bash
# تست دود یکپارچه‌سازی‌ها — کل جریان پنل بدون سرویس خارجی واقعی
set -u
cd "$(dirname "$0")/.."

BASE="http://localhost:3000"
COOKIE=/tmp/int-smoke-cookie.txt
PASS=0; FAIL=0

check() { # name, expected, actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "✔ $1"
  else FAIL=$((FAIL+1)); echo "✖ $1 — انتظار: $2 / واقعی: $3"; fi
}

# ۱) ورود مدیر
curl -s -c "$COOKIE" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"phone":"09120000000","password":"Admin#1404"}' > /tmp/login.json
check "ورود مدیر" "true" "$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/login.json')).ok")"

# ۲) نمای کلی یکپارچه‌سازی‌ها
curl -s -b "$COOKIE" "$BASE/api/integrations" > /tmp/ov.json
node -pe "
const ov = JSON.parse(require('fs').readFileSync('/tmp/ov.json')).data;
JSON.stringify({g: !!ov.google, s: !!ov.sheets, t: !!ov.telegram, a: !!ov.ai, b: !!ov.backup, d: ov.datasets.length, e: ov.telegramEvents.length})
" > /tmp/ov2.json
check "نمای کلی کامل" '{"g":true,"s":true,"t":true,"a":true,"b":true,"d":5,"e":6}' "$(cat /tmp/ov2.json)"

# ۳) ذخیره تلگرام + پوشاندن توکن
curl -s -b "$COOKIE" -X PUT "$BASE/api/integrations/telegram" -H 'content-type: application/json' \
  -d '{"botToken":"123456789:AAE-very-secret-token-xyz","chatId":"-1009999","events":["ORDER_NEW"]}' > /tmp/tg.json
check "ذخیره تلگرام" "true" "$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/tg.json')).ok")"
curl -s -b "$COOKIE" "$BASE/api/integrations" > /tmp/ov3.json
node -pe "
const t = JSON.parse(require('fs').readFileSync('/tmp/ov3.json')).data.telegram;
JSON.stringify({masked: t.botToken?.includes('••••••'), notLeaked: !(t.botToken?.includes('AAE-very')), chatId: t.chatId, events: t.events})
" > /tmp/tg2.json
check "توکن پوشیده شده و chatId حفظ" '{"masked":true,"notLeaked":true,"chatId":"-1009999","events":["ORDER_NEW"]}' "$(cat /tmp/tg2.json)"

# ۴) تست ارسال تلگرام — بدون توکن واقعی پاسخ ok:false ولی نباید ۵۰۰ شود
curl -s -b "$COOKIE" -X POST "$BASE/api/integrations/telegram" -H 'content-type: application/json' \
  -d '{"action":"test"}' > /tmp/tgt.json
check "تست تلگرام بدون توکن واقعی — پاسخ ساختاریافته" "true" "$(node -pe "const j=JSON.parse(require('fs').readFileSync('/tmp/tgt.json')); JSON.stringify(j.ok===true && j.data.ok===false)")"

# ۵) خروجی CSV — BOM و سربرگ فارسی
curl -s -b "$COOKIE" "$BASE/api/integrations/export?datasets=customers&format=CSV" -D /tmp/h1.txt -o /tmp/exp.csv
check "خروجی CSV با BOM" "efbbbf" "$(od -An -tx1 -N3 /tmp/exp.csv | tr -d ' \n')"
check "سربرگ فارسی CSV" "yes" "$(rg -q 'کد مشتری' /tmp/exp.csv && echo yes || echo no)"

# ۶) خروجی XLSX — امضای ZIP
curl -s -b "$COOKIE" "$BASE/api/integrations/export?datasets=customers,products&format=XLSX" -o /tmp/exp.xlsx
check "خروجی XLSX معتبر (PK)" "504b" "$(od -An -tx1 -N2 /tmp/exp.xlsx | tr -d ' \n')"

# ۷) خروجی TS
curl -s -b "$COOKIE" "$BASE/api/integrations/export?datasets=orders&format=TS" -o /tmp/exp.ts
check "خروجی TS" "yes" "$(rg -q 'export type Orders' /tmp/exp.ts && echo yes || echo no)"

# ۸) پیش‌نمایش ورود داده — CSV با یک سطر معتبر و یک سطر خطا
printf '\xef\xbb\xbfکد مشتری,نام فروشگاه,تلفن\nCUS-SMOKE-1,فروشگاه دود,09119998877\n,فروشگاه بی‌کد,09110000000\n' > /tmp/imp.csv
curl -s -b "$COOKIE" -X POST "$BASE/api/integrations/import" \
  -F "file=@/tmp/imp.csv" -F "dataset=customers" -F "mode=preview" > /tmp/prev.json
node -pe "
const d = JSON.parse(require('fs').readFileSync('/tmp/prev.json')).data;
JSON.stringify({total: d.totalRows, valid: d.validCount, errors: d.errorCount})
" > /tmp/prev2.json
check "پیش‌نمایش ورود (۲ سطر، ۱ معتبر، ۱ خطا)" '{"total":2,"valid":1,"errors":1}' "$(cat /tmp/prev2.json)"

# پاک‌سازی مشتری تستی قبل از اعمال — با env صریح تا global DATABASE_URL اثر نگذارد
DATABASE_URL="postgresql://makan:makan123@127.0.0.1:5432/makan" \
node --import tsx -e "
import 'dotenv/config'
process.env.DATABASE_URL = 'postgresql://makan:makan123@127.0.0.1:5432/makan'
const { db } = await import('/home/z/my-project/src/lib/db.ts')
await db.customer.deleteMany({ where: { code: 'CUS-SMOKE-1' } })
console.log('cleaned')
" >/dev/null 2>&1 || true

# ۹) اعمال نهایی ورود
curl -s -b "$COOKIE" -X POST "$BASE/api/integrations/import" \
  -F "file=@/tmp/imp.csv" -F "dataset=customers" -F "mode=apply" > /tmp/apply.json
node -pe "
const d = JSON.parse(require('fs').readFileSync('/tmp/apply.json')).data;
JSON.stringify({created: d.created, failed: d.failed})
" > /tmp/apply2.json
check "اعمال ورود داده" '{"created":1,"failed":1}' "$(cat /tmp/apply2.json)"

# ۱۰) AI غیرفعال — پاسخ خطای واضح بدون ۵۰۰
curl -s -b "$COOKIE" -X POST "$BASE/api/integrations/ai" -H 'content-type: application/json' \
  -d '{"action":"ask","question":"سلام"}' > /tmp/ai.json
check "AI غیرفعال — پیام واضح" "true" "$(node -pe "const j=JSON.parse(require('fs').readFileSync('/tmp/ai.json')); JSON.stringify(j.ok===true && (j.data.error||'').includes('غیرفعال'))")"

# ۱۱) ذخیره بکاپ — nextRunAt محاسبه شود
curl -s -b "$COOKIE" -X PUT "$BASE/api/integrations/backup" -H 'content-type: application/json' \
  -d '{"enabled":true,"format":"XLSX","interval":"DAILY","hour":3,"datasets":["customers","products"],"retentionCount":10}' > /tmp/bk.json
check "ذخیره برنامه بکاپ + nextRunAt" "true" "$(node -pe "const j=JSON.parse(require('fs').readFileSync('/tmp/bk.json')); JSON.stringify(j.ok===true && !!j.data.nextRunAt)")"

# ۱۲) دسترسی به tick با رمز اشتباه → 403
code=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -X POST "$BASE/api/integrations/scheduler/tick" -H 'x-cron-secret: wrong')
check "tick با رمز اشتباه → 403" "403" "$code"

# ۱۳) بکاپ بدون حساب متصل — پیام خوانا (نه ۵۰۰)
curl -s -b "$COOKIE" -X POST "$BASE/api/integrations/backup" -H 'content-type: application/json' \
  -d '{"action":"run"}' > /tmp/run.json
check "بکاپ بدون حساب گوگل — پیام راهنما" "true" "$(node -pe "const j=JSON.parse(require('fs').readFileSync('/tmp/run.json')); JSON.stringify(j.ok===true && j.data.status==='FAILED' && (j.data.message||'').includes('گوگل'))")"

# ۱۴) دسترسی بدون مجوز → 403
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/integrations" > /tmp/anon.txt
check "بدون ورود → 401" "401" "$(cat /tmp/anon.txt)"

echo
echo "نتیجه: $PASS موفق، $FAIL ناموفق"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
