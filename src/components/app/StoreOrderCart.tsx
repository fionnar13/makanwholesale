'use client'
// سبد خرید و ثبت سفارش ویزیتور در فروشگاه — جریان: انتخاب/ایجاد مشتری → بررسی اقلام با قیمت
// زندهٔ سرور → ثبت سفارش با Idempotency. قیمت نهایی همیشه از سرور (همان موتور ثبت سفارش).
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, formatFaNumber, Money, Field } from './kit'
import type { SessionUserLike } from './types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Loader2, RefreshCw, ShoppingBasket, Store, Trash2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { GROUP_LABELS } from '@/lib/format'

export type CartItem = {
  productId: string
  productName: string
  sku: string
  imageUrl: string | null
  unitId: string
  unitName: string
  factor: number
  qty: number // تعداد واحد فروش (مثلاً ۲ کارتن)
  unitPriceRls: number | null // قیمت عمومی — فقط برای نمایش قبل از انتخاب مشتری
  availableBase: number | null
}

type CustomerLite = {
  id: string; code: string; shopName: string; phone: string
  groupKey: string; balanceRls: number; remainingCreditRls: number; status: string
}

type LineQuote = {
  priceRls: number | null
  scope: string
  lineTotalRls: number
  availableBase: number | null
  error: string | null
}

type Placed = { orderNo: string; totalRls: number }

const lineKey = (i: CartItem) => `${i.productId}:${i.unitId}`

