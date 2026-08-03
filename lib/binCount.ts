// Client-side entry point for the stocktake count sheet.
//
// The variance rules live in the pure shared module so the Edge Function and the
// browser run the very same code — the sheet's live prediction ("this will be
// refused", "this surplus lands as untracked") is not a second implementation of
// the server's decision, it IS the server's decision, evaluated early. This file
// re-exports it under `@/` and adds the things only a form needs: parsing a text
// input, describing a slot list, summarising a sheet, and phrasing a refusal.
//
// Mirrors lib/stockAdjustment.ts, which does the same job for AdjustStockModal.

export {
  planCountVariance,
  systemQtyOf,
  reducibleQtyOf,
  surplusBatchFor,
} from '@/supabase/functions/_shared/binCount'

export type {
  CountSlot,
  CountTake,
  CountPlan,
  CountVarianceOk,
  CountVarianceRefused,
} from '@/supabase/functions/_shared/binCount'

import {
  planCountVariance,
  reducibleQtyOf,
  systemQtyOf,
  type CountPlan,
  type CountSlot,
} from '@/supabase/functions/_shared/binCount'

/** A count sheet line, as the UI holds it: the server's view of this product at
 *  this location, plus whatever the operator has typed. */
export interface CountSheetLine {
  productId: number
  sku: string
  name: string
  barcode: string | null
  /** Every balance row for this product here, one per (batch, plate). */
  slots: CountSheetSlot[]
  /** True for a row the operator added by scanning something the system does not
   *  believe is here. Its `slots` are empty and its system quantity is 0. */
  isFound?: boolean
}

export interface CountSheetSlot extends CountSlot {
  lotCode: string | null
  huId: number | null
  huCode: string | null
}

export type CountEntryStatus = 'blank' | 'invalid' | 'match' | 'surplus' | 'shortfall'

/**
 * Parse the counted-quantity input.
 *
 * Returns `null` for blank, which is NOT zero and never becomes zero: a line
 * nobody typed a number into is a line nobody counted, and writing stock off
 * because someone stopped halfway down a bin would be the worst failure this
 * screen could have. Zero has to be typed.
 *
 * Returns `undefined` for text that is present but unusable (negative, a
 * fraction, letters) so the caller can mark the field invalid rather than
 * silently treating it as uncounted.
 */
export function parseCountedQty(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : undefined
}

/** The plan for one line, or null when there is nothing to plan yet (blank or
 *  invalid input). Pure pass-through to the shared planner — kept as a named
 *  helper so components never have to remember to sum the slots first. */
export function planLine(line: CountSheetLine, text: string): CountPlan | null {
  const counted = parseCountedQty(text)
  if (counted == null) return null
  return planCountVariance(line.slots, counted)
}

export function entryStatus(line: CountSheetLine, text: string): CountEntryStatus {
  const counted = parseCountedQty(text)
  if (counted === null) return 'blank'
  if (counted === undefined) return 'invalid'
  const delta = counted - systemQtyOf(line.slots)
  if (delta === 0) return 'match'
  return delta > 0 ? 'surplus' : 'shortfall'
}

/**
 * The lot/plate breakdown shown under a SKU, e.g.
 * "L2026-07 ×12 on PLT-88 · L2026-09 ×12 loose".
 *
 * This is the whole reason a per-product count is acceptable: the operator can
 * see what the single number they are about to type is standing in for, without
 * being asked to key a figure per lot.
 */
export function describeSlots(slots: readonly CountSheetSlot[]): string {
  const stocked = slots.filter((s) => s.onHand > 0)
  if (stocked.length === 0) return 'nothing recorded here'
  return stocked
    .map((s) => {
      const lot = s.lotCode ? s.lotCode : 'no lot'
      const where = s.huCode ? `on ${s.huCode}` : 'loose'
      return `${lot} ×${s.onHand} ${where}`
    })
    .join(' · ')
}

export interface SheetSummary {
  /** Lines with a usable number typed that differs from the system. */
  variances: number
  surplus: number
  shortfall: number
  /** Typed, and matching — counted but nothing to post. */
  matched: number
  blank: number
  invalid: number
  /** Predicted refusals: a shortfall deeper than the unreserved stock. */
  blocked: number
  /** Net unit movement across every posting line. */
  netUnits: number
}

export function sheetSummary(
  lines: readonly CountSheetLine[],
  counts: Readonly<Record<number, string>>,
): SheetSummary {
  const summary: SheetSummary = {
    variances: 0, surplus: 0, shortfall: 0, matched: 0,
    blank: 0, invalid: 0, blocked: 0, netUnits: 0,
  }
  for (const line of lines) {
    const text = counts[line.productId] ?? ''
    const status = entryStatus(line, text)
    if (status === 'blank') { summary.blank++; continue }
    if (status === 'invalid') { summary.invalid++; continue }
    if (status === 'match') { summary.matched++; continue }

    summary.variances++
    if (status === 'surplus') summary.surplus++
    else summary.shortfall++

    const plan = planLine(line, text)
    if (plan && plan.ok === false) summary.blocked++
    else if (plan && plan.ok === true) summary.netUnits += plan.delta
  }
  return summary
}

