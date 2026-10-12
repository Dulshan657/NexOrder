// Order pricing and business-rule checks — the PURE half of order placement.
//
// WHY THIS IS ITS OWN MODULE. `placeOrderCore.ts` runs the same placement
// logic for two callers: `place-order` (a live cart) and, later, the approval
// of a held kitchen order. Both must price, check stock, minimum and credit by
// the same arithmetic or the preview an approver sees disagrees with the order
// the system then writes. Everything here is arithmetic and decision-making on
// data already in memory, so it carries no Deno global, no URL import and no I/O
// and vitest can drive it directly (`__tests__/orderPricing.test.ts`). The
// reads and writes live in `placeOrderCore.ts`.
//
// EVERY CHECK RETURNS A PROBLEM; NONE THROWS. A live placement turns the first
// problem into an HTTP error; a dry run (the approver's preview) shows all of
// them at once. Which of those a caller does is the caller's business — the
// functions below only decide whether a rule is broken, and say so in the exact
// words `place-order` has always used for it.
//
// The wire strings in the messages below are part of the frontend contract
// (`extractFunctionErrorMessage` surfaces them to the user verbatim and
// `__tests__/orderService.placeOrder.test.ts` quotes one). Reword them and you
// have changed the product, not refactored it.

import {
  applyCartPromotions,
  lineBaseUnits,
  resolveLineUnitPrice,
  resolveUomLineUnitPrice,
  type BogoFreeLine,
  type BundleDiscountLine,
  type HoReCa,
  type Product,
  type Promotion,
  type ResolvedItem,
  type UserContext,
} from './pricing.ts'

// ── shapes ──────────────────────────────────────────────────────────────────

/** A product's UOM rows, trimmed to what pricing needs (mig 00067). */
export interface LineUom {
  id: number
  factorToBase: number
  price: number
  isBase: boolean
}

export type PricedProduct = Product & { name: string; sku: string; uoms: LineUom[] }

/** One cart line as the client (or a held request) states it. */
export interface OrderLineInput {
  productId: number
  quantity: number
  packSize?: number | null
  uomId?: number | null
}

/** The business rules a placement can break. */
export type OrderProblemCode =
  | 'HORECA_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'BELOW_MINIMUM'
  | 'CREDIT_EXCEEDED'

/**
 * One broken rule. `code` and `message` are exactly what a live placement would
 * answer with; the optional fields carry the numbers a UI needs to render the
 * problem without parsing the message.
 */
export interface OrderProblem {
  code: OrderProblemCode
  message: string
  /** INSUFFICIENT_STOCK / PRODUCT_NOT_FOUND: the product concerned. */
  productId?: number
  /** INSUFFICIENT_STOCK: base units asked for. */
  requested?: number
  /** INSUFFICIENT_STOCK: base units available in the warehouses the order draws from. */
  available?: number
  /** BELOW_MINIMUM / CREDIT_EXCEEDED: the order total that tripped it. */
  total?: number
  /** BELOW_MINIMUM: the configured minimum order value. */
  minimum?: number
  /** CREDIT_EXCEEDED: the limit in force. */
  limit?: number
  /** CREDIT_EXCEEDED: unpaid invoices before this order. */
  outstanding?: number
}

/** A resolved line plus the figures a preview shows beside it. */
export interface PricedLine extends ResolvedItem {
  /** unitPrice × quantity, to the cent. */
  lineTotal: number
  /** quantity × pack factor — the unit stock is counted in. */
  baseUnits: number
}

/** Stock position of one product against what the order needs (base units). */
export interface StockCheckLine {
  productId: number
  productName: string
  requested: number
  available: number
  short: boolean
}

export interface BogoFreeItem {
  productId: number
  freeQuantity: number
  promoId: string
}

/** What a successful live placement returns (and `place-order` answers with, 201). */
export interface PlaceOrderResult {
  orderId: string
  total: number
  cartDiscount: number
  appliedPromotionIds: string[]
  bogoFreeItems: BogoFreeItem[]
}

