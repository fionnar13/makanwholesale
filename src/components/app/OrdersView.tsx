'use client'
// سفارش‌ها — لیست، تخته عملیات، جزئیات و اقدامات ماشین حالت
import { useState } from 'react'
import { apiFetch, useApiData, DataTable, Money, JDate, StatusBadge, PageHeader, formatFaNumber, Spinner } from './kit'
import OrderCreateDialog from './OrderCreateDialog'
import type { OrderListItem, OrderDetail, SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ORDER_STATUS_LABELS } from '@/lib/format'

const STATUS_OPTIONS = [
  { value: 'SUBMITTED', label: 'ثبت‌شده' },
  { value: 'RESERVED', label: 'رزرو شده' },
  { value: 'CONFIRMED', label: 'تأیید شده' },
  { value: 'CREDIT_APPROVED', label: 'اعتبار تأیید شده' },
  { value: 'PAID', label: 'پرداخت شده' },
  { value: 'PICKING', label: 'در حال آماده‌سازی' },
  { value: 'READY_FOR_DISPATCH', label: 'آماده ارسال' },
  { value: 'DISPATCHED', label: 'ارسال شده' },
  { value: 'DELIVERED', label: 'تحویل شده' },
  { value: 'COMPLETED', label: 'کامل شده' },
  { value: 'CANCELLED', label: 'لغو شده' },
  { value: 'REJECTED', label: 'رد شده' },
]

type Driver = { id: string; name: string; phone: string }

