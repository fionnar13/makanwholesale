#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// راه‌اندازی خودکار PostgreSQL لوکال — سازگار با ویندوز/لینوکس/مک
//   اجرا:   node scripts/pg-local.mjs          (شروع + مایگریشن)
//           node scripts/pg-local.mjs --seed   (شروع + مایگریشن + Seed داده‌های اولیه)
//
// باینری‌های PostgreSQL از پکیج devDependency «@embedded-postgres/linux-x64»
// داخل node_modules خوانده می‌شوند؛ دیتادایرکتوری در node_modules/.pgdata است.
// اگر دیتابیس تازه باشد: initdb → ساخت نقش/دیتابیس → migrate deploy → (در صورت --seed) seed
// ─────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NATIVE = join(ROOT, 'node_modules', '@embedded-postgres', 'linux-x64', 'native')
const BIN = join(NATIVE, 'bin')
const LIB = join(NATIVE, 'lib')
const DATA = join(ROOT, 'node_modules', '.pgdata')
const LOG = join(ROOT, 'node_modules', '.pgdata.log')
const PG_PORT = 5432
const PG_URL = `postgresql://makan:makan123@127.0.0.1:${PG_PORT}/makan`
const SUPER_URL = `postgresql://postgres:postgres123@127.0.0.1:${PG_PORT}/postgres`

const pg = (name, args) => spawnSync(join(BIN, name), args, {
  stdio: 'inherit',
  env: { ...process.env, LD_LIBRARY_PATH: `${LIB}:${process.env.LD_LIBRARY_PATH ?? ''}` },
})

function fixIcuSymlinks() {
  // 'libicuuc.so.60.2' → لینک 'libicuuc.so.60' (در ویندوز symlink لازم نیست)
  for (const base of ['libicui18n.so.60.2', 'libicuuc.so.60.2', 'libicudata.so.60.2']) {
    const link = join(LIB, base.replace(/\.2$/, ''))
    const bad = join(LIB, base.replace('.60.2', '.so.60'))
    if (existsSync(bad) && !existsSync(join(LIB, base))) { try { unlinkSync(bad) } catch { /* ignore */ } }
    if (existsSync(join(LIB, base)) && !existsSync(link)) { try { symlinkSync(base, link) } catch { /* ویندوز: نادیده */ } }
  }
}

function isUp() {
  const r = spawnSync('node', ['-e', `const net=require('net');const s=net.connect(${PG_PORT},'127.0.0.1',()=>{console.log('up');s.end()});s.on('error',()=>{console.log('down')});setTimeout(()=>process.exit(0),1500)`], { encoding: 'utf8' })
  return r.stdout?.trim() === 'up'
}

function sql(query) {
  const r = spawnSync('node', ['-e', `
    (async () => {
      const { execSync } = require('node:child_process')
      // استفاده از Prisma برای اجرای SQL — همان درایوری که پروژه دارد
      const { PrismaClient } = require('${join(ROOT, 'node_modules', '@prisma/client').replaceAll('\\', '\\\\')}')
      const db = new PrismaClient({ datasources: { db: { url: process.env.SUPER_URL } } })
      try { await db.$executeRawUnsafe(process.argv[1]); console.log('ok') }
      catch (e) { console.log('exists: ' + e.message.split('\\n')[0].slice(0, 80)) }
      await db.$disconnect()
    })()
  `, query], { encoding: 'utf8', env: { ...process.env, SUPER_URL }, cwd: ROOT })
  return r.stdout?.trim()
}

// ۱) لینک‌های ICU
fixIcuSymlinks()

// ۲) اگر پروسه اجرا است — فقط .env را مطمئن شویم
if (isUp()) {
  console.log('[pg-local] PostgreSQL already running on port', PG_PORT)
} else {
  const fresh = !existsSync(join(DATA, 'PG_VERSION'))
  if (fresh) {
    mkdirSync(DATA, { recursive: true })
    const pwFile = join(DATA, '..' , '.pg_super_pw')
    writeFileSync(pwFile, 'postgres123\n')
    console.log('[pg-local] initializing new data directory…')
    pg('initdb', ['-D', DATA, '-U', 'postgres', '-A', 'md5', '--pwfile=' + pwFile, '-E', 'UTF8'])
  }
  console.log('[pg-local] starting PostgreSQL…')
  pg('pg_ctl', ['-D', DATA, '-l', LOG, '-o', `-p ${PG_PORT} -k ${dirname(LOG)}`, 'start'])
  // انتظار برای آماده شدن
  for (let i = 0; i < 15 && !isUp(); i++) { spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']) }
  if (!isUp()) { console.error('[pg-local] failed to start — see log: ' + LOG); process.exit(1) }
  if (fresh) {
    console.log('[pg-local] creating role makan + database makan…')
    sql("CREATE ROLE makan LOGIN PASSWORD 'makan123' CREATEDB")
    sql('CREATE DATABASE makan OWNER makan')
  }
}

// ۳) .env — اگر به SQLite اشاره می‌کند یا DIRECT_URL ندارد، اصلاح شود
const envPath = join(ROOT, '.env')
let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
if (!envText.includes('postgresql://') || !envText.includes('DIRECT_URL=')) {
  writeFileSync(envPath, `DATABASE_URL=${PG_URL}\nDIRECT_URL=${PG_URL}\n`)
  console.log('[pg-local] .env rewritten for local PostgreSQL')
}

// ۴) مایگریشن‌ها
console.log('[pg-local] prisma migrate deploy…')
spawnSync(process.execPath, [join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
  stdio: 'inherit', cwd: ROOT, env: { ...process.env, DATABASE_URL: PG_URL, DIRECT_URL: PG_URL },
})

// ۵) Seed اختیاری
if (process.argv.includes('--seed')) {
  console.log('[pg-local] seeding…')
  const r = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'scripts', 'seed.ts')], {
    stdio: 'inherit', cwd: ROOT,
    env: { ...process.env, DATABASE_URL: PG_URL, DIRECT_URL: PG_URL, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Admin#1404' },
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log('[pg-local] ready →', PG_URL)
