'use client'
// تنظیمات یکپارچه‌سازی — اتصال سرویس‌های خارجی بدون نیاز به دانش فنی
// کارت‌ها: Google Drive (بکاپ)، Google Sheets، تلگرام، هوش مصنوعی، ورود/خروج داده، لاگ‌ها
import { useEffect, useState } from 'react'
import { apiFetch, apiUpload, useApiData, DataTable, JDate, PageHeader, Field, formatFaNumber, type Col } from './kit'
import type { SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import {
  CloudUpload, FileSpreadsheet, Send, Sparkles, DatabaseBackup, ArrowUpDown, ScrollText,
  RefreshCw, CheckCircle2, XCircle, Loader2, Plug, HelpCircle, KeyRound, Download, Upload, Bot,
} from 'lucide-react'
import { toast } from 'sonner'

// ─── انواع داده از API ───

type DatasetInfo = { key: string; label: string; exportOnly: boolean }
type Overview = {
  google: {
    mode: 'oauth' | 'service'
    serviceAccountEmail: string | null
    serviceAccountJsonSet: boolean
    folderId: string | null
    retentionCount: number
    connected: boolean
    accounts: Array<{ id: string; email: string; displayName: string | null; isBackupTarget: boolean; tokenValidUntil: string | null; updatedAt: string }>
  }
  sheets: { serviceAccountEmail: string | null; serviceAccountJsonSet: boolean; spreadsheetId: string; sheetName: string; syncIntervalMinutes: number; mappings: Record<string, Record<string, string>>; nextSyncAt: string | null; connected: boolean }
  telegram: { botToken: string | null; chatId: string; events: string[]; templates: Record<string, string>; connected: boolean }
  ai: { enabled: boolean; provider: string; baseUrl: string; apiKey: string | null; model: string; systemPrompt: string; temperature: number; maxDataRows: number; connected: boolean }
  backup: {
    enabled: boolean; format: string; interval: string; hour: number; datasets: string[]; retentionCount: number; nextRunAt: string | null
    lastRun: { id: string; status: string; trigger: string; format: string; fileCount: number; sizeBytes: number; message: string | null; startedAt: string; files?: Array<{ name: string; link: string | null }> } | null
    stats: { success: number; failed: number }
    health?: { level: 'OK' | 'DELAYED' | 'FAILED' | 'STALE' | 'OFF'; message: string; hoursSinceSuccess: number | null }
  }
  datasets: DatasetInfo[]
  telegramEvents: Array<{ key: string; label: string; description: string }>
}

function ConnBadge({ connected, connectedText = 'متصل', disconnectedText = 'غیرمتصل' }: { connected: boolean; connectedText?: string; disconnectedText?: string }) {
  return connected ? (
    <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><CheckCircle2 className="h-3 w-3" /> {connectedText}</Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-stone-500"><XCircle className="h-3 w-3" /> {disconnectedText}</Badge>
  )
}

function Guide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border bg-stone-50/60 text-sm">
      <summary className="cursor-pointer select-none flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-600">
        <HelpCircle className="h-3.5 w-3.5 text-sky-600" /> {title}
      </summary>
      <div className="px-3 pb-3 pt-1 text-[12px] leading-6 text-stone-600 space-y-1.5">{children}</div>
    </details>
  )
}

const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`

// وضعیت رنگی آخرین بکاپ — سبز: موفق و به‌روز، زرد: تأخیر، قرمز: ناموفق/بیش از ۲۴ ساعت، خاکستری: خاموش
type BackupHealthLevel = NonNullable<Overview['backup']['health']>['level']

function BackupHealthBanner({ health }: { health?: Overview['backup']['health'] }) {
  if (!health) return null
  const map: Record<BackupHealthLevel, { label: string; cls: string; dot: string }> = {
    OK: { label: 'به‌روز', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
    DELAYED: { label: 'تأخیر', cls: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
    FAILED: { label: 'ناموفق', cls: 'border-rose-200 bg-rose-50 text-rose-800', dot: 'bg-rose-500' },
    STALE: { label: 'متوقف (بیش از ۲۴ ساعت)', cls: 'border-rose-200 bg-rose-50 text-rose-800', dot: 'bg-rose-500' },
    OFF: { label: 'خاموش', cls: 'border-stone-200 bg-stone-50 text-stone-600', dot: 'bg-stone-400' },
  }
  const s = map[health.level]
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${s.cls}`}>
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
      <span><b>وضعیت آخرین بکاپ: {s.label}</b> — {health.message}</span>
    </div>
  )
}

