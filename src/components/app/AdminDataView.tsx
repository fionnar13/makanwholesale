'use client'
// پنل مدیریت داده‌ها — مدیریت موجودیت‌های پایه دیتابیس
// دسترسی: فقط مجوز users.manage (مدیر کل / آدمین)
import { useEffect, useRef, useState } from 'react'
import { apiFetch, apiUpload, optimizeImageBeforeUpload, useApiData, DataTable, JDate, PageHeader, Field, formatFaNumber, SiteIdentity, notifySiteChanged, hexToRgba, DEFAULT_GRADIENT_COLORS, type LoginConfig, type LoginMediaKind, type LoginSideConfig, type LoginFormConfig, type LoginMobileConfig } from './kit'
import type { SessionUserLike, ViewKeyLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tags, BadgeCheck, Warehouse, Users, Images, Settings2 } from 'lucide-react'
import { Plus, RefreshCw, Lock, Pencil, Trash2, ArrowUpRight, ImagePlus, Globe, Loader2, LayoutPanelTop, ChevronUp, ChevronDown, KeyRound, LogIn, Smartphone } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'

type TableStat = { key: string; label: string; count: number; hint: string; view: string | null }
type OverviewData = { tables: TableStat[] }

type CategoryRow = { id: string; name: string; parentId: string | null; parentName: string | null; productsCount: number; childrenCount: number }
type BrandRow = { id: string; name: string; categoryId: string | null; categoryName: string | null; isConfirmed: boolean; isDemo: boolean; productsCount: number }
type WarehouseRow = { id: string; code: string; name: string; isDefault: boolean; lotsCount: number; balancesCount: number }
type EmployeeRow = { id: string; code: string; fullName: string; phone: string | null; position: string | null; status: string; hireDate: string | null; userId: string | null; userName: string | null; userPhone: string | null; createdAt: string }
type SettingRow = { key: string; value: string; isSystemCounter: boolean; updatedAt: string }

type GoFn = (v: ViewKeyLike) => void

