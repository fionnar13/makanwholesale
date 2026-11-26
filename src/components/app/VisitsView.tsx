'use client'
// بازدیدها و حضور — ثبت بازدید، نتیجه، حضور و غیاب، اهداف فروش
import { useState } from 'react'
import { apiFetch, useApiData, DataTable, Money, JDate, PageHeader, Field, formatFaNumber } from './kit'
import type { CustomerListItem, SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Plus, RefreshCw, LogIn, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { VISIT_RESULT_LABELS, ATTENDANCE_LABELS } from '@/lib/format'

type VisitRow = {
  id: string; customer: { code: string; shopName: string }; branchId: string | null
  startedAt: string; endedAt: string | null
  result: string | null; resultLabel: string | null
  noOrderReason: string | null; note: string | null; lat: number | null; lng: number | null
}
type AttendanceData = {
  today: { id: string; date: string; checkInAt: string | null; checkOutAt: string | null; status: string } | null
  month: string
  records: Array<{ id: string; userId: string; date: string; checkInAt: string | null; checkOutAt: string | null; status: string; userName?: string }>
}
type TargetMine = {
  periodYm: string
  target: { amountRls: number } | null
  achievedRls: number
  ordersCount: number
  visitsCount: number
  orderedVisits: number
  conversionPct: number | null
}
type TargetsAll = { periodYm: string; items: Array<{ userId: string; name: string; target: { amountRls: number } | null; achievedRls: number; ordersCount: number; achievementPct: number | null }> }

export default function VisitsView({ user }: { user: SessionUserLike }) {
  const [refresh, setRefresh] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [endId, setEndId] = useState<VisitRow | null>(null)
  const { data, loading, error, reload } = useApiData<VisitRow[]>(refresh >= 0 ? '/api/visits?take=120' : null)
  const canManage = user.permissions.includes('visits.manage')

  return (
    <div>
      <PageHeader
        title="بازدیدها و حضور"
        desc="بازدید، سفارش و وصول وجه سه رویداد مستقل‌اند — ثبت دقیق مبنای پورسانت و تحقق هدف است"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="h-4 w-4 ml-1" /> به‌روزرسانی</Button>
            {canManage && <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 ml-1" /> ثبت بازدید</Button>}
          </>
        }
      />

      <div className="grid lg:grid-cols-3 gap-4 mb-5">
        <AttendanceCard refresh={refresh} />
        <TargetCard user={user} refresh={refresh} />
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm font-bold mb-2">راهنما</div>
          <ul className="text-xs text-muted-foreground grid gap-1.5">
            <li>• «ثبت بازدید» آغاز بازدید است؛ «پایان بازدید» نتیجه را ثبت می‌کند.</li>
            <li>• نتیجه سفارش، با سفارش واقعی ثبت‌شده در ماژول سفارش‌ها تطبیق داده می‌شود.</li>
            <li>• حضور و غیاب به‌صورت روزانه (ورود/خروج/مرخصی/مأموریت) ثبت می‌شود.</li>
          </ul>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose-600 py-6 text-center">{error}</p>
      ) : (
        <DataTable
          columns={[
            { key: 'customer', header: 'مشتری', cell: (v: VisitRow) => <span className="text-sm">{v.customer.shopName}</span> },
            { key: 'start', header: 'شروع', cell: (v: VisitRow) => <span className="text-xs"><JDate d={v.startedAt} time /></span> },
            { key: 'end', header: 'پایان', cell: (v: VisitRow) => <span className="text-xs">{v.endedAt ? <JDate d={v.endedAt} time /> : '—'}</span> },
            {
              key: 'result', header: 'نتیجه', cell: (v: VisitRow) => v.result
                ? <Badge variant="secondary" className="text-[10px]">{VISIT_RESULT_LABELS[v.result] ?? v.result}</Badge>
                : <Badge className="border-transparent bg-amber-100 text-amber-800">در جریان</Badge>,
            },
            { key: 'reason', header: 'علت عدم سفارش', cell: (v: VisitRow) => <span className="text-xs text-muted-foreground">{v.noOrderReason ?? '—'}</span> },
            { key: 'note', header: 'یادداشت', cell: (v: VisitRow) => <span className="text-xs text-muted-foreground line-clamp-1">{v.note ?? '—'}</span> },
            {
              key: 'actions', header: '', cell: (v: VisitRow) => canManage && !v.endedAt
                ? <Button variant="ghost" size="sm" onClick={() => setEndId(v)}>پایان بازدید</Button>
                : null,
            },
          ]}
          rows={data ?? []}
          loading={loading}
          rowKey={(v: VisitRow) => v.id}
          empty="بازدیدی ثبت نشده است"
        />
      )}

      <CreateVisitDialog open={createOpen} onOpenChange={setCreateOpen} onDone={() => setRefresh(r => r + 1)} />
      <EndVisitDialog visit={endId} onClose={() => setEndId(null)} onDone={() => setRefresh(r => r + 1)} />
    </div>
  )
}

