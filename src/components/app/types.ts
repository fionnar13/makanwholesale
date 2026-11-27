// تایپ‌های مشترک سمت کلاینت
// توجه: permissions اجباری است — همه Viewها فقط با کاربر نشست کامل (پاسخ /api/auth/me) رندر می‌شوند
export type SessionUserLike = {
  id: string
  name: string
  phone: string | null
  email?: string | null
  avatarUrl?: string | null
  roles?: string[]
  roleLabels?: string[]
  permissions: string[]
}

export type ViewKeyLike =
  | 'dashboard' | 'orders' | 'customers' | 'catalog' | 'storefront' | 'inventory' | 'suppliers'
  | 'finance' | 'returns' | 'visits' | 'reports' | 'messages' | 'users'
  | 'territories' | 'audit' | 'visitor' | 'driver' | 'deliveries' | 'admin-data'

export type ProductListItem = {
  id: string
  sku: string
  name: string
  description: string | null
  categoryId: string | null
  brandId: string | null
  imageUrl: string | null
  createdAt: string
  brand: string | null
  brandConfirmed: boolean
  category: string | null
  baseUnitName: string
  weightG: number | null
  volumeMl: number | null
  packagingType: string | null
  minOrderQtyBase: number
  orderMultipleBase: number
  reorderPointBase: number
  isActive: boolean
  isDemo: boolean
  availableBase: number
  physicalBase: number
  reservedBase: number
  units: Array<{ id: string; name: string; factor: number; isBase: boolean; barcode: string | null; defaultPriceRls: number | null }>
}

export type CustomerListItem = {
  id: string
  code: string
  shopName: string
  businessType: string
  groupKey: string
  ownerName: string | null
  phone: string
  address: string | null
  creditLimitRls: number
  creditDays: number
  status: string
  isDemo: boolean
  salesRepId: string | null
  territory: string | null
  branchesCount: number
  ordersCount: number
  balanceRls: number
  remainingCreditRls: number
  createdAt: string
}

export type BranchItem = {
  id: string
  name: string
  address: string | null
  phone: string | null
  managerName: string | null
  isActive: boolean
}

export type CustomerDetail = CustomerListItem & {
  territory: { id: string; name: string } | null
  branches: BranchItem[]
  totalPurchasesRls: number
  recentOrders: Array<{ id: string; orderNo: string; status: string; totalRls: number; createdAt: string }>
  recentLedger: Array<{ id: string; entryType: string; amountRls: number; description: string | null; createdAt: string }>
}

export type OrderListItem = {
  id: string
  orderNo: string
  status: string
  statusLabel: string
  customer: { code: string; shopName: string }
  totalRls: number
  itemsCount: number
  itemsCountBase: number
  payMethod: string
  creditApproved: boolean
  createdBy: string | null
  visitor: string | null
  driver: string | null
  createdAt: string
  notes: string | null
}

export type OrderDetail = {
  id: string
  orderNo: string
  status: string
  statusLabel: string
  customer: { id: string; code: string; shopName: string; phone: string; address: string | null }
  branch: { id: string; name: string; address: string | null } | null
  payMethod: string
  totalRls: number
  notes: string | null
  createdBy: string | null
  visitor: string | null
  driver: string | null
  createdAt: string
  items: Array<{
    id: string
    productId: string
    productName: string
    unitId: string
    unitName: string
    qtyBase: number
    unitPriceRls: number
    lineTotalRls: number
    priceSnapshot: { scope?: string; unitFactor?: number }
  }>
  events: Array<{ id: string; from: string | null; to: string; user: string | null; note: string | null; createdAt: string }>
  invoice: { invoiceNo: string; totalRls: number; status: string; issuedAt: string } | null
  returns: Array<{ id: string; returnNo: string; status: string }>
}
