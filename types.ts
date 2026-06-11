// FIX: Define all necessary types for the application.
export enum UserRole {
    ADMIN = 'Admin',
    MANAGER = 'Manager',
    FIELD_REP = 'Field Sales Rep',
    OFFICE_REP = 'Office Sales Rep',
    CUSTOMER = 'Restaurant/Hotel Customer',
    WAREHOUSE = 'Warehouse',
}

export type OrderVerificationMethod = 'signature' | 'call_reference' | 'choose';

export interface SignatureVerification {
    method: 'signature';
    signatureDataUrl: string; // base64 PNG of the signature
    timestamp: string;
}

export interface CallVerification {
    method: 'call_reference';
    callerName: string;
    callDate: string;
    callTime: string;
    referenceNumber?: string;
    timestamp: string;
}

export type OrderVerification = SignatureVerification | CallVerification;

export type Category = 'Coconut' | 'Meal Pastes' | 'Asian Sauces' | 'Soy Sauces' | 'Chilli Sauces' | 'Condiments' | 'Noodles' | 'Fish' | 'Satay Sauces' | 'Desserts' | 'Ready Meal Sauces' | 'Other';

export interface User {
    id: number;
    name: string;
    email: string;
    role: UserRole;
    avatarUrl?: string;
    hoReCaId?: number; // Link user to a HoReCa entity
    homeWarehouseId?: number; // Warehouse role: the site this user picks/receives at (mig 00036)
}

export interface Product {
    id: number;
    sku: string;
    name: string;
    description: string;
    price: number;
    category: Category;
    inventory: number;
    imageUrl?: string;
    unit: string; // e.g., 'jar', 'bottle', 'can', 'packet'
    cartonSize: number; // units per carton, e.g., 6 or 12
    dietaryLabels?: string[]; // e.g., ['GF', 'VEGAN']
    supplierId: number;
    // Volume / cubic meters
    cubicMetersUnit?: number;   // m³ per single unit (direct override)
    cubicMetersCarton?: number; // m³ per carton (direct override)
    lengthCm?: number;          // unit dimensions for auto-calculation
    widthCm?: number;
    heightCm?: number;
    // Inventory & replenishment (mig 00027). `inventory` above is the on-hand
    // cache (= SUM of inventory_balances.on_hand); these drive restock logic.
    reorderPoint?: number;
    safetyStock?: number;
    leadTimeDays?: number;
    preferredSupplierId?: number;
    isActive?: boolean;
    barcode?: string;
}

// ---------------------------------------------------------------------------
// Inventory & Dispatch (mig 00027)
// ---------------------------------------------------------------------------

export type LocationKind = 'WAREHOUSE' | 'ZONE' | 'BIN' | 'SHELF';

/** Storage model of a WAREHOUSE-kind location (mig 00036). */
export type WarehouseType = 'bulk' | 'racked';

export interface InventoryLocation {
    id: number;
    parentId?: number;
    kind: LocationKind;
    code: string;
    name: string;
    lat?: number;
    lng?: number;
    materializedPath: string;
    isActive: boolean;
    // Warehouse-level config (mig 00036; meaningful only on WAREHOUSE rows).
    locationType?: WarehouseType;
    address?: string;
    contact?: string;
    hours?: string;
    notes?: string;
    // Racked bin config (mig 00039; on ZONE/BIN/SHELF nodes).
    capacitySlots?: number;
    slotKind?: 'pallet' | 'carton';
}

/**
 * A WAREHOUSE-kind location surfaced for warehouse management / routing. Same
 * row as InventoryLocation, narrowed to the fields the warehouse admin + the
 * closest-first allocator care about.
 */
export interface Warehouse {
    id: number;
    code: string;
    name: string;
    locationType: WarehouseType;
    lat?: number;
    lng?: number;
    address?: string;
    contact?: string;
    hours?: string;
    notes?: string;
    isActive: boolean;
}

/** Per-warehouse slice of an order (mig 00036). */
export type FulfillmentStatus = 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered';

export interface OrderFulfillment {
    id: number;
    orderId: string;
    locationId: number;
    warehouseName?: string;
    status: FulfillmentStatus;
    statusHistory: StatusHistoryEntry[];
    createdAt: string;
}

export interface Batch {
    id: number;
    productId: number;
    lotCode: string;
    expiryDate?: string;
    barcode?: string;
    supplierId?: number;
    receivedAt: string;
}

export interface InventoryBalance {
    id: number;
    productId: number;
    locationId: number;
    batchId?: number;
    onHand: number;
    allocated: number;
    available: number; // generated: onHand - allocated
    updatedAt: string;
}

export type MovementType =
    | 'receipt'
    | 'allocate'
    | 'deallocate'
    | 'pick'
    | 'adjustment'
    | 'stocktake_variance'
    | 'transfer_out'
    | 'transfer_in';

