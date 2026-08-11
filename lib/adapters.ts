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
  InventoryLocation, Batch, InventoryBalance, InventoryMovement,
  OrderDocument, PickProgress, Warehouse, OrderFulfillment,
  WarehouseLayout, LayoutPlacement, LayoutObject, ZoneProfile, StorageType,
  WieRule, WieRuleDefinition, ProductWmsAttributes, CategoryCompatibility,
  WieScoringProfile, WieScoringWeights, SlottingSuggestion,
  WieProductVelocity, WieLocationTraffic, ProductUom, ProductSupplierLink,
  LevelRole, RackLevel, LevelRoleRecord, WarehouseSetupAck,
} from '@/types'
import { sortUoms } from './uom'
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
type LocationRow = Database['public']['Tables']['locations']['Row']
type BatchRow = Database['public']['Tables']['batches']['Row']
type InventoryBalanceRow = Database['public']['Tables']['inventory_balances']['Row']
type InventoryMovementRow = Database['public']['Tables']['inventory_movements']['Row']
type OrderDocumentRow = Database['public']['Tables']['order_documents']['Row']
type PickProgressRow = Database['public']['Tables']['pick_progress']['Row']
type OrderFulfillmentRow = Database['public']['Tables']['order_fulfillments']['Row']
type WarehouseLayoutRow = Database['public']['Tables']['warehouse_layouts']['Row']
type LayoutPlacementRow = Database['public']['Tables']['layout_placements']['Row']
type LayoutObjectRow = Database['public']['Tables']['layout_objects']['Row']
type ZoneProfileRow = Database['public']['Tables']['zone_profiles']['Row']
type StorageTypeRow = Database['public']['Tables']['storage_types']['Row']
type WieRuleRow = Database['public']['Tables']['wie_rules']['Row']
type ProductWmsAttributesRow = Database['public']['Tables']['product_wms_attributes']['Row']
type CategoryCompatibilityRow = Database['public']['Tables']['category_compatibility']['Row']
type WieScoringProfileRow = Database['public']['Tables']['wie_scoring_profiles']['Row']
type SlottingSuggestionRow = Database['public']['Tables']['wie_slotting_suggestions']['Row']
type WieProductVelocityRow = Database['public']['Tables']['wie_product_velocity']['Row']
type WieLocationTrafficRow = Database['public']['Tables']['wie_location_traffic']['Row']

// ── Product ───────────────────────────────────────────────────────

type ProductUomRow = Database['public']['Tables']['product_uoms']['Row']

export function toProductUom(row: ProductUomRow): ProductUom {
  return {
    id: row.id,
    productId: row.product_id,
    code: row.code,
    factorToBase: Number(row.factor_to_base),
    isBase: row.is_base,
    price: Number(row.price),
    isOrderable: row.is_orderable,
    isReceivable: row.is_receivable,
    sortOrder: row.sort_order,
    cubicMeters: row.cubic_meters != null ? Number(row.cubic_meters) : null,
  }
}

export function fromProductUom(u: ProductUom): Record<string, unknown> {
  return {
    code: u.code,
    factor_to_base: u.factorToBase,
    is_base: u.isBase,
    price: u.price,
    is_orderable: u.isOrderable,
    is_receivable: u.isReceivable,
    sort_order: u.sortOrder,
    // Null means "inherit from the base unit" — send it explicitly so clearing
    // a volume on edit actually clears it (the RPC writes EXCLUDED.cubic_meters).
    cubic_meters: u.cubicMeters ?? null,
  }
}

type ProductSupplierRow = Database['public']['Tables']['product_suppliers']['Row']

export function toProductSupplier(
  row: ProductSupplierRow & { suppliers?: { name: string } | null },
): ProductSupplierLink {
  return {
    supplierId: row.supplier_id,
    supplierName: row.suppliers?.name ?? undefined,
    supplierSku: row.supplier_sku ?? undefined,
    costPrice: row.cost_price != null ? Number(row.cost_price) : undefined,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
  }
}