function AttendanceCard({ refresh }: { refresh: number }) {
  const { data, reload } = useApiData<AttendanceData>(refresh >= 0 ? '/api/attendance' : null)
  const t = data?.today
  const act = async (action: string) => {
    try {
      await apiFetch('/api/attendance', { method: 'POST', body: JSON.stringify({ action }) })
      toast.success('ثبت شد')
      reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'خطا') }
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm font-bold mb-3">حضور و غیاب امروز</div>
      {!t && <p className="text-xs text-muted-foreground mb-3">امروز ثبت حضور ندارید</p>}
      {t && (
        <div className="text-xs text-muted-foreground mb-3 grid gap-1">
          <span>ورود: {t.checkInAt ? <JDate d={t.checkInAt} time /> : '—'}</span>
          <span>خروج: {t.checkOutAt ? <JDate d={t.checkOutAt} time /> : '—'}</span>
          <span>وضعیت: <Badge variant="secondary" className="text-[10px]">{ATTENDANCE_LABELS[t.status] ?? t.status}</Badge></span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!t?.checkInAt && <Button size="sm" onClick={() => act('checkIn')}><LogIn className="h-4 w-4 ml-1" /> ثبت ورود</Button>}
        {t?.checkInAt && !t.checkOutAt && <Button size="sm" variant="outline" onClick={() => act('checkOut')}><LogOut className="h-4 w-4 ml-1" /> ثبت خروج</Button>}
        {(!t || (t.status === 'PRESENT' && !t.checkOutAt)) && (
          <>
            <Button size="sm" variant="ghost" onClick={() => act('setLeave')}>مرخصی</Button>
            <Button size="sm" variant="ghost" onClick={() => act('setMission')}>مأموریت</Button>
          </>
        )}
      </div>
    </div>
  )
}

