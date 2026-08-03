// Stocktake variance planning — the one definition, for both runtimes.
//
// A count sheet gives the operator ONE number per SKU per location. Turning that
// number into stock movements is not one decision but three, and all three are
// here so the sheet's prediction and the server's write cannot disagree:
//
//   1. which lot absorbs a surplus,
//   2. which lots give up a shortfall, and in what order,
//   3. whether the shortfall is legal at all given what is reserved.
//
// WHY THIS MODULE EXISTS AT ALL. `inv_adjust_stock` (mig 00075 §7) already
// spreads a shortfall across the PLATES of a slot — but only within one batch:
//
//     WHERE product_id = p_product_id
//       AND location_id = p_location_id
//       AND COALESCE(batch_id, 0) = COALESCE(v_batch_id, 0)
//
// So `p_batch_id => NULL` names the UNTRACKED slot; it does not mean "every
// lot". A one-number-per-SKU count therefore cannot be a single RPC call. This
// module does the BATCH fan-out and hands each batch to the RPC, which does the
// PLATE fan-out inside it. Nothing here restates the plate rule — that would be
// two copies of it.
//
// PURITY: no Deno globals, no I/O, no imports. `lib/binCount.ts` re-exports it
// for the browser (same shape as _shared/wie/levelRoles.ts ↔ lib/levelRoles.ts).

/** One `inventory_balances` row for a product at the location being counted,
 *  reduced to the four fields the plan actually turns on. Several rows may share
 *  a `batchId` — one per handling unit — and they are summed here, because the
 *  RPC is what decides which plate within a batch gives up the units. */
export interface CountSlot {
  batchId: number | null
  /** FEFO key. Null sorts last: a lot with no stated expiry is not urgent, and
   *  guessing that it is would consume dated stock in the wrong order. */
  expiryDate: string | null
  onHand: number
  allocated: number
}

/** One `inv_adjust_stock` call the server should make for this line. */
export interface CountTake {
  batchId: number | null
  /** Signed, exactly as `p_qty_delta` wants it: negative for a shortfall,
   *  positive for the single surplus take. */
  qtyDelta: number
}

export interface CountVarianceOk {
  ok: true
  systemQty: number
  countedQty: number
  delta: number
  takes: CountTake[]
  /** True when a surplus could not be attributed to a lot and was booked as
   *  untracked stock. The sheet says so; nothing branches on it server-side. */
  surplusIsUntracked: boolean
}

export interface CountVarianceRefused {
  ok: false
  code: 'BELOW_ALLOCATED'
  systemQty: number
  countedQty: number
  /** How far the line COULD be reduced — Σ(onHand − allocated). The difference
   *  between this and the requested reduction is what is reserved. */
  reducible: number
}

export type CountPlan = CountVarianceOk | CountVarianceRefused

/** Σ on_hand across every lot and plate of this product at the location. */
export function systemQtyOf(slots: readonly CountSlot[]): number {
  return slots.reduce((sum, s) => sum + s.onHand, 0)
}

/** How much of this line can legally be removed. `inv_transfer_stock` and the
 *  `inventory_balances_alloc_bound` CHECK both work on available, not on_hand,
 *  so this is the real ceiling on a write-off. */
export function reducibleQtyOf(slots: readonly CountSlot[]): number {
  return slots.reduce((sum, s) => sum + Math.max(0, s.onHand - s.allocated), 0)
}

/**
 * Which lot a surplus belongs to.
 *
 * Exactly one lot holding stock → that lot; the surplus obviously belongs to it
 * and booking it anywhere else would invent a second, expiry-less balance row
 * that FEFO then has nothing to order by.
 *
 * Zero or several → `null` (untracked). With two lots in the bin nobody knows
 * which the extra cartons came off, and stamping one of them asserts an expiry
 * date the operator never stated. Untracked is the honest answer, and the sheet
 * says so rather than hiding it.
 */
export function surplusBatchFor(slots: readonly CountSlot[]): number | null {
  const stocked = slots.filter((s) => s.onHand > 0 && s.batchId != null)
  const distinct = new Set(stocked.map((s) => s.batchId as number))
  return distinct.size === 1 ? (stocked[0].batchId as number) : null
}

/** FEFO order for consumption: earliest expiry first, undated last, then by
 *  batch id so the result is stable for a given input. Untracked stock (no
 *  batch) has no expiry and therefore also sorts last — which is right, since
 *  dated stock is the stock with a deadline. */
function fefo(a: CountSlot, b: CountSlot): number {
  if (a.expiryDate !== b.expiryDate) {
    if (a.expiryDate == null) return 1
    if (b.expiryDate == null) return -1
    return a.expiryDate < b.expiryDate ? -1 : 1
  }
  const aId = a.batchId ?? Number.MAX_SAFE_INTEGER
  const bId = b.batchId ?? Number.MAX_SAFE_INTEGER
  return aId - bId
}

/** Collapse plate-level rows to one entry per batch — the granularity the RPC
 *  is called at. */
function byBatch(slots: readonly CountSlot[]): CountSlot[] {
  const merged = new Map<number, CountSlot>()
  for (const s of slots) {
    const key = s.batchId ?? 0
    const existing = merged.get(key)
    if (existing) {
      merged.set(key, {
        batchId: existing.batchId,
        // Every row of a batch carries that batch's expiry; keep the first
        // non-null rather than assuming they agree.
        expiryDate: existing.expiryDate ?? s.expiryDate,
        onHand: existing.onHand + s.onHand,
        allocated: existing.allocated + s.allocated,
      })
    } else {
      merged.set(key, { ...s })
    }
  }
  return [...merged.values()]
}

/**
 * Turn a counted total into the exact set of `inv_adjust_stock` calls that
 * realise it — or a refusal.
 *
 * A shortfall larger than what is unreserved is refused OUTRIGHT, and no take
 * is emitted for the line at all. Applying the legal part would leave the SKU
 * showing a number matching neither the count nor the prior belief, and the
 * operator could not re-count it later without double-applying the part that
 * already landed. Refusing whole means the line is exactly as re-countable as
 * it was before someone tried.
 *
 * Callers must not pass a negative `countedQty`; a count is a tally.
 */
export function planCountVariance(slots: readonly CountSlot[], countedQty: number): CountPlan {
  const systemQty = systemQtyOf(slots)
  const delta = countedQty - systemQty

  if (delta === 0) {
    return { ok: true, systemQty, countedQty, delta: 0, takes: [], surplusIsUntracked: false }
  }

  if (delta > 0) {
    const batchId = surplusBatchFor(slots)
    return {
      ok: true,
      systemQty,
      countedQty,
      delta,
      takes: [{ batchId, qtyDelta: delta }],
      surplusIsUntracked: batchId == null,
    }
  }

  const required = -delta
  const reducible = reducibleQtyOf(slots)
  if (reducible < required) {
    return { ok: false, code: 'BELOW_ALLOCATED', systemQty, countedQty, reducible }
  }

  const takes: CountTake[] = []
  let remaining = required
  for (const slot of byBatch(slots).sort(fefo)) {
    if (remaining <= 0) break
    const available = Math.max(0, slot.onHand - slot.allocated)
    if (available <= 0) continue
    const take = Math.min(remaining, available)
    takes.push({ batchId: slot.batchId, qtyDelta: -take })
    remaining -= take
  }

  return { ok: true, systemQty, countedQty, delta, takes, surplusIsUntracked: false }
}
