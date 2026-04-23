/**
 * Adapters to convert between Supabase DB rows (snake_case) and
 * frontend types (camelCase with embedded objects).
 *
 * These adapters allow the entire existing UI to remain unchanged —
 * components still receive the same typed props they always did.
 */

import type {
  Product, HoReCa, User, Supplier, Order, OrderItem, PurchaseOrder,
  Invoice, Promotion, ScheduledVisit, Visit, SalesTarget, AppSettings,
  AppNotification, PantryItem, PaymentMethod, StatusHistoryEntry,
  OrderVerification, AppliedPromotion, ScheduledVisitStop, ScheduledVisitChangeRequest,
  RecurrenceRule, BogoConfig, BundleConfig, PromotionScope,
  PromotionTargeting, OrderStatus, DeliveryTimeSlot, PurchaseOrderItem,
} from '@/types'
import type { Database } from './database.types'
import { numericIdToUuid, uuidToNumericId } from './userIdMap'

// ── DB Row types ──────────────────────────────────────────────────
type ProductRow = Database['public']['Tables']['products']['Row']
type HoReCaRow = Database['public']['Tables']['horecas']['Row']
type SupplierRow = Database['public']['Tables']['suppliers']['Row']
type OrderRow = Database['public']['Tables']['orders']['Row']
type OrderItemRow = Database['public']['Tables']['order_items']['Row']
type InvoiceRow = Database['public']['Tables']['invoices']['Row']
type PromotionRow = Database['public']['Tables']['promotions']['Row']
type RouteRow = Database['public']['Tables']['scheduled_visits']['Row']
type VisitRow = Database['public']['Tables']['visits']['Row']
type SalesTargetRow = Database['public']['Tables']['sales_targets']['Row']
type SettingsRow = Database['public']['Tables']['app_settings']['Row']
type NotificationRow = Database['public']['Tables']['notifications']['Row']
type PantryRow = Database['public']['Tables']['pantry_items']['Row']
type PurchaseOrderRow = Database['public']['Tables']['purchase_orders']['Row']
type PurchaseOrderItemRow = Database['public']['Tables']['purchase_order_items']['Row']
type HoReCaPricingRow = Database['public']['Tables']['horeca_pricing']['Row']
type PaymentMethodRow = Database['public']['Tables']['horeca_payment_methods']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']

// ── Product ───────────────────────────────────────────────────────

export function toProduct(row: ProductRow & { suppliers?: { name: string } | null }): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description ?? '',
    price: Number(row.price),
    category: row.category as Product['category'],
    inventory: row.inventory,
    imageUrl: row.image_url ?? undefined,
    unit: row.unit,
    cartonSize: row.carton_size,
    dietaryLabels: row.dietary_labels ?? undefined,
    supplierId: row.supplier_id,
    cubicMetersUnit: row.cubic_meters_unit != null ? Number(row.cubic_meters_unit) : undefined,
    cubicMetersCarton: row.cubic_meters_carton != null ? Number(row.cubic_meters_carton) : undefined,
    lengthCm: row.length_cm != null ? Number(row.length_cm) : undefined,
    widthCm: row.width_cm != null ? Number(row.width_cm) : undefined,
    heightCm: row.height_cm != null ? Number(row.height_cm) : undefined,
  }
}

export function fromProduct(p: Partial<Product>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.sku !== undefined) row.sku = p.sku
  if (p.name !== undefined) row.name = p.name
  if (p.description !== undefined) row.description = p.description
  if (p.price !== undefined) row.price = p.price
  if (p.category !== undefined) row.category = p.category
  if (p.inventory !== undefined) row.inventory = p.inventory
  if (p.imageUrl !== undefined) row.image_url = p.imageUrl
  if (p.unit !== undefined) row.unit = p.unit
  if (p.cartonSize !== undefined) row.carton_size = p.cartonSize
  if (p.dietaryLabels !== undefined) row.dietary_labels = p.dietaryLabels
  if (p.supplierId !== undefined) row.supplier_id = p.supplierId
  if (p.cubicMetersUnit !== undefined) row.cubic_meters_unit = p.cubicMetersUnit
  if (p.cubicMetersCarton !== undefined) row.cubic_meters_carton = p.cubicMetersCarton
  if (p.lengthCm !== undefined) row.length_cm = p.lengthCm
  if (p.widthCm !== undefined) row.width_cm = p.widthCm
  if (p.heightCm !== undefined) row.height_cm = p.heightCm
  return row
}

