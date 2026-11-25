#!/bin/bash
# ─── راه‌اندازی کامل محیط: PostgreSQL + سرور Next.js ───
# اجرا: bash scripts/start-env.sh
set -e
BIN=/home/z/my-project/.pglocal/bin
export LD_LIBRARY_PATH="/home/z/my-project/.pglocal/lib:$LD_LIBRARY_PATH"
export PATH="$BIN:$PATH"
DATA=/home/z/my-project/.pglocal/data
LOG=/home/z/my-project/.pglocal/pg.log

# ۱) PostgreSQL — اگر اجرا نیست، راه‌اندازی کن
if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
  pg_ctl -D "$DATA" -l "$LOG" -o "-p 5432 -k /tmp" start
  sleep 2
fi
echo "PG: $(pg_ctl -D "$DATA" status | head -1)"

# ۲) سرور وب — اگر روی پورت ۳۰۰۰ چیزی پاسخ نمی‌دهد، راه‌اندازی کن (daemon واقعی)
if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:3000/; then
  cd /home/z/my-project
  env -u DATABASE_URL -u DIRECT_URL start-stop-daemon --start --background \
    --make-pidfile --pidfile /tmp/bwh-dev.pid \
    --startas /usr/local/bin/bun --chdir /home/z/my-project --no-close \
    -- run dev > /tmp/bwh-dev-out.log 2>&1
  sleep 10
fi
echo "Web: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/)"
