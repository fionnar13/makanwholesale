#!/bin/bash
# ─── راه‌اندازی کامل محیط سندباکس: PostgreSQL + سرور Next.js ───
# اجرا: bash scripts/start-env.sh
# PostgreSQL از scripts/pg-local.mjs استفاده می‌کند (باینری‌ها از node_modules).

# ۱) PostgreSQL (+ .env سالم + مایگریشن)
node /home/z/my-project/scripts/pg-local.mjs

# ۲) سرور وب — اگر روی پورت ۳۰۰۰ چیزی پاسخ نمی‌دهد، به‌صورت دیمن راه‌اندازی کن
if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:3000/; then
  env -u DATABASE_URL -u DIRECT_URL start-stop-daemon --start --background \
    --make-pidfile --pidfile /tmp/bwh-dev.pid \
    --startas /usr/local/bin/bun --chdir /home/z/my-project --no-close \
    -- run dev > /tmp/bwh-dev-out.log 2>&1
  sleep 12
fi
echo "Web: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 http://127.0.0.1:3000/)"