// ── Supplier ──────────────────────────────────────────────────────

export function toSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
  }
}

export function fromSupplier(s: Partial<Supplier>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (s.name !== undefined) row.name = s.name
  if (s.contactPerson !== undefined) row.contact_person = s.contactPerson
  if (s.email !== undefined) row.email = s.email
  if (s.phone !== undefined) row.phone = s.phone
  return row
}

// ── HoReCa ────────────────────────────────────────────────────────

export function toHoReCa(
  row: HoReCaRow & {
    horeca_pricing?: HoReCaPricingRow[] | null
    horeca_payment_methods?: PaymentMethodRow[] | null
  }
): HoReCa {
  const pricing: Record<number, number> | undefined =
    row.horeca_pricing && row.horeca_pricing.length > 0
      ? Object.fromEntries(row.horeca_pricing.map(p => [p.product_id, Number(p.custom_price)]))
      : undefined

  const paymentMethods: PaymentMethod[] | undefined =
    row.horeca_payment_methods && row.horeca_payment_methods.length > 0
      ? row.horeca_payment_methods.map(pm => ({
          id: pm.id,
          type: pm.type as PaymentMethod['type'],
          details: pm.details,
          isDefault: pm.is_default,
        }))
      : undefined

  return {
    id: row.id,
    name: row.name,
    address: row.address,
    pricing,
    paymentMethods,
    creditLimit: row.credit_limit != null ? Number(row.credit_limit) : undefined,
    discountPercent: row.discount_percent != null ? Number(row.discount_percent) : undefined,
    showStockTab: row.show_stock_tab ?? undefined,
    tier: (row.tier as HoReCa['tier']) ?? undefined,
    lat: row.lat != null ? Number(row.lat) : undefined,
    lng: row.lng != null ? Number(row.lng) : undefined,
    isTemporary: row.is_temporary ?? false,
    createdByUserId: row.created_by_user_id != null ? uuidToNumericId(row.created_by_user_id) : undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedByUserId: row.reviewed_by != null ? uuidToNumericId(row.reviewed_by) : undefined,
  }
}

export function fromHoReCa(h: Partial<HoReCa>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (h.name !== undefined) row.name = h.name
  if (h.address !== undefined) row.address = h.address
  if (h.creditLimit !== undefined) row.credit_limit = h.creditLimit
  if (h.discountPercent !== undefined) row.discount_percent = h.discountPercent
  if (h.showStockTab !== undefined) row.show_stock_tab = h.showStockTab
  if (h.tier !== undefined) row.tier = h.tier
  if (h.lat !== undefined) row.lat = h.lat
  if (h.lng !== undefined) row.lng = h.lng
  if (h.isTemporary !== undefined) row.is_temporary = h.isTemporary
  if (h.createdByUserId !== undefined) row.created_by_user_id = numericIdToUuid(h.createdByUserId)
  if (h.reviewedAt !== undefined) row.reviewed_at = h.reviewedAt
  if (h.reviewedByUserId !== undefined) row.reviewed_by = numericIdToUuid(h.reviewedByUserId)
  return row
}

// ── User / Profile ────────────────────────────────────────────────

export function toUser(row: ProfileRow): User {
  return {
    id: row.id as unknown as number, // frontend uses numeric IDs but DB uses UUID
    name: row.name,
    email: row.email,
    role: row.role as User['role'],
    avatarUrl: row.avatar_url ?? undefined,
    hoReCaId: row.horeca_id ?? undefined,
  }
}