export function fromProductSupplier(l: ProductSupplierLink): Record<string, unknown> {
  return {
    supplier_id: l.supplierId,
    // Null means "no part number" — send it explicitly so clearing one on edit
    // actually clears it (the RPC writes EXCLUDED.supplier_sku).
    supplier_sku: l.supplierSku ?? null,
    cost_price: l.costPrice ?? null,
    is_primary: l.isPrimary,
    sort_order: l.sortOrder,
  }
}

export function toProduct(
  row: ProductRow & {
    suppliers?: { name: string } | null
    product_uoms?: ProductUomRow[] | null
    product_suppliers?: Array<ProductSupplierRow & { suppliers?: { name: string } | null }> | null
  },
): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description ?? '',
    price: Number(row.price),
    category: row.category as Product['category'],
    inventory: row.inventory,
    // Reservable stock cache (mig 00041). Fall back to on-hand if a row is read
    // before the column exists, so the shop never shows undefined stock.
    available: Number((row as { available?: number }).available ?? row.inventory),
    imageUrl: row.image_url ?? undefined,
    unit: row.unit,
    cartonSize: row.carton_size,
    dietaryLabels: row.dietary_labels ?? undefined,
    // Pinned-to-top flag (mig 00043). Cast defensively in case a row is read
    // before the generated types include the column.
    featured: (row as { featured?: boolean }).featured ?? false,
    supplierId: row.supplier_id,
    cubicMetersUnit: row.cubic_meters_unit != null ? Number(row.cubic_meters_unit) : undefined,
    cubicMetersCarton: row.cubic_meters_carton != null ? Number(row.cubic_meters_carton) : undefined,
    lengthCm: row.length_cm != null ? Number(row.length_cm) : undefined,
    widthCm: row.width_cm != null ? Number(row.width_cm) : undefined,
    heightCm: row.height_cm != null ? Number(row.height_cm) : undefined,
    reorderPoint: row.reorder_point ?? undefined,
    safetyStock: row.safety_stock ?? undefined,
    leadTimeDays: row.lead_time_days ?? undefined,
    preferredSupplierId: row.preferred_supplier_id ?? undefined,
    isActive: row.is_active ?? undefined,
    barcode: row.barcode ?? undefined,
    sizeFactor: row.size_factor != null ? Number(row.size_factor) : undefined,
    // Embedded UOM list (mig 00067), sorted. Absent on rows read without the
    // product_uoms(*) join — callers fall back to deriveDefaultUoms.
    uoms: row.product_uoms ? sortUoms(row.product_uoms.map(toProductUom)) : undefined,
    // Embedded supplier links (mig 00070), primary first then by sortOrder.
    // Absent on rows read without the product_suppliers(*) join — callers fall
    // back to linksForProduct, which synthesises one from supplier_id.
    suppliers: row.product_suppliers
      ? sortSupplierLinks(row.product_suppliers.map(toProductSupplier))
      : undefined,
  }
}

/** Primary link first, then ascending sortOrder, then supplier id (stable). */
function sortSupplierLinks(links: ProductSupplierLink[]): ProductSupplierLink[] {
  return [...links].sort((a, b) =>
    Number(b.isPrimary) - Number(a.isPrimary) ||
    a.sortOrder - b.sortOrder ||
    a.supplierId - b.supplierId,
  )
}

