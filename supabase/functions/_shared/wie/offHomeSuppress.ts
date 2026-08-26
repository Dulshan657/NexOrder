// Off-home dismissal suppression — the rule that decides whether a bin the
// operator has already refused should be raised again.
//
// ── WHY THE DISMISSAL CARRIES A QUANTITY ────────────────────────────────────
//
// A dismissal is a statement about a SITUATION, not about a bin. "Double-stacked
// behind the Ryobi pallets" is true of the pile that is there today; it says
// nothing about the pile that is there after another delivery. So the dismissed
// QUANTITY is the high-water mark: the same stock or less stays silent, and more
// stock arriving is a new situation the operator has not refused.
//
// Suppressing on the (warehouse, product, bin) triple unconditionally is the
// other answer, and it is worse: an operator would have to REMEMBER to lift a
// dismissal, and forgetting is silent. The quantity rule needs nobody to
// remember anything. A deliberate `restore` exists alongside it (see
// mutate-offhome-task) for the dismissal made in error or overtaken by events —
// it is the act you take when you know, not the maintenance you must not forget.
//
// Pure: no I/O, no Deno globals. Under the __tests__/wie/purity.test.ts contract
// so the sweep's decision is testable without a database.

/** A dismissed row, reduced to the three fields the rule reads. */
export interface DismissedRow {
  product_id: number | string
  from_location_id: number | string
  quantity: number | string
}

/** The map key. One dismissal covers one product in one bin. */
export function binKey(productId: number | string, locationId: number | string): string {
  return `${productId}:${locationId}`
}

/**
 * Fold dismissed rows into the largest quantity refused per (product, bin).
 *
 * The LARGEST, not the latest: two dismissals of the same bin mean the operator
 * has said no twice, and the higher figure is the one that has actually been
 * refused. Taking the latest would let a small later dismissal re-open a pile
 * somebody already declined at full size.
 *
 * Rows must already be filtered to `status = 'dismissed'` and to one warehouse.
 * A row whose status has moved on — `expired`, because a restore lifted it — is
 * simply absent, which is how a restore takes effect here with no branch of its
 * own.
 */
export function dismissalHighWater(rows: ReadonlyArray<DismissedRow>): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    const key = binKey(row.product_id, row.from_location_id)
    const qty = Number(row.quantity)
    if (!Number.isFinite(qty)) continue
    out.set(key, Math.max(out.get(key) ?? 0, qty))
  }
  return out
}

/**
 * Should this bin raise a task, given what has been dismissed for it?
 *
 * `dismissed` is `undefined` when nothing has been refused here — including
 * after a restore, which expires the rows rather than rewriting this rule.
 */
export function shouldRaise(qty: number, dismissed: number | undefined): boolean {
  if (dismissed === undefined) return true
  return qty > dismissed
}