/** Every line that would actually be posted — a usable number, differing from
 *  the system quantity. Blank and matching lines are not sent at all; the
 *  server would compute a zero delta and skip them anyway, but leaving them out
 *  keeps the request honest about what the operator changed. */
export function postableLines(
  lines: readonly CountSheetLine[],
  counts: Readonly<Record<number, string>>,
): Array<{ productId: number; countedQty: number }> {
  const out: Array<{ productId: number; countedQty: number }> = []
  for (const line of lines) {
    const counted = parseCountedQty(counts[line.productId] ?? '')
    if (counted == null) continue
    if (counted === systemQtyOf(line.slots)) continue
    out.push({ productId: line.productId, countedQty: counted })
  }
  return out
}

/**
 * Operator-facing phrasing for a line the server refused, or that the sheet can
 * already see will be refused.
 *
 * Names the numbers rather than the error code, and says what to do about it.
 * The specific order holding the reservation is deliberately not named —
 * `inventory_balances.allocated` is a bare total, and attributing it needs
 * `wie_order_alloc_bins` (mig 00064), which this screen does not load.
 */
export function friendlyCountError(
  line: CountSheetLine,
  refusal: { countedQty: number; systemQty: number; reducible: number },
): string {
  const reserved = refusal.systemQty - refusal.reducible
  return (
    `Not posted. ${reserved} of ${refusal.systemQty} unit${reserved === 1 ? ' is' : 's are'} ` +
    `reserved for open orders, so only ${refusal.reducible} can be removed — ` +
    `a count of ${refusal.countedQty} needs ${refusal.systemQty - refusal.countedQty}. ` +
    'Dispatch or cancel those orders, then re-count this line.'
  )
}

/** One entry of `count-bin`'s `results` array. Mirrors the Edge Function's
 *  `LineResult`; `delta` is always what was ACTUALLY applied, so a refusal
 *  carries 0 and the requested variance is `countedQty - systemQty`. */
export interface CountLineResult {
  productId: number
  systemQty: number
  countedQty: number
  delta: number
  ok: boolean
  code?: 'BELOW_ALLOCATED' | 'FAILED'
  message?: string
  reducible?: number
  nowOnHand?: number
  surplusIsUntracked?: boolean
  partial?: boolean
}

export interface CountPostResult {
  locationId: number
  locationCode: string
  posted: number
  refused: number
  results: CountLineResult[]
}

/**
 * What to tell the operator about one line the server has answered on.
 *
 * Returns null for a line that posted cleanly — there is nothing to say about
 * work that simply worked. Everything else gets a sentence naming the numbers
 * and the next action.
 */
export function describeLineResult(result: CountLineResult): string | null {
  if (result.ok) {
    if (result.surplusIsUntracked && result.delta > 0) {
      return (
        `+${result.delta} recorded as untracked stock — more than one lot is held here, ` +
        'so the surplus is not attributed to either. Use Adjust on a lot if you know which it came from.'
      )
    }
    return null
  }

  if (result.code === 'BELOW_ALLOCATED') {
    const onHand = result.nowOnHand ?? result.systemQty
    const reducible = result.reducible ?? 0
    const reserved = Math.max(0, onHand - reducible)
    const partial = result.partial
      ? ` ${Math.abs(result.delta)} unit${Math.abs(result.delta) === 1 ? '' : 's'} came off before it was blocked, so re-count from what is on the shelf now.`
      : ''
    return (
      `Not posted. ${reserved} of ${onHand} unit${reserved === 1 ? ' is' : 's are'} reserved for open orders, ` +
      `so only ${reducible} can be removed. Dispatch or cancel those orders, then re-count this line.${partial}`
    )
  }

  const partial = result.partial ? ' Part of the line posted before it failed — re-count it.' : ''
  return `Not posted: ${result.message ?? 'the adjustment was rejected'}.${partial}`
}

/** Convenience for the sheet: would this typed number be refused right now? */
export function predictedRefusal(line: CountSheetLine, text: string): string | null {
  const plan = planLine(line, text)
  if (!plan || plan.ok !== false) return null
  return friendlyCountError(line, {
    countedQty: plan.countedQty,
    systemQty: plan.systemQty,
    reducible: plan.reducible,
  })
}

/** Re-exported so components can show "N can be removed" without importing from
 *  two modules. */
export function lineReducible(line: CountSheetLine): number {
  return reducibleQtyOf(line.slots)
}
