// What each New Order line will cost, previewed with the server's own rules.
//
// `resolveUomLinePrice` is the Shop's per-UOM display price and mirrors the
// server's `resolveUomLineUnitPrice`, so a line keyed as 3 cartons previews what
// `place-order` will persist. It goes through `resolvePromotionPrice`, never
// `resolveHoReCaPrice` (which knows nothing of promotions — a $3.30 preview once
// became a $2.97 order). A promotion's minimum is measured on the lines BEFORE
// any promotion, as place-order does. The total stays "estimated": carton
// rounding, BOGO free lines and cart-level discounts are the server's to apply.

import { resolvePromotionPrice, resolveUomLinePrice } from '../../pricing'
import { eligibleForOrderValue } from '../../supabase/functions/_shared/promotionMinimum'
import type { HoReCa, Product, Promotion, User } from '../../types'
import type { DraftLine } from './orderLineModel'

export interface LinePricing {
  /** Price of ONE of the line's chosen unit. */
  unitPrices: number[]
  total: number
}

function unitPrice(
  line: DraftLine,
  product: Product | undefined,
  customer: HoReCa | null,
  user: User,
  promotions: Promotion[],
): number {
  if (!product) return 0
  const uom = line.uomId != null ? product.uoms?.find((u) => u.id === line.uomId) : undefined
  return uom
    ? resolveUomLinePrice(product, uom, customer, user, promotions)
    : resolvePromotionPrice(product, customer, user, promotions).finalPrice
}

export function priceLines(
  lines: readonly DraftLine[],
  products: readonly Product[],
  customer: HoReCa | null,
  user: User,
  promotions: Promotion[],
): LinePricing {
  const byId = new Map(products.map((p): [number, Product] => [p.id, p]))
  const valueBefore = lines.reduce(
    (sum, l) => sum + unitPrice(l, byId.get(l.productId), customer, user, []) * l.quantity,
    0,
  )
  const eligible = eligibleForOrderValue<Promotion>(promotions, valueBefore)
  const unitPrices = lines.map((l) => unitPrice(l, byId.get(l.productId), customer, user, eligible))
  const total = lines.reduce((sum, l, i) => sum + unitPrices[i] * (Number.isFinite(l.quantity) ? l.quantity : 0), 0)
  return { unitPrices, total: Math.round(total * 100) / 100 }
}

export const money = (n: number) => `$${n.toFixed(2)}`
