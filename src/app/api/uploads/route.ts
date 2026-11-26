// بارگذاری تصاویر — لوگو/فایوآیکون (مدیر کل و آدمین) و تصویر پروفایل (هر کاربرِ واردشده)
// multipart/form-data با فیلدهای file و kind
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handler, ok } from '@/lib/api'
import { requireAuth, requirePerm } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { saveUploadImage, saveUploadMedia } from '@/lib/uploads'

export async function POST(req: NextRequest) {
  return handler(async () => {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      throw new ApiError(400, 'BAD_FORM', 'بدنه درخواست باید multipart/form-data باشد')
    }
    const kind = String(form.get('kind') ?? '')
    const file = form.get('file')

    if (kind === 'avatar') {
      // تصویر پروفایل خود کاربر — هر کاربرِ واردشده
      const me = await requireAuth(req)
      if (!(file instanceof File)) throw new ApiError(400, 'NO_FILE', 'فایل تصویر ارسال نشده است')
      const avatarUrl = await saveUploadImage(file, 'avatars')
      const prev = await db.user.findUnique({ where: { id: me.id }, select: { avatarUrl: true } })
      await db.user.update({ where: { id: me.id }, data: { avatarUrl } })
      await audit({
        userId: me.id, action: 'user.avatar.set', entityType: 'User', entityId: me.id,
        before: { avatarUrl: prev?.avatarUrl ?? null }, after: { avatarUrl },
      })
      return ok({ kind, avatarUrl })
    }

    if (kind === 'logo' || kind === 'favicon' || kind === 'banner') {
      // هویت وب‌سایت و بنرهای فروشگاه — فقط مدیر کل / آدمین
      // فایوآیکون بدون تبدیل ذخیره می‌شود (سازگاری حداکثری مرورگرها)؛ بقیه به WebP تبدیل می‌شوند
      const user = await requirePerm(req, 'users.manage')
      if (!(file instanceof File)) throw new ApiError(400, 'NO_FILE', 'فایل تصویر ارسال نشده است')
      const url = await saveUploadImage(file, kind === 'banner' ? 'banners' : 'site', { convert: kind !== 'favicon' })
      await audit({
        userId: user.id, action: 'site.image.upload', entityType: 'Setting', entityId: `site.${kind}Url`,
        after: { url },
      })
      return ok({ kind, url })
    }

    if (kind === 'login') {
      // پس‌زمینه تصویری/ویدیویی صفحه ورود — فقط مدیر کل / آدمین
      const user = await requirePerm(req, 'users.manage')
      if (!(file instanceof File)) throw new ApiError(400, 'NO_FILE', 'فایل تصویر یا ویدیو ارسال نشده است')
      const url = await saveUploadMedia(file, 'login')
      await audit({
        userId: user.id, action: 'site.loginMedia.upload', entityType: 'Setting', entityId: 'login.*',
        after: { url, mimeType: file.type, size: file.size },
      })
      return ok({ kind, url })
    }

    throw new ApiError(400, 'BAD_KIND', 'نوع بارگذاری نامعتبر است (logo | favicon | banner | login | avatar)')
  })
}

// حذف تصویر پروفایل خود کاربر
export async function DELETE(req: NextRequest) {
  return handler(async () => {
    const me = await requireAuth(req)
    const kind = new URL(req.url).searchParams.get('kind')
    if (kind !== 'avatar') throw new ApiError(400, 'BAD_KIND', 'فقط حذف تصویر پروفایل از این مسیر مجاز است')
    const prev = await db.user.findUnique({ where: { id: me.id }, select: { avatarUrl: true } })
    await db.user.update({ where: { id: me.id }, data: { avatarUrl: null } })
    await audit({
      userId: me.id, action: 'user.avatar.remove', entityType: 'User', entityId: me.id,
      before: { avatarUrl: prev?.avatarUrl ?? null }, after: { avatarUrl: null },
    })
    return ok({ removed: true })
  })
}
