'use client'
// تأمین‌کنندگان — تولیدکننده/واردکننده/بازرگانی + مانده حساب
import { useState } from 'react'
import { apiFetch, useApiData, DataTable, Money, PageHeader, Field, formatFaNumber } from './kit'
import type { SessionUserLike } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SUPPLIER_TYPE_LABELS } from '@/lib/format'

type Supplier = {
  id: string; code: string; name: string; type: string
  phone: string | null; contactName: string | null; address: string | null
  terms: string | null; status: string; isDemo: boolean
  balanceRls: number; lotsCount: number; paymentsCount: number
}

export default function SuppliersView({ user }: { user: SessionUserLike }) {
  const [createOpen, setCreateOpen] = useState(false)
  const { data, loading, error, reload } = useApiData<Supplier[]>('/api/suppliers')
  const canManage = user.permissions.includes('suppliers.manage')

  return (
    <div>
      <PageHeader
        title="تأمین‌کنندگان"
        desc="تولیدکنندگان، واردکنندگان و بازرگانی‌ها — مانده حساب از Ledger تأمین‌کننده"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="h-4 w-4 ml-1" /> به‌روزرسانی</Button>
            {canManage && <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 ml-1" /> تأمین‌کننده جدید</Button>}
          </>
        }
      />

      {error ? (
        <p className="text-sm text-rose-600 py-6 text-center">{error}</p>
      ) : (
        <DataTable
          columns={[
            { key: 'code', header: 'کد', cell: (s: Supplier) => <span className="font-mono text-xs" dir="ltr">{s.code}</span> },
            {
              key: 'name', header: 'نام', cell: (s: Supplier) => (
                <div>
                  <div className="text-sm font-medium">{s.name} {s.isDemo && <Badge variant="outline" className="text-[9px]">DEMO</Badge>}</div>
                  <div className="text-[11px] text-muted-foreground">{s.contactName ?? '—'} | <span dir="ltr">{s.phone ?? '—'}</span></div>
                </div>
              ),
            },
            { key: 'type', header: 'نوع', cell: (s: Supplier) => <Badge variant="secondary" className="text-[10px]">{SUPPLIER_TYPE_LABELS[s.type] ?? s.type}</Badge> },
            { key: 'lots', header: 'لات‌ها', cell: (s: Supplier) => <span className="text-xs">{formatFaNumber(s.lotsCount)}</span> },
            { key: 'balance', header: 'مانده بدهی ما', cell: (s: Supplier) => <Money rls={s.balanceRls} className={`text-sm font-bold ${s.balanceRls > 0 ? 'text-amber-700' : 'text-emerald-700'}`} /> },
            { key: 'status', header: 'وضعیت', cell: (s: Supplier) => <span className="text-xs">{s.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}</span> },
          ]}
          rows={data ?? []}
          loading={loading}
          rowKey={(s: Supplier) => s.id}
          empty="تأمین‌کننده‌ای ثبت نشده است"
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>تأمین‌کننده جدید</DialogTitle><DialogDescription>کد به‌صورت خودکار تولید می‌شود.</DialogDescription></DialogHeader>
          <CreateSupplier onDone={() => { setCreateOpen(false); reload() }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreateSupplier({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', type: 'PRODUCER', phone: '', contactName: '', address: '', terms: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name) { toast.error('نام الزامی است'); return }
    setBusy(true)
    try {
      await apiFetch('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name, type: form.type,
          phone: form.phone || null, contactName: form.contactName || null,
          address: form.address || null, terms: form.terms || null,
        }),
      })
      toast.success('تأمین‌کننده ثبت شد')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت ناموفق بود')
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3">
      <Field label="نام" required><Input value={form.name} onChange={e => set('name', e.target.value)} /></Field>
      <Field label="نوع">
        <Select value={form.type} onValueChange={v => set('type', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="PRODUCER">تولیدکننده</SelectItem>
            <SelectItem value="IMPORTER">واردکننده</SelectItem>
            <SelectItem value="WHOLESALER">بازرگانی/عمده‌فروش</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="تلفن"><Input dir="ltr" value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="نام رابط"><Input value={form.contactName} onChange={e => set('contactName', e.target.value)} /></Field>
      </div>
      <Field label="آدرس"><Input value={form.address} onChange={e => set('address', e.target.value)} /></Field>
      <Field label="شرایط همکاری"><Input value={form.terms} onChange={e => set('terms', e.target.value)} placeholder="مثلاً تسویه ۳۰ روزه" /></Field>
      <Button onClick={submit} disabled={busy}>{busy ? 'در حال ثبت…' : 'ثبت'}</Button>
    </div>
  )
}
