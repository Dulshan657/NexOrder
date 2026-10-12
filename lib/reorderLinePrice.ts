// What one line of a PAST order costs TODAY.
//
// The single definition both "reorder" surfaces price a line with: the Shop's
// Reorder tab (`components/ReorderTab.tsx`) and the Kitchen's "Order same again"
// (`lib/kitchen/reorderPlan.ts`). Two copies of this drifted once already --
// the tab priced with the bare `resolveHoReCaPrice`, which knows nothing about
// promotions, so "Reorder All ($142.79)" disagreed with the cart and the server
// quote ($128.52) whenever a promotion applied.
//
// The line is priced the way the Shop prices the same pick (ProductCard):
//   - in the line's own unit of measure (`resolveUomLinePrice`, mig 00067),
//     found by id, else by pack factor for a line saved before UOM ids existed,
//     else the base unit;
//   - which includes the venue's own price and any live promotion
//     (`resolvePromotionPrice`).
//
// Pure: no React, no Supabase, no clock beyond what `pricing.ts` already reads.

import type { HoReCa, OrderItem, Product, Promotion, User } from '@/types'
import { resolvePromotionPrice, resolveUomLinePrice } from '@/pricing'
import { deriveDefaultUoms, findUomById, findUomByFactor, orderableUoms } from '@/lib/uom'

export interface ReorderPricingContext {
  hoReCa: HoReCa | null
  promotions: readonly Promotion[]
  currentUser: User | null
  cartonDiscountPercent: number
}

export interface ReorderLinePriced {
  ok: true
  /** Current price of ONE ordered unit (a carton is one unit of a carton line). */
  unitPrice: number
  /** Base units per ordered unit; undefined for the base unit itself. */
  packSize: number | undefined
  unit: string
  /** Undefined for a synthesised default UOM that was never persisted. */
  uomId: number | undefined
}

export interface ReorderLineUnpriceable {
  ok: false
  reason: string
}

export type ReorderLinePrice = ReorderLinePriced | ReorderLineUnpriceable

/** Why a carton line is held back when its pack no longer exists. */
export const PACK_SIZE_CHANGED = 'Pack size changed'

export function priceReorderLine(
  source: OrderItem,
  product: Product,
  ctx: ReorderPricingContext,
): ReorderLinePrice {
  const { hoReCa, currentUser, cartonDiscountPercent } = ctx
  const promotions = [...ctx.promotions]

  const own = orderableUoms(product.uoms)
  const uoms = own.length > 0
    ? own
    : orderableUoms(deriveDefaultUoms(product.unit, product.price, product.cartonSize, cartonDiscountPercent))

  // A line that was a carton must stay a carton. Falling back to the base unit
  // when its pack no longer exists would read "2 cartons" as "2 units" -- a
  // quietly different order -- so the caller holds that line back instead.
  const wasPacked = (source.packSize ?? 1) > 1
  const matched = findUomById(uoms, source.uomId) ?? findUomByFactor(uoms, source.packSize)
  if (!matched && wasPacked) return { ok: false, reason: PACK_SIZE_CHANGED }
  const uom = matched ?? uoms.find((u) => u.isBase) ?? uoms[0]

  const unitPrice = uom
    ? resolveUomLinePrice(product, uom, hoReCa, currentUser, promotions)
    : resolvePromotionPrice(product, hoReCa, currentUser, promotions).finalPrice

  return {
    ok: true,
    unitPrice,
    packSize: uom ? (uom.isBase ? undefined : uom.factorToBase) : source.packSize,
    unit: uom?.code ?? source.unit,
    // An id of 0 is a synthesised default UOM that was never persisted.
    uomId: uom && uom.id > 0 ? uom.id : undefined,
  }
}