// ── Order ─────────────────────────────────────────────────────────

export function toOrder(
  row: OrderRow & { order_items?: OrderItemRow[] | null },
  hoReCas: HoReCa[],
  users: User[],
  products: Product[],
): Order {
  const hoReCa = hoReCas.find(h => h.id === row.horeca_id) ?? {
    id: row.horeca_id,
    name: 'Unknown',
    address: '',
  } as HoReCa

  const submittedBy = users.find(u => String(u.id) === row.submitted_by) ?? {
    id: 0,
    name: 'Unknown',
    email: '',
    role: 'Admin' as const,
  } as User

  const items: OrderItem[] = (row.order_items ?? []).map(oi => {
    const product = products.find(p => p.id === oi.product_id)
    return {
      ...(product ?? {
        id: oi.product_id,
        sku: oi.product_sku,
        name: oi.product_name,
        description: '',
        price: Number(oi.unit_price),
        category: 'Other' as const,
        inventory: 0,
        unit: '',
        cartonSize: 1,
        supplierId: 1,
      }),
      quantity: oi.quantity,
      packSize: oi.pack_size ?? undefined,
      price: Number(oi.unit_price),
    } as OrderItem
  })

  return {
    id: row.id,
    hoReCa,
    submittedBy,
    items,
    total: Number(row.total),
    orderDate: row.order_date,
    notes: row.notes ?? undefined,
    status: row.status as OrderStatus,
    statusHistory: (row.status_history ?? []) as StatusHistoryEntry[],
    deliveryDate: row.delivery_date ?? undefined,
    deliveryTimeSlot: (row.delivery_time_slot as DeliveryTimeSlot) ?? undefined,
    verification: (row.verification as OrderVerification) ?? undefined,
    appliedPromotions: (row.applied_promotions as AppliedPromotion[]) ?? undefined,
  }
}

// ── Invoice ───────────────────────────────────────────────────────

export function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    orderId: row.order_id,
    hoReCaId: row.horeca_id,
    hoReCaName: row.horeca_name,
    amount: Number(row.amount),
    dueDate: row.due_date,
    status: row.status as Invoice['status'],
    paidDate: row.paid_date ?? undefined,
    createdDate: row.created_date,
  }
}

export function fromInvoice(inv: Partial<Invoice>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (inv.orderId !== undefined) row.order_id = inv.orderId
  if (inv.hoReCaId !== undefined) row.horeca_id = inv.hoReCaId
  if (inv.hoReCaName !== undefined) row.horeca_name = inv.hoReCaName
  if (inv.amount !== undefined) row.amount = inv.amount
  if (inv.dueDate !== undefined) row.due_date = inv.dueDate
  if (inv.status !== undefined) row.status = inv.status
  if (inv.paidDate !== undefined) row.paid_date = inv.paidDate
  if (inv.createdDate !== undefined) row.created_date = inv.createdDate
  return row
}

// ── PurchaseOrder ─────────────────────────────────────────────────

export function toPurchaseOrder(
  row: PurchaseOrderRow & { purchase_order_items?: PurchaseOrderItemRow[] | null },
  suppliers: Supplier[],
  users: User[],
): PurchaseOrder {
  const supplier = suppliers.find(s => s.id === row.supplier_id) ?? {
    id: row.supplier_id,
    name: 'Unknown',
    contactPerson: '',
    email: '',
    phone: '',
  }

  const submittedBy = users.find(u => String(u.id) === row.submitted_by) ?? {
    id: 0, name: 'Unknown', email: '', role: 'Admin' as const,
  } as User

  return {
    id: row.id,
    supplier,
    items: (row.purchase_order_items ?? []).map(i => ({
      productId: i.product_id,
      productName: i.product_name,
      quantity: i.quantity,
      cost: Number(i.cost),
    })),
    total: Number(row.total),
    orderDate: row.order_date,
    status: row.status as PurchaseOrder['status'],
    submittedBy,
  }
}

