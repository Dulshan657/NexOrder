// What "this product again" means at the dock (NX-0005).
//
// Scanning a carton used to add a new line with an empty quantity, so twenty
// cartons of one SKU were twenty rows to fix. A repeat now counts up on the line
// it belongs to. Pure, and every return is a new object, because the scan path,
// the search pick and the reducer in `ReceiveStockView` must agree exactly — and
// because two scans can land in one React batch, which is only safe if each
// update is a function of the previous state and nothing else.
//
// Which line a repeat counts on, in order:
//   1. an open mixed pallet captures everything — its own line for the product,
//      or a new line on the pallet;
//   2. "New pallet" was pressed — a separate pallet plate, whatever is staged;
//   3. the NEWEST loose line for the product — newest, so after "New pallet"
//      the next scans count on the pallet just declared, not the first one;
//   4. otherwise a new line on a carton plate.

import type { Product, ProductUom } from '../../../types'
import { receivableUoms } from '../../../lib/uom'
import { newDraft, newPlate, type DraftLine, type DraftPlate } from './receiveDraft'

export interface StagingState {
  lines: DraftLine[]
  plates: DraftPlate[]
  /** The open mixed pallet capturing new lines, or null. */
  activeGroupKey: string | null
  /** "New pallet" was pressed: the next product starts its own pallet plate. */
  forceNewPallet: boolean
}

export interface StageResult {
  state: StagingState
  /** The line that was created or counted on, so the screen can flash it. */
  touchedLineKey: string
}

export const emptyStaging = (): StagingState => ({
  lines: [],
  plates: [],
  activeGroupKey: null,
  forceNewPallet: false,
})

const CARTON_LIKE = /^(carton|ctn|case|box|outer)s?$/i

/**
 * The unit a single scan counts: the product's own carton-like receivable unit,
 * else the base unit (null).
 *
 * Only real `product_uoms` rows qualify. `deriveDefaultUoms` invents a carton
 * with id 0 for a product carrying none, and a uom_id of 0 names no row — so a
 * product with no unit rows counts its base unit, whatever its `cartonSize`.
 * A pallet never qualifies: one scan is one carton, not one pallet.
 */
export function scanUomFor(product: Product): ProductUom | null {
  const own = receivableUoms(product.uoms).filter((u) => !u.isBase && u.id > 0)
  return own.find((u) => CARTON_LIKE.test(u.code.trim())) ?? null
}

const plusOne = (quantity: string): string => String((Number(quantity) || 0) + 1)

function countOn(state: StagingState, lineKey: string): StageResult {
  return {
    state: {
      ...state,
      lines: state.lines.map((l) => (l.key === lineKey ? { ...l, quantity: plusOne(l.quantity) } : l)),
    },
    touchedLineKey: lineKey,
  }
}

function addLine(state: StagingState, product: Product, plateKey: string, quarantine: boolean): StageResult {
  const line: DraftLine = {
    ...newDraft(plateKey, quarantine),
    productId: product.id,
    quantity: '1',
    uomId: scanUomFor(product)?.id ?? null,
  }
  return { state: { ...state, lines: [...state.lines, line] }, touchedLineKey: line.key }
}

export function stageProduct(
  state: StagingState,
  product: Product,
  { quarantine }: { quarantine: boolean },
): StageResult {
  const group = state.activeGroupKey != null
    ? state.plates.find((p) => p.key === state.activeGroupKey)
    : undefined

  if (group) {
    const onGroup = state.lines.find((l) => l.plateKey === group.key && l.productId === product.id)
    return onGroup ? countOn(state, onGroup.key) : addLine(state, product, group.key, quarantine)
  }

  if (state.forceNewPallet) {
    const plate = newPlate('pallet')
    return addLine(
      { ...state, plates: [...state.plates, plate], forceNewPallet: false },
      product, plate.key, quarantine,
    )
  }

  const mixedKeys = new Set(state.plates.filter((p) => p.mixed).map((p) => p.key))
  const loose = state.lines.filter((l) => l.productId === product.id && !mixedKeys.has(l.plateKey))
  if (loose.length > 0) return countOn(state, loose[loose.length - 1].key)

  const plate = newPlate()
  return addLine({ ...state, plates: [...state.plates, plate] }, product, plate.key, quarantine)
}
