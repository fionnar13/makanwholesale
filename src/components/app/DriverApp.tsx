'use client'
// اپ راننده — مأموریت‌های پخش: فهرست، جزئیات + اقدام، تاریخچه (فاز ۱ — بخش D)
// الگو: VisitorApp (تب‌ها + useApiData + موبایل-اول RTL) با دکمه‌های ≥۴۴px و پیام‌های فارسی واضح
//
// ایدمپوتنت دو لایه (مصوبهٔ بخش C + D):
//   • کلاینت: با هر باز شدن دیالوگ یک idempotencyKey (crypto.randomUUID) ساخته و با هر request ارسال می‌شود؛
//     پس از موفقیت دکمه غیرفعال می‌شود و در تکرار پیام «قبلاً ثبت شده» نمایش داده می‌شود.
//   • سرور: تکرار همان اکشن روی وضعیتِ هم‌نتیجه → idempotent:true بدون اثر جدید؛ claim اتمیک هم
//     شلیک هم‌زمان دوبار را می‌بندد (دوبار کلیک = یک‌بار اثر).
//
// آفلاین: پیش از هر ارسال navigator.onLine چک می‌شود و خطای شبکه با پیام واضح نمایش داده می‌شود.
import { useEffect, useMemo, useRef, useState } from 'react'
// ApiClientError — برای تشخیص هدفمند خطای تسویهٔ هم‌زمان (PAYMENT_ALREADY_SETTLED) در دیالوگ پرداخت
import {
  apiFetch, useApiData, Money, JDate, PageHeader, Field, EmptyState, ErrorState, AssignmentStatusBadge,
  formatFaNumber, ApiClientError,
} from './kit'
import type { SessionUserLike, ViewKeyLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Banknote, ClipboardCheck, History, MapPin, Navigation, PackageCheck, Phone, RefreshCw, Truck, Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ASSIGNMENT_STATUS_LABELS, DELIVERY_ASSIGNMENT_STATUSES, DRIVER_PAYMENT_LABELS, RETURN_REASON_LABELS,
  periodRange, type UiPeriod,
} from '@/lib/delivery-shared'
import { PAY_METHOD_LABELS } from '@/lib/format'

// ─── تایپ‌های پاسخ API (سطح دید راننده) ───
type BranchLite = { name: string; address: string | null; phone: string | null }

type DriverAssignment = {
  id: string
  orderId: string
  status: string
  statusLabel: string
  paymentMethod: string | null
  paymentMethodLabel: string | null
  failureReason: string | null
  failureReasonLabel: string | null
  assignedAt: string
  startedAt: string | null
  completedAt: string | null
  order: {
    id: string; orderNo: string; status: string; totalRls: number; payMethod: string; paidAt: string | null
    branch: BranchLite | null
    customer: { code: string; shopName: string; phone: string; address: string | null }
  }
}

type AssignmentDetail = {
  id: string
  status: string
  statusLabel: string
  paymentMethod: string | null
  paymentMethodLabel: string | null
  paymentReference: string | null
  failureReason: string | null
  failureReasonLabel: string | null
  notes: string | null
  assignedAt: string
  startedAt: string | null
  completedAt: string | null
  driver: { id: string; name: string }
  order: {
    id: string; orderNo: string; status: string; statusLabel: string
    totalRls: number; payMethod: string; paidAt: string | null
    customer: { id: string; code: string; shopName: string; phone: string; address: string | null }
    branch: BranchLite | null
    items: Array<{
      productId: string; productName: string; baseUnitName: string; unitId: string; unitName: string
      qtyBase: number; unitPriceRls: number; lineTotalRls: number
    }>
  }
}

// ─── کمکی‌های آفلاین/خطا ───
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}
function errText(e: unknown): string {
  if (e instanceof TypeError) return 'ارتباط با سرور برقرار نشد — اتصال اینترنت را بررسی کنید و دوباره تلاش کنید'
  return e instanceof Error ? e.message : 'خطای ناشناخته'
}
function guardOffline(): boolean {
  if (isOffline()) {
    toast.error('اینترنت در دسترس نیست؛ پس از برقراری اتصال دوباره تلاش کنید')
    return true
  }
  return false
}

