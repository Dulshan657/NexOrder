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

/**
 * A product category. Open-ended since mig 00069 dropped `products_category_check`
 * — operators create categories inline from the product form. `constants.CATEGORIES`
 * holds the built-in suggestions; `lib/productTaxonomy.ts` merges those with the
 * categories actually in use to build every category dropdown/filter.
 */
export type Category = string;

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
    inventory: number; // on-hand cache (SUM of inventory_balances.on_hand) — physical stock
    available: number; // reservable cache (SUM of inventory_balances.available = on_hand − allocated)
    imageUrl?: string;
    unit: string; // e.g., 'jar', 'bottle', 'can', 'packet'
    cartonSize: number; // units per carton, e.g., 6 or 12
    dietaryLabels?: string[]; // e.g., ['GF', 'VEGAN']
    featured?: boolean; // pinned to the top of the shop (demo/hero products, mig 00043)
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
    // Racked WMS: capacity slots a single base unit consumes (mig 00039).
    sizeFactor?: number;
    // N-level units of measure (mig 00067). Embedded child rows; the base UOM
    // (isBase, factorToBase 1) always exists. Absent on rows read before the
    // migration — callers fall back to deriveDefaultUoms(unit, price, cartonSize).
    uoms?: ProductUom[];
    // Suppliers this product can be bought from (mig 00070). Exactly one link is
    // primary and mirrors `supplierId`. Absent on rows read without the
    // product_suppliers join — callers fall back to `linksForProduct`, which
    // synthesises a single primary link from `supplierId`.
    suppliers?: ProductSupplierLink[];
}

/**
 * One product↔supplier link (mig 00070). The same item may be bought from
 * several suppliers, each with their own part number and cost. Exactly one link
 * per product is `isPrimary`, and the server keeps `products.supplier_id` in
 * step with it, so legacy single-supplier read sites keep working.
 */
export interface ProductSupplierLink {
    supplierId: number;
    /** Joined for display; absent when the row was read without the embed. */
    supplierName?: string;
    /** The supplier's own code for this item, as printed on their docket. */
    supplierSku?: string;
    /** What this supplier charges per BASE unit. */
    costPrice?: number;
    isPrimary: boolean;
    sortOrder: number;
}

/**
 * One sellable/receivable unit of measure for a product (mig 00067). A higher
 * UOM is a pure quantity multiplier: `factorToBase` base units per 1 of this
 * UOM (base UOM = 1), with an explicit per-UOM `price`. There is exactly one
 * base UOM per product. `pack_size` on an order/receipt line carries this
 * factor, so the inventory ledger math (base = quantity × factor) is unchanged.
 */
export interface ProductUom {
    id: number;
    productId: number;
    code: string;           // dropdown label: 'each', 'carton', 'pallet', …
    factorToBase: number;   // base units per 1 of this UOM; base = 1 (integer)
    isBase: boolean;
    price: number;          // explicit price for ONE of this UOM
    isOrderable: boolean;   // appears in the shop dropdown
    isReceivable: boolean;  // appears in the receiving dropdown
    sortOrder: number;      // ascending factor; drives dropdown + decomposition order
    /** m³ for ONE of this UOM (mig 00069). Null/undefined = inherit
     * `factorToBase × product.cubicMetersUnit`; see `lib/uomVolume.ts`. */
    cubicMeters?: number | null;
}

// ---------------------------------------------------------------------------
// Inventory & Dispatch (mig 00027)
// ---------------------------------------------------------------------------