export interface InventoryMovement {
    id: number;
    productId: number;
    locationId: number;
    batchId?: number;
    qtyDelta: number;
    movementType: MovementType;
    refType?: string;
    refId?: string;
    actorId?: string;
    reason?: string;
    createdAt: string;
}

export type OrderDocumentType = 'pick_slip' | 'dispatch_advice';

export interface OrderDocument {
    id: number;
    orderId: string;
    docType: OrderDocumentType;
    storagePath: string;
    generatedBy?: string;
    generatedAt: string;
}

export interface PickProgress {
    id: number;
    orderId: string;
    orderItemId: number;
    locationId: number;
    batchId?: number;
    pickedQty: number;
    pickedBy?: string;
    pickedAt: string;
}

export interface PaymentMethod {
    id: number;
    type: 'Credit Card' | 'Bank Transfer' | 'On Account';
    details: string; // e.g., "Visa ending in 1234" or "Net 30 Terms"
    isDefault: boolean;
}

export interface HoReCa {
    id: number;
    name: string;
    address: string;
    pricing?: { [productId: number]: number }; // Custom pricing for this HoReCa
    paymentMethods?: PaymentMethod[];
    creditLimit?: number; // Optional credit limit for the HoReCa
    discountPercent?: number; // Blanket percentage discount (0-100)
    showStockTab?: boolean; // undefined = use global default, true = always show, false = always hide
    tier?: HoReCaTier;
    lat?: number;
    lng?: number;
    // Walk-in support: when a rep adds an ad-hoc stop on a route we create a
    // temporary HoReCa flagged for office follow-up. Review fields record the
    // admin who promoted the temp to a full record.
    isTemporary?: boolean;
    createdByUserId?: number;
    reviewedAt?: string;
    reviewedByUserId?: number;
}

export interface OrderItem extends Product {
    quantity: number;
    packSize?: number; // undefined for single unit, cartonSize for a carton
}

export type OrderStatus = 'processing' | 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered';

export interface StatusHistoryEntry {
    status: OrderStatus;
    timestamp: string;
    note?: string;
}

export type DeliveryTimeSlot = 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)';

export interface Order {
    id: string;
    hoReCa: HoReCa;
    items: OrderItem[];
    total: number;
    orderDate: string; // ISO string
    submittedBy: User;
    notes?: string;
    status: OrderStatus;
    statusHistory: StatusHistoryEntry[];
    deliveryDate?: string;
    deliveryTimeSlot?: DeliveryTimeSlot;
    verification?: OrderVerification;
    appliedPromotions?: AppliedPromotion[];
    // Set by the data adapter when this order was created from an inbound email PO.
    // Drives the "Email PO" source badge. Joined via pending_pos.approved_order_id;
    // see lib/orderSource.ts and the approve-po Edge Function (Stream F).
    inboundMessageId?: string;
    // True when the source PO was auto-approved (no human reviewer). Lets the UI
    // show "Auto-approved (system)" instead of attributing it to the mailbox owner
    // (submittedBy is the connecting admin for auto approvals). Set alongside
    // inboundMessageId from pending_pos.status === 'auto_approved'.
    autoApproved?: boolean;
    // Per-warehouse fulfilment slices (mig 00036). `status` above is the derived
    // rollup (least-advanced fulfilment); these expose the per-site detail so the
    // UI can show "WH1 dispatched · WH2 picking". Empty/absent for legacy orders.
    fulfillments?: OrderFulfillment[];
}

export type InvoiceStatus = 'pending' | 'paid' | 'overdue';

export interface Invoice {
    id: string;
    orderId: string;
    hoReCaId: number;
    hoReCaName: string;
    amount: number;
    dueDate: string;
    status: InvoiceStatus;
    paidDate?: string;
    createdDate: string;
}

export type NotificationType = 'low_stock' | 'order_status' | 'invoice' | 'system' | 'route_assigned' | 'route_completed' | 'change_request' | 'change_approved' | 'change_rejected';

export interface AppNotification {
    id: string;
    type: NotificationType;
    message: string;
    timestamp: string;
    read: boolean;
    targetRoles?: UserRole[];
    metadata?: {
        productId?: number;
        orderId?: string;
        invoiceId?: string;
        scheduledVisitId?: string;
        userId?: number;
    };
}

export type ToastType = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

export interface Supplier {
    id: number;
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
}

export enum PurchaseOrderStatus {
    PENDING = 'Pending',
    SUBMITTED = 'Submitted',
    COMPLETED = 'Completed',
    CANCELLED = 'Cancelled',
}

export interface PurchaseOrderItem {
    productId: number;
    productName: string;
    quantity: number;
    cost: number;
}

