import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import BundleSelectModal from '../components/BundleSelectModal'
import OrderLinesGrid from '../components/admin/newOrder/OrderLinesGrid'
import PromotionsBanner from '../components/PromotionsBanner'
import ReorderTab from '../components/ReorderTab'
import { buildReorderPlan } from '../lib/kitchen/reorderPlan'
import { mkCartItem, mkHoReCa, mkPercentPromo, mkProduct, mkUser } from './fixtures'
import type { ParsedOrderLine } from '../lib/newOrder/resolveOrderLines'

vi.mock('../hooks/queries/useSettings', () => ({ useSettings: () => ({ data: { low_stock_threshold: 10 } }) }))

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

describe('Shop reorder tab', () => {
  const tab = (quantity: number) => {
    const { container } = render(
      <ReorderTab
        lastOrder={{ id: 'O-1', items: [mkCartItem(product, quantity)] } as never}
        products={[product]}
        selectedHoReCa={mkHoReCa()}
        promotions={[promo]}
        currentUser={mkUser()}
        cartonDiscountPercent={5}
        cartItemCount={0}
        onAddItems={vi.fn()}
      />,
    )
    return container.textContent
  }

  it('a carton line with no unit id is sent in the unit it was priced in', () => {
    // Most past carton lines have no unit id. The tab prices one from the carton unit, so it has to
    // say so, or the server falls back to the carton formula and charges something else.
    const CARTON = { id: 5, code: 'CTN', factorToBase: 12, price: 147.6, isBase: false, isOrderable: true }
    const carton = mkProduct({ id: 250, price: 12.3, cartonSize: 12, uoms: [CARTON] as never })
    const onAddItems = vi.fn()
    render(
      <ReorderTab
        lastOrder={{ id: 'O-1', items: [mkCartItem(carton, 1, 12)] } as never}
        products={[carton]}
        selectedHoReCa={mkHoReCa()}
        promotions={[]}
        currentUser={mkUser()}
        cartonDiscountPercent={5}
        cartItemCount={0}
        onAddItems={onAddItems}
      />,
    )
    expect(screen.getByRole('button', { name: /Reorder All/ }).textContent).toContain('$147.60')
    fireEvent.click(screen.getByRole('button', { name: /Reorder All/ }))
    expect(onAddItems.mock.calls[0][0][0]).toMatchObject({ uomId: 5, packSize: 12, price: 147.6 })
  })

  it('measures a minimum on the lines being reordered, not on the cart', () => {
    expect(tab(1)).toContain('$100.00')
    cleanup()
    expect(tab(2)).toContain('$50.00') // the unit price, once the two lines reach it
  })
})

describe('BundleSelectModal', () => {
  it('names the minimum', () => {
    render(
      <BundleSelectModal
        promotion={{ ...promo, type: 'bundle', bundleConfig: { productIds: [1], bundlePrice: 9 } } as never}
        products={[product]}
        cartonDiscountPercent={5}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText(/on orders of \$200\.00 or more/)).toBeTruthy()
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
