'use client'
// پوسته اپلیکیشن — احراز هویت، ناوبری، اعلان‌ها، جستجوی سراسری
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell, Building2, ClipboardList, FileClock, ImagePlus, LayoutDashboard, LogOut, Map, MessageSquare,
  Menu, Package, Receipt, RotateCcw, Route, Search, Store, Truck, UserCog, Warehouse, BarChart3, Smartphone, Database, Plug, Bike,
} from 'lucide-react'
import { apiFetch, JDate, useApiData, StatusBadge, SiteIdentity, UserAvatar, LogoImg, SITE_CHANGED_EVENT } from './kit'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

import Login from './Login'
import DashboardView from './DashboardView'
import OrdersView from './OrdersView'
import CustomersView from './CustomersView'
import CatalogView from './CatalogView'
import InventoryView from './InventoryView'
import SuppliersView from './SuppliersView'
import FinanceView from './FinanceView'
import ReturnsView from './ReturnsView'
import VisitsView from './VisitsView'
import ReportsView from './ReportsView'
import MessagesView from './MessagesView'
import UsersView from './UsersView'
import TerritoriesView from './TerritoriesView'
import AuditView from './AuditView'
import AdminDataView from './AdminDataView'
import IntegrationsView from './IntegrationsView'
import VisitorApp from './VisitorApp'
import DriverApp from './DriverApp'
import DeliveriesView from './DeliveriesView'
import StorefrontView from './StorefrontView'
import ProfileAvatarDialog from './ProfileAvatarDialog'

export type SessionUser = {
  id: string
  phone: string | null
  email: string | null
  name: string
  avatarUrl: string | null
  roles: string[]
  roleLabels: string[]
  permissions: string[]
}

export type ViewKey =
  | 'dashboard' | 'orders' | 'customers' | 'catalog' | 'storefront' | 'inventory' | 'suppliers'
  | 'finance' | 'returns' | 'visits' | 'reports' | 'messages' | 'users'
  | 'territories' | 'audit' | 'visitor' | 'driver' | 'deliveries' | 'admin-data' | 'integrations'

type NavItem = { key: ViewKey; label: string; icon: typeof Bell; perm?: string; roles?: string[]; tone?: keyof typeof ICON_TONE }