export function fromProduct(p: Partial<Product>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.sku !== undefined) row.sku = p.sku
  if (p.name !== undefined) row.name = p.name
  if (p.description !== undefined) row.description = p.description
  if (p.price !== undefined) row.price = p.price
  if (p.category !== undefined) row.category = p.category
  if (p.inventory !== undefined) row.inventory = p.inventory
  // Empty string means "no image" client-side, but the server schema requires
  // image_url to be a valid URL or null (never ''). Map '' -> null so clearing
  // an image on update actually clears it instead of failing INVALID_INPUT.
  if (p.imageUrl !== undefined) row.image_url = p.imageUrl === '' ? null : p.imageUrl
  if (p.unit !== undefined) row.unit = p.unit
  if (p.cartonSize !== undefined) row.carton_size = p.cartonSize
  if (p.dietaryLabels !== undefined) row.dietary_labels = p.dietaryLabels
  if (p.featured !== undefined) row.featured = p.featured
  if (p.supplierId !== undefined) row.supplier_id = p.supplierId
  if (p.cubicMetersUnit !== undefined) row.cubic_meters_unit = p.cubicMetersUnit
  if (p.cubicMetersCarton !== undefined) row.cubic_meters_carton = p.cubicMetersCarton
  if (p.lengthCm !== undefined) row.length_cm = p.lengthCm
  if (p.widthCm !== undefined) row.width_cm = p.widthCm
  if (p.heightCm !== undefined) row.height_cm = p.heightCm
  if (p.reorderPoint !== undefined) row.reorder_point = p.reorderPoint
  if (p.safetyStock !== undefined) row.safety_stock = p.safetyStock
  if (p.leadTimeDays !== undefined) row.lead_time_days = p.leadTimeDays
  if (p.preferredSupplierId !== undefined) row.preferred_supplier_id = p.preferredSupplierId
  if (p.isActive !== undefined) row.is_active = p.isActive
  if (p.barcode !== undefined) row.barcode = p.barcode
  if (p.sizeFactor !== undefined) row.size_factor = p.sizeFactor
  // UOM list (mig 00067) — mutate-product validates + persists via set_product_uoms.
  if (p.uoms !== undefined) row.uoms = p.uoms.map(fromProductUom)
  // Supplier links (mig 00070) — mutate-product validates + persists via
  // set_product_suppliers, which also syncs the supplier_id cache.
  if (p.suppliers !== undefined) row.product_suppliers = p.suppliers.map(fromProductSupplier)
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
    homeWarehouseId: row.home_warehouse_id ?? undefined,
  }
}

// ── Order ─────────────────────────────────────────────────────────

// The orders read query reverse-embeds the source pending_pos via
// approved_order_id; PostgREST returns it as a 0-or-1 element array (empty for
// non-inbound orders, or when RLS hides pending_pos from non-admins).
type PendingPoEmbed = { inbound_message_id: string | null; status: string }

// orders.delivery_address arrived in migration 00021 but database.types.ts has
// not been regenerated since, so OrderRow doesn't know about it. Declared here
// rather than hand-patching the generated file, which the next regen would
// overwrite. The DB CHECK (orders_delivery_address_is_object) guarantees an
// object or NULL, never a scalar.
type DeliveryAddressJson = {
  street?: string | null
  city?: string | null
  postcode?: string | null
  country?: string | null
  recipient_name?: string | null
}

