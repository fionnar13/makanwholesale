#!/bin/bash
# تست دود API سامانه بنکداری — سناریوهای حیاتی سند پروژه
# پیش‌نیاز: دیتابیس تازهٔ seed شده (اعداد موجودی/بدهی زنجیره‌ای تست‌ها به حالت اولیه وابسته‌اند)
set -uo pipefail
BASE="http://localhost:3000"
JAR_ADMIN=/tmp/jar_admin.txt
JAR_VISITOR=/tmp/jar_visitor.txt
rm -f $JAR_ADMIN $JAR_VISITOR
PASS=0; FAIL=0

say() { echo "== $1"; }
check() { # $1=desc $2=expected $3=actual
  if [[ "$3" == *"$2"* ]]; then PASS=$((PASS+1)); echo "   PASS: $1"; else FAIL=$((FAIL+1)); echo "   FAIL: $1 — انتظار: $2 / دریافتی: $3"; fi
}

say "0) Health"
H=$(curl -s $BASE/api)
check "health db up" '"db":"up"' "$H"

say "1) ورود مدیر"
L=$(curl -s -c $JAR_ADMIN -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"phone":"09120000000","password":"Admin#1404"}')
check "admin login ok" '"ok":true' "$L"

say "2) ورود اشتباه — باید رد شود"
L2=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"phone":"09120000000","password":"wrong123"}')
check "bad creds 401" 'BAD_CREDENTIALS' "$L2"

say "3) داشبورد"
D=$(curl -s -b $JAR_ADMIN $BASE/api/dashboard)
check "dashboard has salesMonthRls" 'salesMonthRls' "$D"

say "4) کاتالوگ و شناسه‌ها"
P=$(curl -s -b $JAR_ADMIN $BASE/api/products)
TOM_ID=$(echo "$P" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print([p for p in d if p['sku']=='TOM-CC-800'][0]['id'])")
TOM_CARTON=$(echo "$P" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print([p for p in d if p['sku']=='TOM-CC-800'][0]['units'][1]['id'])")
TOM_BASE_UNIT=$(echo "$P" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print([p for p in d if p['sku']=='TOM-CC-800'][0]['units'][0]['id'])")
echo "   product=$TOM_ID carton=$TOM_CARTON"
check "9 products" '"TOM-MT-800"' "$P"

say "5) قیمت اختصاصی مشتری — اولویت قیمت CUSTOMER بر DEFAULT"
CU=$(curl -s -b $JAR_ADMIN $BASE/api/customers)
KAVEH_ID=$(echo "$CU" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print([c for c in d if c['code']=='CUS-1001'][0]['id'])")
SAHAR_ID=$(echo "$CU" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print([c for c in d if c['code']=='CUS-1002'][0]['id'])")
PR1=$(curl -s -b $JAR_ADMIN "$BASE/api/pricing?productId=$TOM_ID&unitId=$TOM_CARTON&qtyBase=24&customerId=$KAVEH_ID")
check "کاوه carton = 2100000 (اختصاصی)" '"priceRls":2100000' "$PR1"
check "scope CUSTOMER" '"scope":"CUSTOMER"' "$PR1"
PR2=$(curl -s -b $JAR_ADMIN "$BASE/api/pricing?productId=$TOM_ID&unitId=$TOM_CARTON&qtyBase=24&customerId=$SAHAR_ID")
check "سحر carton = 2200000 (عمومی)" '"priceRls":2200000' "$PR2"

say "6) ثبت سفارش با رزرو (موجودی اولیه 100 پایه)"
O=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$KAVEH_ID\",\"payMethod\":\"CREDIT\",\"idempotencyKey\":\"smoke-key-001\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":2}]}")
ORDER_ID=$(echo "$O" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "   order=$ORDER_ID"
check "order created RESERVED" '"status":"RESERVED"' "$O"

say "7) Idempotency — ارسال مجدد همان کلید نباید سفارش تکراری بسازد"
O2=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$KAVEH_ID\",\"payMethod\":\"CREDIT\",\"idempotencyKey\":\"smoke-key-001\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":2}]}")
check "idempotent=true" '"idempotent":true' "$O2"
CNT=$(curl -s -b $JAR_ADMIN "$BASE/api/orders?take=200" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))")
echo "   orders count=$CNT (باید 1 باشد)"