// رنگ اختصاصی هر آیتم سایدبار — پس‌زمینه ملایم پشت آیکون هر ایتم
const ICON_TONE = {
  emerald: 'bg-emerald-500/15 text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-400',
  sky: 'bg-sky-500/15 text-sky-400',
  rose: 'bg-rose-500/15 text-rose-400',
  violet: 'bg-violet-500/15 text-violet-400',
  teal: 'bg-teal-500/15 text-teal-400',
  indigo: 'bg-indigo-500/15 text-indigo-400',
  cyan: 'bg-cyan-500/15 text-cyan-400',
  lime: 'bg-lime-500/15 text-lime-400',
  fuchsia: 'bg-fuchsia-500/15 text-fuchsia-400',
  orange: 'bg-orange-500/15 text-orange-400',
  stone: 'bg-white/10 text-stone-300',
} as const

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'عملیات روزانه',
    items: [
      { key: 'dashboard', label: 'داشبورد', icon: LayoutDashboard, perm: 'dashboard.view', tone: 'emerald' },
      { key: 'visitor', label: 'اپ ویزیتور', icon: Smartphone, roles: ['VISITOR'], tone: 'orange' },
      { key: 'driver', label: 'اپ راننده', icon: Bike, perm: 'deliveries.view.own', tone: 'cyan' },
      { key: 'deliveries', label: 'مأموریت‌های پخش', icon: Route, perm: 'deliveries.manage', tone: 'violet' },
      { key: 'orders', label: 'سفارش‌ها', icon: ClipboardList, perm: 'orders.view', tone: 'sky' },
      { key: 'visits', label: 'بازدیدها و حضور', icon: Map, perm: 'visits.view', tone: 'teal' },
      { key: 'returns', label: 'مرجوعی کالا', icon: RotateCcw, perm: 'returns.view', tone: 'rose' },
    ],
  },
  {
    group: 'پایه و کاتالوگ',
    items: [
      { key: 'storefront', label: 'فروشگاه محصولات', icon: Store, perm: 'products.view', tone: 'amber' },
      { key: 'customers', label: 'مشتریان', icon: Building2, perm: 'customers.view', tone: 'violet' },
      { key: 'catalog', label: 'کاتالوگ محصولات', icon: Package, perm: 'products.view', tone: 'indigo' },
      { key: 'inventory', label: 'انبار و موجودی', icon: Warehouse, perm: 'inventory.view', tone: 'cyan' },
      { key: 'suppliers', label: 'تأمین‌کنندگان', icon: Truck, perm: 'suppliers.view', tone: 'lime' },
      { key: 'territories', label: 'مناطق فروش', icon: Map, perm: 'customers.view', tone: 'teal' },
    ],
  },
  {
    group: 'مالی و تحلیل',
    items: [
      { key: 'finance', label: 'مالی و حساب‌ها', icon: Receipt, perm: 'finance.view', tone: 'emerald' },
      { key: 'reports', label: 'گزارش‌ها', icon: BarChart3, perm: 'reports.view', tone: 'fuchsia' },
    ],
  },
  {
    group: 'سیستم',
    items: [
      { key: 'messages', label: 'پیام‌ها', icon: MessageSquare, perm: 'messages.use', tone: 'sky' },
      { key: 'admin-data', label: 'پنل مدیریت داده‌ها', icon: Database, perm: 'users.manage', tone: 'amber' },
      { key: 'integrations', label: 'تنظیمات یکپارچه‌سازی', icon: Plug, perm: 'users.manage', tone: 'emerald' },
      { key: 'users', label: 'کاربران و نقش‌ها', icon: UserCog, perm: 'users.manage', tone: 'violet' },
      { key: 'audit', label: 'سوابق سیستم', icon: FileClock, perm: 'audit.view', tone: 'stone' },
    ],
  },
]

const VIEW_TITLES: Record<ViewKey, string> = {
  dashboard: 'داشبورد مدیریتی',
  orders: 'سفارش‌ها',
  customers: 'مشتریان عمده',
  catalog: 'کاتالوگ محصولات',
  storefront: 'فروشگاه محصولات',
  inventory: 'انبار و موجودی',
  suppliers: 'تأمین‌کنندگان',
  finance: 'مالی و حساب‌ها',
  returns: 'مرجوعی کالا',
  visits: 'بازدیدها و حضور',
  reports: 'گزارش‌های تحلیلی',
  messages: 'پیام‌رسانی داخلی',
  users: 'کاربران و نقش‌ها',
  territories: 'مناطق فروش',
  audit: 'سوابق سیستم',
  visitor: 'اپ ویزیتور',
  driver: 'اپ راننده',
  deliveries: 'مأموریت‌های پخش',
  'admin-data': 'پنل مدیریت داده‌ها',
  integrations: 'تنظیمات یکپارچه‌سازی',
}

type SearchResult = {
  products: Array<{ id: string; name: string; sku: string }>
  customers: Array<{ id: string; shopName: string; code: string }>
  orders: Array<{ id: string; orderNo: string; status: string }>
}

type NotifItem = { id: string; type: string; title: string; body: string | null; isRead: boolean; refType: string | null; refId: string | null; createdAt: string }

export function navigate(view: ViewKey) {
  window.location.hash = `#/${view}`
}