export function toOrder(
  row: OrderRow & {
    delivery_address?: DeliveryAddressJson | null
    order_items?: OrderItemRow[] | null
    pending_pos?: PendingPoEmbed[] | PendingPoEmbed | null
    order_fulfillments?: (OrderFulfillmentRow & { locations?: { name: string } | null })[] | null
  },
  hoReCas: HoReCa[],
  users: User[],
  products: Product[],
): Order {
  const pendingPo = Array.isArray(row.pending_pos) ? row.pending_pos[0] : row.pending_pos
  const hoReCa = hoReCas.find(h => h.id === row.horeca_id) ?? {
    id: row.horeca_id,
    name: 'Unknown',
    address: '',
  } as HoReCa

  const submittedBy = users.find(u => u.id === uuidToNumericId(row.submitted_by)) ?? {
    id: 0,
    name: 'Unknown',
    email: '',
    role: 'Admin' as const,
  } as User

  const items: OrderItem[] = (Array.isArray(row.order_items) ? row.order_items : []).map(oi => {
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
    // Json columns: status_history is constrained to 'array' by migration
    // 00016, but applied_promotions has no such CHECK. Cast is a runtime
    // no-op, so guard with Array.isArray to stop a non-array JSON value
    // from reaching consumers that iterate it.
    statusHistory: Array.isArray(row.status_history)
      ? (row.status_history as unknown as StatusHistoryEntry[])
      : [],
    deliveryDate: row.delivery_date ?? undefined,
    deliveryTimeSlot: (row.delivery_time_slot as DeliveryTimeSlot) ?? undefined,
    // A row with no usable street is treated as absent, so consumers get the
    // HoReCa fallback rather than rendering an address with no street in it.
    deliveryAddress: row.delivery_address?.street
      ? {
          street: row.delivery_address.street,
          city: row.delivery_address.city ?? null,
          postcode: row.delivery_address.postcode ?? null,
          country: row.delivery_address.country ?? null,
          recipientName: row.delivery_address.recipient_name ?? null,
        }
      : undefined,
    verification: (row.verification as unknown as OrderVerification) ?? undefined,
    appliedPromotions: Array.isArray(row.applied_promotions)
      ? (row.applied_promotions as unknown as AppliedPromotion[])
      : undefined,
    inboundMessageId: pendingPo?.inbound_message_id ?? undefined,
    autoApproved: pendingPo ? pendingPo.status === 'auto_approved' : undefined,
    fulfillments: Array.isArray(row.order_fulfillments)
      ? row.order_fulfillments.map(toOrderFulfillment)
      : undefined,
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

  const submittedBy = users.find(u => u.id === uuidToNumericId(row.submitted_by)) ?? {
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
    bogoConfig: (row.bogo_config as unknown as BogoConfig) ?? undefined,
    bundleConfig: (row.bundle_config as unknown as BundleConfig) ?? undefined,
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
    stops: (row.stops ?? []) as unknown as ScheduledVisitStop[],
    status: row.status as ScheduledVisit['status'],
    createdBy: uuidToNumericId(row.created_by),
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    assignedTo: row.assigned_to != null ? uuidToNumericId(row.assigned_to) : undefined,
    assignedBy: row.assigned_by != null ? uuidToNumericId(row.assigned_by) : undefined,
    assignedAt: row.assigned_at ?? undefined,
    isTemplate: row.is_template ?? undefined,
    templateId: row.template_id ?? undefined,
    recurrence: (row.recurrence as unknown as RecurrenceRule) ?? undefined,
    changeRequests: (row.change_requests ?? []) as unknown as ScheduledVisitChangeRequest[],
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
    userId: uuidToNumericId(row.user_id),
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
    // Auto-approval policy (migs 00044, 00088). Default true if a row predates
    // the columns — the protective setting, matching the Edge Function.
    poAutoApproveEnabled: (row as { po_auto_approve_enabled?: boolean }).po_auto_approve_enabled ?? true,
    poAutoApproveBlockOnShortStock:
      (row as { po_auto_approve_block_on_short_stock?: boolean }).po_auto_approve_block_on_short_stock ?? true,
    poAutoApproveBlockOnSenderMismatch:
      (row as { po_auto_approve_block_on_sender_mismatch?: boolean }).po_auto_approve_block_on_sender_mismatch ?? true,
    poAutoApproveBlockOnCustomerMismatch:
      (row as { po_auto_approve_block_on_customer_mismatch?: boolean })
        .po_auto_approve_block_on_customer_mismatch ?? true,
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
  if (s.poAutoApproveEnabled !== undefined) row.po_auto_approve_enabled = s.poAutoApproveEnabled
  if (s.poAutoApproveBlockOnShortStock !== undefined)
    row.po_auto_approve_block_on_short_stock = s.poAutoApproveBlockOnShortStock
  if (s.poAutoApproveBlockOnSenderMismatch !== undefined)
    row.po_auto_approve_block_on_sender_mismatch = s.poAutoApproveBlockOnSenderMismatch
  if (s.poAutoApproveBlockOnCustomerMismatch !== undefined)
    row.po_auto_approve_block_on_customer_mismatch = s.poAutoApproveBlockOnCustomerMismatch
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

// ── Inventory & Dispatch (mig 00027) ──────────────────────────────

export function toInventoryLocation(row: LocationRow): InventoryLocation {
  return {
    id: row.id,
    parentId: row.parent_id ?? undefined,
    kind: row.kind,
    code: row.code,
    name: row.name,
    lat: row.lat != null ? Number(row.lat) : undefined,
    lng: row.lng != null ? Number(row.lng) : undefined,
    materializedPath: row.materialized_path,
    isActive: row.is_active,
    locationType: row.location_type ?? undefined,
    address: row.address ?? undefined,
    contact: row.contact ?? undefined,
    hours: row.hours ?? undefined,
    notes: row.notes ?? undefined,
    capacitySlots: row.capacity_slots != null ? Number(row.capacity_slots) : undefined,
    slotKind: row.slot_kind ?? undefined,
    weightCapacityKg: row.weight_capacity_kg != null ? Number(row.weight_capacity_kg) : undefined,
    zoneProfileId: row.zone_profile_id ?? undefined,
    storageTypeId: row.storage_type_id ?? undefined,
    // Rack levels (mig 00072). Cast: database.types.ts is regenerated from the
    // live schema and doesn't carry these columns until that migration is
    // applied — same pattern as toSlottingSuggestion's origin/plan_batch below.
    levelRole: (row as LocationRow & { level_role?: LevelRole | null }).level_role ?? undefined,
    levelIndex: (row as LocationRow & { level_index?: number | null }).level_index ?? undefined,
    // Name provenance (mig 00094); same cast reason as the level columns above.
    // Note `?? null` rather than `?? undefined`: null is the honest value for
    // "never numbered", and the naming module distinguishes it from absent.
    nameSeq: (row as LocationRow & { name_seq?: number | null }).name_seq ?? null,
    nameArea: (row as LocationRow & { name_area?: string | null }).name_area ?? null,
    nameIsAuto: (row as LocationRow & { name_is_auto?: boolean | null }).name_is_auto ?? false,
  }
}

/** Narrow a WAREHOUSE-kind location row to the warehouse-management view-type. */
export function toWarehouse(row: LocationRow): Warehouse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    locationType: (row.location_type ?? 'bulk'),
    activeLayoutId: row.active_layout_id ?? undefined,
    lat: row.lat != null ? Number(row.lat) : undefined,
    lng: row.lng != null ? Number(row.lng) : undefined,
    address: row.address ?? undefined,
    contact: row.contact ?? undefined,
    hours: row.hours ?? undefined,
    notes: row.notes ?? undefined,
    isActive: row.is_active,
  }
}

export function toOrderFulfillment(
  row: OrderFulfillmentRow & { locations?: { name: string } | null },
): OrderFulfillment {
  return {
    id: row.id,
    orderId: row.order_id,
    locationId: row.location_id,
    warehouseName: row.locations?.name ?? undefined,
    status: row.status,
    statusHistory: Array.isArray(row.status_history)
      ? (row.status_history as unknown as StatusHistoryEntry[])
      : [],
    createdAt: row.created_at,
  }
}

export function toBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    productId: row.product_id,
    lotCode: row.lot_code,
    expiryDate: row.expiry_date ?? undefined,
    barcode: row.barcode ?? undefined,
    supplierId: row.supplier_id ?? undefined,
    receivedAt: row.received_at,
  }
}