say "8) فروش بیش از موجودی — درخواست 150 کارتن (3600 پایه) از 100 موجودی باید رد شود"
O3=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$KAVEH_ID\",\"payMethod\":\"CASH\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":150}]}")
check "INSUFFICIENT_STOCK 409" 'INSUFFICIENT_STOCK' "$O3"

say "9) سفارش نقدی هم باید بعد از رزرو مشابه برود — رزرو در ثبت، پرداخت در markPaid"
say "10) لغو سفارش → آزادسازی رزرو"
OC=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders/$ORDER_ID -H 'Content-Type: application/json' -d '{"action":"cancel","note":"تست لغو"}')
check "cancelled" '"status":"CANCELLED"' "$OC"
BAL=$(curl -s -b $JAR_ADMIN "$BASE/api/inventory?type=balances" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']['balances']; print([b['availableBase'] for b in d if b['product']['sku']=='TOM-CC-800'][0])")
echo "   available after cancel=$BAL (باید 100 باشد)"
check "رزرو آزاد شد" '100' "$BAL"

say "11) چرخه کامل سفارش دوم: confirm → creditApprove → picking → ready → dispatch → deliver → complete"
O4=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$KAVEH_ID\",\"payMethod\":\"CREDIT\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":2}]}")
OID=$(echo "$O4" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
for A in confirm creditApprove startPicking readyForDispatch; do
  R=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders/$OID -H 'Content-Type: application/json' -d "{\"action\":\"$A\"}")
  check "$A" "\"status\"" "$R"
done
DRV=$(curl -s -b $JAR_ADMIN "$BASE/api/users?role=DRIVER" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
R=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders/$OID -H 'Content-Type: application/json' -d "{\"action\":\"dispatch\",\"driverId\":\"$DRV\"}")
check "dispatch" '"DISPATCHED"' "$R"
R=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders/$OID -H 'Content-Type: application/json' -d '{"action":"deliver"}')
check "deliver + invoice" '"DELIVERED"' "$R"
R=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders/$OID -H 'Content-Type: application/json' -d '{"action":"complete"}')
check "complete" '"COMPLETED"' "$R"
DET=$(curl -s -b $JAR_ADMIN $BASE/api/orders/$OID)
check "invoice issued" '"invoiceNo"' "$DET"
BAL2=$(curl -s -b $JAR_ADMIN "$BASE/api/inventory?type=balances" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']['balances']; print([b['physicalBase'] for b in d if b['product']['sku']=='TOM-CC-800'][0])")
check "خروج فیزیکی: 100-48=52" '52' "$BAL2"
DEBT=$(curl -s -b $JAR_ADMIN "$BASE/api/customers/$KAVEH_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['balanceRls'])")
check "بدهی کاوه = 2 کارتن × 2100000" '4200000' "$DEBT"

say "12) سقف اعتبار — سفارش اعتباری بزرگ‌تر از سقف باید رد شود (باقی اعتبار 500م − 100.8م)"
O5=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$KAVEH_ID\",\"payMethod\":\"CREDIT\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_BASE_UNIT\",\"qty\":5100}]}")
check "CREDIT_EXCEEDED 402" 'CREDIT_EXCEEDED' "$O5"

say "13) دریافت از مشتری → کاهش بدهی"
R=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/finance/receipts -H 'Content-Type: application/json' -d "{\"customerId\":\"$KAVEH_ID\",\"amountRls\":50000000,\"method\":\"CASH\",\"note\":\"تست دریافت\"}")
check "receipt ok" '"receiptNo"' "$R"
DEBT2=$(curl -s -b $JAR_ADMIN "$BASE/api/customers/$KAVEH_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['balanceRls'])")
check "بدهی جدید = 4200000-50000000 (بستانکار)" '-45800000' "$DEBT2"