export default function AdminDataView({ user, go }: { user: SessionUserLike; go: GoFn }) {
  const [tab, setTab] = useState('overview')
  const { data, loading, error, reload } = useApiData<OverviewData>('/api/admin/overview')

  return (
    <div>
      <PageHeader
        title="پنل مدیریت داده‌ها"
        desc="مدیریت مستقیم داده‌های پایه دیتابیس — فقط برای مدیر کل؛ همه تغییرات در سوابق سیستم (Audit) ثبت می‌شود"
        actions={<Button variant="outline" size="sm" onClick={reload}><RefreshCw className="h-4 w-4 ml-1" /> به‌روزرسانی</Button>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview" className="gap-1.5"><LayoutPanelTop className="h-3.5 w-3.5" /> نمای کلی</TabsTrigger>
          <TabsTrigger value="categories" className="gap-1.5"><Tags className="h-3.5 w-3.5" /> دسته‌بندی‌ها</TabsTrigger>
          <TabsTrigger value="brands" className="gap-1.5"><BadgeCheck className="h-3.5 w-3.5" /> برندها</TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-1.5"><Warehouse className="h-3.5 w-3.5" /> انبارها</TabsTrigger>
          <TabsTrigger value="employees" className="gap-1.5"><Users className="h-3.5 w-3.5" /> کارمندان</TabsTrigger>
          <TabsTrigger value="site" className="gap-1.5"><Globe className="h-3.5 w-3.5" /> وب‌سایت</TabsTrigger>
          <TabsTrigger value="banners" className="gap-1.5"><Images className="h-3.5 w-3.5" /> بنرهای فروشگاه</TabsTrigger>
          <TabsTrigger value="google" className="gap-1.5"><KeyRound className="h-3.5 w-3.5" /> ورود با گوگل</TabsTrigger>
          <TabsTrigger value="login" className="gap-1.5"><LogIn className="h-3.5 w-3.5" /> صفحه ورود</TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5"><Settings2 className="h-3.5 w-3.5" /> تنظیمات</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {error ? (
            <p className="text-sm text-rose-600 py-6 text-center">{error}</p>
          ) : (
            <OverviewTab tables={data?.tables ?? []} loading={loading} go={go} />
          )}
        </TabsContent>

        <TabsContent value="categories" className="mt-4"><CategoriesTab /></TabsContent>
        <TabsContent value="brands" className="mt-4"><BrandsTab /></TabsContent>
        <TabsContent value="warehouses" className="mt-4"><WarehousesTab /></TabsContent>
        <TabsContent value="employees" className="mt-4"><EmployeesTab /></TabsContent>
        <TabsContent value="site" className="mt-4"><SiteSettingsTab /></TabsContent>
        <TabsContent value="banners" className="mt-4"><BannersTab /></TabsContent>
        <TabsContent value="google" className="mt-4"><GoogleLoginTab /></TabsContent>
        <TabsContent value="login" className="mt-4"><LoginSettingsTab /></TabsContent>
        <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ─── نمای کلی ───

function OverviewTab({ tables, loading, go }: { tables: TableStat[]; loading: boolean; go: GoFn }) {
  if (loading && tables.length === 0) {
    return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-stone-100 animate-pulse" />)}</div>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tables.map(t => (
        <button
          key={t.key}
          onClick={() => t.view && go(t.view as ViewKeyLike)}
          className={`rounded-xl border bg-card p-4 text-right shadow-sm transition-colors ${t.view ? 'hover:border-emerald-500 hover:bg-emerald-50/40' : 'cursor-default'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t.label}</span>
            {t.view && <ArrowUpRight className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden />}
          </div>
          <div className="text-2xl font-black mt-2" dir="ltr">{formatFaNumber(t.count)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t.hint}</div>
        </button>
      ))}
    </div>
  )
}

// ─── دسته‌بندی‌ها ───

function CategoriesTab() {
  const { data, loading, reload } = useApiData<CategoryRow[]>('/api/admin/categories')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CategoryRow | null>(null)
  const [deleting, setDeleting] = useState<CategoryRow | null>(null)
  const [busy, setBusy] = useState(false)

  const doDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await apiFetch(`/api/admin/categories/${deleting.id}`, { method: 'DELETE' })
      toast.success('دسته‌بندی حذف شد')
      setDeleting(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در حذف')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}><Plus className="h-4 w-4 ml-1" /> دسته‌بندی جدید</Button>
      </div>
      <DataTable
        columns={[
          { key: 'name', header: 'نام', cell: (c: CategoryRow) => <span className="text-sm font-medium">{c.name}</span> },
          { key: 'parent', header: 'والد', cell: (c: CategoryRow) => c.parentName ? <Badge variant="secondary" className="text-[10px]">{c.parentName}</Badge> : <span className="text-muted-foreground text-xs">—</span> },
          { key: 'products', header: 'محصولات', cell: (c: CategoryRow) => <span className="text-xs" dir="ltr">{formatFaNumber(c.productsCount)}</span> },
          { key: 'children', header: 'زیرگروه‌ها', cell: (c: CategoryRow) => <span className="text-xs" dir="ltr">{formatFaNumber(c.childrenCount)}</span> },
          {
            key: 'actions', header: '', cell: (c: CategoryRow) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setEditing(c); setDialogOpen(true) }} aria-label="ویرایش"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" disabled={c.productsCount > 0 || c.childrenCount > 0} onClick={() => setDeleting(c)} aria-label="حذف"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ),
          },
        ]}
        rows={data ?? []}
        loading={loading}
        rowKey={(c: CategoryRow) => c.id}
        empty="دسته‌بندی ثبت نشده است"
      />
      <CategoryDialog
        open={dialogOpen}
        editing={editing}
        categories={(data ?? []).filter(c => c.id !== editing?.id)}
        onClose={() => { setDialogOpen(false); setEditing(null) }}
        onDone={reload}
      />
      <ConfirmDelete
        open={!!deleting}
        title={`حذف دسته‌بندی «${deleting?.name ?? ''}»`}
        description="این عملیات بازگشت‌پذیر نیست. اگر این دسته‌بندی به محصول یا زیرگروهی متصل باشد، سرور اجازه حذف نمی‌دهد."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}

function CategoryDialog({ open, editing, categories, onClose, onDone }: {
  open: boolean
  editing: CategoryRow | null
  categories: CategoryRow[]
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setParentId(editing?.parentId ?? '')
    }
  }, [open, editing])

  const submit = async () => {
    setBusy(true)
    try {
      const body = { name, parentId: parentId || null }
      if (editing) {
        await apiFetch(`/api/admin/categories/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        toast.success('دسته‌بندی ویرایش شد')
      } else {
        await apiFetch('/api/admin/categories', { method: 'POST', body: JSON.stringify(body) })
        toast.success('دسته‌بندی ایجاد شد')
      }
      onDone()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? 'ویرایش دسته‌بندی' : 'دسته‌بندی جدید'}</DialogTitle>
          <DialogDescription>نام باید یکتا باشد؛ انتخاب والد اختیاری است.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="نام دسته‌بندی" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="دسته‌بندی والد (اختیاری)">
            <Select value={parentId || 'none'} onValueChange={v => setParentId(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="بدون والد" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون والد</SelectItem>
                {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>انصراف</Button>
            <Button onClick={submit} disabled={busy || name.trim().length < 2}>{busy ? 'در حال ثبت…' : 'ذخیره'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── برندها ───

function BrandsTab() {
  const { data, loading, reload } = useApiData<BrandRow[]>('/api/admin/brands')
  const { data: categories } = useApiData<CategoryRow[]>('/api/admin/categories')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BrandRow | null>(null)
  const [deleting, setDeleting] = useState<BrandRow | null>(null)
  const [busy, setBusy] = useState(false)

  // فیلتر بر اساس دسته‌بندی — برندها وابسته به دسته‌بندی‌ها هستند
  const rows = (data ?? []).filter(b => catFilter === 'all' || b.categoryId === catFilter)

  const doDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await apiFetch(`/api/admin/brands/${deleting.id}`, { method: 'DELETE' })
      toast.success('برند حذف شد')
      setDeleting(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در حذف')
    } finally { setBusy(false) }
  }

  const toggleConfirm = async (b: BrandRow) => {
    try {
      await apiFetch(`/api/admin/brands/${b.id}`, { method: 'PATCH', body: JSON.stringify({ isConfirmed: !b.isConfirmed }) })
      toast.success(!b.isConfirmed ? 'برند تأیید شد' : 'تأیید برند لغو شد')
      reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'خطا') }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="w-56">
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">همه دسته‌بندی‌ها</SelectItem>
              {(categories ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}><Plus className="h-4 w-4 ml-1" /> برند جدید</Button>
      </div>
      <DataTable
        columns={[
          {
            key: 'name', header: 'برند', cell: (b: BrandRow) => (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{b.name}</span>
                {b.isDemo && <Badge variant="outline" className="text-[9px]">DEMO</Badge>}
              </div>
            ),
          },
          {
            key: 'category', header: 'دسته‌بندی', cell: (b: BrandRow) => (
              b.categoryName
                ? <Badge variant="secondary" className="text-[10px]">{b.categoryName}</Badge>
                : <span className="text-[11px] text-amber-700">بدون دسته — ویرایش کنید</span>
            ),
          },
          {
            key: 'confirmed', header: 'تأیید مدیر', cell: (b: BrandRow) => (
              <Switch checked={b.isConfirmed} onCheckedChange={() => toggleConfirm(b)} aria-label="تأیید برند" />
            ),
          },
          { key: 'products', header: 'محصولات', cell: (b: BrandRow) => <span className="text-xs" dir="ltr">{formatFaNumber(b.productsCount)}</span> },
          {
            key: 'actions', header: '', cell: (b: BrandRow) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setEditing(b); setDialogOpen(true) }} aria-label="ویرایش"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" disabled={b.productsCount > 0} onClick={() => setDeleting(b)} aria-label="حذف"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        rowKey={(b: BrandRow) => b.id}
        empty="برندی ثبت نشده است"
      />
      <BrandDialog open={dialogOpen} editing={editing} onClose={() => { setDialogOpen(false); setEditing(null) }} onDone={reload} />
      <ConfirmDelete
        open={!!deleting}
        title={`حذف برند «${deleting?.name ?? ''}»`}
        description="اگر این برند به محصولی متصل باشد، سرور اجازه حذف نمی‌دهد."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}

function BrandDialog({ open, editing, onClose, onDone }: {
  open: boolean
  editing: BrandRow | null
  onClose: () => void
  onDone: () => void
}) {
  const { data: categories } = useApiData<CategoryRow[]>('/api/admin/categories')
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setCategoryId(editing?.categoryId ?? '')
      setIsConfirmed(editing?.isConfirmed ?? false)
    }
  }, [open, editing])

  const submit = async () => {
    setBusy(true)
    try {
      const body = { name, categoryId, isConfirmed }
      if (editing) {
        await apiFetch(`/api/admin/brands/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        toast.success('برند ویرایش شد')
      } else {
        await apiFetch('/api/admin/brands', { method: 'POST', body: JSON.stringify(body) })
        toast.success('برند ایجاد شد')
      }
      onDone()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? 'ویرایش برند' : 'برند جدید'}</DialogTitle>
          <DialogDescription>هر برند متعلق به یک دسته‌بندی است؛ برند بدون تأیید در کاتالوگ نیازمند بررسی است.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="دسته‌بندی" required>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="انتخاب دسته…" /></SelectTrigger>
              <SelectContent>
                {(categories ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="نام برند" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={isConfirmed} onCheckedChange={setIsConfirmed} aria-label="تأییدشده" />
            تأییدشده توسط مدیر
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>انصراف</Button>
            <Button onClick={submit} disabled={busy || name.trim().length < 1 || !categoryId}>{busy ? 'در حال ثبت…' : 'ذخیره'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── انبارها ───

function WarehousesTab() {
  const { data, loading, reload } = useApiData<WarehouseRow[]>('/api/admin/warehouses')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WarehouseRow | null>(null)
  const [deleting, setDeleting] = useState<WarehouseRow | null>(null)
  const [busy, setBusy] = useState(false)

  const doDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await apiFetch(`/api/admin/warehouses/${deleting.id}`, { method: 'DELETE' })
      toast.success('انبار حذف شد')
      setDeleting(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در حذف')
    } finally { setBusy(false) }
  }

  const toggleDefault = async (w: WarehouseRow) => {
    try {
      await apiFetch(`/api/admin/warehouses/${w.id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: !w.isDefault }) })
      toast.success(!w.isDefault ? 'انبار پیش‌فرض شد' : 'انبار نمی‌تواند غیرپیش‌فرض شود — حداقل یک انبار پیش‌فرض لازم است')
      reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'خطا') }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}><Plus className="h-4 w-4 ml-1" /> انبار جدید</Button>
      </div>
      <DataTable
        columns={[
          { key: 'code', header: 'کد', cell: (w: WarehouseRow) => <span className="text-xs" dir="ltr">{w.code}</span> },
          { key: 'name', header: 'نام انبار', cell: (w: WarehouseRow) => (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{w.name}</span>
              {w.isDefault && <Badge className="text-[9px] border-transparent bg-emerald-600 text-white">پیش‌فرض</Badge>}
            </div>
          ) },
          { key: 'lots', header: 'لات‌ها', cell: (w: WarehouseRow) => <span className="text-xs" dir="ltr">{formatFaNumber(w.lotsCount)}</span> },
          { key: 'balances', header: 'موجودی‌ها', cell: (w: WarehouseRow) => <span className="text-xs" dir="ltr">{formatFaNumber(w.balancesCount)}</span> },
          {
            key: 'default', header: 'پیش‌فرض', cell: (w: WarehouseRow) => (
              <Switch checked={w.isDefault} onCheckedChange={() => toggleDefault(w)} aria-label="انبار پیش‌فرض" />
            ),
          },
          {
            key: 'actions', header: '', cell: (w: WarehouseRow) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setEditing(w); setDialogOpen(true) }} aria-label="ویرایش"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" disabled={w.lotsCount > 0 || w.balancesCount > 0 || w.isDefault} onClick={() => setDeleting(w)} aria-label="حذف"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ),
          },
        ]}
        rows={data ?? []}
        loading={loading}
        rowKey={(w: WarehouseRow) => w.id}
        empty="انباری ثبت نشده است"
      />
      <WarehouseDialog open={dialogOpen} editing={editing} onClose={() => { setDialogOpen(false); setEditing(null) }} onDone={reload} />
      <ConfirmDelete
        open={!!deleting}
        title={`حذف انبار «${deleting?.name ?? ''}»`}
        description="انباری که لات یا موجودی دارد قابل حذف نیست؛ انبار پیش‌فرض نیز حذف نمی‌شود."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}