export type LocationKind = 'WAREHOUSE' | 'ZONE' | 'AISLE' | 'RACK' | 'BAY' | 'SHELF' | 'BIN' | 'STAGING';

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
    /** Per-unit weight limit, kg (mig 00061; inherited from the storage form). */
    weightCapacityKg?: number;
    // WIE zone semantics (mig 00047; on ZONE nodes).
    zoneProfileId?: number;
    // Physical storage-unit type (mig 00056; on rack/BIN nodes).
    storageTypeId?: number;
    // Rack levels (mig 00072; on SHELF-kind level rows only).
    /** This level's role. undefined on a RACK parent and on every legacy bin,
     *  which means the putaway role gate does not constrain it. */
    levelRole?: LevelRole;
    /** 1-based level number within the parent rack; undefined if not a level. */
    levelIndex?: number;
    // Name provenance (mig 00094). `name` is what an operator reads; `code` stays
    // the scan identity. These three say where the name came from.
    /** The rack number inside `nameArea`. Assigned once and never reassigned, so
     *  a deleted rack leaves a permanent gap — a sign already on the floor
     *  cannot be un-printed. null/undefined = never numbered. */
    nameSeq?: number | null;
    /** The pool that number was drawn from. NOT derived from geometry: painting
     *  a different area over a rack must not release its claim. */
    nameArea?: string | null;
    /** false = a human typed this name, so an area rename must leave it alone. */
    nameIsAuto?: boolean;
    // Code provenance (mig 00107). The mirror of the naming triple above, for the
    // scan identity rather than the display name — and deliberately only a pair,
    // because a code has no "custom vs auto" distinction: a code either came from a
    // sweep or predates one.
    /** The block a sweep minted this code under. NULL = not minted by a pattern,
     *  which is true of every code drawn before 00107 — and is exactly what the map
     *  tints to show which parts of a site are still un-swept. Stored rather than
     *  parsed back out of the code, since a block may itself contain the separator
     *  (`AMD-COLD-A` + `-01` is ambiguous to any regex). */
    codeBlock?: string | null;
    /** Its number within that block. UNLIKE `nameSeq` this may be reassigned —
     *  rewriting codes is the entire purpose of a sweep. What is preserved instead
     *  is idempotence: re-running the same sweep must write nothing. */
    codeSeq?: number | null;
}

/** What one "slot" of a storage type counts. 'each'/'uncounted' don't map onto
 *  the engine's pallet/carton slot_kind. */
export type SlotUnit = 'pallet' | 'carton' | 'each' | 'uncounted';

/** What a rack level is used for (mig 00072). Drives the HARD putaway gate:
 *  a SKU may only be placed on a level whose role it allows. `undefined` /
 *  NULL on a location means "unconstrained" — every legacy bin keeps working.
 *
 *  Since mig 00081 the vocabulary is operator-managed (`level_roles`), so this
 *  is a bare string rather than a closed union: `'pick' | 'reserve' | 'bulk'`
 *  are the seeded keys, not the only legal ones. Never compare against a
 *  literal to decide behaviour — read the semantic flags off the role record
 *  (`isPickZone`, `replenSourceRank`, `huTypes`) via `@/lib/levelRoles`. */
export type LevelRole = string;

/** One row of `level_roles` (mig 00081). Re-exported from the pure engine module
 *  so both runtimes share one shape; the helpers live in `@/lib/levelRoles`. */
export type { LevelRoleRecord } from '@/supabase/functions/_shared/wie/levelRoles';

/** One addressable level of a rack. Persisted as a SHELF-kind `locations` row
 *  (child of a RACK-kind parent) plus its own co-located `layout_placements`
 *  row. Positions within a level are deliberately NOT modelled yet. */
export interface RackLevel {
    /** Present once saved; absent on a level drafted in the designer. */
    locationId?: number;
    /** 1-based, counting from the floor up. L1 is the bottom level. */
    levelIndex: number;
    role: LevelRole;
    /** Derived as `<rack code>-L<levelIndex>` when created. */
    code?: string;
    capacitySlots?: number;
    slotKind?: 'pallet' | 'carton';
    weightCapacityKg?: number;
}

/** A user-managed physical storage-unit type (mig 00056) — Pallet Rack, Shelving,
 *  Bulk Floor, Cold Room, …. Supplies default capacity/slot behaviour when a rack
 *  is placed; the engine still reads slot_kind/capacity_slots directly. */
export interface StorageType {
    id: number;
    code: string;
    name: string;
    defaultCapacitySlots?: number;
    slotUnit: SlotUnit;
    attributes: Record<string, unknown>;
    isActive: boolean;
    sortOrder: number;
    // Storage-forms capacity model (mig 00061). Structured capacity: when both
    // levels & positionsPerLevel are set, slots = levels × positionsPerLevel.
    levels?: number;
    positionsPerLevel?: number;
    /** Max weight this form can hold, kg (undefined = no limit). Enforced in putaway. */
    weightCapacityKg?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    /** Hex fill for the Layout Designer palette. */
    color?: string;
    /** Whether this form appears as a drawable tool in the Layout Designer. */
    isDrawable: boolean;
    /** Whether this form carries a STANDARD level layout (mig 00072) — a
     *  non-empty `levelTemplate` is a system invariant of it being true.
     *  False on plenty of real racking that simply has no template configured
     *  (MAIN's own bay forms), so it is NOT the test for "can be levelled";
     *  see `isFloor`. */
    hasLevels: boolean;
    /** Stock stands on the slab: no upright, no beam, so a bin of this form can
     *  never be split into addressable levels (mig 00100). Operator-set. */
    isFloor: boolean;
    /** The STANDARD level layout every rack drawn with this form inherits.
     *  Individual racks override it; see `RackLevel`. */
    levelTemplate?: RackLevel[];
}