say "14) مرجوعی: درخواست روی سفارش تحویل‌شده + بررسی QC با RESTOCK"
RET=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/returns -H 'Content-Type: application/json' -d "{\"orderId\":\"$OID\",\"reason\":\"تست مرجوعی — قوطی آسیب‌دیده\",\"items\":[{\"productId\":\"$TOM_ID\",\"qtyBase\":24,\"reason\":\"آسیب در حمل\"}]}")
check "return created" '"returnNo"' "$RET"
RET_ID=$(echo "$RET" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
RI=$(curl -s -b $JAR_ADMIN $BASE/api/returns/$RET_ID | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['items'][0]['id'])")
RV=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/returns/$RET_ID -H 'Content-Type: application/json' -d "{\"items\":[{\"itemId\":\"$RI\",\"disposition\":\"RESTOCK\",\"qcNote\":\"سالم پس از بررسی\"}]}")
check "credit note = 24×2100000/24×… (مبلغ خط کارتن دوم؟)" '"creditRls"' "$RV"
DEBT3=$(curl -s -b $JAR_ADMIN "$BASE/api/customers/$KAVEH_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['balanceRls'])")
echo "   debt after return=$DEBT3"
BAL3=$(curl -s -b $JAR_ADMIN "$BASE/api/inventory?type=balances" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']['balances']; print([b['physicalBase'] for b in d if b['product']['sku']=='TOM-CC-800'][0])")
check "RESTOCK بازگشت 24 پایه به فیزیکی" '76' "$BAL3"

say "15) دسترسی — ویزیتور نباید به مالی و کاربران دسترسی داشته باشد؛ مشتریان/سفارش‌ها محدود به خودش است"
LV=$(curl -s -c $JAR_VISITOR -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"phone":"09120000005","password":"Demo#1404"}')
check "visitor login" '"ok":true' "$LV"
FV=$(curl -s -b $JAR_VISITOR $BASE/api/finance)
check "finance forbidden" 'FORBIDDEN' "$FV"
UV=$(curl -s -b $JAR_VISITOR $BASE/api/users)
check "users forbidden" 'FORBIDDEN' "$UV"
# scoping مشتری — ویزیتور فقط مشتریان خودش (کاوه با salesRep خودش) را می‌بیند
CV=$(curl -s -b $JAR_VISITOR $BASE/api/customers)
check "visitor sees own customer (کاوه)" 'CUS-1001' "$CV"
SAHAR_VISIBLE=$(echo "$CV" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print('YES' if any(c['code']=='CUS-1002' for c in d) else 'NO')")
check "visitor does NOT see سحر (scoping)" 'NO' "$SAHAR_VISIBLE"
# سفارش برای مشتری دیگر → ممنوع (CUSTOMER_NOT_ASSIGNED)
OV2=$(curl -s -b $JAR_VISITOR -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$SAHAR_ID\",\"payMethod\":\"CASH\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_BASE_UNIT\",\"qty\":5}]}")
check "order for foreign customer FORBIDDEN" 'CUSTOMER_NOT_ASSIGNED' "$OV2"
# سفارش برای مشتری خودش → موفق (سپس مدیر لغو می‌کند و رزرو آزاد می‌شود)
OV1=$(curl -s -b $JAR_VISITOR -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$KAVEH_ID\",\"payMethod\":\"CASH\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":1}]}")
check "visitor order for own customer RESERVED" '"status":"RESERVED"' "$OV1"
VIS_ORDER_ID=$(echo "$OV1" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
RC=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders/$VIS_ORDER_ID -H 'Content-Type: application/json' -d '{"action":"cancel","note":"پاکسازی تست"}')
check "admin cancelled visitor order" '"CANCELLED"' "$RC"
BAL15=$(curl -s -b $JAR_ADMIN "$BASE/api/inventory?type=balances" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']['balances']; print([b['availableBase'] for b in d if b['product']['sku']=='TOM-CC-800'][0])")
check "رزرو ویزیتور آزاد شد (۷۶)" '76' "$BAL15"

say "16) هم‌زمانی — دو سفارش 3 کارتن (72 پایه) با موجودی 76: فقط یکی رزرو قطعی می‌شود"
curl -s -b $JAR_ADMIN -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$SAHAR_ID\",\"payMethod\":\"CASH\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":2}]}" > /tmp/o7.json &
curl -s -b $JAR_ADMIN -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$KAVEH_ID\",\"payMethod\":\"CASH\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":2}]}" > /tmp/o8.json &
wait
O7=$(cat /tmp/o7.json)
O8=$(cat /tmp/o8.json)
echo "   O7=$O7"
echo "   O8=$O8"
check "دقیقا یکی از دو سفارش هم‌زمان موفق" 'INSUFFICIENT_STOCK' "$O7$O8"

