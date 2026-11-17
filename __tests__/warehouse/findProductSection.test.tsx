// NX-0039 A6: "Find a product" in Ask the engine.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProductWhereabouts } from '@/services/supabase/productWhereaboutsService'

const whereaboutsCalls: Array<[number | null, number | null]> = []
let answer: ProductWhereabouts | undefined

vi.mock('@/hooks/queries/useProducts', () => ({
  useProducts: () => ({
    data: [
      { id: 7, name: 'Chicken Breast 5kg', sku: 'CHK-5', barcode: '9300601234567' },
      { id: 9, name: 'Basil', sku: 'BAS-1', barcode: null },
    ],
  }),
}))

vi.mock('@/hooks/queries/useProductWhereabouts', () => ({
  useProductWhereabouts: (warehouseId: number | null, productId: number | null) => {
    whereaboutsCalls.push([warehouseId, productId])
    return { data: productId != null ? answer : undefined, isLoading: false, isError: false }
  },
}))

import { FindProductSection } from '@/components/inventory/warehouse/FindProductSection'

const stop = (sequence: number, locationId: number, code: string, legDistanceM: number) => ({
  sequence, locationId, code, place: PLACE[code], productId: 7, orderItemId: null, orderId: null, qtyBase: 1, legDistanceM,
  path: [{ floor: 0, x: 0, y: 0 }, { floor: 0, x: 4, y: 0 }],
})

const PLACE: Record<string, string> = {
  'A-03-02': 'Chiller · Rack 3 · Level 2',
  'B-11-04': 'Fast Moving · F01 right bay 4',
  MAIN: 'Dock — awaiting putaway',
}

const ANSWER: ProductWhereabouts = {
  mode: 'engine',
  product: { id: 7, name: 'Chicken Breast 5kg' },
  homeBin: { locationId: 10, code: 'A-03-02', place: PLACE['A-03-02'] },
  stock: [
    { locationId: 10, code: 'A-03-02', place: PLACE['A-03-02'], onHand: 12, available: 12, badge: 'home' },
    { locationId: 11, code: 'B-11-04', place: PLACE['B-11-04'], onHand: 6, available: 6, badge: 'off_home' },
    { locationId: 1, code: 'MAIN', place: PLACE.MAIN, onHand: 10, available: 10, badge: 'at_dock' },
  ],
  homeQty: 12,
  offHomeQty: 6,
  atDockQty: 10,
  newDelivery: {
    source: 'home', locationId: 10, code: 'A-03-02', place: 'Chiller · Rack 3 · Level 2', homeQty: 6, overflowQty: 0,
    reason: 'Goes home to Chiller · Rack 3 · Level 2 — it has room.', quantity: 6,
  },
  putawayWalk: {
    stops: [stop(1, 10, 'A-03-02', 14)], totalDistanceM: 14, unreachableCount: 0,
    steps: ['1. Chiller · Rack 3 · Level 2 — 14 m'],
  },
  pickWalk: {
    stops: [stop(1, 10, 'A-03-02', 14), stop(2, 11, 'B-11-04', 7)],
    totalDistanceM: 21, unreachableCount: 0,
    steps: ['1. Chiller · Rack 3 · Level 2 — 14 m', '2. Fast Moving · F01 right bay 4 — 7 m'],
  },
}

function scan(code: string) {
  const box = screen.getByLabelText(/scan or type a product/i)
  fireEvent.change(box, { target: { value: code } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

beforeEach(() => {
  whereaboutsCalls.length = 0
  answer = ANSWER
})
afterEach(() => cleanup())

describe('FindProductSection', () => {
  it('a scanned product shows its home bin, stock badges and where a new delivery goes', () => {
    render(<FindProductSection warehouseId={2} onWalk={vi.fn()} onHighlight={vi.fn()} />)
    scan('9300601234567')

    expect(whereaboutsCalls.at(-1)).toEqual([2, 7])
    expect(screen.getByText('Chicken Breast 5kg')).toBeTruthy()
    expect(screen.getByTestId('home-place').textContent).toContain('Chiller · Rack 3 · Level 2')
    expect(screen.getByTestId('stock-11').textContent).toMatch(/off home/i)
    expect(screen.getByTestId('stock-1').textContent).toMatch(/at dock/i)
    expect(screen.getByText(/Goes home to Chiller · Rack 3 · Level 2/)).toBeTruthy()
  })

  it('choosing a walk hands its stops to the map', () => {
    const onWalk = vi.fn()
    render(<FindProductSection warehouseId={2} onWalk={onWalk} onHighlight={vi.fn()} />)
    scan('CHK-5')

    fireEvent.click(screen.getByRole('button', { name: /pick walk/i }))
    expect(onWalk).toHaveBeenLastCalledWith(ANSWER.pickWalk!.stops)
    expect(screen.getByText('2. Fast Moving · F01 right bay 4 — 7 m')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /put away walk/i }))
    expect(onWalk).toHaveBeenLastCalledWith(ANSWER.putawayWalk!.stops)
  })

  it('an unknown barcode says so and asks the server nothing', () => {
    render(<FindProductSection warehouseId={2} onWalk={vi.fn()} onHighlight={vi.fn()} />)
    scan('0000000000000')

    expect(screen.getByText(/nothing matches 0000000000000/i)).toBeTruthy()
    expect(whereaboutsCalls.every(([, productId]) => productId === null)).toBe(true)
  })

  it('never calls a place a bin', () => {
    const { container } = render(<FindProductSection warehouseId={2} onWalk={vi.fn()} onHighlight={vi.fn()} />)
    scan('9300601234567')
    fireEvent.click(screen.getByRole('button', { name: /pick walk/i }))
    expect(container.textContent).not.toMatch(/\bbins?\b/i)
    // The scannable code is still there, beneath the label.
    expect(screen.getByTestId('stock-11').textContent).toContain('B-11-04')
  })

  it('hands the places holding the product to the map to highlight, and clears them', () => {
    const onHighlight = vi.fn()
    render(<FindProductSection warehouseId={2} onWalk={vi.fn()} onHighlight={onHighlight} />)
    scan('9300601234567')
    // Every place holding it, the dock included: the 2D map outlines what it can place.
    expect(onHighlight).toHaveBeenLastCalledWith({ productId: 7, locationIds: [10, 11, 1] })

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onHighlight).toHaveBeenLastCalledWith(null)
  })
})