export default function DriverApp({ user, go }: { user: SessionUserLike; go: (v: ViewKeyLike) => void }) {
  return (
    <div className="mx-auto max-w-md pb-8">
      <PageHeader
        title={`اپ راننده — ${user.name}`}
        desc="مأموریت‌های پخش: شروع مسیر، تحویل و وصول وجه، ثبت مرجوعی"
        actions={user.permissions.includes('dashboard.view') ? (
          <button onClick={() => go('dashboard')} className="text-xs underline text-muted-foreground">نمای کامل دسکتاپ</button>
        ) : undefined}
      />

      <Tabs defaultValue="missions">
        <TabsList className="w-full grid grid-cols-2 h-11">
          <TabsTrigger value="missions" className="text-xs gap-1.5"><Truck className="h-3.5 w-3.5" /> مأموریت‌ها</TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1.5"><History className="h-3.5 w-3.5" /> تاریخچه</TabsTrigger>
        </TabsList>
        <TabsContent value="missions" className="mt-4"><MissionsTab /></TabsContent>
        <TabsContent value="history" className="mt-4"><HistoryTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ═════════════════════════════ تب ۱ — فهرست مأموریت‌ها ═════════════════════════════

type QuickFilter = 'ACTIVE' | 'DONE' | 'ALL'

function MissionsTab() {
  const [refresh, setRefresh] = useState(0)
  const [quick, setQuick] = useState<QuickFilter>('ACTIVE')
  const [detailId, setDetailId] = useState<string | null>(null)
  const { data, loading, error } = useApiData<DriverAssignment[]>(refresh >= 0 ? '/api/deliveries?take=200' : null)

  const rows = (data ?? []).filter(a =>
    quick === 'ACTIVE' ? ['PENDING', 'IN_PROGRESS'].includes(a.status)
      : quick === 'DONE' ? !['PENDING', 'IN_PROGRESS'].includes(a.status)
        : true,
  )
  const activeCount = (data ?? []).filter(a => ['PENDING', 'IN_PROGRESS'].includes(a.status)).length

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {([['ACTIVE', 'فعال'], ['DONE', 'پایان‌یافته'], ['ALL', 'همه']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setQuick(k)}
              className={`h-9 px-3 rounded-full text-xs font-medium border transition-colors ${
                quick === k ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-card text-muted-foreground border-border'
              }`}
            >
              {label}{k === 'ACTIVE' && activeCount > 0 ? ` (${formatFaNumber(activeCount)})` : ''}
            </button>
          ))}
        </div>
        <button
          onClick={() => setRefresh(r => r + 1)}
          className="h-9 px-2.5 rounded-lg text-xs text-muted-foreground flex items-center gap-1 hover:bg-stone-100"
          aria-label="به‌روزرسانی فهرست"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <ErrorState text={error} onRetry={() => setRefresh(r => r + 1)} />}
      {loading && <p className="text-sm text-center py-6 text-muted-foreground">در حال بارگذاری…</p>}
      {!loading && !error && rows.length === 0 && <EmptyState text="مأموریتی در این دسته نیست" />}

      <div className="grid gap-3">
        {rows.map(a => (
          <div key={a.id} className="rounded-xl border bg-card p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold flex items-center gap-1.5">
                  <PackageCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="font-mono" dir="ltr">{a.order.orderNo}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{a.order.customer.shopName}{a.order.branch ? ` — ${a.order.branch.name}` : ''}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                  {a.order.customer.address ?? a.order.branch?.address ?? 'آدرس ثبت نشده'}
                </div>
              </div>
              <AssignmentStatusBadge status={a.status} label={a.statusLabel} />
            </div>
            <div className="flex items-center justify-between mt-2.5 text-xs">
              <Money rls={a.order.totalRls} className="font-bold text-emerald-700" />
              <span className="text-muted-foreground">
                {a.order.paidAt ? 'تسویه‌شده' : (PAY_METHOD_LABELS[a.order.payMethod] ?? a.order.payMethod)}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              تخصیص: <JDate d={a.assignedAt} time />
              {a.startedAt && <> | شروع: <JDate d={a.startedAt} time /></>}
            </div>
            <Button className="w-full h-11 mt-3 text-sm" onClick={() => setDetailId(a.id)}>
              <ClipboardCheck className="h-4 w-4 ml-1.5" /> جزئیات و اقدام
            </Button>
          </div>
        ))}
      </div>

      <DetailDialog id={detailId} onClose={() => setDetailId(null)} onChanged={() => setRefresh(r => r + 1)} />
    </div>
  )
}