export function toInventoryBalance(row: InventoryBalanceRow): InventoryBalance {
  return {
    id: row.id,
    productId: row.product_id,
    locationId: row.location_id,
    batchId: row.batch_id ?? undefined,
    onHand: Number(row.on_hand),
    allocated: Number(row.allocated),
    available: Number(row.available),
    updatedAt: row.updated_at,
  }
}

export function toInventoryMovement(row: InventoryMovementRow): InventoryMovement {
  return {
    id: row.id,
    productId: row.product_id,
    locationId: row.location_id,
    batchId: row.batch_id ?? undefined,
    qtyDelta: Number(row.qty_delta),
    movementType: row.movement_type,
    refType: row.ref_type ?? undefined,
    refId: row.ref_id ?? undefined,
    actorId: row.actor_id ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
  }
}

export function toOrderDocument(row: OrderDocumentRow): OrderDocument {
  return {
    id: row.id,
    orderId: row.order_id,
    docType: row.doc_type,
    storagePath: row.storage_path,
    generatedBy: row.generated_by ?? undefined,
    generatedAt: row.generated_at,
  }
}

export function toPickProgress(row: PickProgressRow): PickProgress {
  return {
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    locationId: row.location_id,
    batchId: row.batch_id ?? undefined,
    pickedQty: row.picked_qty,
    pickedBy: row.picked_by ?? undefined,
    pickedAt: row.picked_at,
  }
}