function TargetCard({ user, refresh }: { user: SessionUserLike; refresh: number }) {
  const isVisitorOnly = !user.permissions.includes('reports.view') && user.permissions.includes('orders.create')
  const { data: mine } = useApiData<TargetMine>(refresh >= 0 ? '/api/targets?mine=1' : null)
  const { data: all } = useApiData<TargetsAll>(!isVisitorOnly ? '/api/targets' : null)

  if (isVisitorOnly && mine) {
    const pct = mine.target && mine.target.amountRls > 0 ? Math.min(100, Math.round((mine.achievedRls / mine.target.amountRls) * 100)) : null
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-bold mb-2">کارنامه فروش — دوره {mine.periodYm}</div>
        <div className="text-xs text-muted-foreground grid gap-1">
          <span>هدف فروش: <Money rls={mine.target?.amountRls ?? 0} /></span>
          <span>تحقق‌شده: <Money rls={mine.achievedRls} className="font-bold text-emerald-700" /></span>
          <span>سفارش‌ها: {formatFaNumber(mine.ordersCount)} | بازدید: {formatFaNumber(mine.visitsCount)} | تبدیل به سفارش: {mine.conversionPct != null ? `${formatFaNumber(mine.conversionPct)}٪` : '—'}</span>
        </div>
        {pct != null && (
          <div className="mt-3">
            <Progress value={pct} aria-label="تحقق هدف" />
            <span className="text-[11px] text-muted-foreground mt-1 block">{formatFaNumber(pct)}٪ از هدف</span>
          </div>
        )}
      </div>
    )
  }

  if (all) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-bold mb-2">تحقق اهداف ویزیتورها — {all.periodYm}</div>
        {all.items.length === 0 ? <p className="text-xs text-muted-foreground">ویزیتوری ثبت نشده است</p> : (
          <div className="grid gap-2.5 max-h-44 overflow-y-auto">
            {all.items.map(it => (
              <div key={it.userId} className="text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{it.name}</span>
                  <span className="text-muted-foreground">{it.achievementPct != null ? `${formatFaNumber(it.achievementPct)}٪` : 'هدف‌گذاری نشده'}</span>
                </div>
                {it.achievementPct != null && <Progress value={Math.min(100, it.achievementPct)} className="mt-1 h-2" aria-label="تحقق" />}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  return null
}

function CreateVisitDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { data: customers } = useApiData<CustomerListItem[]>(open ? '/api/customers' : null)
  const [form, setForm] = useState({ customerId: '', branchId: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])

  const pickCustomer = async (id: string) => {
    setForm(f => ({ ...f, customerId: id, branchId: '' }))
    if (!id) { setBranches([]); return }
    try {
      const d = await apiFetch<{ branches: Array<{ id: string; name: string; isActive: boolean }> }>(`/api/customers/${id}`)
      setBranches(d.branches.filter(b => b.isActive))
    } catch { setBranches([]) }
  }

  const submit = async () => {
    if (!form.customerId) { toast.error('انتخاب مشتری الزامی است'); return }
    setBusy(true)
    try {
      await apiFetch('/api/visits', {
        method: 'POST',
        body: JSON.stringify({ customerId: form.customerId, branchId: form.branchId || null, note: form.note || null }),
      })
      toast.success('بازدید آغاز شد — پس از اتمام، نتیجه را ثبت کنید')
      onDone(); onOpenChange(false)
      setForm({ customerId: '', branchId: '', note: '' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت ناموفق بود')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>ثبت بازدید</DialogTitle><DialogDescription>زمان شروع از سرور ثبت می‌شود.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Field label="مشتری" required>
            <Select value={form.customerId} onValueChange={pickCustomer}>
              <SelectTrigger><SelectValue placeholder="انتخاب…" /></SelectTrigger>
              <SelectContent className="max-h-52">{customers?.map(c => <SelectItem key={c.id} value={c.id}>{c.shopName}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="شعبه">
            <Select value={form.branchId} onValueChange={v => setForm(f => ({ ...f, branchId: v }))} disabled={branches.length === 0}>
              <SelectTrigger><SelectValue placeholder={branches.length ? 'انتخاب…' : 'بدون شعبه'} /></SelectTrigger>
              <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="یادداشت"><Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button>
            <Button onClick={submit} disabled={busy}>{busy ? 'در حال ثبت…' : 'شروع بازدید'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EndVisitDialog({ visit, onClose, onDone }: { visit: VisitRow | null; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState('')
  const [noOrderReason, setNoOrderReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!visit || !result) { toast.error('نتیجه بازدید الزامی است'); return }
    setBusy(true)
    try {
      await apiFetch(`/api/visits/${visit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ result, noOrderReason: result === 'NO_ORDER' ? noOrderReason || null : null, note: note || null }),
      })
      toast.success('پایان بازدید ثبت شد')
      onDone(); onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت ناموفق بود')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!visit} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>پایان بازدید</DialogTitle><DialogDescription>{visit?.customer.shopName}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Field label="نتیجه" required>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger><SelectValue placeholder="انتخاب…" /></SelectTrigger>
              <SelectContent>
                {Object.entries(VISIT_RESULT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {result === 'NO_ORDER' && (
            <Field label="علت عدم سفارش"><Input value={noOrderReason} onChange={e => setNoOrderReason(e.target.value)} placeholder="مثلاً: موجودی کافی دارد" /></Field>
          )}
          <Field label="یادداشت"><Input value={note} onChange={e => setNote(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>انصراف</Button>
            <Button onClick={submit} disabled={busy}>{busy ? 'در حال ثبت…' : 'ثبت پایان'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