export default function OrdersView({ user }: { user: SessionUserLike }) {
  const [status, setStatus] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const url = `/api/orders?take=150${status !== 'all' ? `&status=${status}` : ''}`
  const { data, loading, error, reload } = useApiData<OrderListItem[]>(url)

  const boardGroups: Array<{ title: string; statuses: string[]; tone: string }> = [
    { title: 'در انتظار تأیید', statuses: ['SUBMITTED', 'RESERVED'], tone: 'bg-amber-50 border-amber-200' },
    { title: 'تأیید/اعتبار', statuses: ['CONFIRMED', 'CREDIT_APPROVED'], tone: 'bg-teal-50 border-teal-200' },
    { title: 'آماده‌سازی', statuses: ['PAID', 'PICKING'], tone: 'bg-orange-50 border-orange-200' },
    { title: 'آماده ارسال', statuses: ['READY_FOR_DISPATCH'], tone: 'bg-yellow-50 border-yellow-200' },
    { title: 'ارسال‌شده', statuses: ['DISPATCHED'], tone: 'bg-violet-50 border-violet-200' },
    { title: 'تحویل‌شده', statuses: ['DELIVERED', 'COMPLETED'], tone: 'bg-emerald-50 border-emerald-200' },
  ]
  const rows = data ?? []

  return (
    <div>
      <PageHeader
        title="سفارش‌ها"
        desc="چرخه کامل سفارش: ثبت → رزرو → تأیید → پرداخت/اعتبار → آماده‌سازی → ارسال → تحویل"
        actions={
          <>
            <Button variant="outline" onClick={reload} size="sm"><RefreshCw className="h-4 w-4 ml-1" /> به‌روزرسانی</Button>
            {user.permissions.includes('orders.create') && (
              <Button onClick={() => setCreateOpen(true)} size="sm"><Plus className="h-4 w-4 ml-1" /> سفارش جدید</Button>
            )}
          </>
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">لیست سفارش‌ها</TabsTrigger>
          <TabsTrigger value="board">تخته عملیات</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <div className="mb-3 max-w-56">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همه وضعیت‌ها</SelectItem>
                {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <p className="text-sm text-rose-600 py-6 text-center">{error}</p>
          ) : (
            <DataTable
              columns={[
                { key: 'orderNo', header: 'شماره', cell: (o: OrderListItem) => <button className="font-mono text-xs hover:underline" onClick={() => setDetailId(o.id)} dir="ltr">{o.orderNo}</button> },
                { key: 'customer', header: 'مشتری', cell: (o: OrderListItem) => <span className="text-sm">{o.customer.shopName}</span> },
                { key: 'total', header: 'مبلغ', cell: (o: OrderListItem) => <Money rls={o.totalRls} className="text-sm font-bold" /> },
                { key: 'items', header: 'اقلام', cell: (o: OrderListItem) => <span className="text-xs">{formatFaNumber(o.itemsCount)} قلم / {formatFaNumber(o.itemsCountBase)} پایه</span> },
                { key: 'status', header: 'وضعیت', cell: (o: OrderListItem) => <StatusBadge status={o.status} label={o.statusLabel} /> },
                { key: 'visitor', header: 'ویزیتور', cell: (o: OrderListItem) => <span className="text-xs text-muted-foreground">{o.visitor ?? '—'}</span> },
                { key: 'createdBy', header: 'ثبت‌کننده', cell: (o: OrderListItem) => <span className="text-xs text-muted-foreground">{o.createdBy ?? '—'}</span> },
                { key: 'createdAt', header: 'زمان', cell: (o: OrderListItem) => <span className="text-xs"><JDate d={o.createdAt} time /></span> },
                {
                  key: 'actions', header: '', cell: (o: OrderListItem) => (
                    <Button variant="ghost" size="sm" onClick={() => setDetailId(o.id)}>جزئیات</Button>
                  ),
                },
              ]}
              rows={rows}
              loading={loading}
              rowKey={(o: OrderListItem) => o.id}
              empty="سفارشی با این فیلتر ثبت نشده است"
            />
          )}
        </TabsContent>

        <TabsContent value="board" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {boardGroups.map(g => {
              const cards = rows.filter(o => g.statuses.includes(o.status))
              return (
                <div key={g.title} className={`rounded-xl border p-2 ${g.tone}`}>
                  <div className="text-xs font-bold px-1 pb-2 flex items-center justify-between">
                    <span>{g.title}</span>
                    <Badge variant="secondary" className="text-[10px]">{formatFaNumber(cards.length)}</Badge>
                  </div>
                  <div className="grid gap-2 max-h-96 overflow-y-auto">
                    {cards.length === 0 && <p className="text-[11px] text-muted-foreground text-center py-3">خالی</p>}
                    {cards.map(o => (
                      <button key={o.id} onClick={() => setDetailId(o.id)} className="text-right rounded-lg bg-white border p-2 hover:shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{o.orderNo}</span>
                          <StatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
                        </div>
                        <div className="text-xs font-medium mt-1 truncate">{o.customer.shopName}</div>
                        <div className="text-xs"><Money rls={o.totalRls} className="font-bold text-emerald-700" /></div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>

      <OrderCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={reload} />

      <OrderDetailDialog orderId={detailId} onClose={() => setDetailId(null)} onChanged={reload} user={user} />
    </div>
  )
}

function OrderDetailDialog({ orderId, onClose, onChanged, user }: {
  orderId: string | null
  onClose: () => void
  onChanged: () => void
  user: SessionUserLike
}) {
  const { data, loading, error, reload } = useApiData<OrderDetail>(orderId ? `/api/orders/${orderId}` : null)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<{ key: string; label: string; needDriver?: boolean } | null>(null)
  const [note, setNote] = useState('')
  const [driverId, setDriverId] = useState('')
  const [drivers, setDrivers] = useState<Driver[]>([])

  const openAction = async (key: string, label: string, needDriver?: boolean) => {
    setNote('')
    setDriverId('')
    setAction({ key, label, needDriver })
    if (needDriver) {
      try {
        const ds = await apiFetch<Driver[]>('/api/users?role=DRIVER')
        setDrivers(ds)
      } catch {
        toast.error('دریافت فهرست رانندگان ناموفق بود')
      }
    }
  }

  const runAction = async () => {
    if (!orderId || !action) return
    setBusy(true)
    try {
      const res = await apiFetch<{ status: string; statusLabel: string }>(`/api/orders/${orderId}`, {
        method: 'POST',
        body: JSON.stringify({ action: action.key, driverId: driverId || null, note: note || null }),
      })
      toast.success(`وضعیت سفارش: ${res.statusLabel}`)
      setAction(null)
      reload()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'اقدام ناموفق بود')
    } finally {
      setBusy(false)
    }
  }

  const d = data
  const p = user.permissions
  const canCancel = d && ['SUBMITTED', 'RESERVED', 'CONFIRMED', 'CREDIT_APPROVED', 'PAID', 'PICKING', 'READY_FOR_DISPATCH'].includes(d.status) && p.includes('orders.cancel')
  const availableActions: Array<{ key: string; label: string; perm: string; needDriver?: boolean }> = d ? [
    { key: 'confirm', label: 'تأیید سفارش', perm: 'orders.confirm' },
    { key: 'reject', label: 'رد سفارش', perm: 'orders.confirm' },
    { key: 'creditApprove', label: 'تأیید اعتبار', perm: 'orders.creditApprove' },
    { key: 'markPaid', label: 'ثبت پرداخت سفارش', perm: 'finance.receipts' },
    { key: 'startPicking', label: 'شروع آماده‌سازی', perm: 'inventory.issue' },
    { key: 'readyForDispatch', label: 'آماده‌سازی کامل شد', perm: 'inventory.issue' },
    { key: 'dispatch', label: 'ارسال از انبار', perm: 'deliveries.manage', needDriver: true },
    { key: 'deliver', label: 'ثبت تحویل و خروج فیزیکی', perm: 'inventory.issue' },
    { key: 'complete', label: 'بستن سفارش', perm: 'orders.confirm' },
  ].filter(a => {
    if (!p.includes(a.perm)) return false
    const from: Record<string, string[]> = {
      confirm: ['RESERVED'], reject: ['SUBMITTED', 'RESERVED'],
      creditApprove: ['CONFIRMED'], markPaid: ['CONFIRMED', 'CREDIT_APPROVED'],
      startPicking: ['PAID', 'CREDIT_APPROVED'], readyForDispatch: ['PICKING'],
      dispatch: ['READY_FOR_DISPATCH'], deliver: ['DISPATCHED'], complete: ['DELIVERED'],
    }
    return from[a.key]?.includes(d.status)
  }) : []

  return (
    <Dialog open={!!orderId} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        {loading && <Spinner />}
        {error && <p className="text-sm text-rose-600 py-6">{error}</p>}
        {d && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-base" dir="ltr">{d.orderNo}</span>
                <StatusBadge status={d.status} label={d.statusLabel} />
                {d.payMethod === 'CREDIT' && <Badge variant="outline">اعتباری</Badge>}
              </DialogTitle>
              <DialogDescription>
                {d.customer.shopName} {d.branch ? `— شعبه ${d.branch.name}` : ''} | ثبت‌کننده: {d.createdBy ?? '—'}
                {d.visitor ? <> | ویزیتور: {d.visitor}</> : ''} | <JDate d={d.createdAt} time />
              </DialogDescription>
            </DialogHeader>

            <div className="grid sm:grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg border bg-stone-50 p-3">
                <div className="text-xs text-muted-foreground">مبلغ کل</div>
                <Money rls={d.totalRls} className="font-black text-emerald-700" />
              </div>
              <div className="rounded-lg border bg-stone-50 p-3">
                <div className="text-xs text-muted-foreground">اقلام</div>
                <span className="font-bold">{formatFaNumber(d.items.length)} قلم</span>
              </div>
              <div className="rounded-lg border bg-stone-50 p-3">
                <div className="text-xs text-muted-foreground">فاکتور</div>
                {d.invoice ? <span className="font-mono text-xs" dir="ltr">{d.invoice.invoiceNo}</span> : <span className="text-xs text-muted-foreground">صادر نشده (در تحویل صادر می‌شود)</span>}
              </div>
            </div>

            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50">
                    <TableHead>کالا</TableHead>
                    <TableHead>واحد</TableHead>
                    <TableHead>مقدار</TableHead>
                    <TableHead>قیمت واحد</TableHead>
                    <TableHead>مبلغ خط</TableHead>
                    <TableHead>منبع قیمت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.items.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm">{i.productName}</TableCell>
                      <TableCell className="text-xs">{i.unitName}</TableCell>
                      <TableCell className="text-xs">{formatFaNumber(i.qtyBase)} پایه</TableCell>
                      <TableCell><Money rls={i.unitPriceRls} className="text-xs" /></TableCell>
                      <TableCell><Money rls={i.lineTotalRls} className="text-xs font-bold" /></TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {i.priceSnapshot?.scope === 'DEFAULT' ? 'عمومی' : i.priceSnapshot?.scope === 'CUSTOMER' ? 'اختصاصی' : i.priceSnapshot?.scope === 'GROUP' ? 'گروه' : i.priceSnapshot?.scope ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* اقدامات */}
            {(availableActions.length > 0 || canCancel) && (
              <div className="flex flex-wrap gap-2">
                {availableActions.map(a => (
                  <Button key={a.key} size="sm" variant={a.key === 'reject' ? 'destructive' : 'default'} onClick={() => openAction(a.key, a.label, a.needDriver)}>
                    {a.label}
                  </Button>
                ))}
                {canCancel && (
                  <Button size="sm" variant="outline" className="text-rose-600 border-rose-200" onClick={() => openAction('cancel', 'لغو سفارش')}>
                    لغو سفارش
                  </Button>
                )}
              </div>
            )}

            {/* رویدادها */}
            <div>
              <div className="text-xs font-bold text-muted-foreground mb-2">رویدادهای سفارش</div>
              <ol className="relative border-r pr-4 grid gap-3">
                {d.events.map(e => (
                  <li key={e.id} className="text-xs">
                    <span className="absolute -right-[5px] mt-1 h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                    <b>{e.from ? `${ORDER_STATUS_LABELS[e.from] ?? e.from} → ` : ''}{ORDER_STATUS_LABELS[e.to] ?? e.to}</b>
                    <span className="text-muted-foreground"> — {e.user ?? 'سیستم'} | <JDate d={e.createdAt} time /></span>
                    {e.note && <div className="text-muted-foreground mt-0.5">{e.note}</div>}
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </DialogContent>

      {/* تأیید اقدام */}
      <AlertDialog open={!!action} onOpenChange={v => !v && setAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{action?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              {action?.key === 'deliver' && 'با ثبت تحویل، خروج فیزیکی کالا با سیاست FEFO از بچ‌ها ثبت و فاکتور صادر می‌شود.'}
              {action?.key === 'dispatch' && 'خروج از انبار و تحویل به راننده ثبت می‌شود.'}
              {(action?.key === 'cancel' || action?.key === 'reject') && 'رزرو موجودی آزاد می‌شود و در صورت پرداخت قبلی، سند اصلاحی ثبت خواهد شد.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3">
            {action?.needDriver && (
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger><SelectValue placeholder="انتخاب راننده (الزامی)…" /></SelectTrigger>
                <SelectContent>
                  {drivers.map(dr => <SelectItem key={dr.id} value={dr.id}>{dr.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Input placeholder="یادداشت (اختیاری)" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.preventDefault(); runAction() }}
              className={action?.key === 'reject' || action?.key === 'cancel' ? 'bg-rose-600 hover:bg-rose-700' : ''}
            >
              {busy ? 'در حال اجرا…' : 'اجرای اقدام'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