export function toWarehouseLayout(row: WarehouseLayoutRow): WarehouseLayout {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    name: row.name,
    status: row.status,
    version: row.version,
    clonedFrom: row.cloned_from ?? undefined,
    gridWidth: row.grid_width,
    gridHeight: row.grid_height,
    cellSizeM: Number(row.cell_size_m),
    floorCount: row.floor_count,
    publishedAt: row.published_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Publishing FREEZES the travel graph — layout_graph_edges.weight_m,
    // layout_travel_distances.distance_m and layout_placements.access_offset_m
    // are all computed once, at publish, from cell_size_m. So a header edit on a
    // live layout (mutate-layout's update_layout) is inert until it is
    // republished, and an operator who changes the scale and sees no distance
    // move has no way to tell that from a bug.
    //
    // No column is needed to say so: on a PUBLISHED layout nothing but that edit
    // can move updated_at — save_geometry refuses a non-draft, and
    // archive_layout leaves the row non-published. A boolean would be a second
    // copy of a fact these two timestamps already hold, with the usual risk that
    // the copy is the one that's wrong.
    needsRepublish:
      row.status === 'published' &&
      !!row.published_at &&
      new Date(row.updated_at).getTime() > new Date(row.published_at).getTime(),
  }
}

export function toLayoutPlacement(row: LayoutPlacementRow): LayoutPlacement {
  return {
    id: row.id,
    layoutId: row.layout_id,
    locationId: row.location_id,
    floor: row.floor,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    rotation: row.rotation as LayoutPlacement['rotation'],
    graphNodeId: row.graph_node_id ?? undefined,
    accessOffsetM: row.access_offset_m != null ? Number(row.access_offset_m) : undefined,
    // Rack levels (mig 00072); undefined = a legacy single-bin placement. See
    // the LocationRow cast note in toInventoryLocation above.
    levelIndex: (row as LayoutPlacementRow & { level_index?: number | null }).level_index ?? undefined,
  }
}

export function toWieRule(row: WieRuleRow): WieRule {
  return {
    id: row.id,
    warehouseId: row.warehouse_id ?? undefined,
    name: row.name,
    ruleType: row.rule_type,
    enforcement: row.enforcement,
    priority: row.priority,
    definition: row.definition as unknown as WieRuleDefinition,
    isActive: row.is_active,
  }
}