export interface PurchaseOrder {
    id: string;
    supplier: Supplier;
    items: PurchaseOrderItem[];
    total: number;
    orderDate: string; // ISO string
    status: PurchaseOrderStatus;
    submittedBy: User;
}

export interface AppSettings {
    companyName: string;
    companyAddress: string;
    companyPhone: string;
    companyEmail: string;
    orderIdPrefix: string;
    minimumOrderValue: number;
    defaultCreditLimit: number;
    cartonDiscountPercent: number; // e.g. 5 means 5% off
    lowStockThreshold: number;
    currency: string;
    showStockToHoReCa: boolean;
    companyLogoUrl?: string | null;
}

export interface PantryItem {
    productId: number;
    preferredPackSize: number | undefined; // undefined = single unit, cartonSize = carton
    defaultQuantity: number;
}

export type PantryLists = Record<number, PantryItem[]>;

export type SalesTargetType = 'revenue' | 'orders' | 'new_horecas';

export interface SalesTarget {
    id: string;
    userId: number;
    type: SalesTargetType;
    targetValue: number;
    startDate: string;  // ISO date string (YYYY-MM-DD)
    endDate: string;    // ISO date string (YYYY-MM-DD)
    createdAt: string;  // ISO datetime string
}

// --- Buying Patterns Analytics ---

export type HoReCaSegment = 'high_value' | 'growing' | 'declining' | 'at_risk' | 'new';

export interface ProductFrequency {
    productId: number;
    productName: string;
    category: Category;
    orderCount: number;
    totalQuantity: number;
    avgQuantityPerOrder: number;
    avgDaysBetweenOrders: number | null;
    lastOrderedDate: string;
    predictedNextOrderDate: string | null;
    isOverdue: boolean;
}

export interface CoPurchasePair {
    productIdA: number;
    productNameA: string;
    productIdB: number;
    productNameB: string;
    coOccurrenceCount: number;
    supportPercent: number;
}

export interface OrderingHint {
    type: 'typical_quantity' | 'reorder_due' | 'last_ordered' | 'missing_from_usual';
    productId: number;
    productName: string;
    message: string;
    value?: number;
    urgency?: 'low' | 'medium' | 'high';
}

export interface SpendingTrend {
    month: string;
    totalSpend: number;
    orderCount: number;
    avgOrderValue: number;
    avgBasketSize: number;
    categoryBreakdown: Record<string, number>;
}

export interface HoReCaInsights {
    hoReCaId: number;
    hoReCaName: string;
    segment: HoReCaSegment;
    totalOrders: number;
    totalSpend: number;
    avgDaysBetweenOrders: number | null;
    predictedNextOrderDate: string | null;
    frequencyTrend: 'increasing' | 'decreasing' | 'stable';
    spendTrend: 'increasing' | 'decreasing' | 'stable';
    avgOrderValue: number;
    productFrequencies: ProductFrequency[];
    spendingTrends: SpendingTrend[];
    daysSinceLastOrder: number | null;
    lastOrderDate: string | null;
}

// --- Promotions & Clearance ---

export type HoReCaTier = 'Gold' | 'Silver' | 'Bronze';

export type PromotionType = 'percentage' | 'fixed_price' | 'bogo' | 'bundle' | 'clearance';

export type PromotionTargeting =
    | { kind: 'all' }
    | { kind: 'horecas'; hoReCaIds: number[] }
    | { kind: 'tier'; tiers: HoReCaTier[] }
    | { kind: 'rep'; repUserId: number };

export type PromotionScope =
    | { kind: 'storewide' }
    | { kind: 'products'; productIds: number[] }
    | { kind: 'categories'; categories: Category[] };

export interface BogoConfig {
    buyProductId: number;
    buyQuantity: number;
    getProductId: number;   // same as buyProductId for same-product BOGO
    getQuantity: number;
}

export interface BundleConfig {
    productIds: number[];   // 2-5 products
    bundlePrice: number;    // flat price when all items present in cart
}

export interface Promotion {
    id: string;
    name: string;
    description: string;
    type: PromotionType;

    // Type-specific config (exactly one populated per type)
    percentOff?: number;            // for 'percentage' (1-100)
    fixedPrice?: number;            // for 'fixed_price' (dollar amount)
    bogoConfig?: BogoConfig;        // for 'bogo'
    bundleConfig?: BundleConfig;    // for 'bundle'
    clearancePercent?: number;      // for 'clearance' (discount percent)

    scope: PromotionScope;
    targeting: PromotionTargeting;
    minOrderValue?: number;         // optional minimum cart value
    appliesTo?: 'unit' | 'carton';  // for bogo/bundle: whether quantities are units or cartons (default 'unit')

    stackWithHoReCaPricing: boolean;
    startDate?: string;             // ISO date string; undefined = manual control
    endDate?: string;               // ISO date string; undefined = no expiry
    isActive: boolean;              // admin manual toggle