// The 8 seeded types keep autocomplete; custom operator-defined types (mig 00057
// dropped the CHECK) are accepted as free text via the `(string & {})` member.
export type ZoneType =
    | 'fast_moving' | 'slow_moving' | 'hazardous' | 'cold'
    | 'bulk' | 'returns' | 'quarantine' | 'overflow'
    | (string & {});

/** Operational semantics for a ZONE location (WIE Phase 2). */
export interface ZoneProfile {
    id: number;
    name: string;
    zoneType: ZoneType;
    priorityWeight: number;
    allowedCategories?: string[];
    maxUtilizationPct?: number;
    isActive: boolean;
    /** Stock in a zone of this profile is HELD (mig 00101): on hand, but not
     *  allocatable, and not a putaway target for ordinary receipts. Moving it
     *  out is the release. Never inferred from `zoneType` — that is free text an
     *  operator can invent. */
    isHold: boolean;
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
    /** The published layout serving this warehouse (mig 00045). Null until a layout
     *  is published; nulled again on archive — a lightweight "is racked+published" flag. */
    activeLayoutId?: number;
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

// ── Warehouse Intelligence Engine (WIE) ──────────────────────────────────────

export type LayoutStatus = 'draft' | 'published' | 'archived';
/** `area` (mig 00090) is an operator-named region wash — "Cold Storage", "Bulk".
 *  It carries `meta.name` (its identity; contiguous cells sharing one merge into
 *  a single labelled region) and optionally `meta.zoneProfileId`. */
export type LayoutObjectType = 'wall' | 'dock' | 'walkway' | 'obstacle' | 'label' | 'lift' | 'conveyor' | 'staging' | 'area';

/** A versioned warehouse layout (spatial digital twin). One published per warehouse. */
export interface WarehouseLayout {
    id: number;
    warehouseId: number;
    name: string;
    status: LayoutStatus;
    version: number;
    clonedFrom?: number;
    gridWidth: number;
    gridHeight: number;
    /** Real metres spanned by one grid cell. Every distance the engine reports is
     *  linear in this, so it is what makes those metres mean anything. */
    cellSizeM: number;
    floorCount: number;
    publishedAt?: string;
    createdAt: string;
    updatedAt: string;
    /** DERIVED, not a column: this layout is published but its header has moved
     *  since, so the travel graph frozen at publish no longer describes it.
     *  See toWarehouseLayout for why the timestamps can carry this. */
    needsRepublish: boolean;
}

/** Geometry of a storage location (bin/rack/zone) within a layout. */
export interface LayoutPlacement {
    id: number;
    layoutId: number;
    locationId: number;
    floor: number;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: 0 | 90 | 180 | 270;
    graphNodeId?: number;
    accessOffsetM?: number;
    /** Which level of its rack this placement is (mig 00072). Levels of one rack
     *  share the same (floor, x, y); undefined = a legacy single-bin placement.
     *  Renderers MUST group placements by (floor, x, y) and draw one rect per
     *  group, or a levelled rack paints N overlapping cells. */
    levelIndex?: number;
}

/** A non-storage grid object (wall/dock/walkway/obstacle/label) within a layout. */
export interface LayoutObject {
    id: number;
    layoutId: number;
    objectType: LayoutObjectType;
    floor: number;
    x: number;
    y: number;
    w: number;
    h: number;
    meta: Record<string, unknown>;
    stagingLocationId?: number;
}

// ── WIE rules, SKU attributes, compatibility (Phase 3) ───────────────────────

export type WieRuleType = 'putaway' | 'picking' | 'slotting';
export type WieEnforcement = 'hard' | 'soft';
export type WieRuleOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'exists';

export interface WieRuleCondition {
    subject: 'product' | 'bin' | 'zone';
    attr: string;
    op: WieRuleOp;
    value?: unknown;
}

export interface WieRuleAction {
    effect: 'require' | 'forbid' | 'boost' | 'penalty';
    target?: { scope: 'bin' | 'zone'; attr: string; op: WieRuleOp; value?: unknown };
    delta?: number;
}

export interface WieRuleDefinition {
    conditions: WieRuleCondition[];
    conditionLogic?: 'and' | 'or';
    action: WieRuleAction;
}

export interface WieRule {
    id: number;
    warehouseId?: number;
    name: string;
    ruleType: WieRuleType;
    enforcement: WieEnforcement;
    priority: number;
    definition: WieRuleDefinition;
    isActive: boolean;
}

export type ShelfLifePolicy = 'FEFO' | 'FIFO';

export interface ProductWmsAttributes {
    productId: number;
    hazardClass?: string;
    tempMin?: number;
    tempMax?: number;
    shelfLifePolicy?: ShelfLifePolicy;
    stackable?: boolean;
    handlingType?: string;
    weightKg?: number;
    volumeL?: number;
    dims?: Record<string, unknown>;
    custom: Record<string, unknown>;
    /** Level roles this SKU may be put away into (mig 00072). undefined = ANY
     *  role. An empty array is never persisted — see mutate-wms-attributes. */
    allowedLevelRoles?: LevelRole[];
}

export type CompatibilityLevel = 'forbidden' | 'restricted' | 'allowed';

export interface CategoryCompatibility {
    categoryA: string;
    categoryB: string;
    level: CompatibilityLevel;
    note?: string;
}

// ── WIE velocity, scoring weights, re-slotting (Phase 4) ─────────────────────

export interface WieScoringWeights {
    travelDistance: number;
    capacityFit: number;
    grouping: number;
    zonePreference: number;
    congestion: number;
    velocityMatch: number;
}

export interface WieScoringProfile {
    warehouseId: number;
    weights: WieScoringWeights;
}

export type VelocityClass = 'A' | 'B' | 'C';

export interface WieProductVelocity {
    warehouseId: number;
    productId: number;
    picks7d: number;
    picks30d: number;
    picks90d: number;
    qty30d: number;
    velocityClass?: VelocityClass;
}

/** Recent pick traffic at a single walkway/graph node — feeds the congestion overlay. */
export interface WieLocationTraffic {
    layoutId: number;
    graphNodeId: number;
    pickVisits30d: number;
}

export type SlottingStatus = 'suggested' | 'accepted' | 'rejected' | 'expired';

export interface SlottingSuggestion {
    id: number;
    warehouseId: number;
    productId: number;
    fromLocationId: number;
    toLocationId: number;
    qty: number;
    expectedGainM: number;
    reason: Record<string, unknown>;
    status: SlottingStatus;
    /** 'reoptimize' = travel-only batch pass; 'reslot' = pre-publish relocation plan. */
    origin: 'reoptimize' | 'reslot';
    /** Groups every move from one publish's relocation plan (reslot origin only). */
    planBatch?: string;
    createdAt: string;
    decidedAt?: string;
}

// ── WIE reporting (Phase 7) ──────────────────────────────────────────────────

export interface WarehouseReport {
    putaway: Record<string, number>;
    slotting: Record<string, number>;
    velocity: Record<string, number>;
    binCount: number;
    emptyBins: number;
    utilizationPct: number | null;
    congestion: Array<{ node: number; visits: number }>;
    latestSimulation: {
        id: number;
        kpis: SimulationKpis;
        diff: SimulationKpiDiff | null;
        params: { days: number; orderCount: number };
        createdAt: string;
    } | null;
}

/**
 * One operator sign-off on a warehouse setup step (mig 00092).
 *
 * The row EXISTING is the acknowledgement — there is no `done` flag and no
 * revoked state, so revoking is a delete. Only the sign-off steps are stored;
 * the derived ones are read from the database on every render.
 */
export interface WarehouseSetupAck {
    id: number;
    warehouseId: number;
    stepKey: string;
    note: string | null;
    acknowledgedBy: string | null;
    acknowledgedAt: string;
}

// ── WIE analytical simulation (Phase 6) ──────────────────────────────────────

export interface SimulationKpis {
    orderCount: number;
    totalTravelM: number;
    avgTravelPerOrderM: number;
    utilizationPct: number | null;
    binsUsed: number;
    binsTotal: number;
    congestionByNode: Array<{ graphNodeId: number; visits: number }>;
    unreachableStops: number;
}

export interface SimulationKpiDiff {
    totalTravelDeltaM: number;
    travelDeltaPct: number | null;
    avgTravelDeltaM: number;
    utilizationDeltaPct: number | null;
    /** True when the target leaves more bins unreachable than the baseline, so its
     *  lower travel is partly an artefact of not serving them (not apples-to-apples). */
    coverageWarning?: boolean;
}

export interface SimulationResult {
    simulationId: number;
    params: { days: number; orderCount: number };
    kpis: SimulationKpis;
    baselineKpis: SimulationKpis | null;
    diff: SimulationKpiDiff | null;
}

// ── WIE pick routing (Phase 5) ───────────────────────────────────────────────

export interface PickRouteStop {
    sequence: number;
    locationId: number;
    code: string | null;
    productId: number | null;
    orderItemId: number | null;
    orderId: string | null;
    qtyBase: number;
    legDistanceM: number;
}

export interface PickRoute {
    stops: PickRouteStop[];
    totalDistanceM: number;
    unreachableCount: number;
}

export type ScoringFactorName =
    | 'travel_distance'
    | 'capacity_fit'
    | 'grouping'
    | 'zone_preference'
    | 'congestion'
    | 'velocity_match';

export interface FactorBreakdown {
    factor: ScoringFactorName;
    weight: number;
    rawValue: number;
    normalized: number;
    weighted: number;
    detail: string;
}

export interface RuleTrigger {
    ruleId: number;
    name: string;
    effect: 'boost' | 'penalty';
    delta: number;
}

export interface CandidateBreakdown {
    locationId: number;
    locationCode: string;
    totalScore: number;
    factors: FactorBreakdown[];
    ruleTriggers: RuleTrigger[];
}

/** The reason a bin was hard-filtered out of putaway. A CLOSED set — the engine
 *  (supabase/functions/_shared/wie/scoring.ts) only ever emits these literals.
 *  Kept as a union (not `string`) so a mis-cased comparison like
 *  'LEVEL_ROLE_MISMATCH' is a compile error, not a silently-dead branch — which
 *  is exactly how the role-mismatch banner shipped broken once. */
export type HardFilterCode =
    | 'unreachable'
    | 'capacity'
    | 'weight'
    | 'zone_category'
    | 'compatibility'
    | 'rule'
    | 'level_role_mismatch';

export interface HardFilterReason {
    ruleId: number | null;
    code: HardFilterCode;
    label: string;
    rejectedCount: number;
    sample: Array<{ locationId: number; code: string; reason: string }>;
}

export interface PutawayExplanation {
    engineVersion: string;
    layoutId: number;
    candidatesConsidered: number;
    hardFilters: HardFilterReason[];
    winner: CandidateBreakdown | null;
    alternatives: CandidateBreakdown[];
    /** Set when the destination was decided WITHOUT scoring — today only a line
     *  riding on a plate an earlier line of the same receipt already placed
     *  (mig 00078). Mirrors _shared/wie/types.ts. */
    note?: string;
}

/** Engine recommendation for one received line (as returned by recommend-putaway). */
export interface PutawayLineRecommendation {
    recommendationId: number;
    productId: number;
    quantity: number;
    recommendedLocationId: number | null;
    alternatives: CandidateBreakdown[];
    explanation: PutawayExplanation;
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
    packSize?: number; // undefined for single unit, else the chosen UOM's factorToBase
    uomId?: number;    // chosen UOM (mig 00067); undefined/base = per-unit line
}

export type OrderStatus = 'processing' | 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered';

export interface StatusHistoryEntry {
    status: OrderStatus;
    timestamp: string;
    note?: string;
}

export type DeliveryTimeSlot = 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)';