// ═════════════════════════════ جزئیات + اقدام ═════════════════════════════

function DetailDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useApiData<AssignmentDetail>(id ? `/api/deliveries/${id}` : null)
  const [payOpen, setPayOpen] = useState(false)
  const [retOpen, setRetOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // کلید ایدمپوتنت اکشن «شروع» — در هر باز شدن جزئیات تازه ساخته می‌شود
  const startKey = useRef('')
  useEffect(() => { if (id) startKey.current = crypto.randomUUID() }, [id])

  const start = async () => {
    if (!id || busy) return
    if (guardOffline()) return
    setBusy(true)
    try {
      const r = await apiFetch<{ status: string; idempotent?: boolean }>(`/api/deliveries/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'start', idempotencyKey: startKey.current }),
      })
      if (r.idempotent) toast.info('قبلاً ثبت شده بود — تغییری اعمال نشد')
      else toast.success('مأموریت شروع شد — مسیر پخش آغاز شد')
      reload()
      onChanged()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const st = data?.status

  return (
    <>
      <Dialog open={!!id} onOpenChange={v => { if (!v) { setPayOpen(false); setRetOpen(false); onClose() } }}>
        <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
          {loading && <p className="text-sm text-center py-6 text-muted-foreground">در حال بارگذاری…</p>}
          {data && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono" dir="ltr">{data.order.orderNo}</span>
                  <AssignmentStatusBadge status={data.status} label={data.statusLabel} />
                </DialogTitle>
                <DialogDescription>
                  {data.order.customer.shopName} — {PAY_METHOD_LABELS[data.order.payMethod] ?? data.order.payMethod}
                </DialogDescription>
              </DialogHeader>

              {/* گیرنده و آدرس — تماس با یک لمس */}
              <div className="rounded-xl border bg-stone-50 p-3 grid gap-1.5 text-xs">
                <div className="font-bold text-sm">{data.order.customer.shopName}</div>
                <div className="flex items-start gap-1 text-muted-foreground">
                  <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{data.order.customer.address ?? '—'}</span>
                </div>
                {data.order.branch && (
                  <div className="text-muted-foreground">
                    شعبه: {data.order.branch.name}{data.order.branch.address ? ` — ${data.order.branch.address}` : ''}
                  </div>
                )}
                <a
                  href={`tel:${data.order.customer.phone}`}
                  className="flex items-center gap-1.5 text-emerald-700 font-medium underline underline-offset-2 w-fit"
                  dir="ltr"
                >
                  <Phone className="h-3.5 w-3.5" /> {data.order.customer.phone}
                </a>
              </div>

              {/* اقلام سفارش */}
              <div>
                <div className="text-xs font-bold text-muted-foreground mb-1.5">اقلام سفارش</div>
                <div className="rounded-xl border divide-y">
                  {data.order.items.map(i => (
                    <div key={`${i.productId}-${i.unitId}`} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{i.productName}</div>
                        <div className="text-[10px] text-muted-foreground">{formatFaNumber(i.qtyBase)} {i.unitName}</div>
                      </div>
                      <Money rls={i.lineTotalRls} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2 text-sm font-bold">
                  <span>{data.order.paidAt ? 'مبلغ سفارش (تسویه‌شده)' : 'مبلغ قابل وصول'}</span>
                  <Money rls={data.order.totalRls} className="text-emerald-700" />
                </div>
                {data.order.paidAt && (
                  <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-2.5 flex items-center gap-1.5">
                    <Banknote className="h-3.5 w-3.5 shrink-0" /> این سفارش پیش‌تر تسویه شده است — نیازی به دریافت وجه نیست
                  </div>
                )}
              </div>

              {/* متادیتا */}
              <div className="text-[11px] text-muted-foreground grid gap-0.5">
                <span>
                  تخصیص: <JDate d={data.assignedAt} time />
                  {data.startedAt && <> | شروع: <JDate d={data.startedAt} time /></>}
                  {data.completedAt && <> | پایان: <JDate d={data.completedAt} time /></>}
                </span>
                {data.paymentMethodLabel && (
                  <span>روش پرداخت: {data.paymentMethodLabel}{data.paymentReference ? ` — مرجع: ${data.paymentReference}` : ''}</span>
                )}
                {data.failureReasonLabel && <span className="text-rose-600">دلیل: {data.failureReasonLabel}</span>}
                {data.notes && <span>یادداشت: {data.notes}</span>}
              </div>

              {/* اقدامات — دکمه‌های بزرگ (≥۴۸px) با فاصلهٔ کافی */}
              {st === 'PENDING' && (
                <Button className="w-full h-12 text-base" disabled={busy} onClick={start}>
                  <Navigation className="h-5 w-5 ml-1.5" /> {busy ? 'در حال ثبت…' : 'شروع مأموریت'}
                </Button>
              )}
              {st === 'IN_PROGRESS' && (
                <div className="grid gap-2.5">
                  <Button className="w-full h-12 text-base" onClick={() => setPayOpen(true)}>
                    <Banknote className="h-5 w-5 ml-1.5" /> ثبت تحویل و دریافت وجه
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-12 text-base text-rose-600 hover:text-rose-700 border-rose-200 hover:bg-rose-50"
                    onClick={() => setRetOpen(true)}
                  >
                    <Undo2 className="h-5 w-5 ml-1.5" /> ثبت مرجوعی
                  </Button>
                </div>
              )}
              {st && !['PENDING', 'IN_PROGRESS'].includes(st) && (
                <div className="rounded-lg border bg-stone-50 text-xs text-muted-foreground p-3 text-center">
                  این مأموریت پایان یافته است — اقدامی لازم نیست
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* دیالوگ‌های اقدام — در سطح جزئیات، پس از موفقیت جزئیات و فهرست هر دو تازه می‌شوند */}
      <PaymentDialog assignmentId={id} detail={data} open={payOpen} onOpenChange={setPayOpen} onDone={() => { reload(); onChanged() }} />
      <ReturnDialog assignmentId={id} open={retOpen} onOpenChange={setRetOpen} onDone={() => { reload(); onChanged() }} />
    </>
  )
}

// ═════════════════════════════ دیالوگ ثبت تحویل و دریافت وجه ═════════════════════════════

function PaymentDialog({ assignmentId, detail, open, onOpenChange, onDone }: {
  assignmentId: string | null
  detail: AssignmentDetail | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [method, setMethod] = useState<string>('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const idemKey = useRef('')

  // هر بار باز شدن دیالوگ = یک submit منطقی تازه → کلید ایدمپوتنت جدید + ریست فرم
  // پیش‌فرض هوشمند روش پرداخت: سفارش تسویه‌شده → بدون پرداخت؛ اعتباری پرداخت‌نشده → CREDIT؛ سایر → CASH
  useEffect(() => {
    if (!open || !detail) return
    idemKey.current = crypto.randomUUID()
    setReference('')
    setNotes('')
    setDone(false)
    setMethod(detail.order.paidAt ? '' : (detail.order.payMethod === 'CREDIT' ? 'CREDIT' : 'CASH'))
  }, [open, detail])

  const settled = detail?.order.paidAt != null
  const needReference = method === 'CARD_TO_CARD' || method === 'POS' || method === 'OTHER'

  const submit = async () => {
    if (!assignmentId || busy || done) return
    if (guardOffline()) return
    if (!settled && !method) { toast.error('انتخاب روش پرداخت الزامی است'); return }
    setBusy(true)
    try {
      const r = await apiFetch<{ status: string; orderStatus: string; invoiceNo: string | null; idempotent?: boolean }>(
        `/api/deliveries/${assignmentId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'complete',
            ...(method ? { paymentMethod: method } : {}),
            paymentReference: reference || null,
            notes: notes || null,
            idempotencyKey: idemKey.current,
          }),
        },
      )
      setDone(true)
      if (r.idempotent) toast.info('قبلاً ثبت شده بود — تغییری اعمال نشد')
      else toast.success(`تحویل ثبت شد — فاکتور ${r.invoiceNo ?? '—'}`)
      onDone()
      onOpenChange(false)
    } catch (e) {
      // رقابت تسویهٔ هم‌زمان (مثلاً markPaid مالی در همین لحظه) — پیام هدفمند + تازه‌سازی جزئیات:
      // در حالت عادی UI برای سفارش تسویه‌شده اصلاً انتخاب روش پرداخت نشان نمی‌دهد؛ این مسیر
      // فقط برای بازهٔ کوتاه بین باز شدن دیالوگ و ثبت تسویهٔ هم‌زمان است.
      if (e instanceof ApiClientError && e.code === 'PAYMENT_ALREADY_SETTLED') {
        toast.error('این سفارش پیش‌تر تسویه شده است — نیازی به دریافت وجه نیست')
        onDone() // جزئیات و فهرست تازه می‌شوند؛ دیالوگ باز می‌ماند و به حالت «تسویه‌شده» می‌رود
      } else {
        toast.error(errText(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>ثبت تحویل و دریافت وجه</DialogTitle>
          <DialogDescription>
            سفارش <span className="font-mono" dir="ltr">{detail?.order.orderNo}</span> — {detail?.order.customer.shopName}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-xl border bg-emerald-50 p-3 text-center">
            <div className="text-[11px] text-muted-foreground">{settled ? 'مبلغ سفارش (تسویه‌شده)' : 'مبلغ قابل وصول در محل'}</div>
            <Money rls={detail?.order.totalRls ?? 0} className="text-lg font-bold text-emerald-700" />
          </div>

          {settled ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs p-2.5 flex items-center gap-1.5">
              <Banknote className="h-3.5 w-3.5 shrink-0" /> سفارش تسویه شده — فقط تحویل ثبت می‌شود و وجه جداگانه گرفته نمی‌شود
            </div>
          ) : (
            <Field label="روش پرداخت" required>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-11"><SelectValue placeholder="انتخاب روش…" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DRIVER_PAYMENT_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {!settled && needReference && (
            <Field label="مرجع پرداخت (اختیاری)" hint="شماره پیگیری کارت‌به‌کارت یا شماره تراکنش POS">
              <Input className="h-11" value={reference} onChange={e => setReference(e.target.value)} dir="ltr" placeholder="90212345" />
            </Field>
          )}

          <Field label="یادداشت (اختیاری)">
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثلاً بسته سالم تحویل شد" />
          </Field>

          <Button className="w-full h-12 text-base" disabled={busy || done} onClick={submit}>
            {busy ? 'در حال ثبت…' : done ? 'ثبت شد' : 'تأیید تحویل'}
          </Button>
          {done && <p className="text-[11px] text-center text-emerald-700">این تحویل ثبت شده است — ثبت مجدد اثر جدیدی ندارد</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ═════════════════════════════ دیالوگ ثبت مرجوعی (فقط reason — پنج کد مصوب) ═════════════════════════════

function ReturnDialog({ assignmentId, open, onOpenChange, onDone }: {
  assignmentId: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const idemKey = useRef('')

  useEffect(() => {
    if (!open) return
    idemKey.current = crypto.randomUUID()
    setReason('')
    setNotes('')
    setDone(false)
  }, [open])

  const submit = async () => {
    if (!assignmentId || busy || done) return
    if (guardOffline()) return
    if (!reason) { toast.error('انتخاب دلیل مرجوعی الزامی است'); return }
    setBusy(true)
    try {
      const r = await apiFetch<{ status: string; returnNo: string | null; idempotent?: boolean }>(
        `/api/deliveries/${assignmentId}`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'return',
            reason,
            notes: notes || null,
            idempotencyKey: idemKey.current,
          }),
        },
      )
      setDone(true)
      if (r.idempotent) toast.info('قبلاً ثبت شده بود — تغییری اعمال نشد')
      else toast.success(`مرجوعی ثبت شد — درخواست ${r.returnNo ?? '—'}`)
      onDone()
      onOpenChange(false)
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>ثبت مرجوعی</DialogTitle>
          <DialogDescription>اقلام با وضعیت «در انتظار بررسی» به انبار ارجاع می‌شود؛ سفارش برای مأموریت مجدد باز می‌ماند.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="دلیل مرجوعی" required>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-11"><SelectValue placeholder="انتخاب دلیل…" /></SelectTrigger>
              <SelectContent>
                {Object.entries(RETURN_REASON_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="توضیح (اختیاری)">
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثلاً بسته‌بندی آسیب دیده" />
          </Field>
          <Button
            className="w-full h-12 text-base"
            variant="outline"
            disabled={busy || done}
            onClick={submit}
          >
            {busy ? 'در حال ثبت…' : done ? 'ثبت شد' : 'ثبت مرجوعی'}
          </Button>
          {done && <p className="text-[11px] text-center text-emerald-700">این مرجوعی ثبت شده است — ثبت مجدد اثر جدیدی ندارد</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ═════════════════════════════ تب ۲ — تاریخچه (فیلتر وضعیت + دوره) ═════════════════════════════
// periodRange مشترک از delivery-shared (بخش E — همان توابع برای داشبورد مدیر)

const PERIODS: Array<[UiPeriod, string]> = [
  ['TODAY', 'امروز'], ['WEEK', 'این هفته'], ['MONTH', 'این ماه'], ['ALL', 'همه'],
]

function HistoryTab() {
  const [status, setStatus] = useState<string>('ALL')
  const [period, setPeriod] = useState<UiPeriod>('TODAY')

  const url = useMemo(() => {
    const { from, to } = periodRange(period)
    const params = new URLSearchParams({ take: '300' })
    if (status !== 'ALL') params.set('status', status)
    if (from && to) { params.set('from', from); params.set('to', to) }
    const qs = params.toString()
    return `/api/deliveries${qs ? `?${qs}` : ''}`
  }, [status, period])

  const { data, loading, error, reload } = useApiData<DriverAssignment[]>(url)
  const rows = data ?? []

  // خلاصهٔ دوره — وصولی در محل = تحویل تسویه‌شده با روش غیراعتباری (وجهی که راننده گرفته است)
  const collected = rows
    .filter(a => a.status === 'PAID' && a.paymentMethod && a.paymentMethod !== 'CREDIT')
    .reduce((s, a) => s + a.order.totalRls, 0)
  const returnedCount = rows.filter(a => a.status === 'RETURNED' || a.status === 'PARTIAL_RETURNED').length

  return (
    <div className="grid gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {PERIODS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setPeriod(k)}
            className={`h-9 px-3 rounded-full text-xs font-medium border transition-colors ${
              period === k ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-card text-muted-foreground border-border'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10 text-xs flex-1"><SelectValue placeholder="همهٔ وضعیت‌ها" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">همهٔ وضعیت‌ها</SelectItem>
            {DELIVERY_ASSIGNMENT_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s] ?? s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={() => reload()}
          className="h-10 px-2.5 rounded-lg text-xs text-muted-foreground flex items-center gap-1 hover:bg-stone-100 shrink-0"
          aria-label="به‌روزرسانی تاریخچه"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* خلاصهٔ دوره */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border bg-card p-2.5 text-center">
          <div className="text-[10px] text-muted-foreground">مأموریت‌ها</div>
          <div className="text-sm font-bold mt-0.5">{formatFaNumber(rows.length)}</div>
        </div>
        <div className="rounded-xl border bg-emerald-50 border-emerald-200 p-2.5 text-center">
          <div className="text-[10px] text-muted-foreground">وصولی در محل</div>
          <div className="text-sm font-bold mt-0.5 text-emerald-700"><Money rls={collected} /></div>
        </div>
        <div className="rounded-xl border bg-card p-2.5 text-center">
          <div className="text-[10px] text-muted-foreground">مرجوعی</div>
          <div className="text-sm font-bold mt-0.5">{formatFaNumber(returnedCount)}</div>
        </div>
      </div>

      {error && <ErrorState text={error} onRetry={() => reload()} />}
      {loading && <p className="text-sm text-center py-6 text-muted-foreground">در حال بارگذاری…</p>}
      {!loading && !error && rows.length === 0 && <EmptyState text="در این دوره مأموریتی ثبت نشده است" />}

      <div className="grid gap-2.5">
        {rows.map(a => (
          <div key={a.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs" dir="ltr">{a.order.orderNo}</span>
              <AssignmentStatusBadge status={a.status} label={a.statusLabel} />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-xs">
              <span className="text-muted-foreground truncate">{a.order.customer.shopName}</span>
              <Money rls={a.order.totalRls} className="font-bold text-emerald-700" />
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 grid gap-0.5">
              <span>
                تخصیص: <JDate d={a.assignedAt} time />
                {a.completedAt && <> | پایان: <JDate d={a.completedAt} time /></>}
              </span>
              {a.paymentMethodLabel && <span>پرداخت: {a.paymentMethodLabel}</span>}
              {a.failureReasonLabel && <span className="text-rose-600">دلیل: {a.failureReasonLabel}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