    createdAt: string;
    createdBy: number;              // userId
    priority: number;               // lower = higher priority (wins ties)
}

export type PromoBadgeType = 'PROMO' | 'SALE' | 'CLEARANCE' | 'BUNDLE' | 'BOGO';

export interface AppliedPromotion {
    promotionId: string;
    promotionName: string;
    type: PromotionType;
    discount: number;
}

export interface PriceResolution {
    finalPrice: number;
    originalPrice: number;
    customerPrice: number;
    appliedPromotion: Promotion | null;
    badge: PromoBadgeType | null;
    savingsPercent: number;
}

export interface CartPromotionResult {
    bogoFreeItems: Array<{
        productId: number;
        productName: string;
        freeQuantity: number;
        promoId: string;
        promoName: string;
        triggerProductId: number;
        triggerQuantityRequired: number;
        unit: 'unit' | 'carton';
    }>;
    bundleDiscounts: Array<{ promoId: string; promoName: string; discount: number; productIds: number[] }>;
    totalDiscount: number;
}

// --- Scheduled Visit Planning & Check-in Tracking ---

export type ScheduledVisitStatus = 'planned' | 'in_progress' | 'completed';
export type ScheduledVisitStopStatus = 'pending' | 'arrived' | 'skipped';

export interface ScheduledVisitStop {
    hoReCaId: number;
    sequence: number;
    plannedArrival?: string;
    status: ScheduledVisitStopStatus;
    visitId?: string;
}

export interface ScheduledVisit {
    id: string;
    name: string;
    date: string;
    stops: ScheduledVisitStop[];
    status: ScheduledVisitStatus;
    createdBy: number;
    createdAt: string;
    completedAt?: string;
    assignedTo?: number;
    assignedBy?: number;
    assignedAt?: string;
    isTemplate?: boolean;
    templateId?: string;
    recurrence?: RecurrenceRule;
    changeRequests?: ScheduledVisitChangeRequest[];
}

export interface RecurrenceRule {
    frequency: 'weekly' | 'biweekly';
    dayOfWeek: number; // 0=Sunday, 1=Monday, etc.
}

export type ScheduledVisitChangeRequestType = 'reorder' | 'add_stop' | 'remove_stop';
export type ScheduledVisitChangeRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ReorderPayload {
    newStopOrder: number[]; // hoReCaIds in new order
}

export interface AddStopPayload {
    hoReCaId: number;
    atIndex?: number;
}

export interface RemoveStopPayload {
    hoReCaId: number;
}

export interface ScheduledVisitChangeRequest {
    id: string;
    scheduledVisitId: string;
    requestedBy: number;
    requestedAt: string;
    type: ScheduledVisitChangeRequestType;
    status: ScheduledVisitChangeRequestStatus;
    reviewedBy?: number;
    reviewedAt?: string;
    description: string;
    payload: ReorderPayload | AddStopPayload | RemoveStopPayload;
}

export interface MockRepPosition {
    userId: number;
    lat: number;
    lng: number;
    heading: number;
    timestamp: string;
    scheduledVisitId?: string;
    currentStopIndex?: number;
}

export type VisitOutcome = 'order_placed' | 'follow_up_needed' | 'not_available' | 'no_interest' | 'stock_check_only';

export interface Visit {
    id: string;
    hoReCaId: number;
    userId: number;
    scheduledVisitId?: string;
    arrivalTime: string;
    departureTime?: string;
    outcome?: VisitOutcome;
    notes?: string;
    competitorNotes?: string;
    stockCheckNotes?: string;
    nextVisitRecommendation?: string;
    photos: string[];
    createdAt: string;
}

// --- Product Movement Analytics ---

export interface ProductVelocity {
    productId: number;
    productName: string;
    category: Category;
    unitsPerWeek: number;
    trend: 'accelerating' | 'declining' | 'stable';
    lastSoldDate: string | null;
    currentStock: number;
}

export interface TargetProjection {
    dailyRate: number;
    projectedFinal: number;
    projectedPercent: number;
    status: 'on_track' | 'behind' | 'at_risk';
    daysRemaining: number;
    message: string;
}

export interface WeeklyPacePoint {
    weekStart: string;
    weekEnd: string;
    cumulative: number;
    idealPace: number;
}

// --- Dashboard ---

export type DashboardTimePeriod = 'today' | 'this_week' | 'this_month' | 'custom';

export interface RepProductivity {
    visitCompletionRate: number;
    visitConversionRate: number;
    avgStopsPerRoute: number;
    routesCompleted: number;
}

export interface PromotionROI {
    promotionId: string;
    promotionName: string;
    type: string;
    ordersUsing: number;
    totalDiscountGiven: number;
    revenueFromPromoOrders: number;
    avgOrderValueWithPromo: number;
    avgOrderValueWithout: number;
    estimatedUplift: number;
}