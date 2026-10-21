// Quantity answers are in BASE units, whatever unit of measure a line was booked in.
//
// OrderItem.quantity is in the line's chosen unit (cartons for a carton line) and
// OrderItem.packSize is that unit's factor to base units, undefined for a single
// unit (types.ts; the server's lineBaseUnits in _shared/pricing.ts). Inventory is
// in base units. Before the fix wave the voice tools summed the entered quantity,
// so a carton-heavy product looked twelve times slower than it sells and a reorder
// divided base-unit stock by a carton rate.
//
// The world here: one product, "Lime Soda", sold by the can (base unit) and by the
// 12-can carton, 40 cans on hand. In the last 30 days, all inside the 90-day window:
//   K1  10 cartons (120 cans) at $22 a carton, 25 days ago
//   K2  10 cartons (120 cans) at $22 a carton, 20 days ago
//   K3  30 single cans at $2,                   10 days ago
// Base units: 270 cans in 90 days = 270 / (90 / 7) = 21 cans a week = 3 a day.
// As entered: 50 "units", which is the wrong 3.9 a week.
// Revenue: 220 + 220 + 60 = $500 either way.

import { describe, expect, it } from 'vitest'
import { mkCartItem, mkProduct } from '../fixtures'
import { toBaseUnitOrders } from '../../lib/voice/baseUnits'
import { runVoiceTool } from '../../lib/voice/runVoiceTool'
import type { VoiceToolResult } from '../../lib/voice/runVoiceTool'
import type { Order, Product } from '../../types'
import { C1, MANAGER, NOW, P1, REP_A, buildOrders, ctxFor, deepFreeze, iso } from './voiceFixtures'

const SODA: Product = mkProduct({
  id: 70, sku: 'LIME', name: 'Lime Soda', price: 2, unit: 'can', cartonSize: 12,
  category: 'Beverages', inventory: 40, available: 40,
})
const CARTON_PRICE = 22
const CANS_PER_CARTON = 12

function sodaOrder(id: string, daysAgo: number, quantity: number, packSize?: number): Order {
  const item = { ...mkCartItem(SODA, quantity, packSize), price: packSize ? CARTON_PRICE : SODA.price }
  return {
    id, hoReCa: C1, items: [item], total: item.price * quantity, orderDate: iso(daysAgo),
    submittedBy: REP_A, status: 'delivered', statusHistory: [],
  }
}

function sodaOrders(): Order[] {
  return [
    sodaOrder('K1', 25, 10, CANS_PER_CARTON),
    sodaOrder('K2', 20, 10, CANS_PER_CARTON),
    sodaOrder('K3', 10, 30),
  ]
}

const sodaCtx = (as = MANAGER) => ctxFor(as, { orders: sodaOrders(), products: [{ ...SODA }] })

function dataOf<T>(result: VoiceToolResult): T {
  if (result.ok === false) throw new Error(`expected ok, got: ${result.error}`)
  return result.data as T
}

function basisOf(result: VoiceToolResult): string {
  if (result.ok === false) throw new Error(`expected ok, got: ${result.error}`)
  return result.basis
}

describe('toBaseUnitOrders', () => {
  it('turns a carton line into base units at the same line value', () => {
    const [converted] = toBaseUnitOrders(deepFreeze([sodaOrder('K1', 30, 3, CANS_PER_CARTON)]))
    const line = converted.items[0]
    expect(line.quantity).toBe(36)
    expect(line.price * line.quantity).toBeCloseTo(3 * CARTON_PRICE, 9)
    expect(line.packSize).toBeUndefined()
    expect(converted.total).toBe(3 * CARTON_PRICE)
  })

  it('leaves a line with no pack size, or a pack size of 1, exactly as it was', () => {
    const loose = sodaOrder('K3', 10, 30)
    const one = sodaOrder('K4', 5, 7, 1)
    const [a, b] = toBaseUnitOrders(deepFreeze([loose, one]))
    expect(a).toEqual(loose)
    expect(b.items[0].quantity).toBe(7)
    expect(b.items[0].price).toBe(CARTON_PRICE)
  })

  it('treats a pack size that is not a positive number as a single unit', () => {
    const odd = { ...sodaOrder('K5', 5, 4), items: [{ ...mkCartItem(SODA, 4), packSize: 0 }] }
    expect(toBaseUnitOrders(deepFreeze([odd]))[0].items[0].quantity).toBe(4)
  })

  it('never modifies what it is given (the input is deep-frozen) and returns new objects', () => {
    const input = deepFreeze(sodaOrders())
    const out = toBaseUnitOrders(input)
    expect(out[0]).not.toBe(input[0])
    expect(out[0].items[0]).not.toBe(input[0].items[0])
    expect(input[0].items[0].quantity).toBe(10)
  })
})