// ── Promotion ─────────────────────────────────────────────────────

export function toPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    type: row.type as Promotion['type'],
    percentOff: row.percent_off != null ? Number(row.percent_off) : undefined,
    fixedPrice: row.fixed_price != null ? Number(row.fixed_price) : undefined,
    bogoConfig: (row.bogo_config as BogoConfig) ?? undefined,
    bundleConfig: (row.bundle_config as BundleConfig) ?? undefined,
    clearancePercent: row.clearance_percent != null ? Number(row.clearance_percent) : undefined,
    scope: row.scope as PromotionScope,
    targeting: row.targeting as PromotionTargeting,
    minOrderValue: row.min_order_value != null ? Number(row.min_order_value) : undefined,
    stackWithHoReCaPricing: row.stack_with_horeca_pricing,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    createdBy: Number(row.created_by) || 0,
    priority: row.priority,
  }
}

export function fromPromotion(p: Partial<Promotion>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.name !== undefined) row.name = p.name
  if (p.description !== undefined) row.description = p.description
  if (p.type !== undefined) row.type = p.type
  if (p.percentOff !== undefined) row.percent_off = p.percentOff
  if (p.fixedPrice !== undefined) row.fixed_price = p.fixedPrice
  if (p.bogoConfig !== undefined) row.bogo_config = p.bogoConfig
  if (p.bundleConfig !== undefined) row.bundle_config = p.bundleConfig
  if (p.clearancePercent !== undefined) row.clearance_percent = p.clearancePercent
  if (p.scope !== undefined) row.scope = p.scope
  if (p.targeting !== undefined) row.targeting = p.targeting
  if (p.minOrderValue !== undefined) row.min_order_value = p.minOrderValue
  if (p.stackWithHoReCaPricing !== undefined) row.stack_with_horeca_pricing = p.stackWithHoReCaPricing
  if (p.startDate !== undefined) row.start_date = p.startDate
  if (p.endDate !== undefined) row.end_date = p.endDate
  if (p.isActive !== undefined) row.is_active = p.isActive
  if (p.priority !== undefined) row.priority = p.priority
  return row
}

// ── ScheduledVisit ─────────────────────────────────────────────────────────

export function toScheduledVisit(row: RouteRow): ScheduledVisit {
  return {
    id: row.id,
    name: row.name,
    date: row.date ?? '',
    stops: (row.stops ?? []) as ScheduledVisitStop[],
    status: row.status as ScheduledVisit['status'],
    createdBy: uuidToNumericId(row.created_by),
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    assignedTo: row.assigned_to != null ? uuidToNumericId(row.assigned_to) : undefined,
    assignedBy: row.assigned_by != null ? uuidToNumericId(row.assigned_by) : undefined,
    assignedAt: row.assigned_at ?? undefined,
    isTemplate: row.is_template ?? undefined,
    templateId: row.template_id ?? undefined,
    recurrence: (row.recurrence as RecurrenceRule) ?? undefined,
    changeRequests: (row.change_requests ?? []) as ScheduledVisitChangeRequest[],
  }
}

export function fromScheduledVisit(r: Partial<ScheduledVisit>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (r.id !== undefined) row.id = r.id
  if (r.name !== undefined) row.name = r.name
  if (r.date !== undefined) row.date = r.date || null
  if (r.stops !== undefined) row.stops = r.stops
  if (r.status !== undefined) row.status = r.status
  if (r.createdBy !== undefined) row.created_by = numericIdToUuid(r.createdBy)
  if (r.createdAt !== undefined) row.created_at = r.createdAt
  if (r.completedAt !== undefined) row.completed_at = r.completedAt
  if (r.assignedTo !== undefined) row.assigned_to = numericIdToUuid(r.assignedTo)
  if (r.assignedBy !== undefined) row.assigned_by = numericIdToUuid(r.assignedBy)
  if (r.assignedAt !== undefined) row.assigned_at = r.assignedAt
  if (r.isTemplate !== undefined) row.is_template = r.isTemplate
  if (r.templateId !== undefined) row.template_id = r.templateId
  if (r.recurrence !== undefined) row.recurrence = r.recurrence
  if (r.changeRequests !== undefined) row.change_requests = r.changeRequests
  return row
}