export function toProductWmsAttributes(row: ProductWmsAttributesRow): ProductWmsAttributes {
  return {
    productId: row.product_id,
    hazardClass: row.hazard_class ?? undefined,
    tempMin: row.temp_min != null ? Number(row.temp_min) : undefined,
    tempMax: row.temp_max != null ? Number(row.temp_max) : undefined,
    shelfLifePolicy: row.shelf_life_policy ?? undefined,
    stackable: row.stackable ?? undefined,
    handlingType: row.handling_type ?? undefined,
    weightKg: row.weight_kg != null ? Number(row.weight_kg) : undefined,
    volumeL: row.volume_l != null ? Number(row.volume_l) : undefined,
    dims: (row.dims as Record<string, unknown>) ?? undefined,
    custom: (row.custom as Record<string, unknown>) ?? {},
    // mig 00072; column absent from database.types.ts until the migration is
    // applied and types regenerated — same inline-intersection cast used above.
    allowedLevelRoles:
      (row as ProductWmsAttributesRow & { allowed_level_roles?: LevelRole[] | null }).allowed_level_roles ?? undefined,
  }
}

export function toWieScoringProfile(row: WieScoringProfileRow): WieScoringProfile {
  return { warehouseId: row.warehouse_id, weights: row.weights as unknown as WieScoringWeights }
}

export function toSlottingSuggestion(row: SlottingSuggestionRow): SlottingSuggestion {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    qty: Number(row.qty),
    expectedGainM: Number(row.expected_gain_m),
    reason: (row.reason as Record<string, unknown>) ?? {},
    status: row.status,
    origin: (row as { origin?: 'reoptimize' | 'reslot' }).origin ?? 'reoptimize',
    planBatch: (row as { plan_batch?: string }).plan_batch ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  }
}

export function toWieProductVelocity(row: WieProductVelocityRow): WieProductVelocity {
  return {
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    picks7d: Number(row.picks_7d),
    picks30d: Number(row.picks_30d),
    picks90d: Number(row.picks_90d),
    qty30d: Number(row.qty_30d),
    velocityClass: row.velocity_class ?? undefined,
  }
}

export function toWieLocationTraffic(row: WieLocationTrafficRow): WieLocationTraffic {
  return {
    layoutId: row.layout_id,
    graphNodeId: row.graph_node_id,
    pickVisits30d: Number(row.pick_visits_30d),
  }
}

export function toCategoryCompatibility(row: CategoryCompatibilityRow): CategoryCompatibility {
  return {
    categoryA: row.category_a,
    categoryB: row.category_b,
    level: row.level,
    note: row.note ?? undefined,
  }
}

export function toZoneProfile(row: ZoneProfileRow): ZoneProfile {
  return {
    id: row.id,
    name: row.name,
    zoneType: row.zone_type,
    priorityWeight: Number(row.priority_weight),
    allowedCategories: Array.isArray(row.allowed_categories)
      ? (row.allowed_categories as unknown as string[])
      : undefined,
    maxUtilizationPct: row.max_utilization_pct != null ? Number(row.max_utilization_pct) : undefined,
    isActive: row.is_active,
    // mig 00101. Defaults false — a row predating the column holds nothing.
    isHold: (row as ZoneProfileRow & { is_hold?: boolean }).is_hold === true,
  }
}

/** A level_roles row (mig 00081). The vocabulary is operator-managed, so this is
 *  the only place the DB's snake_case shape is known. `key` is the stored value
 *  in locations.level_role and never changes; display_name is what operators
 *  see, which is how "Pick face" became "Pick Zone" without touching any data. */
export function toLevelRole(raw: unknown): LevelRoleRecord {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    key: String(row.key ?? ''),
    displayName: String(row.display_name ?? row.key ?? ''),
    description: (row.description as string | null) ?? null,
    colorFill: String(row.color_fill ?? '#e7e5e4'),
    colorStroke: String(row.color_stroke ?? '#78716c'),
    colorText: (row.color_text as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 100),
    // TEXT[] arrives as a real array from PostgREST; guard anyway so a null
    // column can never make .includes() throw inside a canvas render.
    huTypes: Array.isArray(row.hu_types) ? (row.hu_types as string[]) : [],
    isPickZone: Boolean(row.is_pick_zone),
    replenSourceRank: row.replen_source_rank != null ? Number(row.replen_source_rank) : null,
    isSystem: Boolean(row.is_system),
    isActive: row.is_active !== false,
  }
}