/**
 * What a dry run returns: the same pricing a live placement would commit, plus
 * EVERY broken rule rather than the first. `ok` is true exactly when `problems`
 * is empty, i.e. when a live placement of the same input would succeed (barring
 * a stock race between this read and that write).
 */
export interface OrderPreview {
  ok: boolean
  problems: OrderProblem[]
  lines: PricedLine[]
  stock: StockCheckLine[]
  /** Before the cart-level promotion discount, to the cent. */
  subtotal: number
  cartDiscount: number
  total: number
  appliedPromotionIds: string[]
  bogoFreeItems: BogoFreeItem[]
  /** The limit in force: the HoReCa's own, else the tenant default; 0 = none. */
  creditLimit: number
  /** Unpaid (pending / overdue) invoices before this order. */
  outstanding: number
  /** 0 = none. */
  minimumOrderValue: number
  hoReCa: { id: number; name: string } | null
}

export interface OrderTotals {
  subtotal: number
  cartDiscount: number
  total: number
  bogoFreeItems: BogoFreeLine[]
  bundleDiscounts: BundleDiscountLine[]
}

// ── input validation ────────────────────────────────────────────────────────

/**
 * The first reason a cart line is malformed, or null when every line is fine.
 * The wording is `place-order`'s INVALID_ITEM message, shared so a second caller
 * of the core refuses the same inputs in the same words.
 */
export function findInvalidOrderItem(items: ReadonlyArray<Partial<OrderLineInput>>): string | null {
  for (const it of items) {
    if (
      typeof it.productId !== 'number' ||
      typeof it.quantity !== 'number' ||
      it.quantity <= 0 ||
      !Number.isInteger(it.quantity)
    ) {
      return 'Each item needs integer productId and positive integer quantity'
    }
    if (it.uomId != null && (!Number.isInteger(it.uomId) || it.uomId <= 0)) {
      return 'uomId must be a positive integer when provided'
    }
  }
  return null
}

// ── line normalisation ──────────────────────────────────────────────────────

/** One PRODUCT_NOT_FOUND problem per distinct unknown id, in cart order. */
export function findMissingProducts(
  productIds: ReadonlyArray<number>,
  productMap: ReadonlyMap<number, unknown>,
): OrderProblem[] {
  return productIds
    .filter((id) => !productMap.has(id))
    .map((id) => ({ code: 'PRODUCT_NOT_FOUND' as const, message: `Product ${id} not found`, productId: id }))
}

/**
 * Resolve each line's pack factor and UOM from the product's own UOM rows
 * (mig 00067) BEFORE aggregation, stock check and pricing, so all three agree
 * and a client-sent `packSize` can never disagree with the authoritative
 * factor. A UOM resolves to: base → per-unit line (packSize null); non-base →
 * its factor. An unknown or absent `uomId` falls back to the legacy client
 * `packSize` path.
 *
 * Lines whose product is not in the map are dropped: callers report those with
 * `findMissingProducts` first, and a dry run keeps going with the rest.
 */
export function normalizeOrderItems(
  items: ReadonlyArray<OrderLineInput>,
  productMap: ReadonlyMap<number, PricedProduct>,
): OrderLineInput[] {
  const out: OrderLineInput[] = []
  for (const it of items) {
    const product = productMap.get(it.productId)
    if (!product) continue
    const uom = it.uomId != null ? product.uoms.find((u) => u.id === it.uomId) : undefined
    const packSize = uom ? (uom.isBase ? null : uom.factorToBase) : (it.packSize ?? null)
    out.push({ productId: it.productId, quantity: it.quantity, packSize, uomId: uom ? uom.id : null })
  }
  return out
}

/**
 * Merge duplicate lines so a cart that lists a product twice counts both toward
 * the stock check. The key includes `uomId` so two distinct UOMs that happen to
 * share a factor never merge. Order of first appearance is preserved — it is
 * the order the first-failure semantics of a live placement depend on.
 */
