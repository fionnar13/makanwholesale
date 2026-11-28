'use client'
// داشبورد مأموریت‌های پخش — نمای مدیر (فاز ۱ — بخش E)
// بر پایهٔ نمای سادهٔ بخش D، با این افزودنی‌ها:
//   ۱) کارت‌های خلاصهٔ وضعیت از GET /api/deliveries/summary (امروز به‌وقت محلی مدیر)
//   ۲) فیلترهای راننده / وضعیت / دوره (امروز، این هفته، این ماه، بازهٔ دلخواه)
//   ۳) گزارش «تحویل‌شده بدون تسویه» — سفارش‌های DELIVERED با پرداخت CREDIT
//      (نکتهٔ اصلاحی ۲ فاز ۰) با دکمهٔ «ثبت پرداخت» (markPaid) برای هر ردیف
//   ۴) تخصیص مجدد مأموریت لغوشده به رانندهٔ دیگر
// مرزهای دوره با periodRange مشترک (delivery-shared) — هفته از شنبه، «امروز» محلی مرورگر
import { useEffect, useMemo, useState } from 'react'
import {
  apiFetch, useApiData, Money, JDate, PageHeader, Field, DataTable, StatusBadge, AssignmentStatusBadge,
  formatFaNumber, type Col,
} from './kit'
import type { SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Ban, CreditCard, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ASSIGNMENT_STATUS_LABELS, DELIVERY_ASSIGNMENT_STATUSES, dayRange, periodRange, type UiPeriod } from '@/lib/delivery-shared'

type Summary = {
  pending: number
  inProgress: number
  paidInPeriod: number
  returnedInPeriod: number
  creditUnpaid: number
}

type ManagerAssignment = {
  id: string
  status: string
  statusLabel: string
  paymentMethodLabel: string | null
  failureReasonLabel: string | null
  assignedAt: string
  startedAt: string | null
  completedAt: string | null
  order: { id: string; orderNo: string; status: string; totalRls: number; payMethod: string; customer: { shopName: string } }
  driver: { id: string; name: string }
}

type OrderLite = {
  id: string; orderNo: string; status: string; statusLabel: string; totalRls: number
  customer: { shopName: string }
}

type DriverLite = { id: string; name: string; phone: string | null; isActive: boolean }