/** storage_types.level_template is
 *  [{role, capacity_slots, slot_kind, weight_capacity_kg}], positionally ordered
 *  (mig 00072) — 1-based level_index is the array index.
 *
 *  `slot_kind` is per LEVEL, not per form, because one rack can carry two slot
 *  units: Amadiya's bays are carton pick-zone levels below and pallet positions
 *  above. Dropping it here used to be invisible — `RackLevel.slotKind` existed
 *  and `rackLevels.ts` carried it — but the template arrived without one, so
 *  every drawn level fell back to the form's single `slot_unit`. */
function toRackLevelTemplate(raw: unknown): RackLevel[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((entry, i): RackLevel => {
    const e = (entry ?? {}) as Record<string, unknown>
    // Only the two values locations.slot_kind's CHECK accepts survive; anything
    // else (a stale 'each', a typo) reads as "inherit the form's slot_unit".
    const kind = e.slot_kind === 'pallet' || e.slot_kind === 'carton' ? e.slot_kind : undefined
    return {
      levelIndex: i + 1,
      role: e.role as LevelRole,
      capacitySlots: e.capacity_slots != null ? Number(e.capacity_slots as number) : undefined,
      slotKind: kind,
      weightCapacityKg: e.weight_capacity_kg != null ? Number(e.weight_capacity_kg as number) : undefined,
    }
  })
}

export function toStorageType(row: StorageTypeRow): StorageType {
  // Rack levels (mig 00072). Cast: database.types.ts hasn't been regenerated
  // for this migration yet — see the LocationRow cast note above.
  const leveled = row as StorageTypeRow & { has_levels?: boolean; level_template?: unknown; is_floor?: boolean }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    defaultCapacitySlots: row.default_capacity_slots != null ? Number(row.default_capacity_slots) : undefined,
    slotUnit: row.slot_unit,
    attributes: (row.attributes as Record<string, unknown>) ?? {},
    isActive: row.is_active,
    sortOrder: row.sort_order,
    levels: row.levels ?? undefined,
    positionsPerLevel: row.positions_per_level ?? undefined,
    weightCapacityKg: row.weight_capacity_kg != null ? Number(row.weight_capacity_kg) : undefined,
    lengthCm: row.length_cm != null ? Number(row.length_cm) : undefined,
    widthCm: row.width_cm != null ? Number(row.width_cm) : undefined,
    heightCm: row.height_cm != null ? Number(row.height_cm) : undefined,
    color: row.color ?? undefined,
    isDrawable: row.is_drawable,
    hasLevels: leveled.has_levels ?? false,
    // mig 00100. Defaults false, which is the permissive answer: a row that
    // predates the column keeps its Split into levels action.
    isFloor: leveled.is_floor ?? false,
    levelTemplate: toRackLevelTemplate(leveled.level_template),
  }
}

/** One warehouse setup sign-off (mig 00092). Defensive coercion throughout —
 *  `acknowledged_by` is nullable because a profile can be deleted after the
 *  fact, and losing the person must not lose the fact that it was signed off. */
export function toWarehouseSetupAck(raw: unknown): WarehouseSetupAck {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    id: Number(row.id ?? 0),
    warehouseId: Number(row.warehouse_id ?? 0),
    stepKey: String(row.step_key ?? ''),
    note: (row.note as string | null) ?? null,
    acknowledgedBy: (row.acknowledged_by as string | null) ?? null,
    acknowledgedAt: String(row.acknowledged_at ?? ''),
  }
}

export function toLayoutObject(row: LayoutObjectRow): LayoutObject {
  return {
    id: row.id,
    layoutId: row.layout_id,
    objectType: row.object_type,
    floor: row.floor,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    meta: (row.meta as Record<string, unknown>) ?? {},
    stagingLocationId: row.staging_location_id ?? undefined,
  }
}
