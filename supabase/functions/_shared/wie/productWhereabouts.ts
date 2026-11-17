// Warehouse Intelligence Engine — "where is this product, and how do I walk it?"
// (NX-0039). Pure: no Deno, no IO, so the explain-product-location function and
// the browser read the same definitions.
//
// This module DESCRIBES; it never decides. Where a new delivery goes is decided
// by the normal putaway rules — generatePutawayTasks in dry-run, the very path
// receiving takes (rules, compatibility, hold zones, home first, overflow
// nearest home). `newDeliveryReason` only puts that answer into words. Which
// bins a picker walks to is the stock that is there and free to pick; the
// order of the walk is sequencePickRoute's.

import type { SuggestionSource } from './homeFirst.ts'
import type { PickStop } from './picking.ts'

export type StockBadge = 'home' | 'off_home' | 'at_dock'

export interface WhereaboutsBalance {
  locationId: number
  code: string
  onHand: number
  available: number
}

export interface WhereaboutsInput {
  /** The WAREHOUSE location. Stock whose location IS the warehouse has not been put away. */
  warehouseId: number
  homeBinId: number | null
  /** Balance rows for one product, already scoped to this warehouse. One bin may repeat (batches, plates). */
  balances: readonly WhereaboutsBalance[]
}

export interface WhereaboutsStockRow {
  locationId: number
  code: string
  onHand: number
  available: number
  badge: StockBadge
}

export interface Whereabouts {
  /** Home first, then off-home bins by code, then the dock. Zero rows left out. */
  stock: WhereaboutsStockRow[]
  homeQty: number
  offHomeQty: number
  atDockQty: number
}

const BADGE_ORDER: Record<StockBadge, number> = { home: 0, off_home: 1, at_dock: 2 }

export function productWhereabouts(input: WhereaboutsInput): Whereabouts {
  const byLocation = new Map<number, { code: string; onHand: number; available: number }>()
  for (const b of input.balances) {
    const prev = byLocation.get(b.locationId)
    byLocation.set(b.locationId, {
      code: prev?.code ?? b.code,
      onHand: (prev?.onHand ?? 0) + b.onHand,
      available: (prev?.available ?? 0) + b.available,
    })
  }

  const stock: WhereaboutsStockRow[] = []
  for (const [locationId, row] of byLocation) {
    if (row.onHand <= 0) continue
    const badge: StockBadge =
      locationId === input.warehouseId ? 'at_dock'
        : locationId === input.homeBinId ? 'home'
          : 'off_home'
    stock.push({ locationId, code: row.code, onHand: row.onHand, available: row.available, badge })
  }
  stock.sort((a, b) => BADGE_ORDER[a.badge] - BADGE_ORDER[b.badge] || a.code.localeCompare(b.code))

  const sum = (badge: StockBadge) =>
    stock.filter((s) => s.badge === badge).reduce((t, s) => t + s.onHand, 0)
  return { stock, homeQty: sum('home'), offHomeQty: sum('off_home'), atDockQty: sum('at_dock') }
}

/** One line of the dry-run putaway answer (generatePutawayTasks' recommendations). */
export interface PutawayAnswerLine {
  locationId: number | null
  code: string | null
  quantity: number
  source: SuggestionSource
}

export interface NewDeliveryAnswer {
  /** 'home' only when the whole delivery fits at home. */
  source: SuggestionSource
  /** The first bin a putaway walk goes to (home when any of it goes home). Null: no bin can take it. */
  locationId: number | null
  code: string | null
  homeQty: number
  overflowQty: number
  reason: string
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''))

export function newDeliveryReason(
  lines: readonly PutawayAnswerLine[],
  homeBin: { locationId: number; code: string } | null,
): NewDeliveryAnswer {
  const placed = lines.filter((l) => l.locationId !== null)
  const homeQty = placed.filter((l) => l.source === 'home').reduce((t, l) => t + l.quantity, 0)
  const elsewhere = placed.filter((l) => l.source !== 'home')
  const overflowQty = elsewhere.reduce((t, l) => t + l.quantity, 0)
  const first = placed.find((l) => l.source === 'home') ?? placed[0] ?? null

  if (!first) {
    return {
      source: homeBin ? 'overflow' : 'engine',
      locationId: null, code: null, homeQty: 0, overflowQty: 0,
      reason: 'No bin can take it under the putaway rules — it would stay at the dock.',
    }
  }

  const answer = { locationId: first.locationId, code: first.code, homeQty, overflowQty }
  if (!homeBin) {
    return {
      ...answer, source: 'engine',
      reason: `No home bin set — the engine's best bin is ${first.code}.`,
    }
  }
  if (elsewhere.length === 0) {
    return { ...answer, source: 'home', reason: `Goes home to ${homeBin.code} — it has room.` }
  }
  const overflowCodes = [...new Set(elsewhere.map((l) => l.code))].join(', ')
  if (homeQty > 0) {
    return {
      ...answer, source: 'overflow',
      reason: `Home ${homeBin.code} has room for ${fmt(homeQty)}; the other ${fmt(overflowQty)} go to overflow ${overflowCodes}.`,
    }
  }
  return {
    ...answer, source: 'overflow',
    reason: `Home ${homeBin.code} is full — goes to overflow ${overflowCodes}, nearest to home.`,
  }
}

export interface PlacementRef {
  graphNodeId: number | null
  accessOffsetM: number
}

/**
 * The bins a picker would walk to: every bin holding stock that is free to
 * pick. Stock at the dock is not on the racking, and allocated stock is
 * already promised to an order. A bin with no placement is still returned
 * (graphNodeId null) so the sequencer reports it unreachable, not hidden.
 */
export function pickWalkStops(
  stock: readonly WhereaboutsStockRow[],
  placements: ReadonlyMap<number, PlacementRef>,
): PickStop[] {
  return stock
    .filter((s) => s.badge !== 'at_dock' && s.available > 0)
    .map((s) => {
      const p = placements.get(s.locationId)
      return {
        locationId: s.locationId,
        graphNodeId: p?.graphNodeId ?? null,
        accessOffsetM: p?.accessOffsetM ?? 0,
        meta: { code: s.code, qtyBase: s.available },
      }
    })
}

export interface WalkSummary {
  totalDistanceM: number
  /** "1. A-03-02 — 14 m", one per stop, for the handheld. */
  steps: string[]
}

export function walkSummary(
  stops: ReadonlyArray<{ sequence: number; code: string | null; legDistanceM: number }>,
): WalkSummary {
  return {
    totalDistanceM: stops.reduce((t, s) => t + s.legDistanceM, 0),
    steps: stops.map((s) => `${s.sequence}. ${s.code ?? '?'} — ${Math.round(s.legDistanceM)} m`),
  }
}