describe('quantity answers are in base units', () => {
  interface Reorder { products: Array<{ name: string; onHand: number; unitsPerWeek: number; daysRemaining: number; suggestedQty: number; outOfStock: boolean }> }

  it('get_reorder_recommendations: weekly rate, days remaining and suggested quantity are in cans', () => {
    const result = runVoiceTool('get_reorder_recommendations', { lead_time_days: 14 }, sodaCtx())
    const [soda] = dataOf<Reorder>(result).products
    expect(soda.name).toBe('Lime Soda')
    expect(soda.onHand).toBe(40)
    expect(soda.unitsPerWeek).toBe(21)
    // 40 cans at 3 a day.
    expect(soda.daysRemaining).toBe(13)
    // (14 + 14) days at 3 a day is 84 cans, less the 40 on hand.
    expect(soda.suggestedQty).toBe(44)
    expect(soda.outOfStock).toBe(false)
    expect(basisOf(result)).toMatch(/base units/)
  })

  it('get_product_movement: units per week are cans, not cartons', () => {
    const result = runVoiceTool('get_product_movement', { kind: 'top' }, sodaCtx())
    const data = dataOf<{ products: Array<{ name: string; unitsPerWeek: number }> }>(result)
    expect(data.products).toEqual([expect.objectContaining({ name: 'Lime Soda', unitsPerWeek: 21 })])
    expect(basisOf(result)).toMatch(/base units/)
  })

  it('get_sales_summary: top product units are cans while revenue is unchanged', () => {
    const result = runVoiceTool('get_sales_summary', { period: 'last_30_days' }, sodaCtx())
    const data = dataOf<{ revenue: number; topProducts: Array<{ name: string; units: number }> }>(result)
    expect(data.topProducts).toEqual([{ name: 'Lime Soda', units: 270 }])
    expect(data.revenue).toBe(500)
  })

  it('get_suggested_order_for_customer: suggests cans and names the unit', () => {
    // Two cartons a week, every week, last bought 8 days ago: due.
    const orders = [22, 15, 8].map((d, i) => sodaOrder(`W${i}`, d, 2, CANS_PER_CARTON))
    const ctx = ctxFor(MANAGER, { orders, products: [{ ...SODA }] })
    const result = runVoiceTool('get_suggested_order_for_customer', { horeca_id: C1.id }, ctx)
    const { items } = dataOf<{ items: Array<{ name: string; suggestedQty: number; usualQty: number; unit: string }> }>(result)
    expect(items).toEqual([expect.objectContaining({ name: 'Lime Soda', suggestedQty: 24, usualQty: 24, unit: 'can' })])
    expect(basisOf(result)).toMatch(/base units/)
  })

  it('get_suggested_order_for_customer: says units when the product names no unit', () => {
    const plain = { ...SODA, unit: '' }
    const orders = [22, 15, 8].map((d, i) => ({ ...sodaOrder(`W${i}`, d, 2, CANS_PER_CARTON) }))
    const ctx = ctxFor(MANAGER, { orders, products: [plain] })
    const { items } = dataOf<{ items: Array<{ unit: string }> }>(
      runVoiceTool('get_suggested_order_for_customer', { horeca_id: C1.id }, ctx),
    )
    expect(items[0].unit).toBe('units')
  })

  it('get_customer_insights: average quantity per order is in cans, spend unchanged', () => {
    const orders = [22, 15, 8].map((d, i) => sodaOrder(`W${i}`, d, 2, CANS_PER_CARTON))
    const ctx = ctxFor(MANAGER, { orders, products: [{ ...SODA }] })
    const data = dataOf<{ totalSpend: number; topProducts: Array<{ avgQuantityPerOrder: number }> }>(
      runVoiceTool('get_customer_insights', { horeca_id: C1.id }, ctx),
    )
    expect(data.topProducts[0].avgQuantityPerOrder).toBe(24)
    expect(data.totalSpend).toBe(3 * 2 * CARTON_PRICE)
  })

  it('a world with no pack sizes answers exactly as before', () => {
    // The shared fixtures carry no packSize; Red Curry Paste (P1) sells 154 jars
    // in the window (20+20+24+16+30+10+10+12+12), 154 / (90/7) = 11.98 => 12.0 a week.
    const result = runVoiceTool('get_product_movement', { kind: 'top' }, ctxFor(MANAGER, { orders: buildOrders() }))
    const top = dataOf<{ products: Array<{ name: string; unitsPerWeek: number }> }>(result).products[0]
    expect(top).toEqual(expect.objectContaining({ name: P1.name, unitsPerWeek: 12 }))
    expect(NOW.toISOString()).toBe('2026-10-20T04:00:00.000Z')
  })
})