export function aggregateOrderItems(items: ReadonlyArray<OrderLineInput>): OrderLineInput[] {
  const byKey = new Map<string, OrderLineInput>()
  for (const it of items) {
    const key = `${it.productId}:${it.uomId ?? ''}:${it.packSize ?? ''}`
    const existing = byKey.get(key)
    byKey.set(key, existing ? { ...existing, quantity: existing.quantity + it.quantity } : { ...it })
  }
  return [...byKey.values()]
}

/**
 * Base units needed per product. Inventory is counted in BASE units, but a
 * carton line carries quantity = number of cartons and packSize = units per
 * carton, so each line converts (quantity × packSize) before summing. The
 * stock check and the reservation both read this same map, which is what keeps
 * them in the same unit as the stock.
 */
export function baseUnitsByProduct(aggregated: ReadonlyArray<OrderLineInput>): Map<number, number> {
  const totals = new Map<number, number>()
  for (const it of aggregated) {
    totals.set(it.productId, (totals.get(it.productId) ?? 0) + lineBaseUnits(it.quantity, it.packSize))
  }
  return totals
}

// ── stock ───────────────────────────────────────────────────────────────────

/** Sum `inventory_balances.available` per product across the rows read. */
export function sumAvailableByProduct(
  rows: ReadonlyArray<{ product_id: number; available: number | string }>,
): Map<number, number> {
  const out = new Map<number, number>()
  for (const r of rows) out.set(r.product_id, (out.get(r.product_id) ?? 0) + Number(r.available))
  return out
}

/** Every product's stock position against what the order needs. */
export function stockPositions(
  totalsByProduct: ReadonlyMap<number, number>,
  availByProduct: ReadonlyMap<number, number>,
  productMap: ReadonlyMap<number, { name: string }>,
): StockCheckLine[] {
  return [...totalsByProduct].map(([productId, requested]) => {
    const available = availByProduct.get(productId) ?? 0
    return {
      productId,
      productName: productMap.get(productId)?.name ?? `Product #${productId}`,
      requested,
      available,
      short: available < requested,
    }
  })
}

/**
 * One INSUFFICIENT_STOCK problem per short product, in the order products first
 * appear in the cart. A live placement reports only the first.
 */
export function findStockShortages(
  totalsByProduct: ReadonlyMap<number, number>,
  availByProduct: ReadonlyMap<number, number>,
  productMap: ReadonlyMap<number, { name: string }>,
): OrderProblem[] {
  return stockPositions(totalsByProduct, availByProduct, productMap)
    .filter((s) => s.short)
    .map((s) => ({
      code: 'INSUFFICIENT_STOCK' as const,
      message: `${s.available} of "${s.productName}" available, ${s.requested} requested`,
      productId: s.productId,
      requested: s.requested,
      available: s.available,
    }))
}

// ── pricing ─────────────────────────────────────────────────────────────────

/**
 * Price every aggregated line. An explicit non-base UOM uses that UOM's own list
 * price (mig 00067); the base UOM and legacy packSize-only lines use the
 * carton/per-unit math. The carton discount comes from `app_settings`.
 */
export function priceOrderLines(
  aggregated: ReadonlyArray<OrderLineInput>,
  productMap: ReadonlyMap<number, PricedProduct>,
  hoReCa: HoReCa,
  user: UserContext,
  promotions: ReadonlyArray<Promotion>,
  cartonDiscountPercent: number,
): ResolvedItem[] {
  const promos = [...promotions]
  const resolved: ResolvedItem[] = []
  for (const it of aggregated) {
    const product = productMap.get(it.productId)
    if (!product) continue
    const uom = it.uomId != null ? product.uoms.find((u) => u.id === it.uomId) : undefined
    const { unitPrice, appliedPromotionId } =
      uom && !uom.isBase
        ? resolveUomLineUnitPrice(product, hoReCa, user, promos, uom)
        : resolveLineUnitPrice(product, hoReCa, user, promos, it.packSize ?? null, cartonDiscountPercent)
    resolved.push({
      productId: it.productId,
      quantity: it.quantity,
      packSize: it.packSize ?? null,
      uomId: it.uomId ?? null,
      productName: product.name,
      productSku: product.sku,
      unitPrice,
      appliedPromotionId,
    })
  }
  return resolved
}