function readHash(): ViewKey {
  const h = window.location.hash.replace(/^#\//, '') as ViewKey
  return (h in VIEW_TITLES) ? h : 'dashboard'
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [booting, setBooting] = useState(true)
  const [view, setView] = useState<ViewKey>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchRes, setSearchRes] = useState<SearchResult | null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [avatarOpen, setAvatarOpen] = useState(false)

  // هویت وب‌سایت — عمومی است؛ حتی قبل از ورود برای صفحه لاگین خوانده می‌شود
  const { data: site, reload: reloadSite } = useApiData<SiteIdentity>('/api/site-settings')

  const notifUrl = user ? `/api/notifications?take=12` : null
  const { data: notifData, reload: reloadNotif } = useApiData<{ items: NotifItem[]; unread: number }>(notifUrl)

  // نمای اولیه — ویزیتورِ بدون مجوز تأیید مستقیم وارد اپ موبایل خودش می‌شود؛
  // رانندهٔ بدون داشبورد هم مستقیم به اپ راننده می‌رود (الگوی همان بهینه‌سازی برای اپ موبایل)
  const resolveInitialView = useCallback((u: SessionUser): ViewKey => {
    const h = readHash()
    if (h !== 'dashboard') return h
    if (u.roles.includes('VISITOR') && !u.permissions.includes('orders.confirm')) return 'visitor'
    if (u.roles.includes('DRIVER') && !u.permissions.includes('dashboard.view')) return 'driver'
    return h
  }, [])

  useEffect(() => {
    apiFetch<SessionUser>('/api/auth/me')
      .then(u => {
        setUser(u)
        setView(resolveInitialView(u))
      })
      .catch(() => setUser(null))
      .finally(() => setBooting(false))
  }, [resolveInitialView])

  useEffect(() => {
    const onHash = () => setView(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // همگام‌سازی عنوان و فایوآیکون تب مرورگر با تنظیمات وب‌سایت
  useEffect(() => {
    if (!site) return
    document.title = site.name
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = site.faviconUrl || '/logo.svg'
  }, [site])

  // پس از ذخیره تنظیمات در پنل مدیریت، هویت بلافاصله به‌روز می‌شود
  useEffect(() => {
    const onChange = () => reloadSite()
    window.addEventListener(SITE_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SITE_CHANGED_EVENT, onChange)
  }, [reloadSite])

  // اعلان‌ها — polling سبک هر ۲۰ ثانیه
  useEffect(() => {
    if (!user) return
    const t = setInterval(() => reloadNotif(), 20000)
    return () => clearInterval(t)
  }, [user, reloadNotif])

  const go = useCallback((v: ViewKey) => {
    setView(v)
    window.location.hash = `#/${v}`
    setSidebarOpen(false)
    setSearchOpen(false)
  }, [])

  // پس از ورود موفق — نشست را از سرور می‌گیریم؛ در صورت مسدود بودن کوکی پیام راهنما نمایش داده می‌شود
  const establishSession = useCallback(() => {
    const tryMe = () => apiFetch<SessionUser>('/api/auth/me')
    // یک تلاش مجدد خودکار با تأخیر کوتاه (برای تأخیر ذخیره کوکی در برخی مرورگرها)
    tryMe()
      .catch(() => new Promise<SessionUser>((resolve, reject) =>
        setTimeout(() => tryMe().then(resolve, reject), 600)
      ))
      .then(u => {
        setLoginError(null)
        setUser(u)
        setView(resolveInitialView(u))
      })
      .catch(() => {
        setLoginError('ورود انجام شد اما نشست در مرورگر ذخیره نشد (کوکی‌ها مسدود شده‌اند). لینک برنامه را در یک تب جدید باز کنید و دوباره وارد شوید، یا کوکی‌ها را برای این سایت مجاز کنید.')
      })
  }, [resolveInitialView])

  const logout = async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
    setUser(null)
    setLoginError(null)
    toast.success('خارج شدید')
  }

  // جستجوی سراسری — نتیجه فقط به‌صورت async تنظیم می‌شود
  const searchActive = searchOpen && searchQ.trim().length >= 2
  useEffect(() => {
    if (!searchActive) return
    const t = setTimeout(() => {
      Promise.all([
        apiFetch<SearchResult['products']>(`/api/products?q=${encodeURIComponent(searchQ)}`).catch(() => []),
        apiFetch<SearchResult['customers']>(`/api/customers?q=${encodeURIComponent(searchQ)}`).catch(() => []),
        apiFetch<SearchResult['orders']>(`/api/orders?take=50`).catch(() => []),
      ]).then(([products, customers, orders]) => {
        setSearchRes({
          products: products.slice(0, 4),
          customers: customers.slice(0, 4),
          orders: (orders as SearchResult['orders']).filter(o => o.orderNo.includes(searchQ.trim())).slice(0, 4),
        })
      })
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ, searchActive])

  const visibleNav = useMemo(() => {
    if (!user) return []
    return NAV
      .map(g => ({
        ...g,
        items: g.items.filter(it =>
          it.roles ? it.roles.some(r => (user.roles ?? []).includes(r)) : it.perm ? (user.permissions ?? []).includes(it.perm) : true
        ),
      }))
      .filter(g => g.items.length > 0)
  }, [user])

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="h-10 w-10 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin" aria-hidden />
      </div>
    )
  }

  if (!user) {
    return (
      <Login
        site={site}
        authError={loginError}
        onRetry={establishSession}
        onSuccess={establishSession}
      />
    )
  }

  const notifs = notifData?.items ?? []
  const unread = notifData?.unread ?? 0

  const renderView = () => {
    switch (view) {
      case 'dashboard': return <DashboardView user={user} go={go} />
      case 'orders': return <OrdersView user={user} />
      case 'customers': return <CustomersView user={user} />
      case 'catalog': return <CatalogView user={user} go={go} />
      case 'storefront': return <StorefrontView user={user} />
      case 'inventory': return <InventoryView user={user} />
      case 'suppliers': return <SuppliersView user={user} />
      case 'finance': return <FinanceView user={user} />
      case 'returns': return <ReturnsView user={user} />
      case 'visits': return <VisitsView user={user} />
      case 'reports': return <ReportsView />
      case 'messages': return <MessagesView user={user} />
      case 'users': return <UsersView user={user} />
      case 'territories': return <TerritoriesView user={user} />
      case 'audit': return <AuditView user={user} />
      case 'admin-data': return <AdminDataView user={user} go={go} />
      case 'integrations': return <IntegrationsView user={user} />
      case 'visitor': return <VisitorApp user={user} go={go} />
      case 'driver': return <DriverApp user={user} go={go} />
      case 'deliveries': return <DeliveriesView user={user} />
      default: return <DashboardView user={user} go={go} />
    }
  }

  return (
    // قاب ثابت صفحه — اسکرول هر منطقه (سایدبار/محتوا) مستقل است و نوار پیمایش در هیچ‌کدام دیده نمی‌شود
    <div className="h-dvh overflow-hidden flex flex-col bg-stone-100">
      {/* هدر */}
      <header className="sticky top-0 z-40 h-14 bg-sidebar text-sidebar-foreground shadow-sm flex items-center gap-3 px-3 md:px-5">
        {/* منوی موبایل */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <button className="lg:hidden p-2 rounded-md hover:bg-sidebar-accent" aria-label="باز کردن منو">
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="bg-sidebar text-sidebar-foreground border-sidebar-border p-0 w-72 flex flex-col overflow-hidden scrollbar-none">
            <SheetTitle className="px-4 pt-5 text-lg font-bold">{site?.name ?? 'بنکداری هوشمند'}</SheetTitle>
            <SidebarNav user={user} nav={visibleNav} view={view} go={go} />
          </SheetContent>
        </Sheet>

        <button onClick={() => go('dashboard')} className="flex items-center gap-2 text-base font-bold" title={site?.slogan ?? undefined}>
          <LogoImg
            src={site?.logoUrl}
            alt={site?.name ?? 'لوگو'}
            className="h-8 w-8 rounded-lg object-cover"
            fallback={<span className="grid place-items-center h-8 w-8 rounded-lg bg-primary text-primary-foreground text-sm font-black">ب</span>}
          />
          <span className="hidden sm:block">{site?.name ?? 'بنکداری هوشمند'}</span>
        </button>

        <nav aria-label="مسیر" className="hidden md:flex items-center gap-1.5 text-sm text-sidebar-foreground/70 mr-4">
          <span>خانه</span>
          <span aria-hidden>/</span>
          <span className="text-sidebar-foreground font-medium">{VIEW_TITLES[view]}</span>
        </nav>

        <div className="flex-1" />

        {/* جستجوی سراسری */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 h-9 text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground"
          aria-label="جستجوی سراسری"
        >
          <Search className="h-4 w-4" />
          <span className="hidden md:block text-xs">جستجو…</span>
        </button>

        {/* اعلان‌ها */}
        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
          <PopoverTrigger asChild>
            <button className="relative p-2 rounded-md hover:bg-sidebar-accent" aria-label="اعلان‌ها">
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -left-0.5 grid place-items-center h-5 min-w-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                  {unread}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-bold text-sm">اعلان‌ها</span>
              {unread > 0 && (
                <button
                  className="text-xs text-emerald-700 hover:underline"
                  onClick={async () => { await apiFetch('/api/notifications', { method: 'POST', body: JSON.stringify({ all: true }) }).catch(() => null); reloadNotif() }}
                >
                  علامت‌گذاری همه به‌عنوان خوانده‌شده
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto divide-y">
              {notifs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">اعلانی وجود ندارد</p>}
              {notifs.map(n => (
                <button
                  key={n.id}
                  className={`w-full text-right px-4 py-3 hover:bg-stone-50 ${!n.isRead ? 'bg-emerald-50/60' : ''}`}
                  onClick={async () => {
                    await apiFetch('/api/notifications', { method: 'POST', body: JSON.stringify({ ids: [n.id] }) }).catch(() => null)
                    reloadNotif()
                    if (n.refType === 'ORDER') go('orders')
                    else if (n.refType === 'RETURN') go('returns')
                    else if (n.refType === 'MESSAGE') go('messages')
                  }}
                >
                  <div className="flex items-center gap-2">
                    {!n.isRead && <span className="h-2 w-2 rounded-full bg-emerald-600 shrink-0" aria-hidden />}
                    <span className="text-sm font-medium">{n.title}</span>
                    <span className="text-[10px] text-muted-foreground mr-auto shrink-0"><JDate d={n.createdAt} time /></span>
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.body}</p>}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* حساب کاربری */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2 h-9 hover:bg-sidebar-accent" aria-label="حساب کاربری">
              <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="h-7 w-7 text-xs" />
              <span className="hidden md:block text-sm max-w-40 truncate">{user.name}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="flex items-center gap-2.5">
                <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="h-10 w-10 text-base" />
                <div className="min-w-0">
                  <div className="font-bold truncate">{user.name}</div>
                  <div className="text-xs text-muted-foreground font-normal mt-0.5" dir="ltr">{user.phone ?? user.email ?? '—'}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {user.roleLabels.map(l => <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>)}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setAvatarOpen(true)}>
              <ImagePlus className="h-4 w-4" /> تصویر پروفایل…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-rose-600 focus:text-rose-600">
              <LogOut className="h-4 w-4" /> خروج از حساب
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* سایدبار دسکتاپ — مستقل از محتوا؛ فقط خودش در صورت نیاز اسکرول نامرئی دارد */}
        <aside className="hidden lg:flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground overflow-hidden">
          <SidebarNav user={user} nav={visibleNav} view={view} go={go} />
        </aside>

        {/* محتوا — اسکرول مستقل از سایدبار و بدون نوار پیمایش مرئی */}
        <main className="flex-1 min-w-0 overflow-y-auto scrollbar-none">
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            {renderView()}
            <footer className="mt-auto pt-8 pb-4 text-center text-xs text-stone-400">
              بنکداری هوشمند — سامانه مدیریت B2B بنکداری مواد غذایی | داده‌های کاتالوگ اولیه دارای نشان DEMO_SEED هستند
            </footer>
          </div>
        </main>
      </div>

      {/* جستجوی سراسری */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="p-0 max-w-xl" dir="rtl">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm sr-only">جستجوی سراسری</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-2 -mt-8">
            <Input autoFocus placeholder="جستجوی کالا، مشتری یا شماره سفارش…" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          </div>
          <div className="max-h-80 overflow-y-auto px-2 pb-3 text-sm">
            {searchRes && searchActive && (
              <>
                {searchRes.customers.length > 0 && (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">مشتریان</div>
                )}
                {searchRes.customers.map(c => (
                  <button key={c.id} onClick={() => go('customers')} className="w-full text-right px-3 py-2 rounded-lg hover:bg-stone-100">
                    <Building2 className="inline h-3.5 w-3.5 ml-1.5 text-stone-400" /> {c.shopName} <span className="text-xs text-muted-foreground">({c.code})</span>
                  </button>
                ))}
                {searchRes.products.length > 0 && (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground mt-1">کالاها</div>
                )}
                {searchRes.products.map(p => (
                  <button key={p.id} onClick={() => go('catalog')} className="w-full text-right px-3 py-2 rounded-lg hover:bg-stone-100">
                    <Package className="inline h-3.5 w-3.5 ml-1.5 text-stone-400" /> {p.name} <span className="text-xs text-muted-foreground" dir="ltr">({p.sku})</span>
                  </button>
                ))}
                {searchRes.orders.length > 0 && (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground mt-1">سفارش‌ها</div>
                )}
                {searchRes.orders.map(o => (
                  <button key={o.id} onClick={() => go('orders')} className="w-full text-right px-3 py-2 rounded-lg hover:bg-stone-100">
                    <ClipboardList className="inline h-3.5 w-3.5 ml-1.5 text-stone-400" /> {o.orderNo} <StatusBadge status={o.status} />
                  </button>
                ))}
                {searchQ.trim().length >= 2 && !searchRes.customers.length && !searchRes.products.length && !searchRes.orders.length && (
                  <p className="text-center text-muted-foreground py-6">نتیجه‌ای یافت نشد</p>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* گفتگوی تصویر پروفایل */}
      <ProfileAvatarDialog
        open={avatarOpen}
        onOpenChange={setAvatarOpen}
        user={user}
        onUpdated={avatarUrl => setUser(u => (u ? { ...u, avatarUrl } : u))}
      />
    </div>
  )
}

function SidebarNav({ user, nav, view, go }: { user: SessionUser; nav: Array<{ group: string; items: NavItem[] }>; view: ViewKey; go: (v: ViewKey) => void }) {
  return (
    <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-none py-4 px-3 flex flex-col gap-5" aria-label="منوی اصلی">
      {nav.map(g => (
        <div key={g.group}>
          <div className="px-2 pb-1.5 text-[10px] font-bold text-sidebar-foreground/50 tracking-wide">{g.group}</div>
          <div className="grid gap-0.5">
            {g.items.map(it => {
              const Icon = it.icon
              const active = view === it.key
              return (
                <button
                  key={it.key}
                  onClick={() => go(it.key)}
                  aria-current={active ? 'page' : undefined}
                  title={it.label}
                  className={`group flex items-center gap-2.5 rounded-lg px-2 h-10 text-sm transition-colors ${
                    active ? 'bg-primary text-primary-foreground font-medium' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                  }`}
                >
                  {/* آیکون هر ایتم در قاب رنگی اختصاصی */}
                  <span
                    aria-hidden
                    className={`grid place-items-center h-7 w-7 rounded-lg shrink-0 transition-colors ${
                      active
                        ? 'bg-white/20 text-white'
                        : (ICON_TONE[it.tone ?? 'stone'] ?? ICON_TONE.stone) + ' group-hover:bg-sidebar-accent'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{it.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="mt-auto px-2 pt-4 text-[10px] text-sidebar-foreground/40">
        {user.name} — {user.roleLabels.join('، ')}
      </div>
    </nav>
  )
}

export { NAV, VIEW_TITLES }
export type { NavItem }