/** Snapshot of where one order ships, taken at creation time (mig 00021).
 *  Distinct from `HoReCa.address`, which is the customer's standing address:
 *  an inbound PO carries its own "Deliver To" block and a customer can ship to
 *  several sites. Absent means "use the HoReCa's address" — that is what NULL
 *  in the column means, and legacy orders predate it entirely. */
export interface OrderDeliveryAddress {
    street: string;
    city?: string | null;
    postcode?: string | null;
    country?: string | null;
    recipientName?: string | null;
}

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
    // Per-order shipping snapshot. Undefined for legacy orders and whenever the
    // source document printed no usable address — read through
    // lib/orderDeliveryAddress.ts, which applies the HoReCa fallback.
    deliveryAddress?: OrderDeliveryAddress;
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

export type NotificationType = 'low_stock' | 'order_status' | 'invoice' | 'system' | 'system_alert' | 'route_assigned' | 'route_completed' | 'change_request' | 'change_approved' | 'change_rejected';

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
    // PO-Inbox auto-approval policy toggles (migs 00044, 00088). All default true.
    poAutoApproveEnabled: boolean;
    poAutoApproveBlockOnShortStock: boolean;
    poAutoApproveBlockOnSenderMismatch: boolean;
    poAutoApproveBlockOnCustomerMismatch: boolean;
}

export interface PantryItem {
    productId: number;
    preferredPackSize: number | undefined; // undefined = single unit, else UOM factorToBase
    preferredUomId?: number;               // chosen UOM (mig 00067); kept in sync with packSize
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