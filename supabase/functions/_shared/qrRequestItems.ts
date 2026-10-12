// The lines of a held QR order (`qr_order_requests.items`, mig 00129): their
// stored shape, how a request's lines are told apart from an approver's edit, and
// how a stored row is turned back into the input `placeOrderCore` takes.
//
// Pure for the same reason `qrRequestTransitions.ts` is: no Deno, no I/O, driven
// by `__tests__/qrRequestItems.test.ts`, imported unchanged by `qr-order-request`.
//
// A stored line is what `place-order` takes (`productId`, `quantity`, `packSize`,
// `uomId`) PLUS a name snapshot. The snapshot exists so the request can be shown
// ("2 x Fresh Cream 1L") without re-reading `products`, and so it still reads
// sensibly if the product is renamed or deactivated while the request waits. It
// is never an input: the price is resolved at approval, from the product as it is
// THEN, and a name carried here must never reach pricing.

import { findInvalidOrderItem, type OrderLineInput } from './orderPricing.ts'

export interface QrRequestLine {
  productId: number
  quantity: number
  packSize: number | null
  uomId: number | null
  /** Display only. */
  productName?: string
  /** Display only. */
  productSku?: string
}

/** The most lines one request may hold. A kitchen reorder is a few dozen at most. */
export const QR_MAX_LINES = 200
/** The largest quantity on one line. Stops a typo becoming a six-figure order. */
export const QR_MAX_LINE_QUANTITY = 10_000

/** Strip the display snapshot: what `placeOrderCore` is allowed to see. */
export function toOrderLines(lines: ReadonlyArray<QrRequestLine>): OrderLineInput[] {
  return lines.map((l) => ({
    productId: l.productId,
    quantity: l.quantity,
    packSize: l.packSize ?? null,
    uomId: l.uomId ?? null,
  }))
}

/**
 * Validate lines arriving from a client, returning the first reason they are
 * unusable or null. Wraps `place-order`'s own check so a held order refuses
 * exactly what a live one would, then adds the bounds a held order needs and a
 * live one gets for free from the rate limit.
 */
export function findInvalidRequestLines(lines: ReadonlyArray<Partial<QrRequestLine>>): string | null {
  if (lines.length === 0) return 'An order needs at least one item'
  if (lines.length > QR_MAX_LINES) return `An order can hold at most ${QR_MAX_LINES} lines`
  const base = findInvalidOrderItem(lines)
  if (base) return base
  for (const l of lines) {
    if ((l.quantity as number) > QR_MAX_LINE_QUANTITY) {
      return `A single line can hold at most ${QR_MAX_LINE_QUANTITY} units`
    }
    if (l.packSize != null && (typeof l.packSize !== 'number' || !(l.packSize > 0))) {
      return 'packSize must be a positive number when provided'
    }
  }
  return null
}

/**
 * Read `items` back from the database. The column is JSONB behind only a
 * "non-empty array" CHECK, so the contents are re-validated here rather than
 * trusted: a row written by an older version, or by hand, must not reach
 * `placeOrderCore` malformed. Returns null when anything is wrong.
 */
export function parseStoredLines(value: unknown): QrRequestLine[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: QrRequestLine[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const line: QrRequestLine = {
      productId: r.productId as number,
      quantity: r.quantity as number,
      packSize: typeof r.packSize === 'number' ? r.packSize : null,
      uomId: typeof r.uomId === 'number' ? r.uomId : null,
    }
    if (typeof r.productName === 'string') line.productName = r.productName
    if (typeof r.productSku === 'string') line.productSku = r.productSku
    out.push(line)
  }
  return findInvalidRequestLines(out) === null ? out : null
}

function lineKey(l: Pick<QrRequestLine, 'productId' | 'uomId' | 'packSize'>): string {
  return `${l.productId}:${l.uomId ?? ''}:${l.packSize ?? ''}`
}

/** Quantity per distinct (product, UOM, pack) -- duplicate lines add up, order is irrelevant. */
function totals(lines: ReadonlyArray<QrRequestLine>): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of lines) out.set(lineKey(l), (out.get(lineKey(l)) ?? 0) + l.quantity)
  return out
}

/**
 * Did an approver change what was asked for? Compared on what is ORDERED, so
 * reordering the lines, or splitting one into two that add up, is not an edit and
 * does not flag the order "edited by approver".
 */
export function linesDiffer(before: ReadonlyArray<QrRequestLine>, after: ReadonlyArray<QrRequestLine>): boolean {
  const a = totals(before)
  const b = totals(after)
  if (a.size !== b.size) return true
  for (const [key, qty] of a) {
    if (b.get(key) !== qty) return true
  }
  return false
}

/** Attach the display snapshot (name, SKU) from a priced preview to the lines as submitted. */
export function withSnapshot(
  lines: ReadonlyArray<QrRequestLine>,
  priced: ReadonlyArray<{ productId: number; productName: string; productSku: string }>,
): QrRequestLine[] {
  const byProduct = new Map<number, { productName: string; productSku: string }>()
  for (const p of priced) if (!byProduct.has(p.productId)) byProduct.set(p.productId, p)
  return lines.map((l) => {
    const known = byProduct.get(l.productId)
    return known ? { ...l, productName: known.productName, productSku: known.productSku } : { ...l }
  })
}

// ── what a kitchen may ask for ──────────────────────────────────────────────

/** A held order may be dated at most this many days past today. */
export const QR_MAX_DELIVERY_DAYS_AHEAD = 90

const DAY_MS = 86_400_000

/**
 * Why a requested delivery date is unusable, or null when it is fine (or absent).
 * The window is today through today + 90 days, by the UTC calendar date: an order
 * dated yesterday cannot be delivered, and one dated years out is a typo that
 * would sit in the approvers' queue until somebody noticed. `date` is the
 * already-validated `YYYY-MM-DD` the schema accepts.
 */
export function deliveryDateProblem(date: string | null | undefined, now: Date): string | null {
  if (date == null || date === '') return null
  const today = now.toISOString().slice(0, 10)
  const latest = new Date(now.getTime() + QR_MAX_DELIVERY_DAYS_AHEAD * DAY_MS).toISOString().slice(0, 10)
  if (date < today) return 'The delivery date cannot be in the past.'
  if (date > latest) return `Choose a delivery date within the next ${QR_MAX_DELIVERY_DAYS_AHEAD} days.`
  return null
}

/**
 * The first requested product that exists but is switched off, or null.
 * `rows` are the products as read from the database for the requested ids; an id
 * with no row is the pricing dry run's `PRODUCT_NOT_FOUND`, not this check's.
 * `placeOrderCore` does not look at `is_active` (and must not change for this), so
 * without the check a kitchen could keep ordering something the catalogue has
 * retired.
 */
export function firstInactiveProduct(
  rows: ReadonlyArray<{ id: number; name?: string | null; is_active: boolean | null }>,
  lines: ReadonlyArray<Pick<QrRequestLine, 'productId'>>,
): { id: number; name: string } | null {
  const byId = new Map(rows.map((r) => [Number(r.id), r]))
  for (const line of lines) {
    const row = byId.get(line.productId)
    if (row && row.is_active === false) {
      return { id: line.productId, name: row.name?.trim() || `Product ${line.productId}` }
    }
  }
  return null
}
