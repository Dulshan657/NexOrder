// Client-side entry point for the pallet break-down sheet.
//
// The allocation rules live in the pure shared module so the Edge Function and
// the browser run the very same code — the sheet's running total and its inline
// refusals are not a second implementation of the server's decision, they ARE
// the server's decision, evaluated early. This file re-exports it under `@/` and
// adds the things only a form needs: parsing a typed count, turning a layer into
// base units, and naming a unit.
//
// Mirrors lib/binCount.ts, which does the same job for the count sheet.

export {
  COUNTED_UNITS,
  huTypeForUnit,
  planBreakdown,
} from '@/supabase/functions/_shared/palletBreakdown'

export type {
  BreakdownHuType,
  BreakdownPlan,
  BreakdownPortionInput,
  BreakdownRefusal,
  CountedUnit,
  PlannedPortion,
  PortionRefusal,
} from '@/supabase/functions/_shared/palletBreakdown'

import type { CountedUnit } from '@/supabase/functions/_shared/palletBreakdown'

/**
 * Parse a typed portion count.
 *
 * Returns `null` for blank — nothing typed is not zero, and a row nobody filled
 * in must never commit a zero-unit plate. Returns `undefined` for text that is
 * present but unusable, so the field can be marked invalid rather than silently
 * treated as empty. Same three-state contract as `parseCountedQty` in
 * lib/binCount.ts, and for the same reason.
 */
export function parsePortionCount(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return value
}

/** What a layer is worth, from the pallet fit. `perLayer` is cartons per layer
 *  (lib/palletFit.ts), so a layer is that many cartons of units. */
export interface LayerBasis {
  perLayer: number
  unitsPerCarton: number
}

/**
 * Base units for `count` layers, or null when this product has no pallet fit.
 *
 * Null is the honest answer and the sheet withholds the Layers unit entirely
 * rather than offering one that computes nothing: a layer needs the global
 * pallet spec AND a carton box, and mig 00125 refuses by name rather than
 * inventing a figure when either is missing.
 */
export function layerBaseQty(count: number, basis: LayerBasis | null | undefined): number | null {
  if (!basis) return null
  if (!Number.isFinite(basis.perLayer) || !Number.isFinite(basis.unitsPerCarton)) return null
  if (basis.perLayer <= 0 || basis.unitsPerCarton <= 0) return null
  return count * basis.perLayer * basis.unitsPerCarton
}

/**
 * Name for a unit, for the picker and the running total.
 *
 * The three container words are pluralised because a picker reads better that
 * way ("cartons"). The PRODUCT's own base unit is returned VERBATIM: it is a
 * `product_uoms.code` typed by an operator, not an English noun, and naive
 * pluralisation turns 'each' into "eachs". Nothing else in this app pluralises
 * it either — the walk card and the queue both say "2 each", "36 can",
 * "1 packet" — so echoing it unchanged is also the consistent choice.
 */
export function unitLabel(unit: CountedUnit, baseLabel = 'units'): string {
  if (unit === 'base') return baseLabel
  return unit === 'pallet' ? 'pallets' : unit === 'layer' ? 'layers' : 'cartons'
}