export default function StoreOrderCart({ open, onOpenChange, user, items, onItemsChange }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  user: SessionUserLike
  items: CartItem[]
  onItemsChange: (items: CartItem[]) => void
}) {
  const [customers, setCustomers] = useState<CustomerLite[]>([])
  const [loadingCust, setLoadingCust] = useState(false)
  const [custQ, setCustQ] = useState('')
  const [mode, setMode] = useState<'pick' | 'new'>('pick')
  const [customerId, setCustomerId] = useState('')
  const [newForm, setNewForm] = useState({ shopName: '', ownerName: '', phone: '', address: '', businessType: 'GROCERY' })
  const [creatingCust, setCreatingCust] = useState(false)
  const [quotes, setQuotes] = useState<Record<string, LineQuote>>({})
  const [quoting, setQuoting] = useState(false)
  const [payMethod, setPayMethod] = useState<'CASH' | 'CREDIT' | 'TRANSFER'>('CREDIT')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [placed, setPlaced] = useState<Placed | null>(null)
  const idemKey = useRef('')

  const customer = useMemo(() => customers.find(c => c.id === customerId) ?? null, [customers, customerId])
  const hasManage = user.permissions?.includes('customers.manage') ?? false

  // بارگذاری مشتریان (سمت سرور به مشتریان همین ویزیتور محدود شده) + ریست وضعیت با هر باز شدن
  useEffect(() => {
    if (!open) return
    idemKey.current = crypto.randomUUID()
    setPlaced(null); setNotes(''); setCustomerId(''); setCustQ(''); setMode('pick')
    setNewForm({ shopName: '', ownerName: '', phone: '', address: '', businessType: 'GROCERY' })
    setLoadingCust(true)
    apiFetch<CustomerLite[]>('/api/customers')
      .then(cs => setCustomers(cs.filter(c => c.status === 'ACTIVE')))
      .catch(e => toast.error(e instanceof Error ? e.message : 'دریافت مشتریان ناموفق بود'))
      .finally(() => setLoadingCust(false))
  }, [open])

  // قیمت زندهٔ هر قلم از سرور — پس از انتخاب مشتری یا تغییر اقلام (debounce)
  useEffect(() => {
    if (!open || !customerId || items.length === 0) { setQuotes({}); return }
    setQuoting(true)
    const t = setTimeout(() => {
      Promise.all(items.map(async i => {
        try {
          const q = await apiFetch<{ priceRls: number; scope: string; availableBase: number | null }>(
            `/api/pricing?productId=${i.productId}&unitId=${i.unitId}&qtyBase=${i.qty * i.factor}&customerId=${customerId}`)
          const lineTotal = q.priceRls * i.qty
          const stockShort = q.availableBase != null && i.qty * i.factor > q.availableBase
          return [lineKey(i), {
            priceRls: q.priceRls, scope: q.scope, lineTotalRls: lineTotal,
            availableBase: q.availableBase,
            error: stockShort ? `موجودی کافی نیست (قابل فروش: ${formatFaNumber(q.availableBase ?? 0)})` : null,
          } as LineQuote]
        } catch (e) {
          return [lineKey(i), { priceRls: null, scope: '', lineTotalRls: 0, availableBase: null, error: e instanceof Error ? e.message : 'قیمت نامعتبر' } as LineQuote]
        }
      })).then(entries => setQuotes(Object.fromEntries(entries)))
        .finally(() => setQuoting(false))
    }, 300)
    return () => clearTimeout(t)
  }, [open, customerId, items])

  const setQty = (idx: number, qty: number) => {
    onItemsChange(items.map((i, j) => j === idx ? { ...i, qty: Math.max(1, Math.floor(qty) || 1) } : i))
  }
  const removeItem = (idx: number) => onItemsChange(items.filter((_, j) => j !== idx))

  // مبلغ هر خط — با مشتری: قیمت زندهٔ سرور؛ بدون مشتری: قیمت عمومی (تخمینی)
  const lineAmount = (i: CartItem) => {
    const q = quotes[lineKey(i)]
    if (customer && q && !q.error) return q.lineTotalRls
    if (customer && q?.error) return null
    return i.unitPriceRls != null ? i.unitPriceRls * i.qty : null
  }
  const totalRls = items.reduce((s, i) => (lineAmount(i) ?? 0) + s, 0)
  const anyLineError = customer && items.length > 0 && items.some(i => quotes[lineKey(i)]?.error)
  const anyMissingPrice = items.some(i => customer && quotes[lineKey(i)] == null && !quoting)

  const filteredCustomers = customers.filter(c =>
    !custQ.trim() || c.shopName.includes(custQ.trim()) || c.code.includes(custQ.trim()) || c.phone.includes(custQ.trim()))

  const createCustomer = async () => {
    if (!newForm.shopName || newForm.shopName.trim().length < 2) { toast.error('نام فروشگاه الزامی است'); return }
    if (!newForm.phone || newForm.phone.trim().length < 8) { toast.error('شماره تماس معتبر وارد کنید'); return }
    setCreatingCust(true)
    try {
      const res = await apiFetch<{ id: string; code: string; shopName: string; existing?: boolean }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          shopName: newForm.shopName.trim(),
          ownerName: newForm.ownerName || null,
          phone: newForm.phone.trim(),
          address: newForm.address || null,
          businessType: newForm.businessType,
        }),
      })
      if (res.existing) {
        toast.info(`مشتری با این تلفن قبلاً ثبت شده بود — «${res.shopName}» انتخاب شد`)
      } else {
        toast.success(`مشتری ${res.shopName} با کد ${res.code} ثبت شد`)
      }
      setCustomers(prev => prev.some(c => c.id === res.id) ? prev : [
        { id: res.id, code: res.code, shopName: res.shopName, phone: newForm.phone.trim(), groupKey: 'REGULAR', balanceRls: 0, remainingCreditRls: 0, status: 'ACTIVE' },
        ...prev,
      ])
      setCustomerId(res.id)
      setNewForm({ shopName: '', ownerName: '', phone: '', address: '', businessType: 'GROCERY' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت مشتری ناموفق بود')
    } finally {
      setCreatingCust(false)
    }
  }

  const submit = async () => {
    if (!customerId) { toast.error('ابتدا مشتری را انتخاب یا ثبت کنید'); return }
    if (items.length === 0) { toast.error('حداقل یک قلم به سبد اضافه کنید'); return }
    if (anyLineError) { toast.error('ابتدا خطاهای اقلام را برطرف کنید'); return }
    if (anyMissingPrice) { toast.error('قیمت اقلام هنوز از سرور دریافت نشده است'); return }
    setSubmitting(true)
    try {
      const res = await apiFetch<{ orderNo: string; totalRls: number; idempotent: boolean }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          branchId: null,
          payMethod,
          notes: notes || null,
          idempotencyKey: idemKey.current,
          items: items.map(i => ({ productId: i.productId, unitId: i.unitId, qty: i.qty })),
        }),
      })
      setPlaced({ orderNo: res.orderNo, totalRls: res.totalRls })
      onItemsChange([])
      toast.success(res.idempotent
        ? `سفارش ${res.orderNo} قبلاً ثبت شده بود (درخواست تکراری)`
        : `سفارش ${res.orderNo} ثبت و برای مدیر ارسال شد`)
      idemKey.current = crypto.randomUUID()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت سفارش ناموفق بود')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingBasket className="h-5 w-5 text-emerald-600" /> سبد سفارش مشتری</DialogTitle>
          <DialogDescription>
            {placed
              ? 'سفارش با موفقیت ثبت شد و مدیر در جریان قرار گرفت.'
              : 'قیمت و موجودی هر قلم در لحظه از سرور محاسبه می‌شود؛ ثبت سفارش قطعی و رزرو موجودی پس از تأیید است.'}
          </DialogDescription>
        </DialogHeader>

        {/* پیام موفقیت پس از ثبت */}
        {placed ? (
          <div className="grid gap-4 py-2 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" aria-hidden />
            <div>
              <div className="text-lg font-black text-emerald-700">سفارش <span className="font-mono" dir="ltr">{placed.orderNo}</span> ثبت شد</div>
              <div className="text-sm text-muted-foreground mt-1">جمع کل: <Money rls={placed.totalRls} className="font-bold text-stone-700" /></div>
              <div className="text-xs text-muted-foreground mt-2 leading-5">
                مشتری و ویزیتور ثبت‌کننده در سفارش ذخیره شده‌اند؛ مدیر در تب «سفارش‌ها» جزئیات کامل را می‌بیند
                و پس از تأیید، موجودی رزرو شده وارد چرخهٔ آماده‌سازی می‌شود.
              </div>
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>بستن</Button>
              <Button onClick={() => { setPlaced(null); setCustomerId('') }}>سفارش جدید</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {/* ─── مرحله ۱: مشتری ─── */}
            {customer ? (
              <div className="rounded-xl border bg-emerald-50/60 border-emerald-200 p-3 flex flex-wrap items-center gap-2">
                <Store className="h-4 w-4 text-emerald-700" aria-hidden />
                <div className="flex-1 min-w-40">
                  <div className="text-sm font-bold">{customer.shopName} <span className="text-[11px] text-muted-foreground font-normal" dir="ltr">({customer.code})</span></div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                    <span>گروه: {GROUP_LABELS[customer.groupKey] ?? customer.groupKey}</span>
                    <span>مانده بدهی: <Money rls={customer.balanceRls} /></span>
                    <span>اعتبار باقی‌مانده: <Money rls={customer.remainingCreditRls} /></span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setCustomerId('')}>
                  <RefreshCw className="h-3.5 w-3.5 ml-1" /> تغییر مشتری
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border p-3 grid gap-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                  <Users className="h-4 w-4" /> مرحله ۱ — اطلاعات مشتری
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant={mode === 'pick' ? 'default' : 'outline'} className="h-8" onClick={() => setMode('pick')}>
                    انتخاب از مشتریان من
                  </Button>
                  <Button size="sm" variant={mode === 'new' ? 'default' : 'outline'} className="h-8" onClick={() => setMode('new')}>
                    <UserPlus className="h-3.5 w-3.5 ml-1" /> مشتری جدید
                  </Button>
                </div>

                {mode === 'pick' ? (
                  loadingCust ? (
                    <p className="text-sm text-muted-foreground text-center py-3 flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> در حال بارگذاری مشتریان…
                    </p>
                  ) : (
                    <>
                      <Input placeholder="جستجوی نام فروشگاه، کد یا تلفن…" value={custQ} onChange={e => setCustQ(e.target.value)} />
                      <div className="max-h-44 overflow-y-auto rounded-lg border divide-y">
                        {filteredCustomers.length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-4">مشتری‌ای یافت نشد — از تب «مشتری جدید» ثبت کنید</p>
                        )}
                        {filteredCustomers.map(c => (
                          <button
                            key={c.id}
                            onClick={() => setCustomerId(c.id)}
                            className="w-full text-right px-3 py-2 hover:bg-emerald-50 flex items-center justify-between gap-2"
                          >
                            <span className="text-sm font-medium truncate">{c.shopName}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0" dir="ltr">{c.code}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )
                ) : (
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    <Field label="نام فروشگاه" required>
                      <Input value={newForm.shopName} onChange={e => setNewForm(f => ({ ...f, shopName: e.target.value }))} />
                    </Field>
                    <Field label="نام مالک">
                      <Input value={newForm.ownerName} onChange={e => setNewForm(f => ({ ...f, ownerName: e.target.value }))} />
                    </Field>
                    <Field label="تلفن" required>
                      <Input dir="ltr" value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} />
                    </Field>
                    <Field label="نوع کسب‌وکار">
                      <Select value={newForm.businessType} onValueChange={v => setNewForm(f => ({ ...f, businessType: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GROCERY">خواربارفروشی</SelectItem>
                          <SelectItem value="SUPERMARKET">سوپرمارکت</SelectItem>
                          <SelectItem value="OTHER">سایر</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="آدرس">
                      <Input value={newForm.address} onChange={e => setNewForm(f => ({ ...f, address: e.target.value }))} />
                    </Field>
                    <div className="flex items-end">
                      <Button onClick={createCustomer} disabled={creatingCust} className="w-full">
                        {creatingCust && <Loader2 className="h-4 w-4 animate-spin ml-1" />} ثبت مشتری
                      </Button>
                    </div>
                    {!hasManage && (
                      <p className="text-[10px] text-muted-foreground sm:col-span-2 leading-5">
                        مشتری با گروه «معمولی» و بدون اعتبار ثبت می‌شود و به فهرست مشتریان شما اضافه می‌گردد؛
                        تنظیم گروه/اعتبار توسط مدیر در پنل مشتریان انجام می‌شود.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ─── مرحله ۲: اقلام سبد ─── */}
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <ShoppingBasket className="h-4 w-4" /> مرحله ۲ — اقلام سبد خرید ({formatFaNumber(items.length)} قلم)
              </div>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed py-8 text-center">
                  <ShoppingBasket className="h-8 w-8 text-stone-300 mx-auto" aria-hidden />
                  <p className="text-sm text-muted-foreground mt-2">سبد خالی است</p>
                  <p className="text-xs text-muted-foreground mt-1">در فروشگاه روی محصول «افزودن به سبد» بزنید؛ برای انتخاب واحد در جزئیات محصول</p>
                </div>
              ) : (
                <div className="rounded-xl border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50">
                        <TableHead>کالا</TableHead>
                        <TableHead>واحد</TableHead>
                        <TableHead>مقدار</TableHead>
                        <TableHead>قیمت واحد</TableHead>
                        <TableHead>مبلغ</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((i, idx) => {
                        const q = quotes[lineKey(i)]
                        const amount = lineAmount(i)
                        return (
                          <TableRow key={lineKey(i)}>
                            <TableCell className="text-sm max-w-52">
                              <div className="truncate" title={i.productName}>{i.productName}</div>
                              <div className="text-[10px] text-muted-foreground" dir="ltr">{i.sku}</div>
                            </TableCell>
                            <TableCell className="text-xs">
                              {i.unitName}
                              {i.factor > 1 && <span className="text-muted-foreground"> ({formatFaNumber(i.factor)} عدد)</span>}
                            </TableCell>
                            <TableCell>
                              <Input
                                dir="ltr" type="number" min={1} step={1}
                                value={i.qty}
                                onChange={e => setQty(idx, Number(e.target.value))}
                                className="h-8 w-16 text-sm"
                                aria-label={`مقدار ${i.productName}`}
                              />
                            </TableCell>
                            <TableCell className="text-xs">
                              {customer ? (
                                quoting && !q ? (
                                  <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> …</span>
                                ) : q?.error ? (
                                  <span className="text-rose-600">خطا</span>
                                ) : q?.priceRls != null ? (
                                  <>
                                    <Money rls={q.priceRls} />
                                    {q.scope !== 'DEFAULT' && <Badge variant="secondary" className="text-[9px] mr-1">اختصاصی</Badge>}
                                  </>
                                ) : <span className="text-muted-foreground">—</span>
                              ) : (
                                i.unitPriceRls != null ? <Money rls={i.unitPriceRls} /> : <span className="text-muted-foreground">بدون قیمت</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {amount != null ? <Money rls={amount} className="text-sm font-bold" /> : <span className="text-rose-600 text-[11px]">{q?.error ?? '—'}</span>}
                            </TableCell>
                            <TableCell>
                              <button className="text-rose-500 hover:text-rose-700" aria-label={`حذف ${i.productName}`} onClick={() => removeItem(idx)}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  {!customer && (
                    <p className="text-[10px] text-amber-700 bg-amber-50 px-3 py-2 border-t leading-5">
                      قیمت‌های بالا «عمومی» است؛ پس از انتخاب مشتری، قیمت اختصاصی هر قلم از سرور محاسبه می‌شود.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ─── مرحله ۳: پرداخت و ثبت ─── */}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="روش پرداخت" required>
                <Select value={payMethod} onValueChange={v => setPayMethod(v as 'CASH' | 'CREDIT' | 'TRANSFER')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">نقدی (پرداخت هنگام تحویل)</SelectItem>
                    <SelectItem value="CREDIT">اعتباری (داخل سقف اعتبار)</SelectItem>
                    <SelectItem value="TRANSFER">انتقالی/کارت به کارت</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="توضیحات سفارش">
                <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="اختیاری — مثلاً زمان تحویل موردنظر مشتری…" />
              </Field>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <div className="text-sm">
                جمع کل: <Money rls={totalRls} className="font-black text-emerald-700 text-base" />
                {customer && quoting && <span className="text-[11px] text-muted-foreground mr-2">(در حال محاسبهٔ قیمت سرور…)</span>}
              </div>
              <p className="text-[10px] text-muted-foreground">در صورت قطع اینترنت، ارسال مجدد سفارش تکراری نمی‌سازد (Idempotency Key).</p>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">بستن</Button>
                <Button
                  onClick={submit}
                  disabled={submitting || !customerId || items.length === 0 || !!anyLineError || anyMissingPrice}
                  className="flex-1 sm:flex-none"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin ml-1" />} ثبت نهایی سفارش
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
