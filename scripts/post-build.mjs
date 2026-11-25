// کپی خروجی standalone — سازگار با ویندوز/لینوکس/مک (جایگزین cp -r)
// پس از `next build` فایل‌های static و public را در .next/standalone قرار می‌دهد
// تا اجرای `node .next/standalone/server.js` (مثل Docker) درست کار کند.
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const standalone = join(root, '.next', 'standalone')

if (!existsSync(standalone)) {
  console.error('[post-build] .next/standalone not found — is output:"standalone" enabled?')
  process.exit(0)
}

for (const dir of ['.next/static', 'public']) {
  const src = join(root, dir)
  const dst = join(standalone, dir)
  if (!existsSync(src)) continue
  cpSync(src, dst, { recursive: true, force: true })
  console.log('[post-build] copied', dir, '→ .next/standalone/' + dir)
}
console.log('[post-build] done')
