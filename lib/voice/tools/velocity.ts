// Product movement against a clock we are given.
//
// services/productMovementService.ts has the rules (what a top mover, a slow
// mover, dead stock and a restock alert ARE), but getTopMovers, getSlowMovers,
// getDeadStock and getRestockAlerts take no `now` and read the system clock, and
// a tool whose answer changes with the wall clock cannot be tested or replayed.
// `computeSalesVelocity` does take `now`, so this file calls that and re-applies
// the four filters and sorts on top of it.
//
// That is duplication, and it is held honest by __tests__/voice/velocity.test.ts,
// which sets the system clock to `now` and requires these to return exactly what
// the service returns. The way to remove the duplication is to give those four
// service functions an optional `now`; until then change a rule in one place and
// that test fails.
//
// Callers pass the orders and products they want counted (non-cancelled, active).
//
// UNITS. velocities() restates every line in BASE units first (../baseUnits.ts):
// the service sums quantity as entered, so a carton line would count cartons,
// and every caller here compares the rate with base-unit stock (days remaining,
// suggested reorder quantity, dead stock). The service itself is left alone
// because other screens read it.

import { computeSalesVelocity } from '@/services/productMovementService'
import type { Order, Product, ProductVelocity } from '@/types'
import { toBaseUnitOrders } from '../baseUnits'
import { DAY_MS } from './common'

export const MOVEMENT_WINDOW_DAYS = 90
export const DEAD_STOCK_DAYS = 30

const byName = (a: ProductVelocity, b: ProductVelocity): number => a.productName.localeCompare(b.productName)

/** Weekly velocity per product in BASE units over the last 90 days, as of `now`. */
export function velocities(orders: readonly Order[], products: readonly Product[], now: Date): ProductVelocity[] {
  return computeSalesVelocity(toBaseUnitOrders(orders), products, MOVEMENT_WINDOW_DAYS, now)
}

/** Selling products, fastest first. */
export function topMovers(rows: readonly ProductVelocity[]): ProductVelocity[] {
  return rows.filter((v) => v.unitsPerWeek > 0).sort((a, b) => b.unitsPerWeek - a.unitsPerWeek || byName(a, b))
}

/** Selling products with stock on hand, slowest first. */
export function slowMovers(rows: readonly ProductVelocity[]): ProductVelocity[] {
  return rows
    .filter((v) => v.unitsPerWeek > 0 && v.currentStock > 0)
    .sort((a, b) => a.unitsPerWeek - b.unitsPerWeek || byName(a, b))
}

/** Stock on the shelf that has not sold for `thresholdDays`, biggest pile first. */
export function deadStock(
  rows: readonly ProductVelocity[],
  now: Date,
  thresholdDays: number = DEAD_STOCK_DAYS,
): ProductVelocity[] {
  return rows
    .filter((v) => {
      if (v.currentStock <= 0) return false
      if (v.lastSoldDate === null) return true
      return (now.getTime() - new Date(v.lastSoldDate).getTime()) / DAY_MS > thresholdDays
    })
    .sort((a, b) => b.currentStock - a.currentStock || byName(a, b))
}

/** Products that sell, have stock, and will run out inside `leadTimeDays`, soonest first. */
export function restockAlerts(rows: readonly ProductVelocity[], leadTimeDays: number): ProductVelocity[] {
  const daysLeft = (v: ProductVelocity): number => v.currentStock / (v.unitsPerWeek / 7)
  return rows
    .filter((v) => v.unitsPerWeek > 0 && v.currentStock > 0 && daysLeft(v) <= leadTimeDays)
    .sort((a, b) => daysLeft(a) - daysLeft(b) || byName(a, b))
}

/** Products that have run out but are still being ordered, best sellers first. */
export function outOfStockSelling(rows: readonly ProductVelocity[]): ProductVelocity[] {
  return rows
    .filter((v) => v.currentStock <= 0 && v.unitsPerWeek > 0)
    .sort((a, b) => b.unitsPerWeek - a.unitsPerWeek || byName(a, b))
}