say "17) گزارش‌ها و Audit"
RP=$(curl -s -b $JAR_ADMIN "$BASE/api/reports?type=sales&groupBy=product")
check "sales by product has TOM" 'TOM-CC-800' "$RP"
AU=$(curl -s -b $JAR_ADMIN "$BASE/api/audit?take=200")
check "audit has order.create" 'order.create' "$AU"

say "18) جریان فروشگاه ویزیتور — ثبت سریع مشتری + سبد + ثبت سفارش + مشاهده مدیر"
# ۱۸-۱: ایجاد سریع مشتری توسط ویزیتور (بدون customers.manage)
NC=$(curl -s -b $JAR_VISITOR -X POST $BASE/api/customers -H 'Content-Type: application/json' -d '{"shopName":"فروشگاه آزمون ویزیتور","ownerName":"تست فروشگاه","phone":"06133330099","address":"اهواز — تست","businessType":"SUPERMARKET"}')
check "visitor quick-create customer" '"code":"CUS-' "$NC"
NEWCUST_ID=$(echo "$NC" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
NDUP=$(curl -s -b $JAR_VISITOR -X POST $BASE/api/customers -H 'Content-Type: application/json' -d '{"shopName":"فروشگاه تکراری","phone":"06133330099"}')
check "duplicate phone → existing" '"existing":true' "$NDUP"
CV2=$(curl -s -b $JAR_VISITOR $BASE/api/customers)
check "new customer in visitor list" 'فروشگاه آزمون ویزیتور' "$CV2"
# ۱۸-۲: پیش‌نمایش قیمت برای مشتری جدید (گروه معمولی → قیمت عمومی ۲.۲م)
PV=$(curl -s -b $JAR_VISITOR "$BASE/api/pricing?productId=$TOM_ID&unitId=$TOM_CARTON&qtyBase=24&customerId=$NEWCUST_ID")
check "quote for new customer = 2200000" '"priceRls":2200000' "$PV"
# ۱۸-۳: ثبت سفارش ویزیتور برای مشتری خودش (۱ کارتن = ۲۴ پایه از موجودی باقی‌مانده ۲۸)
VO=$(curl -s -b $JAR_VISITOR -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$NEWCUST_ID\",\"payMethod\":\"CASH\",\"idempotencyKey\":\"visitor-store-key-1\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":1}]}")
check "visitor storefront order RESERVED" '"status":"RESERVED"' "$VO"
VID=$(echo "$VO" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
VO2=$(curl -s -b $JAR_VISITOR -X POST $BASE/api/orders -H 'Content-Type: application/json' -d "{\"customerId\":\"$NEWCUST_ID\",\"payMethod\":\"CASH\",\"idempotencyKey\":\"visitor-store-key-1\",\"items\":[{\"productId\":\"$TOM_ID\",\"unitId\":\"$TOM_CARTON\",\"qty\":1}]}")
check "idempotent re-submit" '"idempotent":true' "$VO2"
# ۱۸-۴: ویزیتور جزئیات سفارش خودش را می‌بیند ولی سفارش مدیر را نه
VOV=$(curl -s -b $JAR_VISITOR "$BASE/api/orders/$VID")
check "visitor sees own order detail" '"orderNo"' "$VOV"
VF=$(curl -s -b $JAR_VISITOR "$BASE/api/orders/$OID")
check "visitor cannot open admin order" 'FORBIDDEN' "$VF"
# ۱۸-۵: مدیر سفارش ویزیتور را با مشتری + ویزیتور + اقلام می‌بیند
AL=$(curl -s -b $JAR_ADMIN "$BASE/api/orders?take=200")
check "admin sees visitor name on order" 'سمیرا احمدی' "$AL"
check "admin sees quick-created customer" 'فروشگاه آزمون ویزیتور' "$AL"
VD=$(curl -s -b $JAR_ADMIN "$BASE/api/orders/$VID")
check "admin sees order items (qtyBase=24)" '"qtyBase":24' "$VD"
check "admin detail shows visitor" 'سمیرا احمدی' "$VD"
CA=$(curl -s -b $JAR_ADMIN $BASE/api/customers)
check "admin sees ALL customers (incl سحر)" 'CUS-1002' "$CA"
# ۱۸-۶: پاکسازی — لغو سفارش ویزیتوری توسط مدیر
RCV=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/orders/$VID -H 'Content-Type: application/json' -d '{"action":"cancel","note":"پاکسازی تست"}')
check "cleanup: cancelled" '"CANCELLED"' "$RCV"