function WarehouseDialog({ open, editing, onClose, onDone }: {
  open: boolean
  editing: WarehouseRow | null
  onClose: () => void
  onDone: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setCode(editing?.code ?? '')
      setName(editing?.name ?? '')
      setIsDefault(editing?.isDefault ?? false)
    }
  }, [open, editing])

  const submit = async () => {
    setBusy(true)
    try {
      const body = { code, name, isDefault }
      if (editing) {
        await apiFetch(`/api/admin/warehouses/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        toast.success('انبار ویرایش شد')
      } else {
        await apiFetch('/api/admin/warehouses', { method: 'POST', body: JSON.stringify(body) })
        toast.success('انبار ایجاد شد')
      }
      onDone()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? 'ویرایش انبار' : 'انبار جدید'}</DialogTitle>
          <DialogDescription>کد انبار یکتاست؛ اگر «پیش‌فرض» بزنید، پیش‌فرضی قبلی به‌صورت خودکار برداشته می‌شود.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="کد انبار" required><Input dir="ltr" value={code} onChange={e => setCode(e.target.value)} disabled={!!editing} /></Field>
          <Field label="نام انبار" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} aria-label="انبار پیش‌فرض" />
            انبار پیش‌فرض سیستم
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>انصراف</Button>
            <Button onClick={submit} disabled={busy || !code.trim() || name.trim().length < 2}>{busy ? 'در حال ثبت…' : 'ذخیره'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── کارمندان ───

function EmployeesTab() {
  const { data, loading, reload } = useApiData<EmployeeRow[]>('/api/admin/employees')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<EmployeeRow | null>(null)
  const [deleting, setDeleting] = useState<EmployeeRow | null>(null)
  const [busy, setBusy] = useState(false)

  const doDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await apiFetch(`/api/admin/employees/${deleting.id}`, { method: 'DELETE' })
      toast.success('کارمند حذف شد')
      setDeleting(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در حذف')
    } finally { setBusy(false) }
  }

  const toggleStatus = async (e: EmployeeRow) => {
    try {
      await apiFetch(`/api/admin/employees/${e.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) })
      toast.success(e.status === 'ACTIVE' ? 'کارمند غیرفعال شد' : 'کارمند فعال شد')
      reload()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'خطا') }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}><Plus className="h-4 w-4 ml-1" /> کارمند جدید</Button>
      </div>
      <DataTable
        columns={[
          { key: 'code', header: 'کد پرسنلی', cell: (e: EmployeeRow) => <span className="text-xs" dir="ltr">{e.code}</span> },
          {
            key: 'name', header: 'کارمند', cell: (e: EmployeeRow) => (
              <div>
                <div className="text-sm font-medium">{e.fullName}</div>
                {e.phone && <div className="text-[11px] text-muted-foreground" dir="ltr">{e.phone}</div>}
              </div>
            ),
          },
          { key: 'position', header: 'سمت', cell: (e: EmployeeRow) => <span className="text-xs">{e.position ?? '—'}</span> },
          {
            key: 'user', header: 'حساب متصل', cell: (e: EmployeeRow) => e.userName ? (
              <div>
                <div className="text-xs font-medium">{e.userName}</div>
                <div className="text-[10px] text-muted-foreground" dir="ltr">{e.userPhone}</div>
              </div>
            ) : <span className="text-xs text-muted-foreground">—</span>
          },
          { key: 'hire', header: 'استخدام', cell: (e: EmployeeRow) => <span className="text-xs">{e.hireDate ? <JDate d={e.hireDate} /> : '—'}</span> },
          {
            key: 'status', header: 'فعال', cell: (e: EmployeeRow) => (
              <Switch checked={e.status === 'ACTIVE'} onCheckedChange={() => toggleStatus(e)} aria-label="فعال/غیرفعال" />
            ),
          },
          {
            key: 'actions', header: '', cell: (e: EmployeeRow) => (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setEditing(e); setDialogOpen(true) }} aria-label="ویرایش"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" disabled={!!e.userId} onClick={() => setDeleting(e)} aria-label="حذف"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ),
          },
        ]}
        rows={data ?? []}
        loading={loading}
        rowKey={(e: EmployeeRow) => e.id}
        empty="کارمندی ثبت نشده است"
      />
      <EmployeeDialog open={dialogOpen} editing={editing} onClose={() => { setDialogOpen(false); setEditing(null) }} onDone={reload} />
      <ConfirmDelete
        open={!!deleting}
        title={`حذف کارمند «${deleting?.fullName ?? ''}»`}
        description="کارمندي که به حساب کاربری متصل است قابل حذف نیست؛ ابتدا اتصال را قطع کنید یا وضعیت را غیرفعال کنید."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}