/** Subtotal, cart-level promotion discount and the rounded order total. */
export function computeOrderTotals(
  resolved: ReadonlyArray<ResolvedItem>,
  promotions: ReadonlyArray<Promotion>,
  hoReCa: HoReCa,
  user: UserContext,
  productMap: ReadonlyMap<number, Product>,
): OrderTotals {
  const subtotal = resolved.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const { bogoFreeItems, bundleDiscounts, cartDiscount } = applyCartPromotions(
    [...resolved],
    [...promotions],
    hoReCa,
    user,
    new Map(productMap),
  )
  const total = Math.round((subtotal - cartDiscount) * 100) / 100
  return { subtotal, cartDiscount, total, bogoFreeItems, bundleDiscounts }
}

/** The lines as a preview shows them: resolved, plus line total and base units. */
export function toPricedLines(resolved: ReadonlyArray<ResolvedItem>): PricedLine[] {
  return resolved.map((i) => ({
    ...i,
    lineTotal: Math.round(i.unitPrice * i.quantity * 100) / 100,
    baseUnits: lineBaseUnits(i.quantity, i.packSize),
  }))
}

/** Every promotion id that touched the order, once each. */
export function collectAppliedPromotionIds(
  resolved: ReadonlyArray<ResolvedItem>,
  bundleDiscounts: ReadonlyArray<BundleDiscountLine>,
  bogoFreeItems: ReadonlyArray<BogoFreeLine>,
): string[] {
  return [
    ...new Set([
      ...resolved.map((i) => i.appliedPromotionId).filter((x): x is string => !!x),
      ...bundleDiscounts.map((b) => b.promoId),
      ...bogoFreeItems.map((b) => b.promoId),
    ]),
  ]
}

/** The trimmed shape the API returns for free-item promotions. */
export function toBogoFreeItems(bogoFreeItems: ReadonlyArray<BogoFreeLine>): BogoFreeItem[] {
  return bogoFreeItems.map((b) => ({ productId: b.productId, freeQuantity: b.freeQuantity, promoId: b.promoId }))
}

// ── order-level rules ───────────────────────────────────────────────────────

/** BELOW_MINIMUM when a minimum is configured (> 0) and the total is under it. */
export function checkMinimumOrder(total: number, minimumOrderValue: number): OrderProblem | null {
  if (minimumOrderValue > 0 && total < minimumOrderValue) {
    return {
      code: 'BELOW_MINIMUM',
      message: `Order total $${total} is below minimum $${minimumOrderValue}`,
      total,
      minimum: minimumOrderValue,
    }
  }
  return null
}

/**
 * The credit limit in force: the HoReCa's own when it has one (> 0), otherwise
 * the tenant default from `app_settings`. 0 means no limit.
 */
export function resolveCreditLimit(hoReCaCreditLimit: number, defaultCreditLimit: number): number {
  return hoReCaCreditLimit > 0 ? hoReCaCreditLimit : defaultCreditLimit
}

/**
 * CREDIT_EXCEEDED when a limit applies (> 0) and unpaid invoices plus this order
 * would pass it. Not transactional — two orders placed in the same instant can
 * each pass — which is how it has always behaved.
 */
export function checkCreditLimit(creditLimit: number, outstanding: number, total: number): OrderProblem | null {
  if (creditLimit > 0 && outstanding + total > creditLimit) {
    return {
      code: 'CREDIT_EXCEEDED',
      message: `Credit limit $${creditLimit} would be exceeded ($${outstanding} outstanding + $${total} new)`,
      total,
      limit: creditLimit,
      outstanding,
    }
  }
  return null
}