export default function IntegrationsView({ user }: { user: SessionUserLike }) {
  const { data: ov, loading, reload } = useApiData<Overview>('/api/integrations')
  const [tab, setTab] = useState('drive')

  return (
    <div>
      <PageHeader
        title="تنظیمات یکپارچه‌سازی"
        desc="اتصال سرویس‌های خارجی — گوگل، تلگرام و هوش مصنوعی؛ همه بدون نیاز به دانش فنی از همین پنل تنظیم می‌شود"
        actions={<Button variant="outline" size="sm" onClick={reload}><RefreshCw className="h-4 w-4 ml-1" /> به‌روزرسانی</Button>}
      />

      {/* کارت‌های خلاصه وضعیت */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-5">
        <StatusCard icon={CloudUpload} label="Google Drive" connected={ov?.google.connected} hint={ov?.google.connected ? (ov.google.mode === 'oauth' ? ov.google.accounts[0]?.email : ov.google.serviceAccountEmail ?? undefined) : 'برای بکاپ خودکار اتصال دهید'} onClick={() => setTab('drive')} />
        <StatusCard icon={FileSpreadsheet} label="Google Sheets" connected={ov?.sheets.connected} hint={ov?.sheets.connected ? ov.sheets.spreadsheetId : 'همگام‌سازی اکسل آنلاین'} onClick={() => setTab('sheets')} />
        <StatusCard icon={Send} label="تلگرام" connected={ov?.telegram.connected} hint="اطلاع‌رسانی رویدادها و ارسال گزارش" onClick={() => setTab('telegram')} />
        <StatusCard icon={Sparkles} label="هوش مصنوعی" connected={ov?.ai.connected} hint="پاسخ مدیریتی، خلاصه و دسته‌بندی خودکار" onClick={() => setTab('ai')} />
        <StatusCard icon={DatabaseBackup} label="بکاپ خودکار" connected={ov?.backup.enabled} connectedText="فعال" disconnectedText="خاموش" hint={ov?.backup.nextRunAt ? `اجرای بعدی: ${new Date(ov.backup.nextRunAt).toLocaleString('fa-IR')}` : 'برنامه‌ریزی نشده'} onClick={() => setTab('backup')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="drive" className="gap-1.5"><CloudUpload className="h-3.5 w-3.5" /> Google Drive</TabsTrigger>
          <TabsTrigger value="backup" className="gap-1.5"><DatabaseBackup className="h-3.5 w-3.5" /> بکاپ خودکار</TabsTrigger>
          <TabsTrigger value="sheets" className="gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> Google Sheets</TabsTrigger>
          <TabsTrigger value="telegram" className="gap-1.5"><Send className="h-3.5 w-3.5" /> تلگرام</TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> هوش مصنوعی</TabsTrigger>
          <TabsTrigger value="data" className="gap-1.5"><ArrowUpDown className="h-3.5 w-3.5" /> ورود و خروج داده</TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5"><ScrollText className="h-3.5 w-3.5" /> لاگ‌ها</TabsTrigger>
        </TabsList>

        <TabsContent value="drive" className="mt-4">{ov && <DriveTab ov={ov} reload={reload} user={user} />}</TabsContent>
        <TabsContent value="backup" className="mt-4">{ov && <BackupTab ov={ov} reload={reload} />}</TabsContent>
        <TabsContent value="sheets" className="mt-4">{ov && <SheetsTab ov={ov} reload={reload} user={user} />}</TabsContent>
        <TabsContent value="telegram" className="mt-4">{ov && <TelegramTab ov={ov} reload={reload} />}</TabsContent>
        <TabsContent value="ai" className="mt-4">{ov && <AiTab ov={ov} reload={reload} />}</TabsContent>
        <TabsContent value="data" className="mt-4">{ov && <DataTab ov={ov} user={user} />}</TabsContent>
        <TabsContent value="logs" className="mt-4"><LogsTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function StatusCard({ icon: Icon, label, connected, hint, onClick, connectedText, disconnectedText }: {
  icon: typeof CloudUpload; label: string; connected?: boolean; hint?: string; onClick?: () => void; connectedText?: string; disconnectedText?: string
}) {
  return (
    <button onClick={onClick} className="text-right rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-emerald-500 hover:bg-emerald-50/30">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-emerald-600" /> {label}</span>
        {connected === undefined ? <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-400" /> : <ConnBadge connected={connected} connectedText={connectedText ?? 'متصل'} disconnectedText={disconnectedText ?? 'غیرمتصل'} />}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground mt-2 line-clamp-2" dir="auto">{hint}</p>}
    </button>
  )
}

// ═══════════════ Google Drive ═══════════════

function DriveTab({ ov, reload, user }: { ov: Overview; reload: () => void; user: SessionUserLike }) {
  const g = ov.google
  const [mode, setMode] = useState<'oauth' | 'service'>(g.mode)
  const [saJson, setSaJson] = useState('')
  const [folderId, setFolderId] = useState(g.folderId ?? '')
  const [retention, setRetention] = useState(String(g.retentionCount))
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const save = async () => {
    setBusy('save')
    try {
      await apiFetch('/api/integrations/google-drive', {
        method: 'PUT',
        body: JSON.stringify({
          mode,
          serviceAccountJson: saJson.trim() ? saJson : null,
          folderId: folderId.trim() || null,
          retentionCount: Number(retention) || 10,
        }),
      })
      toast.success('تنظیمات Google Drive ذخیره شد')
      setSaJson('')
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ذخیره')
    } finally { setBusy(null) }
  }

  const action = async (act: 'test' | 'disconnect') => {
    setBusy(act)
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/api/integrations/google-drive', {
        method: 'POST', body: JSON.stringify({ action: act }),
      })
      res.ok ? toast.success(res.message) : toast.error(res.message)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(null) }
  }

  const connectGoogle = async () => {
    setBusy('connect')
    try {
      const res = await apiFetch<{ url: string }>('/api/integrations/google/connect', { method: 'POST' })
      window.location.href = res.url
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در شروع اتصال')
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><CloudUpload className="h-4 w-4 text-emerald-600" /> اتصال Google Drive (مقصد بکاپ)</h3>
          <ConnBadge connected={g.connected} />
        </div>

        <Field label="روش اتصال">
          <Select value={mode} onValueChange={v => setMode(v as 'oauth' | 'service')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="oauth">حساب شخصی Google (Gmail) — ساده‌ترین روش</SelectItem>
              <SelectItem value="service">Service Account — مناسب سازمانی</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {mode === 'oauth' && (
          <div className="space-y-3">
            <Guide title="راهنمای اتصال حساب شخصی گوگل">
              <p>۱) باید Client ID و Client Secret گوگل تنظیم شده باشد (تب «ورود با گوگل» در پنل مدیریت داده‌ها یا متغیرهای محیطی).</p>
              <p>۲) روی «اتصال حساب Google» بزنید و در صفحه گوگل حساب خود را انتخاب و به دو مجوز زیر اجازه بدهید:</p>
              <p className="pr-4">• دیدن ایمیل و نام (profile/email)</p>
              <p className="pr-4">• مدیریت فایل‌های ساخته‌شده توسط همین برنامه (drive.file — به کل Drive شما دسترسی ندارد)</p>
              <p>۳) حساب متصل به‌عنوان مقصد بکاپ خودکار استفاده می‌شود. چند حساب می‌توانید متصل کنید و مقصد را انتخاب کنید.</p>
            </Guide>
            <div className="flex flex-wrap gap-2">
              <Button onClick={connectGoogle} disabled={busy === 'connect'}>
                {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} اتصال حساب Google
              </Button>
            </div>
            {g.accounts.length > 0 && (
              <div className="rounded-lg border divide-y text-sm">
                {g.accounts.map(a => (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate" dir="ltr">{a.email}</div>
                      <div className="text-[11px] text-muted-foreground">متصل: <JDate d={a.updatedAt} /> {a.tokenValidUntil && `— توکن معتبر تا ${new Date(a.tokenValidUntil).toLocaleString('fa-IR')}`}</div>
                    </div>
                    {a.isBackupTarget && <Badge className="bg-emerald-100 text-emerald-800">مقصد بکاپ</Badge>}
                    {!a.isBackupTarget && (
                      <Button size="sm" variant="outline" onClick={async () => {
                        try {
                          const res = await apiFetch<{ ok: boolean; message: string }>('/api/integrations/google-drive', {
                            method: 'POST', body: JSON.stringify({ action: 'set-backup-target', accountId: a.id }),
                          })
                          toast.success(res.message)
                          reload()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'خطا')
                        }
                      }} title="تعیین به‌عنوان مقصد بکاپ">تعیین مقصد</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'service' && (
          <div className="space-y-3">
            <Guide title="راهنمای Service Account">
              <p>۱) در Google Cloud Console یک Service Account بسازید و کلید JSON آن را دانلود کنید (IAM &amp; Admin → Service Accounts → Keys → Add Key → JSON).</p>
              <p>۲) محتوای کامل فایل JSON را در کادر زیر بچسبانید و ذخیره کنید.</p>
              <p>۳) برای بکاپ: اگر شناسه پوشه Drive می‌دهید، پوشه را با ایمیل سرویس‌اکانت به اشتراک بگذارید (نقش Editor). اگر پوشه ندهید، فایل‌ها در ریشه Drive سرویس‌اکانت ساخته می‌شوند.</p>
            </Guide>
            {g.serviceAccountJsonSet && (
              <p className="text-xs text-emerald-700">✓ فایل سرویس‌اکانت ذخیره شده — ایمیل: <span dir="ltr" className="font-medium">{g.serviceAccountEmail}</span></p>
            )}
            <Field label="محتوای فایل JSON سرویس‌اکانت" hint="پس از ذخیره، مقدار به‌صورت رمزنگاری‌شده نگهداری می‌شود و دیگر نمایش داده نمی‌شود">
              <Textarea dir="ltr" rows={5} className="text-xs font-mono" placeholder='{"type":"service_account","project_id":...}' value={saJson} onChange={e => setSaJson(e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="شناسه پوشه Drive مقصد (اختیاری)" hint="از URL پوشه در Drive کپی کنید؛ خالی = ریشه My Drive">
          <Input dir="ltr" value={folderId} onChange={e => setFolderId(e.target.value)} placeholder="1AbC..." />
        </Field>
        <Field label="تعداد نسخه‌های نگهداری‌شده" hint="نسخه‌های قدیمی‌تر پس از هر بکاپ موفق خودکار حذف می‌شوند">
          <Input type="number" min={1} max={100} value={retention} onChange={e => setRetention(e.target.value)} />
        </Field>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={save} disabled={busy === 'save'}>
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ذخیره تنظیمات
          </Button>
          <Button variant="outline" onClick={() => action('test')} disabled={busy === 'test'}>
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} آزمایش اتصال
          </Button>
          <Button variant="destructive" onClick={() => setConfirmDisconnect(true)}>
            قطع اتصال و پاک‌سازی توکن‌ها
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h3 className="font-bold text-sm">نکات امنیتی</h3>
        <ul className="text-xs leading-6 text-muted-foreground space-y-1.5 list-disc pr-5">
          <li>توکن‌های OAuth، Refresh Token و محتوای Service Account با AES-256-GCM رمزنگاری و در دیتابیس ذخیره می‌شوند — هرگز در کد یا مخزن قرار نمی‌گیرند.</li>
          <li>کلید رمزنگاری از متغیر محیطی <span dir="ltr">INTEGRATION_SECRET_KEY</span> خوانده می‌شود؛ تغییر آن باعث عدم امکان بازگشایی توکن‌های قبلی می‌شود.</li>
          <li>اسکوپ درخواستی فقط <span dir="ltr">drive.file</span> است: برنامه فقط به فایل‌هایی که خودش می‌سازد دسترسی دارد، نه کل Drive شما.</li>
          <li>قطع اتصال همه توکن‌ها و داده‌های حساس را کامل حذف می‌کند.</li>
        </ul>
        <p className="text-[11px] text-stone-400">کاربر: {user.name} — همه تغییرات در سوابق سیستم ثبت می‌شود.</p>
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>قطع اتصال گوگل؟</AlertDialogTitle>
            <AlertDialogDescription>
              همه حساب‌های متصل، توکن‌ها و تنظیمات Google Drive حذف می‌شوند. بکاپ‌های خودکار متوقف می‌شوند. این عملیات بازگشت‌پذیر نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { await action('disconnect'); setConfirmDisconnect(false) }}>قطع اتصال</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ═══════════════ بکاپ خودکار ═══════════════

type BackupDetail = {
  config: { enabled: boolean; format: string; interval: string; hour: number; datasets: string[]; retentionCount: number; nextRunAt: string | null }
  runs: Array<{ id: string; status: string; trigger: string; format: string; scope: string[]; fileCount: number; sizeBytes: number; message: string | null; durationMs: number | null; startedAt: string; files: Array<{ name: string; link: string | null }> | null }>
}

function BackupTab({ ov, reload }: { ov: Overview; reload: () => void }) {
  const { data, reload: reloadDetail } = useApiData<BackupDetail>('/api/integrations/backup')
  const c = data?.config
  const [enabled, setEnabled] = useState(false)
  const [format, setFormat] = useState('XLSX')
  const [interval, setInterval_] = useState('DAILY')
  const [hour, setHour] = useState('3')
  const [datasets, setDatasets] = useState<string[]>([])
  const [retention, setRetention] = useState('10')
  const [busy, setBusy] = useState<string | null>(null)
  const [initd, setInitd] = useState(false)

  useEffect(() => {
    if (c && !initd) {
      setEnabled(c.enabled); setFormat(c.format); setInterval_(c.interval)
      setHour(String(c.hour)); setDatasets(c.datasets); setRetention(String(c.retentionCount))
      setInitd(true)
    }
  }, [c, initd])

  const save = async () => {
    setBusy('save')
    try {
      await apiFetch('/api/integrations/backup', {
        method: 'PUT',
        body: JSON.stringify({ enabled, format, interval, hour: Number(hour), datasets, retentionCount: Number(retention) }),
      })
      toast.success('تنظیمات بکاپ ذخیره شد')
      reload(); reloadDetail()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ذخیره')
    } finally { setBusy(null) }
  }

  const runNow = async () => {
    setBusy('run')
    try {
      const res = await apiFetch<{ status: string; message: string; fileCount: number; sizeBytes: number; files?: Array<{ name: string; link: string | null }> }>('/api/integrations/backup', {
        method: 'POST', body: JSON.stringify({ action: 'run' }),
      })
      if (res.status === 'SUCCESS') {
        toast.success(`بکاپ موفق — ${res.fileCount} فایل (${fmtSize(res.sizeBytes)})`)
        if (res.files?.length) window.open(res.files[0].link ?? '', '_blank')
      } else {
        toast.error(res.message)
      }
      reload(); reloadDetail()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در اجرای بکاپ')
    } finally { setBusy(null) }
  }

  const cols: Col<BackupDetail['runs'][number]>[] = [
    { key: 'status', header: 'وضعیت', cell: r => r.status === 'SUCCESS' ? <Badge className="bg-emerald-100 text-emerald-800">موفق</Badge> : r.status === 'FAILED' ? <Badge className="bg-rose-100 text-rose-800">ناموفق</Badge> : <Badge variant="outline">در حال اجرا</Badge> },
    { key: 'trigger', header: 'نوع', cell: r => r.trigger === 'MANUAL' ? 'دستی' : 'خودکار' },
    { key: 'format', header: 'فرمت', cell: r => <span dir="ltr">{r.format}</span> },
    { key: 'scope', header: 'دیتاست‌ها', cell: r => <span className="text-xs">{r.scope.map(s => ov.datasets.find(d => d.key === s)?.label ?? s).join('، ')}</span> },
    { key: 'files', header: 'فایل‌ها', cell: r => `${formatFaNumber(r.fileCount)} (${fmtSize(r.sizeBytes)})` },
    { key: 'startedAt', header: 'زمان', cell: r => <JDate d={r.startedAt} time /> },
    { key: 'msg', header: 'پیام', cell: r => <span className="text-xs text-muted-foreground line-clamp-2">{r.message}</span> },
    {
      key: 'link', header: '', cell: r => r.files?.[0]?.link
        ? <a href={r.files[0].link} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 hover:underline">مشاهده در Drive</a>
        : null,
    },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><DatabaseBackup className="h-4 w-4 text-emerald-600" /> بکاپ خودکار در Google Drive</h3>
          <ConnBadge connected={Boolean(c?.enabled)} connectedText="فعال" disconnectedText="خاموش" />
        </div>

        <BackupHealthBanner health={ov.backup?.health} />

        <Guide title="چطور کار می‌کند؟">
          <p>• داده‌های انتخابی در فرمت انتخابی به Google Drive حساب متصل‌شده آپلود می‌شود.</p>
          <p>• اجرا هر بار پس از موفقیت، نسخه‌های قدیمی‌تر از سقف نگهداشت حذف می‌شوند.</p>
          <p>• وضعیت، لاگ موفقیت/خطا و پیام آزمایشی در همین صفحه و در کارت تلگرام قابل پیگیری است.</p>
          <p>• روی سرورهای رایگان (مثل Render) سرویس پس از بی‌کاری می‌خوابد؛ برای دقیق‌بودن ساعت اجرا می‌توانید یک سرویس cron بیرونی را به مسیر <span dir="ltr">POST /api/integrations/scheduler/tick</span> با هدر <span dir="ltr">x-cron-secret</span> وصل کنید.</p>
        </Guide>

        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
          <span className="text-sm font-medium">بکاپ خودکار فعال باشد</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="فرمت پیش‌فرض بکاپ">
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="XLSX">Excel (XLSX) — برای کاربر غیرفنی</SelectItem>
                <SelectItem value="CSV">CSV — برای اکسل و تبادل جدولی</SelectItem>
                <SelectItem value="JSON">JSON — بکاپ کامل ساختاریافته</SelectItem>
                <SelectItem value="TS">TypeScript — خروجی typed برای کد</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="بازه زمانی">
            <Select value={interval} onValueChange={setInterval_}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAILY">روزانه</SelectItem>
                <SelectItem value="WEEKLY">هفتگی</SelectItem>
                <SelectItem value="MONTHLY">ماهانه (اول هر ماه)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="ساعت اجرا (به وقت تهران)">
            <Input type="number" min={0} max={23} value={hour} onChange={e => setHour(e.target.value)} />
          </Field>
          <Field label="تعداد نسخه نگهداری‌شده">
            <Input type="number" min={1} max={100} value={retention} onChange={e => setRetention(e.target.value)} />
          </Field>
        </div>

        <Field label="چه داده‌هایی بکاپ گرفته شود؟">
          <div className="flex flex-wrap gap-2">
            {ov.datasets.map(d => (
              <label key={d.key} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${datasets.includes(d.key) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'hover:bg-stone-50'}`}>
                <input
                  type="checkbox" className="accent-emerald-600" checked={datasets.includes(d.key)}
                  onChange={e => setDatasets(prev => e.target.checked ? [...prev, d.key] : prev.filter(k => k !== d.key))}
                />
                {d.label}
              </label>
            ))}
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy === 'save'}>
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ذخیره برنامه
          </Button>
          <Button variant="outline" onClick={runNow} disabled={busy === 'run'}>
            {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />} اجرای دستی بکاپ
          </Button>
          {c?.nextRunAt && <span className="text-xs text-muted-foreground self-center">اجرای بعدی: {new Date(c.nextRunAt).toLocaleString('fa-IR')}</span>}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-bold text-sm mb-3">سابقه اجرا</h3>
        <DataTable columns={cols} rows={data?.runs ?? []} rowKey={r => r.id} loading={!data} empty="هنوز بکاپی اجرا نشده است" />
      </div>
    </div>
  )
}

// ═══════════════ Google Sheets ═══════════════

function SheetsTab({ ov, reload, user }: { ov: Overview; reload: () => void; user: SessionUserLike }) {
  const s = ov.sheets
  const [saJson, setSaJson] = useState('')
  const [spreadsheetId, setSpreadsheetId] = useState(s.spreadsheetId)
  const [sheetName, setSheetName] = useState(s.sheetName)
  const [intervalMin, setIntervalMin] = useState(String(s.syncIntervalMinutes))
  const [busy, setBusy] = useState<string | null>(null)
  const [mappingDataset, setMappingDataset] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{ validRows: number; errors: Array<{ row: number; message: string }>; sample: Array<Record<string, unknown>> } | null>(null)

  const importableDatasets = ov.datasets.filter(d => !d.exportOnly)

  useEffect(() => {
    if (mappingDataset && ov) {
      setMapping(ov.sheets.mappings[mappingDataset] ?? {})
      setPreview(null)
    }
  }, [mappingDataset, ov])

  const save = async (extra?: Record<string, unknown>) => {
    setBusy('save')
    try {
      await apiFetch('/api/integrations/sheets', {
        method: 'PUT',
        body: JSON.stringify({
          serviceAccountJson: saJson.trim() ? saJson : null,
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim() || 'Sheet1',
          syncIntervalMinutes: Number(intervalMin) || 0,
          ...extra,
        }),
      })
      toast.success('تنظیمات Google Sheets ذخیره شد')
      setSaJson('')
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ذخیره')
    } finally { setBusy(null) }
  }

  const doAction = async (action: string, dataset?: string) => {
    setBusy(action + (dataset ?? ''))
    try {
      if (action === 'test') {
        const res = await apiFetch<{ ok: boolean; message: string; sheets?: string[] }>('/api/integrations/sheets', { method: 'POST', body: JSON.stringify({ action: 'test' }) })
        res.ok ? toast.success(res.message) : toast.error(res.message)
      } else if (action === 'sync-export') {
        const res = await apiFetch<{ message: string }>('/api/integrations/sheets', { method: 'POST', body: JSON.stringify({ action: 'sync-export', dataset }) })
        toast.success(res.message)
      } else if (action === 'sync-import-preview') {
        const res = await apiFetch<{ validRows: number; errors: Array<{ row: number; message: string }>; sample: Array<Record<string, unknown>> }>('/api/integrations/sheets', { method: 'POST', body: JSON.stringify({ action: 'sync-import-preview', dataset }) })
        setPreview(res)
        toast.info(`${res.validRows} سطر معتبر — ${res.errors.length} خطا`)
      } else if (action === 'sync-import-apply') {
        const res = await apiFetch<{ message: string }>('/api/integrations/sheets', { method: 'POST', body: JSON.stringify({ action: 'sync-import-apply', dataset }) })
        toast.success(res.message)
        reload()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(null) }
  }

  const saveMapping = async () => {
    if (!mappingDataset) return
    await save({ mappings: { [mappingDataset]: mapping } })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> اتصال Google Sheets (اکسل آنلاین گوگل)</h3>
          <ConnBadge connected={s.connected} />
        </div>

        <Guide title="راهنمای اتصال (۳ قدم ساده)">
          <p>۱) در Google Cloud Console یک Service Account بسازید و کلید JSON دانلود کنید — همان فایل مرحله Drive قابل استفاده است.</p>
          <p>۲) یک Google Spreadsheet بسازید و از منوی اشتراک‌گذاری، ایمیل سرویس‌اکانت (مثل <span dir="ltr">makan-bot@project.iam.gserviceaccount.com</span>) را با نقش «ویرایشگر (Editor)» اضافه کنید.</p>
          <p>۳) شناسه فایل را از URL کپی کنید: <span dir="ltr">docs.google.com/spreadsheets/d/<b>THIS-ID</b>/edit</span> و در کادر زیر بگذارید، سپس «آزمایش اتصال» را بزنید.</p>
        </Guide>

        {s.serviceAccountJsonSet && (
          <p className="text-xs text-emerald-700">✓ سرویس‌اکانت ذخیره شده — ایمیل: <span dir="ltr" className="font-medium">{s.serviceAccountEmail}</span></p>
        )}
        <Field label="محتوای فایل JSON سرویس‌اکانت" hint="اگر قبلاً ذخیره کرده‌اید، خالی بگذارید">
          <Textarea dir="ltr" rows={4} className="text-xs font-mono" placeholder='{"type":"service_account",...}' value={saJson} onChange={e => setSaJson(e.target.value)} />
        </Field>
        <Field label="شناسه Spreadsheet" required>
          <Input dir="ltr" value={spreadsheetId} onChange={e => setSpreadsheetId(e.target.value)} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="نام تب (شیت)">
            <Input value={sheetName} onChange={e => setSheetName(e.target.value)} placeholder="Sheet1" />
          </Field>
          <Field label="بازه همگام‌سازی خودکار (دقیقه)" hint="۰ = خاموش">
            <Input type="number" min={0} value={intervalMin} onChange={e => setIntervalMin(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save()} disabled={busy === 'save'}>
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ذخیره
          </Button>
          <Button variant="outline" onClick={() => doAction('test')} disabled={busy === 'test'}>
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} آزمایش اتصال
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <h3 className="font-bold text-sm">نگاشت فیلدها و همگام‌سازی</h3>
        <Field label="دیتاست" hint="دیتاست‌های فقط‌خواندنی (مثل سفارش‌ها) برای ورود داده پشتیبانی نمی‌شوند">
          <Select value={mappingDataset} onValueChange={setMappingDataset}>
            <SelectTrigger><SelectValue placeholder="انتخاب کنید…" /></SelectTrigger>
            <SelectContent>
              {ov.datasets.map(d => <SelectItem key={d.key} value={d.key} disabled={d.exportOnly}>{d.label}{d.exportOnly ? ' (فقط خروجی)' : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        {mappingDataset && (
          <>
            <p className="text-xs text-muted-foreground">نام ستون در شیت برای هر فیلد — برچسب فارسی پیش‌فرض است و می‌توانید تغییر دهید:</p>
            <div className="grid gap-2 max-h-64 overflow-y-auto pr-1">
              {(ov.datasets.find(d => d.key === mappingDataset)?.label ? Object.entries(s.mappings[mappingDataset] ?? {}) : []).length === 0 && (
                <p className="text-xs text-stone-400">نگام فعلی خالی است — ذخیره کنید تا نگاشت پیش‌فرض ساخته شود</p>
              )}
              {Object.entries(mapping).map(([field, col]) => (
                <div key={field} className="flex items-center gap-2">
                  <Input className="flex-1 text-xs" value={col} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))} placeholder="نام ستون در شیت" />
                  <span className="text-[11px] text-muted-foreground w-28 shrink-0">{field}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={saveMapping} disabled={busy === 'save'}>
                {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} ذخیره نگاشت
              </Button>
              <Button size="sm" variant="outline" onClick={() => doAction('sync-export', mappingDataset)} disabled={busy === 'sync-export' + mappingDataset}>
                {busy === 'sync-export' + mappingDataset ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpDown className="h-3.5 w-3.5" />} نوشتن در شیت
              </Button>
              <Button size="sm" variant="outline" onClick={() => doAction('sync-import-preview', mappingDataset)} disabled={busy === 'sync-import-preview' + mappingDataset}>
                پیش‌نمایش ورود از شیت
              </Button>
              <Button size="sm" onClick={() => doAction('sync-import-apply', mappingDataset)} disabled={busy === 'sync-import-apply' + mappingDataset}>
                اعمال داده شیت
              </Button>
            </div>
            {preview && (
              <div className="rounded-lg border p-3 text-xs space-y-2 bg-stone-50/60">
                <p className="font-medium">پیش‌نمایش: {formatFaNumber(preview.validRows)} سطر معتبر</p>
                {preview.errors.length > 0 && (
                  <div className="text-rose-700 space-y-0.5">
                    {preview.errors.slice(0, 8).map((e, i) => <p key={i}>سطر {e.row}: {e.message}</p>)}
                    {preview.errors.length > 8 && <p>… و {preview.errors.length - 8} خطای دیگر</p>}
                  </div>
                )}
                {preview.sample.length > 0 && (
                  <pre dir="ltr" className="max-h-40 overflow-auto rounded bg-white p-2 text-[10px] leading-4">{JSON.stringify(preview.sample, null, 1)}</pre>
                )}
              </div>
            )}
          </>
        )}
        <p className="text-[11px] text-stone-400">همه عملیات با مجوز {user.roleLabels?.join('، ')} و ثبت در سوابق سیستم انجام می‌شود.</p>
      </div>
    </div>
  )
}

// ═══════════════ تلگرام ═══════════════

function TelegramTab({ ov, reload }: { ov: Overview; reload: () => void }) {
  const t = ov.telegram
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState(t.chatId)
  const [events, setEvents] = useState<string[]>(t.events ?? [])
  const [templates, setTemplates] = useState<Record<string, string>>(t.templates ?? {})
  const [busy, setBusy] = useState<string | null>(null)
  const [initd, setInitd] = useState(false)

  useEffect(() => {
    if (!initd && t.chatId) { setChatId(t.chatId); setEvents(t.events ?? []); setTemplates(t.templates ?? {}); setInitd(true) }
  }, [t, initd])

  const save = async () => {
    setBusy('save')
    try {
      await apiFetch('/api/integrations/telegram', {
        method: 'PUT',
        body: JSON.stringify({ botToken: botToken.trim() ? botToken : null, chatId: chatId.trim(), events, templates }),
      })
      toast.success('تنظیمات تلگرام ذخیره شد')
      setBotToken('')
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ذخیره')
    } finally { setBusy(null) }
  }

  const sendTest = async () => {
    setBusy('test')
    try {
      const res = await apiFetch<{ ok: boolean; error?: string }>('/api/integrations/telegram', { method: 'POST', body: JSON.stringify({ action: 'test' }) })
      res.ok ? toast.success('پیام آزمایشی ارسال شد — تلگرام را بررسی کنید') : toast.error(res.error ?? 'ارسال ناموفق بود')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(null) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><Send className="h-4 w-4 text-emerald-600" /> اتصال بات تلگرام</h3>
          <ConnBadge connected={t.connected} />
        </div>

        <Guide title="راهنمای دریافت توکن و Chat ID">
          <p>• توکن بات: در تلگرام به <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-700 underline" dir="ltr">@BotFather</a> پیام دهید → دستور /newbot → نام و یوزرنیم بات → توکن را کپی کنید.</p>
          <p>• Chat ID شخصی: به <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-sky-700 underline" dir="ltr">@userinfobot</a> پیام دهید — شناسه عددی را کپی کنید.</p>
          <p>• Chat ID گروه/کانال: بات را به گروه اضافه کنید و عدد منفی از همان بات بگیرید. برای کانال، بات باید ادمین کانال باشد.</p>
        </Guide>

        <Field label="توکن بات" hint={t.botToken ? `ذخیره‌شده: ${t.botToken}` : 'توکن را از @BotFather دریافت کنید'}>
          <Input dir="ltr" type="password" value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="123456789:AAE..." />
        </Field>
        <Field label="Chat ID مقصد" required hint="شناسه عددی چت، گروه یا کانال">
          <Input dir="ltr" value={chatId} onChange={e => setChatId(e.target.value)} placeholder="-1001234567890" />
        </Field>

        <Field label="رویدادهای ارسالی به تلگرام">
          <div className="space-y-2">
            {ov.telegramEvents.map(ev => (
              <label key={ev.key} className="flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer hover:bg-stone-50">
                <input
                  type="checkbox" className="mt-1 accent-emerald-600"
                  checked={events.includes(ev.key)}
                  onChange={e => setEvents(prev => e.target.checked ? [...prev, ev.key] : prev.filter(k => k !== ev.key))}
                />
                <span>
                  <span className="text-sm font-medium">{ev.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{ev.description}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy === 'save'}>
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ذخیره
          </Button>
          <Button variant="outline" onClick={sendTest} disabled={busy === 'test'}>
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} ارسال پیام تست
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h3 className="font-bold text-sm">متن پیام‌ها (قابل سفارشی‌سازی)</h3>
        <p className="text-xs text-muted-foreground">با متغیرهای <span dir="ltr">{`{{orderNo}}`}</span>، <span dir="ltr">{`{{customerName}}`}</span> و… متن هر رویداد را شخصی‌سازی کنید. خالی = متن پیش‌فرض.</p>
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {ov.telegramEvents.map(ev => (
            <Field key={ev.key} label={`قالب «${ev.label}»`}>
              <Textarea
                rows={3} className="text-xs"
                value={templates[ev.key] ?? ''}
                onChange={e => setTemplates(t => ({ ...t, [ev.key]: e.target.value }))}
                placeholder="متن پیش‌فرض استفاده می‌شود"
              />
            </Field>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════ هوش مصنوعی ═══════════════

function AiTab({ ov, reload }: { ov: Overview; reload: () => void }) {
  const a = ov.ai
  const [enabled, setEnabled] = useState(a.enabled)
  const [provider, setProvider] = useState(a.provider)
  const [baseUrl, setBaseUrl] = useState(a.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(a.model)
  const [systemPrompt, setSystemPrompt] = useState(a.systemPrompt)
  const [busy, setBusy] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [suggestions, setSuggestions] = useState<Array<{ sku: string; suggestedCategory: string }>>([])
  const [initd, setInitd] = useState(false)

  useEffect(() => {
    if (!initd && a.baseUrl) {
      setEnabled(a.enabled); setProvider(a.provider); setBaseUrl(a.baseUrl); setModel(a.model); setSystemPrompt(a.systemPrompt)
      setInitd(true)
    }
  }, [a, initd])

  const save = async () => {
    setBusy('save')
    try {
      await apiFetch('/api/integrations/ai', {
        method: 'PUT',
        body: JSON.stringify({
          enabled, provider,
          baseUrl: provider === 'custom' ? baseUrl : baseUrl,
          apiKey: apiKey.trim() ? apiKey : null,
          model, systemPrompt,
        }),
      })
      toast.success('تنظیمات هوش مصنوعی ذخیره شد')
      setApiKey('')
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ذخیره')
    } finally { setBusy(null) }
  }

  const runAction = async (action: 'ask' | 'summarize' | 'categorize') => {
    setBusy(action)
    setAnswer('')
    try {
      if (action === 'categorize') {
        const res = await apiFetch<{ ok: boolean; error?: string; suggestions?: Array<{ sku: string; suggestedCategory: string }> }>('/api/integrations/ai', {
          method: 'POST', body: JSON.stringify({ action: 'categorize' }),
        })
        if (!res.ok) { toast.error(res.error ?? 'خطا'); return }
        setSuggestions(res.suggestions ?? [])
        toast.success(`${res.suggestions?.length ?? 0} پیشنهاد دسته‌بندی دریافت شد`)
      } else {
        const res = await apiFetch<{ ok: boolean; content?: string; error?: string }>('/api/integrations/ai', {
          method: 'POST', body: JSON.stringify({ action, question: action === 'ask' ? question : undefined }),
        })
        if (!res.ok) { toast.error(res.error ?? 'خطا'); return }
        setAnswer(res.content ?? '')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(null) }
  }

  const applyCategories = async () => {
    setBusy('apply')
    try {
      const res = await apiFetch<{ message: string }>('/api/integrations/ai', {
        method: 'POST', body: JSON.stringify({ action: 'apply-categories', suggestions }),
      })
      toast.success(res.message)
      setSuggestions([])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(null) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-emerald-600" /> اتصال هوش مصنوعی (سازگار با OpenAI)</h3>
          <ConnBadge connected={a.connected} connectedText="فعال" disconnectedText="غیرفعال" />
        </div>

        <Guide title="کلید API از کجا بگیرم؟">
          <p>• <b>OpenRouter:</b> در <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-sky-700 underline" dir="ltr">openrouter.ai/keys</a> کلید بسازید. مدل‌های رایگان مثل <span dir="ltr">google/gemini-2.0-flash-exp:free</span> هم موجودند.</p>
          <p>• <b>9Router:</b> کلید را از داشبورد 9Router بگیرید و Base URL سرور خودتان را وارد کنید (پیش‌فرض: <span dir="ltr">http://localhost:20128/v1</span>).</p>
          <p>• <b>سفارشی:</b> هر سرویس سازگار با OpenAI (مثل Ollama، LM Studio یا Azure OpenAI compatible) — فقط Base URL، کلید و نام مدل بدهید.</p>
        </Guide>

        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
          <span className="text-sm font-medium">هوش مصنوعی فعال باشد</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <Field label="ارائه‌دهنده">
          <Select value={provider} onValueChange={v => {
            setProvider(v)
            if (v === 'openrouter') setBaseUrl('https://openrouter.ai/api/v1')
            if (v === 'ninerouter') setBaseUrl('http://localhost:20128/v1')
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
              <SelectItem value="ninerouter">9Router</SelectItem>
              <SelectItem value="custom">سرویس سازگار با OpenAI (سفارشی)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Base URL">
          <Input dir="ltr" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" />
        </Field>
        <Field label="کلید API" hint={a.apiKey ? `ذخیره‌شده: ${a.apiKey}` : 'کلید پس از ذخیره رمزنگاری و مخفی می‌شود'}>
          <Input dir="ltr" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-v1-..." />
        </Field>
        <Field label="نام مدل" hint="مثال: openai/gpt-4o-mini یا مدل‌های free">
          <Input dir="ltr" value={model} onChange={e => setModel(e.target.value)} placeholder="openai/gpt-4o-mini" />
        </Field>
        <Field label="دستور سیستمی (System Prompt)">
          <Textarea rows={3} className="text-xs" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />
        </Field>

        <Button onClick={save} disabled={busy === 'save'}>
          {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} ذخیره تنظیمات
        </Button>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="font-bold text-sm">دستیار مدیریتی — بر اساس داده‌های سامانه پاسخ می‌دهد</h3>
          <Field label="پرسش مدیریتی" hint="مثال: کدام مشتریان بیشترین بدهی را دارند؟ یا: روند فروش این ماه چطور است؟">
            <Textarea rows={2} value={question} onChange={e => setQuestion(e.target.value)} placeholder="پرسش خود را بنویسید…" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => runAction('ask')} disabled={busy === 'ask'}>
              {busy === 'ask' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} پاسخ با داده‌ها
            </Button>
            <Button size="sm" variant="outline" onClick={() => runAction('summarize')} disabled={busy === 'summarize'}>
              {busy === 'summarize' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} خلاصه وضعیت سامانه
            </Button>
            <Button size="sm" variant="outline" onClick={() => runAction('categorize')} disabled={busy === 'categorize'}>
              {busy === 'categorize' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} دسته‌بندی خودکار محصولات
            </Button>
          </div>
          {answer && (
            <div className="rounded-lg border bg-stone-50/60 p-3 text-sm leading-7 whitespace-pre-wrap max-h-72 overflow-y-auto">{answer}</div>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">پیشنهادهای دسته‌بندی ({formatFaNumber(suggestions.length)})</h3>
              <Button size="sm" onClick={applyCategories} disabled={busy === 'apply'}>
                {busy === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} اعمال همه
              </Button>
            </div>
            <div className="max-h-60 overflow-y-auto divide-y text-xs">
              {suggestions.map((s, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <span dir="ltr" className="font-mono text-[10px] text-muted-foreground w-36 shrink-0 truncate">{s.sku}</span>
                  <span className="flex-1 truncate">{s.suggestedCategory}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════ ورود و خروج داده ═══════════════

function DataTab({ ov, user }: { ov: Overview; user: SessionUserLike }) {
  const [dataset, setDataset] = useState('customers')
  const [format, setFormat] = useState('XLSX')
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ totalRows: number; validCount: number; errorCount: number; sample: Array<Record<string, unknown>>; errors: Array<{ row: number; field: string; message: string }> } | null>(null)
  const [importResult, setImportResult] = useState<{ created: number; updated: number; failed: number; skipped: number; results: Array<{ index: number; action: string; key: string; error?: string }> } | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const ds = ov.datasets.find(d => d.key === dataset)

  const download = async () => {
    setBusy('export')
    try {
      const res = await fetch(`/api/integrations/export?datasets=${dataset}&format=${format}`, { credentials: 'include' })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error?.message ?? 'خطا در تولید خروجی')
      }
      const blob = await res.blob()
      const dispo = res.headers.get('content-disposition') ?? ''
      const m = dispo.match(/filename\*=UTF-8''([^;]+)/) ?? dispo.match(/filename="([^"]+)"/)
      const name = m ? decodeURIComponent(m[1]) : `export.${format.toLowerCase()}`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success('خروجی دانلود شد')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(null) }
  }

  const doPreview = async () => {
    if (!pendingFile) return
    setBusy('preview')
    setImportResult(null)
    try {
      const form = new FormData()
      form.append('file', pendingFile)
      form.append('dataset', dataset)
      form.append('mode', 'preview')
      const res = await apiUpload<typeof preview>('/api/integrations/import', form)
      setPreview(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(null) }
  }

  const doApply = async () => {
    if (!pendingFile) return
    setBusy('apply')
    try {
      const form = new FormData()
      form.append('file', pendingFile)
      form.append('dataset', dataset)
      form.append('mode', 'apply')
      const res = await apiUpload<NonNullable<typeof importResult>>('/api/integrations/import', form)
      setImportResult(res)
      setPreview(null)
      toast.success(`${res.created} جدید، ${res.updated} به‌روزرسانی، ${res.failed} ناموفق`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(null) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <h3 className="font-bold text-sm flex items-center gap-2"><Download className="h-4 w-4 text-emerald-600" /> خروجی داده</h3>
        <Guide title="ساختار ستون‌ها مستند است">
          <p>• ستون‌های CSV/Excel با برچسب فارسی هستند؛ همان فایل را می‌توانید ویرایش و دوباره بارگذاری کنید.</p>
          <p>• JSON ساختار کامل با روابط برای بکاپ دارد؛ TypeScript خروجی typed برای توسعه‌دهندگان است.</p>
          <p>• برای CSV چند دیتاستی، هر دیتاست به یک فایل جداگانه تبدیل می‌شود (هر بار یکی دانلود می‌شود).</p>
        </Guide>
        <Field label="دیتاست">
          <Select value={dataset} onValueChange={v => { setDataset(v); setPreview(null); setPendingFile(null) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ov.datasets.map(d => <SelectItem key={d.key} value={d.key}>{d.label}{d.exportOnly ? ' (فقط خروجی)' : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="فرمت">
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="XLSX">Excel (XLSX)</SelectItem>
              <SelectItem value="CSV">CSV</SelectItem>
              <SelectItem value="JSON">JSON</SelectItem>
              <SelectItem value="TS">TypeScript</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Button onClick={download} disabled={busy === 'export'}>
          {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} دانلود خروجی
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <h3 className="font-bold text-sm flex items-center gap-2"><Upload className="h-4 w-4 text-emerald-600" /> ورود داده (CSV / Excel / JSON)</h3>
        <p className="text-xs text-muted-foreground">۱) فایل را انتخاب کنید ۲) پیش‌نمایش و خطاها را بررسی کنید ۳) سپس اعمال نهایی. رکوردها بر اساس کد/SKU به‌روزرسانی می‌شوند — داده تکراری دوباره ساخته نمی‌شود.</p>
        <Field label="فایل" hint="حداکثر ۱۰ مگابایت — CSV با برچسب فارسی یا انگلیسی، XLSX و JSON">
          <Input type="file" accept=".csv,.xlsx,.xls,.json" onChange={e => { setPendingFile(e.target.files?.[0] ?? null); setPreview(null); setImportResult(null) }} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={doPreview} disabled={!pendingFile || busy === 'preview' || Boolean(ds?.exportOnly)}>
            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} پیش‌نمایش و اعتبارسنجی
          </Button>
          <Button onClick={doApply} disabled={!pendingFile || busy === 'apply' || Boolean(ds?.exportOnly) || !preview || preview.validCount === 0}>
            {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} اعمال نهایی
          </Button>
        </div>
        {ds?.exportOnly && <p className="text-xs text-rose-600">دیتاست «{ds.label}» فقط خروجی دارد.</p>}

        {preview && (
          <div className="rounded-lg border p-3 text-xs space-y-2 bg-stone-50/60">
            <p className="font-medium text-emerald-800">✓ {formatFaNumber(preview.validCount)} سطر معتبر از {formatFaNumber(preview.totalRows)} سطر ({formatFaNumber(preview.errorCount)} خطا)</p>
            {preview.errors.length > 0 && (
              <div className="text-rose-700 space-y-0.5 max-h-32 overflow-y-auto">
                {preview.errors.map((e, i) => <p key={i}>سطر {e.row} — {e.message}</p>)}
              </div>
            )}
            {preview.sample.length > 0 && (
              <pre dir="ltr" className="max-h-44 overflow-auto rounded bg-white p-2 text-[10px] leading-4">{JSON.stringify(preview.sample, null, 1)}</pre>
            )}
          </div>
        )}

        {importResult && (
          <div className="rounded-lg border p-3 text-xs space-y-2 bg-stone-50/60">
            <p className="font-medium">نتیجه اعمال: {formatFaNumber(importResult.created)} جدید، {formatFaNumber(importResult.updated)} به‌روزرسانی، {formatFaNumber(importResult.failed)} ناموفق، {formatFaNumber(importResult.skipped)} نادیده‌گرفته</p>
            {importResult.results.filter(r => r.action === 'FAILED').slice(0, 10).map((r, i) => (
              <p key={i} className="text-rose-700">سطر {r.index} ({r.key}): {r.error}</p>
            ))}
          </div>
        )}
        <p className="text-[11px] text-stone-400">عملیات با مجوز {user.roleLabels?.join('، ')} و ثبت در سوابق سیستم انجام می‌شود.</p>
      </div>
    </div>
  )
}

// ═══════════════ لاگ‌ها ═══════════════

type LogRow = { id: string; integration: string; level: string; event: string; message: string | null; createdAt: string }

function LogsTab() {
  const [filter, setFilter] = useState('all')
  const url = filter === 'all' ? '/api/integrations/logs?take=150' : `/api/integrations/logs?integration=${filter}&take=150`
  const { data, reload } = useApiData<LogRow[]>(url)

  const cols: Col<LogRow>[] = [
    { key: 'level', header: 'سطح', cell: r => r.level === 'ERROR' ? <Badge className="bg-rose-100 text-rose-800">خطا</Badge> : r.level === 'WARN' ? <Badge className="bg-amber-100 text-amber-800">هشدار</Badge> : <Badge variant="outline">اطلاع</Badge> },
    { key: 'integration', header: 'یکپارچه‌سازی', cell: r => ({ google: 'Google', sheets: 'Sheets', telegram: 'تلگرام', ai: 'AI', backup: 'بکاپ', scheduler: 'اسکجولر' })[r.integration] ?? r.integration },
    { key: 'event', header: 'رویداد', cell: r => <span dir="ltr" className="text-xs font-mono">{r.event}</span> },
    { key: 'message', header: 'پیام', cell: r => <span className="text-xs line-clamp-2">{r.message}</span> },
    { key: 'createdAt', header: 'زمان', cell: r => <JDate d={r.createdAt} time /> },
  ]

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-sm flex items-center gap-2"><ScrollText className="h-4 w-4 text-emerald-600" /> لاگ رویدادهای یکپارچه‌سازی</h3>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه</SelectItem>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="sheets">Sheets</SelectItem>
              <SelectItem value="telegram">تلگرام</SelectItem>
              <SelectItem value="ai">AI</SelectItem>
              <SelectItem value="backup">بکاپ</SelectItem>
              <SelectItem value="scheduler">اسکجولر</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      <DataTable columns={cols} rows={data ?? []} rowKey={r => r.id} loading={!data} empty="لاگی ثبت نشده است" />
    </div>
  )
}
