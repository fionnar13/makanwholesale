'use client'
// کاتالوگ محصولات — لیست، ایجاد با واحدها، مدیریت قواعد قیمت
import { useEffect, useState } from 'react'
import { apiFetch, useApiData, DataTable, Money, JDate, PageHeader, Field, formatFaNumber } from './kit'
import { ProductTile } from './StoreShared'
import ImageLightbox, { type LightboxImage } from './ImageLightbox'
import type { ProductListItem, SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, RefreshCw, Store, Tag, Package } from 'lucide-react'
import { toast } from 'sonner'
import { SCOPE_LABELS } from '@/lib/format'
import type { ViewKeyLike } from './types'

type Meta = {
  categories: Array<{ id: string; name: string }>
  brands: Array<{ id: string; name: string; isConfirmed: boolean; categoryId: string | null; categoryName: string | null }>
}

type ProductDetail = ProductListItem & {
  prices: Array<{
    id: string; unitId: string; scope: string; scopeLabel: string
    priceRls: number; minQtyBase: number; maxQtyBase: number | null
    startAt: string | null; endAt: string | null; isActive: boolean; note: string | null
  }>
}

type TerritoryLite = { id: string; name: string }
type CustomerLite = { id: string; shopName: string; code: string }

export default function CatalogView({ user, go }: { user: SessionUserLike; go?: (v: ViewKeyLike) => void }) {
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pricesId, setPricesId] = useState<string | null>(null)
  // لایت‌باکس بندانگشتی لیست — کلیک روی تصویر سطر، همان تصویر را تمام‌صفحه نشان می‌دهد
  const [lightbox, setLightbox] = useState<LightboxImage[] | null>(null)
  const { data, loading, error, reload } = useApiData<ProductListItem[]>(`/api/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const { data: meta } = useApiData<Meta>('/api/products?meta=1')

  const rows = data ?? []

  return (
    <div>
      <PageHeader
        title="کاتالوگ محصولات"
        desc="محصولات، واحدهای فروش و موتور قیمت‌گذاری — قیمت‌های نمونه با نشان DEMO_SEED قابل اصلاح‌اند"
        actions={
          <>
            {go && (
              <Button variant="outline" size="sm" onClick={() => go('storefront')}><Store className="h-4 w-4 ml-1" /> نمای فروشگاهی</Button>
            )}
            <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="h-4 w-4 ml-1" /> به‌روزرسانی</Button>
            {user.permissions?.includes('products.manage') && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 ml-1" /> محصول جدید</Button>
            )}
          </>
        }
      />

      <div className="mb-3 max-w-64">
        <Input placeholder="جستجوی نام یا SKU…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {error ? (
        <p className="text-sm text-rose-600 py-6 text-center">{error}</p>
      ) : (
        <DataTable
          columns={[
            {
              key: 'img', header: 'تصویر', cell: (p: ProductListItem) => p.imageUrl ? (
                // بندانگشتی ۱۲×۱۲ با کانتینر ثابت — تصویر با برش کنترل‌شده داخل کادر می‌ماند
                <button
                  type="button"
                  onClick={() => setLightbox([{ src: p.imageUrl as string, alt: p.name }])}
                  aria-label={`مشاهده تصویر بزرگ ${p.name}`}
                  title="مشاهده تصویر بزرگ"
                  className="block h-12 w-12 rounded-lg overflow-hidden border bg-stone-50 cursor-zoom-in"
                >
                  <ProductTile p={p} />
                </button>
              ) : <span className="text-xs text-muted-foreground">—</span>,
            },
            {
              key: 'name', header: 'کالا', cell: (p: ProductListItem) => (
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground" dir="ltr">{p.sku} {p.brand && `— ${p.brand}`}{p.brand && !p.brandConfirmed && ' (برند نیازمند تأیید)'}</div>
                </div>
              ),
            },
            { key: 'category', header: 'دسته', cell: (p: ProductListItem) => <span className="text-xs">{p.category ?? '—'}</span> },
            {
              key: 'price', header: 'قیمت عمومی', cell: (p: ProductListItem) => {
                const base = p.units.find(u => u.isBase) ?? p.units[0]
                return base?.defaultPriceRls != null
                  ? <Money rls={base.defaultPriceRls} className="text-xs font-bold text-emerald-700" />
                  : <span className="text-xs text-muted-foreground">—</span>
              },
            },
            {
              key: 'units', header: 'واحدها', cell: (p: ProductListItem) => (
                <div className="flex flex-wrap gap-1">
                  {p.units.map(u => <Badge key={u.id} variant="secondary" className="text-[10px]">{u.name}</Badge>)}
                </div>
              ),
            },
            { key: 'stock', header: 'قابل فروش', cell: (p: ProductListItem) => <span className={`text-sm font-bold ${p.availableBase < p.reorderPointBase ? 'text-rose-600' : 'text-stone-700'}`}>{formatFaNumber(p.availableBase)}</span> },
            { key: 'demo', header: '', cell: (p: ProductListItem) => p.isDemo ? <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-300">DEMO_SEED</Badge> : null },
            { key: 'active', header: 'فعال', cell: (p: ProductListItem) => <span className="text-xs">{p.isActive ? 'بله' : 'خیر'}</span> },
            { key: 'actions', header: '', cell: (p: ProductListItem) => user.permissions?.includes('products.manage') ? <Button variant="ghost" size="sm" onClick={() => setPricesId(p.id)}><Tag className="h-3.5 w-3.5 ml-1" /> قیمت‌ها</Button> : null },
          ]}
          rows={rows}
          loading={loading}
          rowKey={(p: ProductListItem) => p.id}
          empty="کالایی یافت نشد"
        />
      )}

      <CreateProductDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={reload} meta={meta} />
      <PriceRulesDialog id={pricesId} onClose={() => setPricesId(null)} onChanged={reload} />
      <ImageLightbox images={lightbox ?? []} index={lightbox ? 0 : null} onClose={() => setLightbox(null)} />
    </div>
  )
}

function CreateProductDialog({ open, onOpenChange, onCreated, meta }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
  meta: Meta | null
}) {
  const [form, setForm] = useState({ sku: '', name: '', description: '', categoryId: '', brandId: '', imageUrl: '', weightG: '', volumeMl: '', reorderPointBase: '80', minOrderQtyBase: '1', orderMultipleBase: '1' })
  const [units, setUnits] = useState([{ name: '', factor: '1', isBase: true, priceToman: '', barcode: '' }])
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const setUnit = (i: number, k: string, v: string | boolean) => setUnits(us => us.map((u, j) => j === i ? { ...u, [k]: v } : u))

  // برندها وابسته به دسته‌بندی‌اند — فقط برندهای دسته انتخابی نمایش داده می‌شوند
  const brandOptions = (meta?.brands ?? []).filter(b => !form.categoryId || b.categoryId === form.categoryId)
  const changeCategory = (v: string) => setForm(f => ({
    ...f,
    categoryId: v,
    // اگر برند انتخاب‌شده به دسته جدید تعلق ندارد، پاک می‌شود
    brandId: f.brandId && (meta?.brands ?? []).some(b => b.id === f.brandId && b.categoryId === v) ? f.brandId : '',
  }))

  const submit = async () => {
    const valid = units.filter(u => u.name && Number(u.factor) >= 1)
    if (!form.sku || !form.name || valid.length === 0) {
      toast.error('SKU، نام و حداقل یک واحد کامل الزامی است')
      return
    }
    if (!valid.some(u => u.isBase)) { toast.error('یک واحد باید واحد پایه باشد'); return }
    setBusy(true)
    try {
      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          sku: form.sku, name: form.name, description: form.description || null,
          categoryId: form.categoryId || null, brandId: form.brandId || null,
          imageUrl: form.imageUrl.trim() || null,
          weightG: form.weightG ? Number(form.weightG) : null,
          volumeMl: form.volumeMl ? Number(form.volumeMl) : null,
          minOrderQtyBase: Number(form.minOrderQtyBase || 1),
          orderMultipleBase: Number(form.orderMultipleBase || 1),
          reorderPointBase: Number(form.reorderPointBase || 50),
          isDemo: false,
          units: valid.map(u => ({
            name: u.name, factor: Number(u.factor), isBase: u.isBase,
            barcode: u.barcode || null,
            priceRls: u.priceToman ? Math.round(Number(u.priceToman) * 10) : null,
          })),
        }),
      })
      toast.success('محصول ثبت شد')
      onCreated(); onOpenChange(false)
      setForm({ sku: '', name: '', description: '', categoryId: '', brandId: '', imageUrl: '', weightG: '', volumeMl: '', reorderPointBase: '80', minOrderQtyBase: '1', orderMultipleBase: '1' })
      setUnits([{ name: '', factor: '1', isBase: true, priceToman: '', barcode: '' }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت ناموفق بود')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>محصول جدید</DialogTitle><DialogDescription>واحد پایه انبار و واحدهای بسته‌بندی را با قیمت عمومی تعریف کنید.</DialogDescription></DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="SKU" required hint="کد یکتا"><Input dir="ltr" value={form.sku} onChange={e => set('sku', e.target.value)} /></Field>
          <Field label="نام کالا" required><Input value={form.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="دسته‌بندی">
            <Select value={form.categoryId} onValueChange={changeCategory}>
              <SelectTrigger><SelectValue placeholder="انتخاب…" /></SelectTrigger>
              <SelectContent>{meta?.categories?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="برند" hint={form.categoryId ? 'برندهای همین دسته‌بندی' : 'ابتدا دسته‌بندی را انتخاب کنید'}>
            <Select value={form.brandId} onValueChange={v => set('brandId', v)} disabled={!form.categoryId}>
              <SelectTrigger><SelectValue placeholder="انتخاب…" /></SelectTrigger>
              <SelectContent>
                {brandOptions.map(b => <SelectItem key={b.id} value={b.id}>
                  {b.name}{!b.isConfirmed && ' (نیازمند تأیید)'}
                </SelectItem>)}
                {brandOptions.length === 0 && form.categoryId && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">برندی برای این دسته ثبت نشده — از پنل مدیریت داده‌ها اضافه کنید</div>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="وزن (گرم)"><Input dir="ltr" type="number" min={0} value={form.weightG} onChange={e => set('weightG', e.target.value)} /></Field>
          <Field label="حجم (میلی‌لیتر)"><Input dir="ltr" type="number" min={0} value={form.volumeMl} onChange={e => set('volumeMl', e.target.value)} /></Field>
          <Field label="حداقل سفارش (واحد پایه)"><Input dir="ltr" type="number" min={1} value={form.minOrderQtyBase} onChange={e => set('minOrderQtyBase', e.target.value)} /></Field>
          <Field label="مضرب مجاز سفارش"><Input dir="ltr" type="number" min={1} value={form.orderMultipleBase} onChange={e => set('orderMultipleBase', e.target.value)} /></Field>
          <Field label="نقطه سفارش (هشدار کم‌موجودی)"><Input dir="ltr" type="number" min={0} value={form.reorderPointBase} onChange={e => set('reorderPointBase', e.target.value)} /></Field>
          <Field label="توضیحات"><Input value={form.description} onChange={e => set('description', e.target.value)} /></Field>
          <Field label="آدرس تصویر (اختیاری)" hint="برای نمایش در نمای فروشگاهی — آدرس کامل تصویر">
            <Input dir="ltr" value={form.imageUrl} onChange={e => set('imageUrl', e.target.value)} placeholder="https://example.com/image.jpg" />
          </Field>
        </div>

        <div>
          <div className="text-xs font-bold text-muted-foreground mb-2">واحدهای فروش و قیمت عمومی</div>
          <div className="grid gap-2">
            {units.map((u, i) => (
              <div key={i} className="rounded-lg border p-2.5 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                <Field label="نام واحد"><Input value={u.name} onChange={e => setUnit(i, 'name', e.target.value)} placeholder="قوطی ۸۰۰ گرمی" /></Field>
                <Field label="فاکتور پایه"><Input dir="ltr" type="number" min={1} value={u.factor} onChange={e => setUnit(i, 'factor', e.target.value)} /></Field>
                <div className="flex items-center gap-2 pb-2.5">
                  <Switch checked={u.isBase} onCheckedChange={v => setUnits(us => us.map((x, j) => j === i ? { ...x, isBase: v } : x.isBase ? { ...x, isBase: false } : x))} id={`base-${i}`} />
                  <label htmlFor={`base-${i}`} className="text-xs">پایه انبار</label>
                </div>
                <Field label="قیمت عمومی (تومان)"><Input dir="ltr" type="number" min={0} value={u.priceToman} onChange={e => setUnit(i, 'priceToman', e.target.value)} /></Field>
                <Field label="بارکد"><Input dir="ltr" value={u.barcode} onChange={e => setUnit(i, 'barcode', e.target.value)} /></Field>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setUnits(us => [...us, { name: '', factor: '1', isBase: false, priceToman: '', barcode: '' }])}>
              <Plus className="h-4 w-4 ml-1" /> افزودن واحد
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'در حال ثبت…' : 'ثبت محصول'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PriceRulesDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data: p, reload } = useApiData<ProductDetail>(id ? `/api/products/${id}` : null)
  const { data: territories } = useApiData<TerritoryLite[]>('/api/territories')
  const { data: customers } = useApiData<CustomerLite[]>('/api/customers')
  const [form, setForm] = useState({ unitId: '', scope: 'DEFAULT', refId: '', priceToman: '', minQtyBase: '1', maxQtyBase: '', startAt: '', endAt: '', note: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (p && !form.unitId && p.units[0]) setForm(f => ({ ...f, unitId: p.units[0].id }))
  }, [p, form.unitId])

  const addRule = async () => {
    if (!id || !form.unitId || !form.priceToman) { toast.error('واحد و قیمت الزامی است'); return }
    setBusy(true)
    try {
      await apiFetch('/api/pricing', {
        method: 'POST',
        body: JSON.stringify({
          productId: id, unitId: form.unitId, scope: form.scope,
          refId: form.scope === 'CUSTOMER' || form.scope === 'TERRITORY' ? form.refId || null : null,
          priceRls: Math.round(Number(form.priceToman) * 10),
          minQtyBase: Number(form.minQtyBase || 1),
          maxQtyBase: form.maxQtyBase ? Number(form.maxQtyBase) : null,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
          note: form.note || null,
        }),
      })
      toast.success('قاعده قیمت ثبت شد')
      setForm(f => ({ ...f, priceToman: '', refId: '', note: '' }))
      reload(); onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت ناموفق بود')
    } finally { setBusy(false) }
  }

  const toggle = async (ruleId: string, isActive: boolean) => {
    try {
      await apiFetch('/api/pricing', { method: 'PATCH', body: JSON.stringify({ id: ruleId, isActive }) })
      reload(); onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'خطا') }
  }

  return (
    <Dialog open={!!id} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> {p?.name ?? 'قیمت‌ها'}</DialogTitle>
          <DialogDescription>اولویت: اختصاصی مشتری &gt; گروه مشتری &gt; منطقه &gt; مقدار خرید &gt; عمومی. دو قاعده هم‌اولویتِ ناسازگار در ثبت سفارش خطا می‌دهد.</DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader><TableRow className="bg-stone-50"><TableHead>واحد</TableHead><TableHead>نوع</TableHead><TableHead>قیمت</TableHead><TableHead>حد</TableHead><TableHead>اعتبار</TableHead><TableHead>فعال</TableHead></TableRow></TableHeader>
            <TableBody>
              {p?.prices.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{p.units.find(u => u.id === r.unitId)?.name ?? '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{SCOPE_LABELS[r.scope]}{r.scopeLabel && r.scope !== 'DEFAULT' && r.scope !== 'VOLUME' ? `: ${r.scopeLabel}` : ''}</Badge></TableCell>
                  <TableCell><Money rls={r.priceRls} className="text-xs font-bold" /></TableCell>
                  <TableCell className="text-[11px]">{formatFaNumber(r.minQtyBase)}{r.maxQtyBase ? ` تا ${formatFaNumber(r.maxQtyBase)}` : '+'}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {r.startAt ? <JDate d={r.startAt} /> : 'از همیشه'}{r.endAt ? <> تا <JDate d={r.endAt} /></> : ''}
                  </TableCell>
                  <TableCell><Switch checked={r.isActive} onCheckedChange={v => toggle(r.id, v)} aria-label="فعال/غیرفعال" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-xl border p-3 grid sm:grid-cols-3 gap-2.5">
          <Field label="واحد فروش" required>
            <Select value={form.unitId} onValueChange={v => setForm(f => ({ ...f, unitId: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{p?.units.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="نوع قیمت" required>
            <Select value={form.scope} onValueChange={v => setForm(f => ({ ...f, scope: v, refId: '' }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">عمومی</SelectItem>
                <SelectItem value="CUSTOMER">اختصاصی مشتری</SelectItem>
                <SelectItem value="GROUP">گروه مشتری</SelectItem>
                <SelectItem value="TERRITORY">منطقه فروش</SelectItem>
                <SelectItem value="VOLUME">مقدار خرید</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.scope === 'CUSTOMER' && (
            <Field label="مشتری" required>
              <Select value={form.refId} onValueChange={v => setForm(f => ({ ...f, refId: v }))}>
                <SelectTrigger><SelectValue placeholder="انتخاب…" /></SelectTrigger>
                <SelectContent className="max-h-52">{customers?.map(c => <SelectItem key={c.id} value={c.id}>{c.shopName} ({c.code})</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {form.scope === 'TERRITORY' && (
            <Field label="منطقه" required>
              <Select value={form.refId} onValueChange={v => setForm(f => ({ ...f, refId: v }))}>
                <SelectTrigger><SelectValue placeholder="انتخاب…" /></SelectTrigger>
                <SelectContent>{territories?.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {form.scope === 'GROUP' && (
            <Field label="گروه" required>
              <Select value={form.refId} onValueChange={v => setForm(f => ({ ...f, refId: v }))}>
                <SelectTrigger><SelectValue placeholder="انتخاب…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REGULAR">معمولی</SelectItem>
                  <SelectItem value="GOLD">طلایی</SelectItem>
                  <SelectItem value="WHOLESALE">عمده</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="قیمت (تومان)" required><Input dir="ltr" type="number" min={0} value={form.priceToman} onChange={e => setForm(f => ({ ...f, priceToman: e.target.value }))} /></Field>
          <Field label="حداقل مقدار (پایه)"><Input dir="ltr" type="number" min={1} value={form.minQtyBase} onChange={e => setForm(f => ({ ...f, minQtyBase: e.target.value }))} /></Field>
          <Field label="حداکثر مقدار (پایه)"><Input dir="ltr" type="number" min={1} value={form.maxQtyBase} onChange={e => setForm(f => ({ ...f, maxQtyBase: e.target.value }))} /></Field>
          <Field label="شروع اعتبار"><Input type="date" value={form.startAt} onChange={e => setForm(f => ({ ...f, startAt: e.target.value }))} /></Field>
          <Field label="پایان اعتبار"><Input type="date" value={form.endAt} onChange={e => setForm(f => ({ ...f, endAt: e.target.value }))} /></Field>
          <Field label="یادداشت"><Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>
          <div className="sm:col-span-3 flex justify-end">
            <Button onClick={addRule} disabled={busy}>{busy ? 'در حال ثبت…' : 'افزودن قاعده'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
