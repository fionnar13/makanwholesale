'use client'
// مأموریت‌های پخش — نمای مدیر (فاز ۱ — بخش D): فهرست همهٔ مأموریت‌ها + فیلتر وضعیت
// + دیالوگ تخصیص سفارش به راننده + لغو مأموریت فعال
// این یک نمای سادهٔ مدیریتی است؛ داشبورد تحلیلی دوره‌ای در بخش E اضافه می‌شود
// (فیلتر از/تا از GET /api/deliveries — بخش D — برای E آماده است)
import { useState } from 'react'
import { apiFetch, useApiData, Money, JDate, PageHeader, Field, DataTable, StatusBadge, AssignmentStatusBadge, type Col } from './kit'
import type { SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Ban, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ASSIGNMENT_STATUS_LABELS, DELIVERY_ASSIGNMENT_STATUSES } from '@/lib/delivery-shared'

type ManagerAssignment = {
  id: string
  status: string
  statusLabel: string
  paymentMethodLabel: string | null
  failureReasonLabel: string | null
  assignedAt: string
  startedAt: string | null
  completedAt: string | null
  order: { id: string; orderNo: string; status: string; statusLabel: string; totalRls: number; payMethod: string; customer: { shopName: string } }
  driver: { id: string; name: string }
}

type OrderLite = {
  id: string; orderNo: string; status: string; statusLabel: string; totalRls: number
  customer: { shopName: string }
}

type DriverLite = { id: string; name: string; phone: string | null; isActive: boolean }

export default function DeliveriesView({ user }: { user: SessionUserLike }) {
  const [refresh, setRefresh] = useState(0)
  const [status, setStatus] = useState<string>('ALL')
  const [assignOpen, setAssignOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<ManagerAssignment | null>(null)

  const { data, loading, error, reload } = useApiData<ManagerAssignment[]>(
    refresh >= 0 ? `/api/deliveries${status !== 'ALL' ? `?status=${status}` : '?take=300'}` : null,
  )
  const rows = data ?? []
  const activeCount = rows.filter(a => ['PENDING', 'IN_PROGRESS'].includes(a.status)).length

  const columns: Array<Col<ManagerAssignment>> = [
    {
      key: 'order',
      header: 'سفارش',
      cell: a => (
        <div className="min-w-40">
          <div className="font-mono text-xs" dir="ltr">{a.order.orderNo}</div>
          <div className="mt-0.5"><StatusBadge status={a.order.status} label={a.order.statusLabel} /></div>
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
      cell: a => ['PENDING', 'IN_PROGRESS'].includes(a.status)
        ? (
          <Button size="sm" variant="outline" className="h-9 text-rose-600 hover:text-rose-700 border-rose-200 hover:bg-rose-50" onClick={() => setCancelTarget(a)}>
            <Ban className="h-3.5 w-3.5 ml-1" /> لغو
          </Button>
        )
        : <span className="text-xs text-muted-foreground">—</span>,
    },
  ]

  return (
    <div>
      <PageHeader
        title="مأموریت‌های پخش"
        desc={`${activeCount} مأموریت فعال — تخصیص سفارش‌های آمادهٔ ارسال به راننده‌ها و پیگیری تحویل`}
        actions={
          <>
            <button
              onClick={() => reload()}
              className="h-10 px-3 rounded-lg text-xs text-muted-foreground flex items-center gap-1.5 hover:bg-stone-100 border"
            >
              <RefreshCw className="h-3.5 w-3.5" /> به‌روزرسانی
            </button>
            <Button onClick={() => setAssignOpen(true)} className="h-10">
              <Plus className="h-4 w-4 ml-1" /> تخصیص مأموریت
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2 mb-3 max-w-xs">
        <span className="text-xs text-muted-foreground shrink-0">وضعیت:</span>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10 text-xs"><SelectValue placeholder="همهٔ وضعیت‌ها" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">همهٔ وضعیت‌ها</SelectItem>
            {DELIVERY_ASSIGNMENT_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s] ?? s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-rose-600 py-4">{error}</p>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={loading}
        empty="مأموریتی ثبت نشده است — از دکمهٔ «تخصیص مأموریت» سفارش‌های آمادهٔ ارسال را به راننده بسپارید"
      />

      <AssignDialog open={assignOpen} onOpenChange={setAssignOpen} onDone={() => setRefresh(r => r + 1)} />
      <CancelDialog target={cancelTarget} onClose={() => setCancelTarget(null)} onDone={() => setRefresh(r => r + 1)} />
    </div>
  )
}

// ═════════════════════════════ دیالوگ تخصیص مأموریت ═════════════════════════════

function AssignDialog({ open, onOpenChange, onDone }: {
  open: boolean
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
      setOrderId(''); setDriverId(''); setNotes('')
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
      toast.success('مأموریت لغو شد و به راننده اعلان داده شد')
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