export default function DeliveriesView({ user }: { user: SessionUserLike }) {
  const [bump, setBump] = useState(0) // پس از هر تغییر (تخصیص/لغو/ثبت پرداخت) خلاصه تازه می‌شود
  const [tab, setTab] = useState<'missions' | 'credit'>('missions')
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignOrderId, setAssignOrderId] = useState<string | null>(null) // null = تخصیص تازه

  // «امروزِ» مدیر پخش با منطقهٔ زمانی خودش — مرز روز سمت کلاینت محاسبه و به سرور می‌رود
  const today = useMemo(() => periodRange('TODAY'), [])
  const summaryUrl = `/api/deliveries/summary?from=${encodeURIComponent(today.from ?? '')}&to=${encodeURIComponent(today.to ?? '')}&_r=${bump}`
  const { data: summary, loading: summaryLoading } = useApiData<Summary>(summaryUrl)

  const openAssign = (orderId?: string) => { setAssignOrderId(orderId ?? null); setAssignOpen(true) }
  const onChanged = () => setBump(b => b + 1)

  return (
    <div>
      <PageHeader
        title="داشبورد مأموریت‌های پخش"
        desc="تخصیص سفارش به راننده، پیگیری تحویل، مرجوعی و تسویهٔ اعتباری — «امروز» به‌وقت محلی شما"
        actions={
          <Button onClick={() => openAssign()} className="h-10">
            <Plus className="h-4 w-4 ml-1" /> تخصیص مأموریت
          </Button>
        }
      />

      <SummaryCards summary={summary} loading={summaryLoading} onCreditClick={() => setTab('credit')} />

      <Tabs value={tab} onValueChange={v => setTab(v as 'missions' | 'credit')}>
        <TabsList className="h-11 max-w-md grid grid-cols-2">
          <TabsTrigger value="missions" className="text-xs gap-1.5">مأموریت‌ها</TabsTrigger>
          <TabsTrigger value="credit" className="text-xs gap-1.5">
            پیگیری تسویه
            {(summary?.creditUnpaid ?? 0) > 0 && (
              <span className="rounded-full bg-orange-100 text-orange-800 px-1.5 text-[10px] font-bold">
                {formatFaNumber(summary!.creditUnpaid)}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="missions" className="mt-4">
          <MissionsTab onChanged={onChanged} onReassign={id => openAssign(id)} />
        </TabsContent>
        <TabsContent value="credit" className="mt-4">
          <CreditTab onChanged={onChanged} />
        </TabsContent>
      </Tabs>

      <AssignDialog open={assignOpen} initialOrderId={assignOrderId} onOpenChange={setAssignOpen} onDone={onChanged} />
    </div>
  )
}

// ═════════════════════════════ کارت‌های خلاصهٔ وضعیت ═════════════════════════════

function SummaryCards({ summary, loading, onCreditClick }: {
  summary?: Summary | null
  loading: boolean
  onCreditClick: () => void
}) {
  const cards: Array<{ label: string; value?: number; cls: string; hint?: string; onClick?: () => void }> = [
    { label: 'در انتظار شروع', value: summary?.pending, cls: 'bg-amber-50 border-amber-200 text-amber-900' },
    { label: 'در مسیر پخش', value: summary?.inProgress, cls: 'bg-sky-50 border-sky-200 text-sky-900' },
    { label: 'تحویلِ امروز', value: summary?.paidInPeriod, cls: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
    { label: 'مرجوعی امروز', value: summary?.returnedInPeriod, cls: 'bg-rose-50 border-rose-200 text-rose-900' },
    {
      label: 'تحویل اعتباریِ بی‌تسویه', value: summary?.creditUnpaid,
      cls: 'bg-orange-50 border-orange-200 text-orange-900', hint: 'نیاز به پیگیری مالی — گزارش تسویه',
      onClick: onCreditClick,
    },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-5">
      {cards.map(c => (
        <div
          key={c.label}
          onClick={c.onClick}
          className={`rounded-xl border p-3 ${c.cls} ${c.onClick ? 'cursor-pointer hover:shadow-sm transition-shadow' : ''}`}
        >
          <div className="text-[11px] opacity-80 leading-4">{c.label}</div>
          <div className="text-xl font-bold mt-1">{loading && c.value == null ? '—' : formatFaNumber(c.value ?? 0)}</div>
          {c.hint && <div className="text-[10px] mt-0.5 opacity-70">{c.hint}</div>}
        </div>
      ))}
    </div>
  )
}

// ═════════════════════════════ تب ۱ — فهرست مأموریت‌ها (فیلترهای راننده/وضعیت/دوره) ═════════════════════════════

type MissionsPeriod = UiPeriod | 'CUSTOM'
const MISSION_PERIODS: Array<[MissionsPeriod, string]> = [
  ['TODAY', 'امروز'], ['WEEK', 'این هفته'], ['MONTH', 'این ماه'], ['ALL', 'همه'], ['CUSTOM', 'دلخواه'],
]

function MissionsTab({ onChanged, onReassign }: { onChanged: () => void; onReassign: (orderId: string) => void }) {
  const [driverId, setDriverId] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [period, setPeriod] = useState<MissionsPeriod>('ALL')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [cancelTarget, setCancelTarget] = useState<ManagerAssignment | null>(null)

  const { data: drivers } = useApiData<DriverLite[]>('/api/users?role=DRIVER')
  const activeDrivers = (drivers ?? []).filter(d => d.isActive)

  const url = useMemo(() => {
    const params = new URLSearchParams({ take: '300' })
    if (driverId !== 'ALL') params.set('driverId', driverId)
    if (status !== 'ALL') params.set('status', status)
    // فیلتر دوره روی assignedAt (پیش‌فرض API) — «مأموریت‌های ایجادشده در این دوره»
    let from: string | null = null
    let to: string | null = null
    if (period === 'CUSTOM') {
      from = customFrom ? dayRange(customFrom) : null
      to = customTo ? dayRange(customTo, true) : null
    } else {
      const r = periodRange(period)
      from = r.from ?? null
      to = r.to ?? null
    }
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    return `/api/deliveries${qs ? `?${qs}` : ''}`
  }, [driverId, status, period, customFrom, customTo])

  const { data, loading, error, reload } = useApiData<ManagerAssignment[]>(url)
  const rows = data ?? []
  const activeCount = rows.filter(a => ['PENDING', 'IN_PROGRESS'].includes(a.status)).length

  const columns: Array<Col<ManagerAssignment>> = [
    {
      key: 'order',
      header: 'سفارش',
      cell: a => (
        <div className="min-w-40">
          <div className="font-mono text-xs" dir="ltr">{a.order.orderNo}</div>
          <div className="mt-0.5"><StatusBadge status={a.order.status} /></div>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'مشتری',
      cell: a => (
        <div>
          <div className="text-sm">{a.order.customer.shopName}</div>
          <Money rls={a.order.totalRls} className="text-xs font-bold text-emerald-700" />
        </div>
      ),
    },
    { key: 'driver', header: 'راننده', cell: a => <span className="text-sm">{a.driver.name}</span> },
    { key: 'status', header: 'وضعیت مأموریت', cell: a => <AssignmentStatusBadge status={a.status} label={a.statusLabel} /> },
    {
      key: 'payment',
      header: 'پرداخت',
      cell: a => a.paymentMethodLabel
        ? <span className="text-xs">{a.paymentMethodLabel}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      key: 'assignedAt',
      header: 'تخصیص',
      cell: a => <span className="text-xs text-muted-foreground"><JDate d={a.assignedAt} time /></span>,
    },
    {
      key: 'actions',
      header: 'اقدام',
      cell: a => (
        <div className="flex gap-1.5">
          {['PENDING', 'IN_PROGRESS'].includes(a.status) && (
            <Button
              size="sm" variant="outline"
              className="h-9 text-rose-600 hover:text-rose-700 border-rose-200 hover:bg-rose-50"
              onClick={() => setCancelTarget(a)}
            >
              <Ban className="h-3.5 w-3.5 ml-1" /> لغو
            </Button>
          )}
          {a.status === 'CANCELLED' && (
            <Button
              size="sm" variant="outline"
              className="h-9 text-violet-700 hover:text-violet-800 border-violet-200 hover:bg-violet-50"
              onClick={() => onReassign(a.order.id)}
            >
              <RefreshCw className="h-3.5 w-3.5 ml-1" /> تخصیص مجدد
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      {/* فیلترها */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Select value={driverId} onValueChange={setDriverId}>
          <SelectTrigger className="h-10 text-xs w-44"><SelectValue placeholder="همهٔ راننده‌ها" /></SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="ALL">همهٔ راننده‌ها</SelectItem>
            {activeDrivers.map(d => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10 text-xs w-44"><SelectValue placeholder="همهٔ وضعیت‌ها" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">همهٔ وضعیت‌ها</SelectItem>
            {DELIVERY_ASSIGNMENT_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s] ?? s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-1.5 flex-wrap">
          {MISSION_PERIODS.map(([k, label]) => (
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

        <button
          onClick={() => reload()}
          className="h-10 px-2.5 rounded-lg text-xs text-muted-foreground flex items-center gap-1 hover:bg-stone-100 border"
          aria-label="به‌روزرسانی فهرست"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {period === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-muted-foreground">بازهٔ دلخواه (تخصیص مأموریت):</span>
          <Input type="date" className="h-9 w-40 text-xs" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span className="text-xs text-muted-foreground">تا</span>
          <Input type="date" className="h-9 w-40 text-xs" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          {customFrom && customTo && dayRange(customFrom)! > dayRange(customTo, true)! && (
            <span className="text-xs text-rose-600">بازه نامعتبر است — «از» پس از «تا»</span>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground mb-2">
        {formatFaNumber(rows.length)} مأموریت در این نما — {formatFaNumber(activeCount)} فعال
      </p>

      {error && <p className="text-sm text-rose-600 py-4">{error}</p>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={loading}
        empty="مأموریتی در این فیلترها نیست — از دکمهٔ «تخصیص مأموریت» سفارش‌های آمادهٔ ارسال را به راننده بسپارید"
      />

      <CancelDialog target={cancelTarget} onClose={() => setCancelTarget(null)} onDone={onChanged} />
    </div>
  )
}

// ═════════════════════════════ تب ۲ — گزارش تحویل‌شده بدون تسویه (اعتباری) ═════════════════════════════
// نکتهٔ اصلاحی ۲ فاز ۰ — پیگیری مالی سفارش‌های تحویل‌شده با فروش اعتباری

function CreditTab({ onChanged }: { onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const { data, loading, error, reload } = useApiData<ManagerAssignment[]>('/api/deliveries?status=DELIVERED&take=500')

  // فقط سفارش‌های اعتباری؛ قدیمی‌ترین اول (بیشترین روز گذشته در بالا)
  const rows = useMemo(() => (data ?? [])
    .filter(a => a.order.payMethod === 'CREDIT')
    .sort((x, y) => new Date(x.completedAt ?? x.assignedAt).getTime() - new Date(y.completedAt ?? y.assignedAt).getTime()),
  [data])

  const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))

  const payNow = async (a: ManagerAssignment) => {
    if (busyId) return
    setBusyId(a.id)
    try {
      // همان مسیر markPaid بخش C — تسویه سفارش → مأموریت PAID و فاکتور PAID
      const r = await apiFetch<{ id: string; status: string; statusLabel: string }>(`/api/orders/${a.order.id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'markPaid' }),
      })
      toast.success(`پرداخت سفارش «${a.order.orderNo}» ثبت شد — وضعیت: ${r.statusLabel}`)
      onChanged() // خلاصهٔ داشبورد تازه شود
      reload() // ردیف از گزارش خارج می‌شود
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ثبت پرداخت')
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<Col<ManagerAssignment>> = [
    {
      key: 'order',
      header: 'سفارش / مشتری',
      cell: a => (
        <div className="min-w-40">
          <div className="font-mono text-xs" dir="ltr">{a.order.orderNo}</div>
          <div className="text-sm mt-0.5">{a.order.customer.shopName}</div>
        </div>
      ),
    },
    { key: 'amount', header: 'مبلغ', cell: a => <Money rls={a.order.totalRls} className="font-bold text-emerald-700" /> },
    {
      key: 'deliveredAt',
      header: 'تاریخ تحویل',
      cell: a => <span className="text-xs text-muted-foreground"><JDate d={a.completedAt ?? a.assignedAt} time /></span>,
    },
    { key: 'driver', header: 'راننده', cell: a => <span className="text-sm">{a.driver.name}</span> },
    {
      key: 'days',
      header: 'روزهای گذشته',
      cell: a => {
        const d = daysSince(a.completedAt ?? a.assignedAt)
        return (
          <span className={`text-xs font-bold ${d >= 7 ? 'text-rose-600' : d >= 3 ? 'text-amber-600' : 'text-muted-foreground'}`}>
            {formatFaNumber(d)} روز
          </span>
        )
      },
    },
    {
      key: 'action',
      header: 'اقدام',
      cell: a => (
        <Button size="sm" className="h-9" disabled={busyId != null} onClick={() => payNow(a)}>
          <CreditCard className="h-3.5 w-3.5 ml-1" />
          {busyId === a.id ? 'در حال ثبت…' : 'ثبت پرداخت'}
        </Button>
      ),
    },
  ]

  return (
    <div>
      <div className="rounded-xl border border-orange-200 bg-orange-50 text-orange-900 text-xs p-3 mb-3">
        سفارش‌های تحویل‌شده با پرداخت اعتباری که هنوز تسویه نشده‌اند — قدیمی‌ترین‌ها در بالا.
        «ثبت پرداخت» سفارش را «تسویه‌شده» می‌کند (فاکتور و مأموریت هم تسویه می‌شوند) و از این گزارش خارج می‌شود.
      </div>

      {error && <p className="text-sm text-rose-600 py-4">{error}</p>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={loading}
        empty="تحویل‌شدهٔ بی‌تسویهٔ اعتباری نیست — همهٔ سفارش‌های اعتباری تسویه شده‌اند"
      />
    </div>
  )
}

// ═════════════════════════════ دیالوگ تخصیص مأموریت (با حالت تخصیص مجدد) ═════════════════════════════

function AssignDialog({ open, initialOrderId, onOpenChange, onDone }: {
  open: boolean
  initialOrderId: string | null // تخصیص مجدد: سفارش مأموریت لغوشده — تخصیص تازه: null
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  // سفارش‌های واجد تخصیص: آمادهٔ ارسال + ارسال شده (مصوبهٔ فاز ۱)
  const { data: ready } = useApiData<OrderLite[]>(open ? '/api/orders?status=READY_FOR_DISPATCH&take=100' : null)
  const { data: dispatched } = useApiData<OrderLite[]>(open ? '/api/orders?status=DISPATCHED&take=100' : null)
  const { data: drivers } = useApiData<DriverLite[]>(open ? '/api/users?role=DRIVER' : null)

  const [orderId, setOrderId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  // هر بار باز شدن: با سفارش پیش‌فرض (تخصیص مجدد) یا خالی ریست می‌شود
  useEffect(() => {
    if (!open) return
    setOrderId(initialOrderId ?? '')
    setDriverId('')
    setNotes('')
  }, [open, initialOrderId])

  const orders = [...(ready ?? []), ...(dispatched ?? [])]
  const activeDrivers = (drivers ?? []).filter(d => d.isActive)

  const submit = async () => {
    if (busy) return
    if (!orderId) { toast.error('انتخاب سفارش الزامی است'); return }
    if (!driverId) { toast.error('انتخاب راننده الزامی است'); return }
    setBusy(true)
    try {
      await apiFetch('/api/deliveries', {
        method: 'POST',
        body: JSON.stringify({ orderId, deliveryUserId: driverId, notes: notes || null }),
      })
      toast.success('مأموریت تخصیص یافت و به راننده اعلان داده شد')
      onDone()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تخصیص مأموریت پخش</DialogTitle>
          <DialogDescription>سفارش‌های «آمادهٔ ارسال» و «ارسال شده» قابل تخصیص هستند؛ هر سفارش حداکثر یک مأموریت فعال دارد.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {initialOrderId && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 text-violet-900 text-xs p-2.5">
              تخصیص مجدد — این سفارش مأموریت لغوشده دارد؛ برای ادامهٔ کار، رانندهٔ دیگری انتخاب کنید.
            </div>
          )}
          <Field label="سفارش" required>
            <Select value={orderId} onValueChange={setOrderId}>
              <SelectTrigger className="h-11"><SelectValue placeholder="انتخاب سفارش…" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {orders.map(o => (
                  <SelectItem key={o.id} value={o.id}>
                    <span className="font-mono" dir="ltr">{o.orderNo}</span> — {o.customer.shopName} — {o.statusLabel} — <Money rls={o.totalRls} />
                  </SelectItem>
                ))}
                {orders.length === 0 && <div className="text-xs text-muted-foreground text-center py-3">سفارش قابل تخصیصی نیست</div>}
              </SelectContent>
            </Select>
          </Field>
          <Field label="راننده" required>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger className="h-11"><SelectValue placeholder="انتخاب راننده…" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {activeDrivers.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}{d.phone ? ` — ${d.phone}` : ''}</SelectItem>
                ))}
                {activeDrivers.length === 0 && <div className="text-xs text-muted-foreground text-center py-3">راننده فعالی ثبت نشده است</div>}
              </SelectContent>
            </Select>
          </Field>
          <Field label="یادداشت (اختیاری)">
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثلاً تحویل صبح — تماس پیش از رسیدن" />
          </Field>
          <Button className="h-11" disabled={busy} onClick={submit}>
            {busy ? 'در حال ثبت…' : 'تخصیص مأموریت'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ═════════════════════════════ دیالوگ لغو مأموریت ═════════════════════════════

function CancelDialog({ target, onClose, onDone }: {
  target: ManagerAssignment | null
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      await apiFetch(`/api/deliveries/${target.id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel', reason: reason || null, idempotencyKey: crypto.randomUUID() }),
      })
      toast.success('مأموریت لغو شد و به راننده اعلان داده شد — می‌توانید «تخصیص مجدد» بدهید')
      onDone()
      onClose()
      setReason('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={v => { if (!busy && !v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>لغو مأموریت</DialogTitle>
          <DialogDescription>
            مأموریت سفارش <span className="font-mono" dir="ltr">{target?.order.orderNo}</span> ({target?.driver.name}) لغو می‌شود.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="دلیل لغو (اختیاری)">
            <Input className="h-11" value={reason} onChange={e => setReason(e.target.value)} placeholder="مثلاً انصراف مشتری" />
          </Field>
          <Button className="h-11" variant="destructive" disabled={busy} onClick={submit}>
            {busy ? 'در حال ثبت…' : 'لغو مأموریت'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
