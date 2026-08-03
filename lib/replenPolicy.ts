// Client-side entry point for the replenishment min/max grid.
//
// The policy and the row rules live in the pure shared module so the Edge
// Function and the browser run the very same code — the grid's suggested
// figures and its inline refusals are not a second implementation of the
// server's decision, they ARE that decision, evaluated early. This file
// re-exports it under `@/` and adds what only a form needs: a draft row, text
// parsing, and the conversion between the packs an operator types and the base
// units the column stores.
//
// Mirrors lib/binCount.ts, which does the same job for the count sheet.

export {
  DEFAULT_REPLEN_POLICY,
  MAX_BULK_REPLEN_ROWS,
  baseToPacks,
  capacityBaseUnits,
  entryUnitLabel,
  packUnits,
  packsToBase,
  proposeHomeBins,
  suggestMinMax,
  suggestionInputFor,
  validateReplenRow,
} from '@/supabase/functions/_shared/wie/replenPolicy'

export type {
  ProposedHomeBin,
  ReplenConfigPayload,
  ReplenConfigRow,
  ReplenFreeBin,
  ReplenPolicy,
  ReplenRowCandidate,
  ReplenRowVerdict,
  ReplenSlotKind,
  ReplenSuggestion,
} from '@/supabase/functions/_shared/wie/replenPolicy'

import {
  baseToPacks,
  packUnits,
  packsToBase,
  suggestMinMax,
  suggestionInputFor,
  validateReplenRow,
  type ProposedHomeBin,
  type ReplenConfigRow,
  type ReplenPolicy,
  type ReplenRowVerdict,
  type ReplenSuggestion,
} from '@/supabase/functions/_shared/wie/replenPolicy'

/** One row as the grid holds it: the chosen slot and the two figures as typed. */
export interface ReplenDraft {
  /** The home bin the operator has settled on — starts as whatever is stored,
   *  else whatever is proposed. */
  binId: number | null
  /** As typed, in ENTRY units (packs when the SKU has one, base units when not).
   *  Empty string means "not filled in", which is never the same as 0. */
  minText: string
  maxText: string
}

/**
 * Parse one typed figure.
 *
 * `null` for blank — a cell nobody filled in leaves the stored value alone, the
 * same rule the count sheet applies (see lib/binCount.ts parseCountedQty), and
 * the reason a CSV round-trip cannot quietly wipe a column.
 *
 * `undefined` for text that is present but unusable, so the field can be marked
 * wrong instead of being silently treated as empty.
 */
export function parseQtyEntry(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Format a base-unit figure for an entry box, in that row's entry units. */
export function formatEntry(base: number | null, row: ReplenConfigRow): string {
  if (base == null) return ''
  const packs = baseToPacks(base, row.packFactor)
  // Whole packs are the normal case; a legacy figure that does not divide keeps
  // its remainder rather than being silently rounded into something else.
  return Number.isInteger(packs) ? String(packs) : String(Number(packs.toFixed(3)))
}

/** The draft a row starts with: stored values if any, else blank. */
export function initialDraft(row: ReplenConfigRow, proposal?: ProposedHomeBin | null): ReplenDraft {
  return {
    binId: row.homeBinId ?? proposal?.binId ?? null,
    minText: formatEntry(row.minQty, row),
    maxText: formatEntry(row.maxQty, row),
  }
}

export interface DraftFigures {
  /** Base units, or null when the cell is blank. */
  minQty: number | null
  maxQty: number | null
  /** True when either cell holds text that is not a usable number. */
  invalid: boolean
  /** True when neither cell has been filled in. */
  empty: boolean
}

/** Convert a draft's typed entry figures into the base units the column holds. */
export function draftFigures(row: ReplenConfigRow, draft: ReplenDraft): DraftFigures {
  const min = parseQtyEntry(draft.minText)
  const max = parseQtyEntry(draft.maxText)
  return {
    minQty: typeof min === 'number' ? packsToBase(min, row.packFactor) : null,
    maxQty: typeof max === 'number' ? packsToBase(max, row.packFactor) : null,
    invalid: min === undefined || max === undefined,
    empty: min === null && max === null,
  }
}

/** True when the draft differs from what is stored — the only rows worth sending. */
export function isDraftDirty(row: ReplenConfigRow, draft: ReplenDraft): boolean {
  const figures = draftFigures(row, draft)
  if (figures.invalid) return false
  return (
    draft.binId !== row.homeBinId ||
    figures.minQty !== row.minQty ||
    figures.maxQty !== row.maxQty
  )
}

/**
 * What an apply does to `replen_enabled`, mirroring the Edge Function's
 * call-level `replenEnabled` exactly: `true` arms, `false` disarms, and
 * 'leave' (the field omitted) touches the column at all — which is what an
 * ordinary "save the numbers" apply does.
 */
export type ArmAction = 'arm' | 'disarm' | 'leave'

/** Whether the row ends up armed once this apply lands. A numbers-only apply on
 *  an already-armed row still has to satisfy the pick-zone rule, because the row
 *  is still armed afterwards — that is the case a naive `arming: false` misses. */
export function willBeArmed(row: ReplenConfigRow, action: ArmAction): boolean {
  if (action === 'arm') return true
  if (action === 'disarm') return false
  return row.replenEnabled
}

export interface VerdictContext {
  /** Every bin that resolves inside this warehouse, and the pick-zone subset. */
  warehouseBinIds: ReadonlySet<number>
  pickZoneBinIds: ReadonlySet<number>
  action: ArmAction
}

/** The grid's per-row verdict, decided by the same function the server runs. */
export function draftVerdict(
  row: ReplenConfigRow,
  draft: ReplenDraft,
  context: VerdictContext,
): ReplenRowVerdict {
  const figures = draftFigures(row, draft)
  if (figures.invalid) return { ok: false, reason: 'That is not a usable number.' }

  return validateReplenRow({
    binId: draft.binId,
    binInWarehouse: draft.binId != null && context.warehouseBinIds.has(draft.binId),
    binIsPickZone: draft.binId != null && context.pickZoneBinIds.has(draft.binId),
    minQty: figures.minQty,
    maxQty: figures.maxQty,
    arming: willBeArmed(row, context.action),
  })
}

/** The suggestion for a row against whichever slot it is pointed at. */
export function suggestionFor(
  row: ReplenConfigRow,
  policy: ReplenPolicy,
  binCapacity?: { capacitySlots: number | null; slotKind: ReplenConfigRow['homeBinSlotKind'] } | null,
): ReplenSuggestion | null {
  const input = suggestionInputFor(row, binCapacity)
  if (!input) return null
  return suggestMinMax(input, policy)
}

/**
 * The echo beside an entry box: "= 144 units".
 *
 * This is the whole defence against the error class the carton/base split
 * creates — 240 typed meaning cartons and 240 units getting replenished. The
 * figure the database will actually hold is always on screen next to the one
 * being typed. Empty for a blank cell, because there is nothing to restate.
 */
export function describeEntry(baseQty: number | null, row: ReplenConfigRow): string {
  if (baseQty == null) return ''
  if (packUnits(row.packFactor) <= 1) return `${baseQty} base`
  return `= ${baseQty}`
}
