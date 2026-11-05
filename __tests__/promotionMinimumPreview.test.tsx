import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import OrderLinesGrid from '../components/admin/newOrder/OrderLinesGrid'
import PromotionsBanner from '../components/PromotionsBanner'
import { buildReorderPlan } from '../lib/kitchen/reorderPlan'
import { mkCartItem, mkHoReCa, mkPercentPromo, mkProduct, mkUser } from './fixtures'
import type { ParsedOrderLine } from '../lib/newOrder/resolveOrderLines'

afterEach(cleanup)

const product = mkProduct({ id: 1, price: 100 })
const promo = mkPercentPromo({ id: 'MIN', percentOff: 50, minOrderValue: 200 })

describe('New Order preview', () => {
  const grid = (quantity: number) => {
    const lines = [{ productId: 1, name: product.name, sku: product.sku, quantity }] as unknown as ParsedOrderLine[]
    render(
      <OrderLinesGrid
        lines={lines}
        products={[product]}
        customer={mkHoReCa()}
        currentUser={mkUser()}
        promotions={[promo]}
        onChangeQuantity={vi.fn()}
        onRemove={vi.fn()}
        onAddProduct={vi.fn()}
      />,
    )
    return screen.getByText('Estimated total').closest('tr')?.textContent
  }

  it('a promotion below its minimum gives no discount until the lines reach it', () => {
    expect(grid(1)).toContain('$100.00')
    cleanup()
    expect(grid(2)).toContain('$100.00') // two at $50
    cleanup()
    expect(grid(3)).toContain('$150.00')
  })
})

describe('reorder plan', () => {
  const plan = (quantity: number) =>
    buildReorderPlan({
      order: { items: [mkCartItem(product, quantity)] },
      products: [product],
      hoReCa: mkHoReCa(),
      promotions: [promo],
      currentUser: mkUser(),
      cartonDiscountPercent: 5,
    })

  it('a promotion below its minimum gives no discount on the plan', () => {
    expect(plan(1).estimatedTotal).toBe(100)
    expect(plan(2).estimatedTotal).toBe(100)
    expect(plan(3).estimatedTotal).toBe(150)
  })
})

describe('PromotionsBanner', () => {
  it('names the minimum', () => {
    render(
      <PromotionsBanner
        promotions={[promo, mkPercentPromo({ id: 'PLAIN', name: 'No minimum' })]}
        customer={mkHoReCa()}
        currentUser={mkUser()}
        products={[]}
      />,
    )
    expect(screen.getAllByText('On orders of $200.00 or more')).toHaveLength(1)
  })
})
