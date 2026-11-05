// Which promotions a given order value qualifies for. Imported by both runtimes, place-order on the
// server and the cart and previews in the browser, so they cannot disagree. Imports nothing.
//
// The value is the whole order at the customer's own prices before ANY promotion. Measured after
// them, a promotion's own discount could take the order under its minimum and switch itself off.

const toCents = (value: number): number => Math.round(value * 100)

export function eligibleForOrderValue<T extends { minOrderValue?: number | null }>(
  promotions: readonly T[],
  orderValue: number,
): T[] {
  return promotions.filter((promotion) => {
    const minimum = promotion.minOrderValue
    return minimum == null || minimum <= 0 || toCents(orderValue) >= toCents(minimum)
  })
}