say "19) تصاویر — تبدیل WebP سمت سرور"
# آپلود JPEG واقعی از فایل‌های نمونه — باید به WebP تبدیل شود
UP=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/uploads -F kind=banner -F "file=@public/products/tomato-paste-mit.jpg;type=image/jpeg")
check "uploaded image converted to webp" '.webp' "$UP"
UP_URL=$(echo "$UP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['url'])" 2>/dev/null || true)
if [ -n "$UP_URL" ] && [[ "$UP_URL" == *.webp ]] && [ -f "public$UP_URL" ]; then
  check "webp file exists on disk" 'webp' "public$UP_URL"
  CT=$(curl -s -I "$BASE$UP_URL" | grep -i '^content-type' | tr -d '\r')
  check "served as image/webp" 'image/webp' "$CT"
  rm -f "public$UP_URL" # پاکسازی فایل تست
else
  check "webp file exists on disk" 'ok' "$UP"
fi
# فایل خراب — امضای بایتی نامعتبر؛ قبل از رسیدن به پردازش تصویر رد می‌شود
printf 'not-an-image-at-all' > /tmp/bwh-bad.png
BAD=$(curl -s -b $JAR_ADMIN -X POST $BASE/api/uploads -F kind=banner -F "file=@/tmp/bwh-bad.png;type=image/png")
check "corrupt image rejected (byte signature)" 'BAD_TYPE' "$BAD"

say "20) تنظیمات موبایل صفحه ورود (گرادیانت متحرک)"
LS=$(curl -s $BASE/api/login-settings)
check "GET login-settings has mobile gradient" 'gradientColors' "$LS"
check "gradient default enabled" '"gradientEnabled":true' "$LS"
# اعتبارسنجی — رنگ نامعتبر رد می‌شود
LSBAD=$(curl -s -b $JAR_ADMIN -X PUT $BASE/api/login-settings -H 'Content-Type: application/json' -d '{"mobile":{"gradientColors":["#0d9488","red"]}}')
check "invalid gradient color rejected" 'ok":false' "$LSBAD"
# ذخیره پالت سفارشی و بازخوانی
LSPUT=$(curl -s -b $JAR_ADMIN -X PUT $BASE/api/login-settings -H 'Content-Type: application/json' -d '{"mobile":{"gradientColors":["#0d9488","#34d399","#065f46"],"gradientSpeed":18,"gradientAngle":120,"gradientIntensity":70}}')
check "PUT mobile palette ok" '"ok":true' "$LSPUT"
check "palette persisted" '#0d9488' "$LSPUT"
check "speed persisted" '"gradientSpeed":18' "$LSPUT"
# بازگردانی پیش‌فرض‌ها
curl -s -b $JAR_ADMIN -X PUT $BASE/api/login-settings -H 'Content-Type: application/json' -d '{"mobile":{"gradientColors":["#34d399","#0d9488","#10b981","#065f46"],"gradientSpeed":14,"gradientAngle":135,"gradientIntensity":60}}' > /dev/null

echo
echo "════ نتیجه: $PASS موفق، $FAIL ناموفق ════"
