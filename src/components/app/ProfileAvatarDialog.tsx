'use client'
// گفتگوی تصویر پروفایل — هر کاربر می‌تواند تصویر خودش را بارگذاری یا حذف کند
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { apiFetch, apiUpload, optimizeImageBeforeUpload, UserAvatar } from './kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'

export default function ProfileAvatarDialog({ open, onOpenChange, user, onUpdated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  user: { id: string; name: string; avatarUrl: string | null }
  onUpdated: (avatarUrl: string | null) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // پیش‌نمایش محلی فایل انتخاب‌شده
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // با بستن گفتگو، انتخاب‌ها پاک می‌شوند
  useEffect(() => {
    if (!open) { setFile(null); setBusy(false) }
  }, [open])

  const pick = (f: File | null) => {
    if (!f) return
    if (f.size > 2 * 1024 * 1024) {
      toast.error('حجم تصویر باید حداکثر ۲ مگابایت باشد')
      return
    }
    setFile(f)
  }

  const upload = async () => {
    if (!file) return
    setBusy(true)
    try {
      const optimized = await optimizeImageBeforeUpload(file, { maxDimension: 512 })
      const form = new FormData()
      form.append('kind', 'avatar')
      form.append('file', optimized)
      const res = await apiUpload<{ avatarUrl: string }>('/api/uploads', form)
      onUpdated(res.avatarUrl)
      toast.success('تصویر پروفایل به‌روزرسانی شد')
      setFile(null)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در بارگذاری تصویر')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await apiFetch('/api/uploads?kind=avatar', { method: 'DELETE' })
      onUpdated(null)
      toast.success('تصویر پروفایل حذف شد')
      setFile(null)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در حذف تصویر')
    } finally { setBusy(false) }
  }

  const current = user.avatarUrl
  const shown = preview ?? current

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>تصویر پروفایل</DialogTitle>
          <DialogDescription>
            تصویر شما در هدر برنامه و فهرست کاربران نمایش داده می‌شود. حداکثر ۲ مگابایت؛ فرمت PNG، JPEG، WEBP، GIF یا ICO.
          </DialogDescription>
        </DialogHeader>
        <div className="grid justify-items-center gap-4 py-1">
          <UserAvatar name={user.name} avatarUrl={shown} size="h-24 w-24 text-3xl" />
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon"
            className="hidden"
            onChange={e => { pick(e.target.files?.[0] ?? null); e.target.value = '' }}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
              <ImagePlus className="h-4 w-4 ml-1" /> انتخاب تصویر
            </Button>
            {file && (
              <Button type="button" size="sm" onClick={upload} disabled={busy}>
                {busy ? 'در حال بارگذاری…' : 'بارگذاری تصویر جدید'}
              </Button>
            )}
            {current && !file && (
              <Button type="button" variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" onClick={remove} disabled={busy}>
                <Trash2 className="h-4 w-4 ml-1" /> حذف تصویر فعلی
              </Button>
            )}
          </div>
          {file && <p className="text-[11px] text-muted-foreground text-center">برای تأیید، «بارگذاری تصویر جدید» را بزنید.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