// ── Visit ─────────────────────────────────────────────────────────

export function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    hoReCaId: row.horeca_id,
    userId: Number(row.user_id) || 0,
    scheduledVisitId: row.scheduled_visit_id ?? undefined,
    arrivalTime: row.arrival_time,
    departureTime: row.departure_time ?? undefined,
    outcome: (row.outcome as Visit['outcome']) ?? undefined,
    notes: row.notes ?? undefined,
    competitorNotes: row.competitor_notes ?? undefined,
    stockCheckNotes: row.stock_check_notes ?? undefined,
    nextVisitRecommendation: row.next_visit_recommendation ?? undefined,
    photos: row.photos ?? [],
    createdAt: row.created_at,
  }
}

// ── SalesTarget ───────────────────────────────────────────────────

export function toSalesTarget(row: SalesTargetRow): SalesTarget {
  return {
    id: row.id,
    userId: Number(row.user_id) || 0,
    type: row.type as SalesTarget['type'],
    targetValue: Number(row.target_value),
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  }
}

// ── AppSettings ───────────────────────────────────────────────────

export function toAppSettings(row: SettingsRow): AppSettings {
  return {
    companyName: row.company_name,
    companyAddress: row.company_address,
    companyPhone: row.company_phone,
    companyEmail: row.company_email,
    orderIdPrefix: row.order_id_prefix,
    minimumOrderValue: Number(row.minimum_order_value),
    defaultCreditLimit: Number(row.default_credit_limit),
    cartonDiscountPercent: Number(row.carton_discount_percent),
    lowStockThreshold: row.low_stock_threshold,
    currency: row.currency,
    showStockToHoReCa: row.show_stock_to_horeca,
    companyLogoUrl: row.company_logo_url,
  }
}

export function fromAppSettings(s: Partial<AppSettings>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (s.companyName !== undefined) row.company_name = s.companyName
  if (s.companyAddress !== undefined) row.company_address = s.companyAddress
  if (s.companyPhone !== undefined) row.company_phone = s.companyPhone
  if (s.companyEmail !== undefined) row.company_email = s.companyEmail
  if (s.orderIdPrefix !== undefined) row.order_id_prefix = s.orderIdPrefix
  if (s.minimumOrderValue !== undefined) row.minimum_order_value = s.minimumOrderValue
  if (s.defaultCreditLimit !== undefined) row.default_credit_limit = s.defaultCreditLimit
  if (s.cartonDiscountPercent !== undefined) row.carton_discount_percent = s.cartonDiscountPercent
  if (s.lowStockThreshold !== undefined) row.low_stock_threshold = s.lowStockThreshold
  if (s.currency !== undefined) row.currency = s.currency
  if (s.showStockToHoReCa !== undefined) row.show_stock_to_horeca = s.showStockToHoReCa
  if (s.companyLogoUrl !== undefined) row.company_logo_url = s.companyLogoUrl
  return row
}

// ── Notification ──────────────────────────────────────────────────

export function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type as AppNotification['type'],
    message: row.message,
    timestamp: row.timestamp,
    read: row.read,
    targetRoles: row.target_roles as AppNotification['targetRoles'],
    metadata: row.metadata as AppNotification['metadata'],
  }
}

// ── PantryItem ────────────────────────────────────────────────────

export function toPantryItem(row: PantryRow): PantryItem {
  return {
    productId: row.product_id,
    preferredPackSize: row.preferred_pack_size ?? undefined,
    defaultQuantity: row.default_quantity,
  }
}