function EmployeeDialog({ open, editing, onClose, onDone }: {
  open: boolean
  editing: EmployeeRow | null
  onClose: () => void
  onDone: () => void
}) {
  const [form, setForm] = useState({ code: '', fullName: '', phone: '', position: '', userId: '', hireDate: '' })
  const [busy, setBusy] = useState(false)
  const { data: usersData } = useApiData<Array<{ id: string; name: string; phone: string; isActive: boolean }>>(open ? '/api/users' : null)

  useEffect(() => {
    if (open) {
      setForm({
        code: editing?.code ?? '',
        fullName: editing?.fullName ?? '',
        phone: editing?.phone ?? '',
        position: editing?.position ?? '',
        userId: editing?.userId ?? '',
        hireDate: editing?.hireDate ? String(editing.hireDate).slice(0, 10) : '',
      })
    }
  }, [open, editing])

  const submit = async () => {
    setBusy(true)
    try {
      const body = {
        fullName: form.fullName,
        phone: form.phone || null,
        position: form.position || null,
        userId: form.userId || null,
        hireDate: form.hireDate || null,
        ...(editing ? {} : { code: form.code }),
      }
      if (editing) {
        await apiFetch(`/api/admin/employees/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        toast.success('کارمند ویرایش شد')
      } else {
        await apiFetch('/api/admin/employees', { method: 'POST', body: JSON.stringify(body) })
        toast.success('کارمند ایجاد شد')
      }
      onDone()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'ویرایش کارمند' : 'کارمند جدید'}</DialogTitle>
          <DialogDescription>کد پرسنلی یکتاست. اتصال به حساب کاربری برای ویزیتورها لازم است (بازدید و حضور).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="کد پرسنلی" required={!editing}><Input dir="ltr" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} disabled={!!editing} /></Field>
          <Field label="نام کامل" required><Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="موبایل"><Input dir="ltr" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="تاریخ استخدام"><Input dir="ltr" type="date" value={form.hireDate} onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} /></Field>
          </div>
          <Field label="سمت"><Input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} /></Field>
          <Field label="اتصال به حساب کاربری (اختیاری)">
            <Select value={form.userId || 'none'} onValueChange={v => setForm(f => ({ ...f, userId: v === 'none' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="بدون اتصال" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون اتصال</SelectItem>
                {(usersData ?? []).map(u => <SelectItem key={u.id} value={u.id}>{u.name} — <span dir="ltr">{u.phone}</span></SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>انصراف</Button>
            <Button onClick={submit} disabled={busy || (!editing && !form.code.trim()) || form.fullName.trim().length < 2}>{busy ? 'در حال ثبت…' : 'ذخیره'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── تنظیمات ───

function SettingsTab() {
  const { data, loading, reload } = useApiData<SettingRow[]>('/api/admin/settings')
  const [editing, setEditing] = useState<SettingRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const counters = (data ?? []).filter(s => s.isSystemCounter)
  const appSettings = (data ?? []).filter(s => !s.isSystemCounter)

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 ml-1" /> کلید جدید</Button>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b bg-stone-50 text-sm font-bold">تنظیمات برنامه</div>
        <div className="divide-y">
          {loading && <p className="text-sm text-muted-foreground p-4">در حال بارگذاری…</p>}
          {appSettings.map(s => (
            <div key={s.key} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium" dir="ltr">{s.key}</div>
                <div className="text-xs text-muted-foreground mt-0.5 break-all" dir="auto">{s.value}</div>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0"><JDate d={s.updatedAt} time /></span>
              <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label="ویرایش"><Pencil className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {!loading && appSettings.length === 0 && <p className="text-sm text-muted-foreground p-4">کلیدی ثبت نشده است</p>}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-stone-50 text-sm font-bold flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-stone-400" aria-hidden />
          شمارنده‌های داخلی اسناد (فقط‌خواندنی)
        </div>
        <div className="divide-y max-h-72 overflow-y-auto">
          {counters.map(s => (
            <div key={s.key} className="flex items-center gap-3 px-4 py-2.5 opacity-70">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium" dir="ltr">{s.key}</span>
                <span className="text-xs text-muted-foreground mr-3" dir="ltr">{s.value}</span>
              </div>
            </div>
          ))}
          {!loading && counters.length === 0 && <p className="text-sm text-muted-foreground p-4">هنوز سند numbering ثبت نشده است</p>}
        </div>
      </div>

      <SettingDialog open={!!editing || addOpen} setting={editing} isNew={addOpen} onClose={() => { setEditing(null); setAddOpen(false) }} onDone={reload} />
    </div>
  )
}

function SettingDialog({ open, setting, isNew, onClose, onDone }: {
  open: boolean
  setting: SettingRow | null
  isNew: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const isEdit = !isNew && !!setting

  useEffect(() => {
    if (open) {
      setKey(isEdit ? setting?.key ?? '' : '')
      setValue(isEdit ? setting?.value ?? '' : '')
    }
  }, [open, isEdit, setting])

  const submit = async () => {
    setBusy(true)
    try {
      await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ key, value }) })
      toast.success('تنظیم ذخیره شد')
      onDone()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'ویرایش تنظیم' : 'کلید تنظیم جدید'}</DialogTitle>
          <DialogDescription>{isEdit ? 'مقدار کلید را ویرایش کنید.' : 'کلید با حروف لاتین/عدد/نقطه/دونقطه؛ کلیدهای seq:* داخلی هستند و قابل ساخت نیستند.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="کلید" required={isNew}>
            <Input dir="ltr" value={key} onChange={e => setKey(e.target.value)} disabled={isEdit} placeholder="store.name" />
          </Field>
          <Field label="مقدار" required><Textarea rows={3} value={value} onChange={e => setValue(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>انصراف</Button>
            <Button onClick={submit} disabled={busy || !key.trim() || !value}>{busy ? 'در حال ثبت…' : 'ذخیره'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── تنظیمات وب‌سایت (نام، شعار، لوگو، فایوآیکون) ───

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon'

function SiteSettingsTab() {
  const { data, loading, reload } = useApiData<SiteIdentity>('/api/site-settings')
  const [name, setName] = useState('')
  const [slogan, setSlogan] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<'logo' | 'favicon' | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const faviconInput = useRef<HTMLInputElement>(null)

  // مقادیر اولیه از سرور — تا وقتی کاربر چیزی تایپ نکرده، با داده سرور همگام می‌ماند
  useEffect(() => {
    if (data && !dirty) {
      setName(data.name)
      setSlogan(data.slogan)
    }
  }, [data, dirty])

  const saveText = async () => {
    setBusy(true)
    try {
      await apiFetch('/api/site-settings', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), slogan: slogan.trim() }),
      })
      toast.success('تنظیمات وب‌سایت ذخیره شد')
      setDirty(false)
      reload()
      notifySiteChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ذخیره تنظیمات')
    } finally { setBusy(false) }
  }

  const uploadImage = async (kind: 'logo' | 'favicon', file: File) => {
    setUploading(kind)
    try {
      const optimized = await optimizeImageBeforeUpload(file)
      const form = new FormData()
      form.append('kind', kind)
      form.append('file', optimized)
      const res = await apiUpload<{ url: string }>('/api/uploads', form)
      await apiFetch('/api/site-settings', {
        method: 'PUT',
        body: JSON.stringify(kind === 'logo' ? { logoUrl: res.url } : { faviconUrl: res.url }),
      })
      toast.success(kind === 'logo' ? 'لوگو به‌روزرسانی شد' : 'فایوآیکون به‌روزرسانی شد')
      reload()
      notifySiteChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در بارگذاری تصویر')
    } finally { setUploading(null) }
  }

  const resetImage = async (field: 'logoUrl' | 'faviconUrl') => {
    setUploading(field === 'logoUrl' ? 'logo' : 'favicon')
    try {
      await apiFetch('/api/site-settings', { method: 'PUT', body: JSON.stringify({ [field]: null }) })
      toast.success('به پیش‌فرض بازگشت')
      reload()
      notifySiteChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در بازنشانی تصویر')
    } finally { setUploading(null) }
  }

  const nameValid = name.trim().length >= 2 && name.trim().length <= 60

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* نام و شعار */}
      <div className="rounded-xl border bg-card p-4 grid gap-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <Globe className="h-4 w-4 text-emerald-700" aria-hidden />
          <span className="text-sm font-bold">نام و شعار وب‌سایت</span>
        </div>
        <Field label="نام وب‌سایت" required hint="در هدر برنامه، صفحه ورود و عنوان تب مرورگر نمایش داده می‌شود (حداکثر ۶۰ کاراکتر)">
          <Input
            value={name}
            onChange={e => { setName(e.target.value); setDirty(true) }}
            maxLength={60}
            placeholder="بنکداری هوشمند"
            disabled={loading}
          />
        </Field>
        <Field label="شعار (Slogan)" hint="زیر نام در صفحه ورود نمایش داده می‌شود (حداکثر ۱۲۰ کاراکتر)">
          <Input
            value={slogan}
            onChange={e => { setSlogan(e.target.value); setDirty(true) }}
            maxLength={120}
            placeholder="سامانه مدیریت B2B بنکداری مواد غذایی"
            disabled={loading}
          />
        </Field>
        <div className="flex justify-end">
          <Button size="sm" onClick={saveText} disabled={busy || !dirty || !nameValid}>
            {busy ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
          </Button>
        </div>
      </div>

      {/* لوگو و فایوآیکون */}
      <div className="rounded-xl border bg-card p-4 grid gap-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <ImagePlus className="h-4 w-4 text-emerald-700" aria-hidden />
          <span className="text-sm font-bold">لوگو و فایوآیکون</span>
        </div>

        <input
          ref={logoInput}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage('logo', f); e.target.value = '' }}
        />
        <input
          ref={faviconInput}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage('favicon', f); e.target.value = '' }}
        />

        {/* لوگو */}
        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">لوگو — در هدر و صفحه ورود نمایش داده می‌شود (حداکثر ۲ مگابایت)</div>
          <div className="flex items-center gap-3">
            <div className="h-20 w-28 rounded-lg border bg-stone-50 grid place-items-center overflow-hidden shrink-0">
              {data?.logoUrl
                ? <img src={data.logoUrl} alt="لوگوی فعلی" className="max-h-16 max-w-24 object-contain" />
                : <span className="grid place-items-center h-10 w-10 rounded-lg bg-primary text-primary-foreground font-black">ب</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => logoInput.current?.click()} disabled={uploading !== null}>
                {uploading === 'logo' ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <ImagePlus className="h-4 w-4 ml-1" />}
                {data?.logoUrl ? 'تغییر لوگو' : 'بارگذاری لوگو'}
              </Button>
              {data?.logoUrl && (
                <Button type="button" variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => resetImage('logoUrl')} disabled={uploading !== null}>
                  <Trash2 className="h-4 w-4 ml-1" /> حذف
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="border-t" />

        {/* فایوآیکون */}
        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">فایوآیکون — آیکون تب مرورگر (حداکثر ۲ مگابایت)</div>
          <div className="flex items-center gap-3">
            <div className="h-20 w-28 rounded-lg border bg-stone-50 grid place-items-center overflow-hidden shrink-0">
              {data?.faviconUrl ? (
                <span className="flex items-end gap-3">
                  <img src={data.faviconUrl} alt="فایوآیکون" className="h-12 w-12 object-contain" />
                  <img src={data.faviconUrl} alt="" aria-hidden className="h-4 w-4 object-contain" />
                </span>
              ) : (
                <img src="/logo.svg" alt="فایوآیکون پیش‌فرض" className="h-12 w-12 object-contain" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => faviconInput.current?.click()} disabled={uploading !== null}>
                {uploading === 'favicon' ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <ImagePlus className="h-4 w-4 ml-1" />}
                {data?.faviconUrl ? 'تغییر فایوآیکون' : 'بارگذاری فایوآیکون'}
              </Button>
              {data?.faviconUrl && (
                <Button type="button" variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => resetImage('faviconUrl')} disabled={uploading !== null}>
                  <Trash2 className="h-4 w-4 ml-1" /> حذف
                </Button>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            پس از ذخیره، عنوان و آیکون تب مرورگر بلافاصله به‌روز می‌شود؛ در صورت ناپدید شدن تصویر، صفحه را یک‌بار بازخوانی کنید.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── بنرهای فروشگاه (هیرو اسلایدشو) ───

type BannerRow = {
  id: string
  title: string | null
  subtitle: string | null
  imageUrl: string
  linkUrl: string | null
  linkLabel: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
}

function BannersTab() {
  const { data, loading, reload } = useApiData<BannerRow[]>('/api/admin/banners')
  const [editing, setEditing] = useState<BannerRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const banners = data ?? []

  const toggleActive = async (b: BannerRow) => {
    try {
      await apiFetch(`/api/admin/banners/${b.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !b.isActive }) })
      toast.success(b.isActive ? 'بنر غیرفعال شد' : 'بنر فعال شد')
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    }
  }

  const move = async (b: BannerRow, dir: -1 | 1) => {
    const sorted = [...banners].sort((x, y) => x.sortOrder - y.sortOrder || x.createdAt.localeCompare(y.createdAt))
    const idx = sorted.findIndex(x => x.id === b.id)
    const swapWith = sorted[idx + dir]
    if (!swapWith) return
    try {
      // مبادله ترتیب با همسایه — دو درخواست PATCH
      await Promise.all([
        apiFetch(`/api/admin/banners/${b.id}`, { method: 'PATCH', body: JSON.stringify({ sortOrder: swapWith.sortOrder }) }),
        apiFetch(`/api/admin/banners/${swapWith.id}`, { method: 'PATCH', body: JSON.stringify({ sortOrder: b.sortOrder }) }),
      ])
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در تغییر ترتیب')
    }
  }

  const doDelete = async () => {
    if (!deleteId) return
    setBusy(true)
    try {
      await apiFetch(`/api/admin/banners/${deleteId}`, { method: 'DELETE' })
      toast.success('بنر حذف شد')
      setDeleteId(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در حذف')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-muted-foreground">
          بنرهای فعال در هیرو اسلایدشوِ صفحه «فروشگاه محصولات» نمایش داده می‌شوند (چرخش خودکار هر ۵ ثانیه). حداکثر ۵ مگابایت.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 ml-1" /> بنر جدید</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">در حال بارگذاری…</p>
      ) : banners.length === 0 ? (
        <div className="rounded-xl border bg-card py-12 text-center">
          <Images className="h-9 w-9 text-stone-300 mx-auto" aria-hidden />
          <p className="text-sm text-muted-foreground mt-3">هنوز بنری ثبت نشده — صفحه فروشگاه حالت پیش‌فرض را نشان می‌دهد</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {banners.map(b => (
            <div key={b.id} className={`rounded-xl border bg-card overflow-hidden ${!b.isActive ? 'opacity-60' : ''}`}>
              <div className="relative aspect-[16/7] bg-stone-100">
                <img src={b.imageUrl} alt={b.title ?? 'بنر'} className="absolute inset-0 h-full w-full object-cover" />
                {!b.isActive && (
                  <span className="absolute top-2 left-2 rounded-full bg-rose-600 text-white text-[10px] font-bold px-2 py-1">غیرفعال</span>
                )}
              </div>
              <div className="p-3 grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{b.title ?? 'بدون عنوان'}</div>
                    {b.subtitle && <div className="text-[11px] text-muted-foreground line-clamp-1">{b.subtitle}</div>}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 rounded bg-stone-100 px-1.5 py-0.5" dir="ltr">#{b.sortOrder}</span>
                </div>
                {b.linkUrl && <div className="text-[10px] text-emerald-700 truncate" dir="ltr">{b.linkLabel ?? 'لینک'}: {b.linkUrl}</div>}
                <div className="flex items-center gap-1.5 pt-1 border-t border-dashed">
                  <Button variant="ghost" size="sm" className="h-7 px-1.5" aria-label="انتقال به بالا" onClick={() => move(b, -1)}><ChevronUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" className="h-7 px-1.5" aria-label="انتقال به پایین" onClick={() => move(b, 1)}><ChevronDown className="h-4 w-4" /></Button>
                  <Switch checked={b.isActive} onCheckedChange={() => toggleActive(b)} aria-label="فعال/غیرفعال" />
                  <span className="mr-auto flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => setEditing(b)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-7 text-rose-600 hover:text-rose-700" onClick={() => setDeleteId(b.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <BannerDialog open={!!editing || addOpen} banner={editing} isNew={addOpen} onClose={() => { setEditing(null); setAddOpen(false) }} onDone={reload} />
      <ConfirmDelete
        open={!!deleteId}
        title="حذف بنر"
        description="این بنر برای همیشه حذف می‌شود و در اسلایدشو فروشگاه نمایش داده نمی‌شود."
        busy={busy}
        onCancel={() => setDeleteId(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}

function BannerDialog({ open, banner, isNew, onClose, onDone }: {
  open: boolean
  banner: BannerRow | null
  isNew: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [isActive, setIsActive] = useState(true)
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const isEdit = !isNew && !!banner

  useEffect(() => {
    if (open) {
      if (banner) {
        setTitle(banner.title ?? ''); setSubtitle(banner.subtitle ?? '')
        setLinkUrl(banner.linkUrl ?? ''); setLinkLabel(banner.linkLabel ?? '')
        setSortOrder(banner.sortOrder); setIsActive(banner.isActive); setImageUrl(banner.imageUrl)
      } else {
        setTitle(''); setSubtitle(''); setLinkUrl(''); setLinkLabel('')
        setSortOrder(0); setIsActive(true); setImageUrl('')
      }
      setDirty(false)
    }
  }, [open, banner])

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const optimized = await optimizeImageBeforeUpload(file)
      const form = new FormData()
      form.append('kind', 'banner')
      form.append('file', optimized)
      const res = await apiUpload<{ url: string }>('/api/uploads', form)
      setImageUrl(res.url)
      setDirty(true)
      toast.success('تصویر بارگذاری شد')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در بارگذاری تصویر')
    } finally { setUploading(false) }
  }

  const submit = async () => {
    if (!imageUrl) { toast.error('ابتدا تصویر بنر را بارگذاری کنید'); return }
    const payload: Record<string, unknown> = { title: title.trim() || null, subtitle: subtitle.trim() || null, linkUrl: linkUrl.trim() || null, linkLabel: linkLabel.trim() || null, isActive }
    if (!isEdit) {
      payload.imageUrl = imageUrl
      payload.sortOrder = sortOrder
    } else if (dirty) {
      payload.imageUrl = imageUrl
    }
    setBusy(true)
    try {
      if (isEdit) {
        await apiFetch(`/api/admin/banners/${banner!.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        toast.success('بنر به‌روزرسانی شد')
      } else {
        await apiFetch('/api/admin/banners', { method: 'POST', body: JSON.stringify(payload) })
        toast.success('بنر ایجاد شد')
      }
      onDone(); onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'ویرایش بنر' : 'بنر جدید'}</DialogTitle>
          <DialogDescription>تصویر بنر (حداکثر ۵ مگابایت — PNG/JPEG/WEBP) و متن اختیاری روی تصویر.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {/* تصویر */}
          <div className="grid gap-2">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
            <div className="relative rounded-lg border overflow-hidden aspect-[16/7] bg-stone-50">
              {imageUrl ? (
                <img src={imageUrl} alt="پیش‌نمایش بنر" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">تصویری بارگذاری نشده</div>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <ImagePlus className="h-4 w-4 ml-1" />}
              {imageUrl ? 'تغییر تصویر' : 'بارگذاری تصویر'}
            </Button>
          </div>

          <Field label="عنوان (روی تصویر)" hint="اختیاری — حداکثر ۸۰ کاراکتر">
            <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="مثلاً: پیشنهاد ویژه ماه رمضان" />
          </Field>
          <Field label="زیرعنوان" hint="اختیاری — حداکثر ۱۶۰ کاراکتر">
            <Textarea rows={2} value={subtitle} onChange={e => setSubtitle(e.target.value)} maxLength={160} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="متن دکمه" hint="اختیاری">
              <Input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} maxLength={40} placeholder="مشاهده" />
            </Field>
            <div className="col-span-2">
              <Field label="لینک دکمه" hint="اختیاری — مسیر داخلی مثل #/catalog">
                <Input dir="ltr" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} maxLength={300} placeholder="#/catalog" />
              </Field>
            </div>
          </div>
          {!isEdit && (
            <Field label="ترتیب نمایش" hint="عدد کوچک‌تر زودتر نمایش داده می‌شود">
              <Input type="number" dir="ltr" min={0} max={9999} value={sortOrder} onChange={e => setSortOrder(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="فعال" />
            فعال (در اسلایدشو نمایش داده شود)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>انصراف</Button>
            <Button onClick={submit} disabled={busy || !imageUrl || (!dirty && isEdit)}>
              {busy ? 'در حال ثبت…' : isEdit ? 'ذخیره' : 'ایجاد بنر'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── ورود با گوگل ───

type GoogleConfig = { enabled: boolean; clientId: string; secretSet: boolean; redirectUri: string; source: 'env' | 'db' }

function GoogleLoginTab() {
  const { data, loading, reload } = useApiData<GoogleConfig>('/api/admin/auth-google')
  const [enabled, setEnabled] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (data && !dirty) {
      setEnabled(data.enabled)
      setClientId(data.clientId)
    }
  }, [data, dirty])

  const save = async () => {
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { enabled }
      if (dirty && clientId !== data?.clientId) payload.clientId = clientId
      if (clientSecret.trim()) payload.clientSecret = clientSecret.trim()
      await apiFetch('/api/admin/auth-google', { method: 'PUT', body: JSON.stringify(payload) })
      toast.success('تنظیمات ورود با گوگل ذخیره شد')
      setClientSecret('')
      setDirty(false)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ذخیره تنظیمات')
    } finally { setBusy(false) }
  }

  const copyRedirect = async () => {
    if (!data?.redirectUri) return
    try {
      await navigator.clipboard.writeText(data.redirectUri)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { toast.error('کپی ناموفق بود؛ آدرس را دستی کپی کنید') }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 grid gap-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <KeyRound className="h-4 w-4 text-emerald-700" aria-hidden />
          <span className="text-sm font-bold">فعال‌سازی ورود با گوگل</span>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
        ) : (
          <>
            <label className="flex items-start gap-3 cursor-pointer">
              <Switch checked={enabled} onCheckedChange={v => { setEnabled(v); setDirty(true) }} aria-label="ورود با گوگل" />
              <span className="text-sm">
                ورود کاربران با حساب گوگل
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  {enabled ? 'دکمه «ورود با گوگل» در صفحه ورود نمایش داده می‌شود.' : 'دکمه گوگل از صفحه ورود حذف می‌شود.'}
                </span>
              </span>
            </label>

            <Field label="Client ID" hint="از Google Cloud Console → Credentials → OAuth 2.0 Client ID">
              <Input dir="ltr" value={clientId} onChange={e => { setClientId(e.target.value); setDirty(true) }} placeholder="xxxxxxxx.apps.googleusercontent.com" />
            </Field>
            <Field label="Client Secret" hint={data?.secretSet ? 'یک secret ثبت شده — برای تغییر مقدار جدید وارد کنید (خالی بماند تا تغییر نکند)' : 'Secret کلاینت OAuth گوگل'}>
              <Input dir="ltr" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder={data?.secretSet ? '•••••••• (ثبت شده)' : ''} />
            </Field>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-900 leading-5">
              URI بازگشت برای ثبت در گوگل (Authorized redirect URIs):
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 min-w-0 rounded bg-white border px-2 py-1 text-[11px] overflow-x-auto" dir="ltr">{data?.redirectUri ?? '—'}</code>
                <Button type="button" variant="outline" size="sm" className="h-7 shrink-0" onClick={copyRedirect}>{copied ? 'کپی شد' : 'کپی'}</Button>
              </div>
              {data?.source === 'env' && <p className="mt-2">شناسه و رمز از متغیرهای محیطی (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) خوانده می‌شود و مقادیر پنل نادیده گرفته می‌شوند.</p>}
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={busy || (!dirty && !clientSecret.trim())}>{busy ? 'در حال ذخیره…' : 'ذخیره تغییرات'}</Button>
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4 grid gap-3 text-xs leading-6 text-muted-foreground">
        <div className="flex items-center gap-2 border-b pb-3 text-sm font-bold text-stone-700">
          <Globe className="h-4 w-4 text-emerald-700" aria-hidden />
          راهنمای راه‌اندازی
        </div>
        <ol className="grid gap-2 list-decimal pr-5">
          <li>در <span dir="ltr">console.cloud.google.com</span> یک پروژه بسازید و به «APIs & Services → Credentials» بروید.</li>
          <li>«OAuth client ID» با نوع <span dir="ltr">Web application</span> بسازید و در بخش Authorized redirect URIs آدرس کپی‌شده بالا را ثبت کنید.</li>
          <li>Client ID و Client Secret را در همین فرم وارد و ذخیره کنید (یا به‌جای آن متغیرهای محیطی <span dir="ltr">GOOGLE_CLIENT_ID</span> / <span dir="ltr">GOOGLE_CLIENT_SECRET</span> را تنظیم کنید).</li>
          <li>کلید «ورود کاربران با حساب گوگل» را روشن کنید؛ دکمه گوگل فوراً در صفحه ورود ظاهر می‌شود.</li>
        </ol>
        <div className="rounded-lg bg-stone-50 border p-3 leading-6">
          <span className="font-bold text-stone-700">کاربران جدید گوگل:</span>{' '}
          با اولین ورود، حسابی با نقش پیش‌فرض «کاربر آنلاین» ساخته می‌شود که فقط داشبورد، فروشگاه و سفارش‌ها را می‌بیند؛
          مدیر می‌تواند از تب «کاربران و نقش‌ها» نقش آن‌ها را تغییر دهد. ورود با شماره موبایل برای این حساب‌ها غیرفعال است (فقط ورود با گوگل).
        </div>
        <div className="rounded-lg bg-stone-50 border p-3 leading-6">
          <span className="font-bold text-stone-700">خروج از حساب:</span>{' '}
          روی آواتار در هدر → «خروج از حساب».
        </div>
      </div>
    </div>
  )
}

// ─── سفارشی‌سازی صفحه ورود (دو ستون قابل تنظیم) ───

const LOGIN_MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm'
const LOGIN_SWATCHES = ['#ffffff', '#f5f5f4', '#ecfdf5', '#0f172a', '#14532d', '#7c2d12']

// انتخابگر پس‌زمینه تصویری/ویدیویی یک ستون صفحه ورود — پیش‌نمایش + بارگذاری + حذف
function LoginMediaPicker({ target, kind, url, uploading, onPick, onClear, overlay }: {
  target: 'side' | 'form'
  kind: LoginMediaKind
  url: string | null
  uploading: 'side' | 'form' | null
  onPick: (target: 'side' | 'form', file: File) => void
  onClear: (target: 'side' | 'form') => void
  overlay?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const has = kind !== 'none' && !!url
  return (
    <div className="grid gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={LOGIN_MEDIA_ACCEPT}
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(target, f); e.target.value = '' }}
      />
      <div className="relative rounded-lg border overflow-hidden aspect-[16/7] bg-stone-50">
        {has && url ? (
          kind === 'image' ? (
            <img src={url} alt="پیش‌نمایش پس‌زمینه" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <video src={url} muted loop autoPlay playsInline aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          )
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">پس‌زمینه‌ای الصاق نشده — رنگ قالب پیش‌فرض</div>
        )}
        {has && overlay !== undefined && (
          <div className="absolute inset-0" style={{ backgroundColor: `rgba(10, 14, 20, ${(overlay / 100).toFixed(2)})` }} aria-hidden />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading !== null}>
          {uploading === target ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <ImagePlus className="h-4 w-4 ml-1" />}
          {has ? 'تغییر پس‌زمینه' : 'الصاق تصویر یا ویدیو'}
        </Button>
        {has && (
          <>
            <Button type="button" variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => onClear(target)} disabled={uploading !== null}>
              <Trash2 className="h-4 w-4 ml-1" /> حذف
            </Button>
            <Badge variant="secondary" className="text-[10px]">{kind === 'video' ? 'ویدیو' : 'تصویر'}</Badge>
          </>
        )}
      </div>
    </div>
  )
}

// انتخاب رنگ متن ستون — خودکار/روشن/تیره
function TextToneSelect({ value, onChange }: { value: LoginSideConfig['textTone']; onChange: (v: LoginSideConfig['textTone']) => void }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as LoginSideConfig['textTone'])}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">خودکار — روی پس‌زمینه روشن، بدون پس‌زمینه رنگ قالب</SelectItem>
        <SelectItem value="light">روشن (سفید)</SelectItem>
        <SelectItem value="dark">تیره</SelectItem>
      </SelectContent>
    </Select>
  )
}

// متغیرهای CSS لایه گرادیانت — از تنظیمات موبایل به کلاس bwh-login-gradient
export function gradientVars(m: LoginMobileConfig): React.CSSProperties {
  return {
    '--lg-c1': m.gradientColors[0] ?? DEFAULT_GRADIENT_COLORS[0],
    '--lg-c2': m.gradientColors[1] ?? DEFAULT_GRADIENT_COLORS[1],
    '--lg-c3': m.gradientColors[2] ?? m.gradientColors[0] ?? DEFAULT_GRADIENT_COLORS[2],
    '--lg-c4': m.gradientColors[3] ?? m.gradientColors[1] ?? DEFAULT_GRADIENT_COLORS[3],
    '--lg-speed': `${m.gradientSpeed}s`,
    '--lg-angle': `${m.gradientAngle}deg`,
    '--lg-opacity': (m.gradientIntensity / 100).toFixed(2),
  } as React.CSSProperties
}

// ─── تنظیمات گرادیانت متحرک موبایل صفحه ورود ───
const GRADIENT_SWATCH_SETS = [
  ['#34d399', '#0d9488', '#10b981', '#065f46'], // زمردی قالب
  ['#f59e0b', '#ef4444', '#ec4899', '#7c2d12'], // غروب
  ['#60a5fa', '#6366f1', '#8b5cf6', '#1e1b4b'], // شب
  ['#fbbf24', '#f97316', '#f43f5e', '#7f1d1d'], // آتش
]

function MobileGradientSettings({ mobile, onPatch, onUpdater }: {
  mobile: LoginMobileConfig
  onPatch: (patch: Partial<LoginMobileConfig>) => void
  onUpdater: (fn: (m: LoginMobileConfig) => LoginMobileConfig) => void
}) {
  const set = onPatch
  const setColor = (i: number, v: string) => onUpdater(m => ({
    ...m,
    gradientColors: m.gradientColors.map((c, j) => (j === i ? v : c)),
  }))
  const addColor = () => onUpdater(m => (
    m.gradientColors.length >= 5 ? m : { ...m, gradientColors: [...m.gradientColors, DEFAULT_GRADIENT_COLORS[m.gradientColors.length % DEFAULT_GRADIENT_COLORS.length]] }
  ))
  const removeColor = (i: number) => onUpdater(m => (
    m.gradientColors.length <= 2 ? m : { ...m, gradientColors: m.gradientColors.filter((_, j) => j !== i) }
  ))

  return (
    <div className="rounded-xl border bg-card p-4 grid gap-4">
      <div className="flex items-center gap-2 border-b pb-3">
        <Smartphone className="h-4 w-4 text-emerald-700" aria-hidden />
        <span className="text-sm font-bold">موبایل — پس‌زمینه گرادیانت متحرک</span>
      </div>

      <p className="text-xs text-muted-foreground leading-6">
        در گوشی و تبلت (زایر عرض دسکتاپ) پشت کارت فرم، یک گرادیانت نرم و متحرک نمایش داده می‌شود؛
        در دسکتاپ صفحه ورود مانند قبل است. اگر برای ستون فرم پس‌زمینه تصویری/ویدیویی تنظیم کرده باشید،
        گرادیانت جای آن را نمی‌گیرد. با تنظیم «کاهش حرکت» در سیستم کاربر، انیمیشن خاموش و گرادیانت ثابت می‌شود.
      </p>

      <label className="flex items-start gap-3 cursor-pointer">
        <Switch
          checked={mobile.gradientEnabled}
          onCheckedChange={v => set({ gradientEnabled: v })}
          aria-label="فعال بودن گرادیانت متحرک موبایل"
        />
        <span className="text-sm">
          نمایش گرادیانت متحرک در موبایل
          <span className="block text-[11px] text-muted-foreground mt-0.5">
            خاموش بودن = پس‌زمینه سادهٔ قالب (مانند قبل)
          </span>
        </span>
      </label>

      <Field label="رنگ‌های گرادیانت" hint="۲ تا ۵ رنگ HEX — گرادیانت به‌ترتیب از رنگ اول تا آخر جابه‌جا می‌شود">
        <div className="flex items-center gap-2 flex-wrap">
          {mobile.gradientColors.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#000000'}
                onChange={e => setColor(i, e.target.value)}
                className="h-9 w-12 rounded-md border cursor-pointer bg-transparent p-1"
                aria-label={`رنگ ${formatFaNumber(i + 1)} گرادیانت`}
              />
              {mobile.gradientColors.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeColor(i)}
                  aria-label={`حذف رنگ ${formatFaNumber(i + 1)}`}
                  className="grid place-items-center h-7 w-7 rounded-md border text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {mobile.gradientColors.length < 5 && (
            <Button type="button" variant="outline" size="sm" onClick={addColor}>
              <Plus className="h-4 w-4 ml-1" /> رنگ
            </Button>
          )}
        </div>
      </Field>

      <Field label="پالت‌های آماده">
        <div className="flex items-center gap-2 flex-wrap">
          {GRADIENT_SWATCH_SETS.map((palette, i) => (
            <button
              key={i}
              type="button"
              onClick={() => set({ gradientColors: palette })}
              aria-label={`پالت ${formatFaNumber(i + 1)}`}
              className="h-8 w-16 rounded-md border overflow-hidden flex"
            >
              {palette.map(c => <span key={c} className="flex-1" style={{ backgroundColor: c }} />)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={`سرعت انیمیشن (${mobile.gradientSpeed} ثانیه در هر سیکل)`} hint="عدد بیشتر = حرکت آرام‌تر و سبک‌تر">
        <Slider
          value={[mobile.gradientSpeed]}
          min={4} max={60} step={1}
          onValueChange={([v]: number[]) => set({ gradientSpeed: v })}
        />
      </Field>

      <Field label={`جهت حرکت گرادیانت (${mobile.gradientAngle} درجه)`} hint="۱۳۵ درجه = مورب از بالا به پایین؛ ۹۰ = عمودی؛ ۱۸۰ = افقی">
        <Slider
          value={[mobile.gradientAngle]}
          min={0} max={360} step={5}
          onValueChange={([v]: number[]) => set({ gradientAngle: v })}
        />
      </Field>

      <Field label={`شدت گرادیانت (${mobile.gradientIntensity}٪)`} hint="شدت کمتر = رنگ‌ها ملایم‌تر روی پس‌زمینه قالب">
        <Slider
          value={[mobile.gradientIntensity]}
          min={20} max={100} step={5}
          onValueChange={([v]: number[]) => set({ gradientIntensity: v })}
        />
      </Field>

      {/* پیش‌نمایش زنده — همان کلاس صفحه واقعی ورود با متغیرهای فعلی */}
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">پیش‌نمایش (نسبت موبایل)</span>
        <div className="relative h-28 w-full max-w-56 mx-auto rounded-xl border overflow-hidden bg-stone-100">
          <div aria-hidden className="bwh-login-gradient" style={gradientVars(mobile)} />
          <div className="absolute inset-x-6 inset-y-5 rounded-lg bg-card border shadow-sm grid place-items-center text-xs font-bold text-card-foreground">
            کارت فرم
          </div>
        </div>
      </div>
    </div>
  )
}

function LoginSettingsTab() {
  const { data, loading, reload } = useApiData<LoginConfig>('/api/login-settings')
  const [side, setSide] = useState<LoginSideConfig | null>(null)
  const [form, setForm] = useState<LoginFormConfig | null>(null)
  const [mobile, setMobile] = useState<LoginMobileConfig | null>(null)
  const [itemsText, setItemsText] = useState('')
  const [uploading, setUploading] = useState<'side' | 'form' | null>(null)
  const [busy, setBusy] = useState(false)

  // همگام‌سازی از سرور — هر بار پس از ذخیره هم به‌روز می‌شود
  useEffect(() => {
    if (data) {
      setSide(data.side)
      setForm(data.form)
      setMobile(data.mobile)
      setItemsText(data.side.items.join('\n'))
    }
  }, [data])

  const upload = async (target: 'side' | 'form', file: File) => {
    setUploading(target)
    try {
      // تصاویر شطرنجی بزرگ قبل از ارسال در مرورگر کوچک/WebP می‌شوند — سرور تبدیل نهایی را انجام می‌دهد
      const optimized = await optimizeImageBeforeUpload(file)
      const isVideo = optimized.type.startsWith('video/')
      const fd = new FormData()
      fd.append('kind', 'login')
      fd.append('file', optimized)
      const res = await apiUpload<{ url: string }>('/api/uploads', fd)
      if (target === 'side') {
        setSide(s => (s ? { ...s, bgKind: isVideo ? 'video' : 'image', bgUrl: res.url } : s))
      } else {
        setForm(f => (f ? { ...f, bgKind: isVideo ? 'video' : 'image', bgUrl: res.url } : f))
      }
      toast.success(isVideo ? 'ویدیوی پس‌زمینه بارگذاری شد' : 'تصویر پس‌زمینه بارگذاری شد')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در بارگذاری فایل')
    } finally { setUploading(null) }
  }

  const clearMedia = (target: 'side' | 'form') => {
    if (target === 'side') setSide(s => (s ? { ...s, bgKind: 'none', bgUrl: null } : s))
    else setForm(f => (f ? { ...f, bgKind: 'none', bgUrl: null } : f))
  }

  const save = async () => {
    if (!side || !form || !mobile) return
    if (!/^#[0-9a-fA-F]{6}$/.test(form.color)) {
      toast.error('رنگ کارت فرم معتبر نیست؛ از انتخابگر رنگ استفاده کنید')
      return
    }
    if (mobile.gradientColors.length < 2 || mobile.gradientColors.some(c => !/^#[0-9a-fA-F]{6}$/.test(c))) {
      toast.error('رنگ‌های گرادیانت موبایل معتبر نیستند؛ حداقل دو رنگ HEX معتبر لازم است')
      return
    }
    setBusy(true)
    try {
      await apiFetch('/api/login-settings', {
        method: 'PUT',
        body: JSON.stringify({
          // bgUrl خالی به‌جای null — سرور فقط رشته می‌پذیرد
          side: { ...side, bgUrl: side.bgUrl ?? '', items: itemsText.split('\n').map(x => x.trim()).filter(Boolean) },
          form: { ...form, bgUrl: form.bgUrl ?? '' },
          mobile,
        }),
      })
      toast.success('تنظیمات صفحه ورود ذخیره شد')
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ذخیره تنظیمات')
    } finally { setBusy(false) }
  }

  const dirty = !!data && !!side && !!form && !!mobile && (
    JSON.stringify({ ...side, items: itemsText.split('\n').map(x => x.trim()).filter(Boolean) }) !== JSON.stringify(data.side) ||
    JSON.stringify(form) !== JSON.stringify(data.form) ||
    JSON.stringify(mobile) !== JSON.stringify(data.mobile)
  )

  if (loading && !data) {
    return <p className="text-sm text-muted-foreground py-8 text-center">در حال بارگذاری…</p>
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground max-w-3xl leading-6">
          صفحه ورود دو ستون دارد: <b>ستون راست</b> معرفی و توضیحات و <b>ستون چپ</b> فرم ورود.
          برای هر ستون می‌توانید تصویر یا ویدیوی پس‌زمینه الصاق کنید، درصد تاریکی و رنگ متن را تنظیم کنید،
          رنگ/شفافیت/محو بودن کارت فرم را تغییر دهید و همه نوشته‌های بالای فرم، پایین فرم و ستون مقابل را ویرایش کنید.
          در بخش «موبایل» نیز پس‌زمینه گرادیانت متحرک صفحه ورود در گوشی‌ها قابل سفارشی‌سازی است.
        </p>
        <Button size="sm" onClick={save} disabled={busy || !side || !form || !mobile}>
          {busy ? 'در حال ذخیره…' : dirty ? 'ذخیره تغییرات' : 'ذخیره'}
        </Button>
      </div>

      {side && form && (
        <div className="grid gap-4 xl:grid-cols-2">
          {/* ستون راست — معرفی و توضیحات */}
          <div className="rounded-xl border bg-card p-4 grid gap-4">
            <div className="flex items-center gap-2 border-b pb-3">
              <LogIn className="h-4 w-4 text-emerald-700" aria-hidden />
              <span className="text-sm font-bold">ستون راست — نوشته‌ها و توضیحات</span>
            </div>

            <LoginMediaPicker
              target="side"
              kind={side.bgKind}
              url={side.bgUrl}
              uploading={uploading}
              onPick={upload}
              onClear={clearMedia}
              overlay={side.overlay}
            />

            <Field label={`درصد تاریکی روی پس‌زمینه (${side.overlay}٪)`} hint="فقط وقتی پس‌زمینه الصاق شده اعمال می‌شود — برای خوانایی متن روی تصویر/ویدیو">
              <Slider
                value={[side.overlay]}
                min={0} max={80} step={5}
                onValueChange={([v]: number[]) => setSide(s => (s ? { ...s, overlay: v } : s))}
              />
            </Field>

            <Field label="رنگ متن‌های این ستون">
              <TextToneSelect value={side.textTone} onChange={v => setSide(s => (s ? { ...s, textTone: v } : s))} />
            </Field>

            <Field label="عنوان اصلی" hint="کنار لوگو نمایش داده می‌شود — خالی = بدون عنوان">
              <Input value={side.title} maxLength={80} onChange={e => setSide(s => (s ? { ...s, title: e.target.value } : s))} />
            </Field>
            <Field label="زیرعنوان" hint="زیر عنوان اصلی — حداکثر ۱۶۰ کاراکتر">
              <Input value={side.subtitle} maxLength={160} onChange={e => setSide(s => (s ? { ...s, subtitle: e.target.value } : s))} />
            </Field>
            <Field label="بندهای توضیحات" hint="هر بند در یک خط — حداکثر ۸ بند و ۱۶۰ کاراکتر در هر خط">
              <Textarea rows={5} value={itemsText} onChange={e => setItemsText(e.target.value)} />
            </Field>
            <Field label="متن پایین ستون" hint="حداکثر ۲۰۰ کاراکتر — خالی = نمایش داده نمی‌شود">
              <Input value={side.footer} maxLength={200} onChange={e => setSide(s => (s ? { ...s, footer: e.target.value } : s))} />
            </Field>
          </div>

          {/* ستون چپ — فرم ورود */}
          <div className="rounded-xl border bg-card p-4 grid gap-4">
            <div className="flex items-center gap-2 border-b pb-3">
              <LogIn className="h-4 w-4 text-emerald-700" aria-hidden />
              <span className="text-sm font-bold">ستون چپ — فرم ورود</span>
            </div>

            <LoginMediaPicker
              target="form"
              kind={form.bgKind}
              url={form.bgUrl}
              uploading={uploading}
              onPick={upload}
              onClear={clearMedia}
            />

            <Field label="رنگ کارت فرم" hint="با شفافیت بالا، پس‌زمینه از پشت کارت دیده می‌شود">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : '#ffffff'}
                  onChange={e => setForm(f => (f ? { ...f, color: e.target.value } : f))}
                  className="h-9 w-12 rounded-md border cursor-pointer bg-transparent p-1"
                  aria-label="انتخاب رنگ کارت فرم"
                />
                <Input
                  dir="ltr"
                  className="w-28"
                  value={form.color}
                  onChange={e => {
                    const v = e.target.value
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setForm(f => (f ? { ...f, color: v } : f))
                  }}
                />
                <div className="flex items-center gap-1.5">
                  {LOGIN_SWATCHES.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`رنگ ${c}`}
                      onClick={() => setForm(f => (f ? { ...f, color: c } : f))}
                      className={`h-7 w-7 rounded-md border ${form.color.toLowerCase() === c ? 'ring-2 ring-emerald-600' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </Field>

            <Field label={`شفافیت کارت فرم (${form.transparency}٪)`} hint="۰٪ کاملاً مات — ۱۰۰٪ کاملاً شفاف">
              <Slider
                value={[form.transparency]}
                min={0} max={100} step={5}
                onValueChange={([v]: number[]) => setForm(f => (f ? { ...f, transparency: v } : f))}
              />
            </Field>

            <Field label={`محو بودن پس‌زمینه پشت کارت (${form.blur} پیکسل)`} hint="بلور (Blur) پشت کارت — برای خوانایی روی تصویر/ویدیو">
              <Slider
                value={[form.blur]}
                min={0} max={24} step={2}
                onValueChange={([v]: number[]) => setForm(f => (f ? { ...f, blur: v } : f))}
              />
            </Field>

            {/* پیش‌نمایش کارت با تنظیمات فعلی */}
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">پیش‌نمایش کارت فرم</span>
              <div className="relative h-20 rounded-lg border overflow-hidden bg-gradient-to-l from-stone-300 via-stone-100 to-stone-300">
                <div
                  className="absolute inset-x-8 inset-y-3 rounded-xl border shadow-sm grid place-items-center text-xs font-bold"
                  style={{
                    backgroundColor: hexToRgba(form.color, form.transparency),
                    backdropFilter: form.blur > 0 ? `blur(${form.blur}px)` : undefined,
                    WebkitBackdropFilter: form.blur > 0 ? `blur(${form.blur}px)` : undefined,
                    color: form.textTone === 'light' || (form.textTone === 'auto' && form.bgKind !== 'none') ? '#ffffff' : undefined,
                  }}
                >
                  نمونه کارت فرم
                </div>
              </div>
            </div>

            <Field label="رنگ متن‌های فرم">
              <TextToneSelect value={form.textTone} onChange={v => setForm(f => (f ? { ...f, textTone: v } : f))} />
            </Field>

            <Field label="عنوان بالای فرم" hint="نوشته بالای فیلدها — خالی = بدون عنوان">
              <Input value={form.title} maxLength={80} onChange={e => setForm(f => (f ? { ...f, title: e.target.value } : f))} />
            </Field>
            <Field label="زیرعنوان فرم" hint="زیر عنوان فرم — حداکثر ۱۶۰ کاراکتر">
              <Input value={form.subtitle} maxLength={160} onChange={e => setForm(f => (f ? { ...f, subtitle: e.target.value } : f))} />
            </Field>
            <Field label="متن پایین فرم" hint="پس از دکمه ورود نمایش داده می‌شود — حداکثر ۲۰۰ کاراکتر">
              <Textarea rows={2} value={form.footer} maxLength={200} onChange={e => setForm(f => (f ? { ...f, footer: e.target.value } : f))} />
            </Field>

            <label className="flex items-start gap-3 cursor-pointer">
              <Switch
                checked={form.showDemo}
                onCheckedChange={v => setForm(f => (f ? { ...f, showDemo: v } : f))}
                aria-label="نمایش حساب‌های نمایشی"
              />
              <span className="text-sm">
                نمایش کادر «حساب‌های نمایشی»
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  در محیط واقعی خاموش کنید تا شماره‌ها و رمزهای نمایشی دیده نشوند.
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

      {mobile && (
        <MobileGradientSettings
          mobile={mobile}
          onPatch={patch => setMobile(m => (m ? { ...m, ...patch } : m))}
          onUpdater={fn => setMobile(m => (m ? fn(m) : m))}
        />
      )}

      <div className="rounded-lg bg-stone-50 border p-3 text-[11px] text-muted-foreground leading-6">
        پس از ذخیره، صفحه ورود با تنظیمات جدید باز می‌شود (برای مشاهده، از حساب خارج شوید یا صفحه را در حالت خروج بازخوانی کنید).
        تصاویر تا ۸ و ویدیوها تا ۵۰ مگابایت پشتیبانی می‌شوند؛ ویدیوها بی‌صدا و به‌صورت خودکار و تکرارشونده پخش می‌شوند.
        تصاویر شطرنجی به‌طور خودکار به WebP تبدیل می‌شوند (SVG، فایوآیکون و تصاویر متحرک دست‌نخورده می‌مانند).
      </div>
    </div>
  )
}

// ─── تأیید حذف مشترک ───

function ConfirmDelete({ open, title, description, busy, onCancel, onConfirm }: {
  open: boolean
  title: string
  description: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={v => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={busy}>انصراف</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white">
            {busy ? 'در حال حذف…' : 'حذف'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
