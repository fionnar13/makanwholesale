#!/bin/bash
# راه‌اندازی PostgreSQL همراه (۱۶.۱۶) — باینری‌ها و کتابخانه‌ها در .pglocal/bin
BIN=/home/z/my-project/.pglocal/bin
export LD_LIBRARY_PATH="$BIN/lib:$LD_LIBRARY_PATH"
export PATH="$BIN:$PATH"
DATA=/home/z/my-project/.pglocal/data
LOG=/home/z/my-project/.pglocal/pg.log

if pg_ctl -D "$DATA" status >/dev/null 2>&1; then
  echo "PG already running"
  exit 0
fi
pg_ctl -D "$DATA" -l "$LOG" -o "-p 5432 -k /tmp" start
sleep 2
"$BIN/psql" --version >/dev/null 2>&1 || true
# بررسی آمادگی با اتصال واقعی
for i in 1 2 3 4 5; do
  if env -u DATABASE_URL -u DIRECT_URL bun -e "
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient({ datasources: { db: { url: 'postgresql://makan:makan123@127.0.0.1:5432/makan' } } })
await db.\$queryRaw\`SELECT 1\`
await db.\$disconnect()" >/dev/null 2>&1; then
    echo "PG ready on 127.0.0.1:5432"
    exit 0
  fi
  sleep 2
done
echo "PG failed to start — see $LOG"
tail -5 "$LOG"
exit 1
