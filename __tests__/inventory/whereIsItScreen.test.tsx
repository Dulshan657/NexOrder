// NX-0039 A7: "Where is it?" on the handheld.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProductWhereabouts } from '@/services/supabase/productWhereaboutsService'
import { UserRole, type User } from '@/types'

const calls: Array<[number | null, number | null]> = []

vi.mock('@/hooks/queries/useProducts', () => ({
  useProducts: () => ({ data: [{ id: 7, name: 'Chicken Breast 5kg', sku: 'CHK-5', barcode: '9300601234567' }] }),
}))
vi.mock('@/hooks/queries/useWarehouses', () => ({
  useWarehouses: () => ({ data: [{ id: 2, code: 'MAIN', name: 'Main', isActive: true }] }),
}))
vi.mock('@/context/WarehouseScopeContext', () => ({
  useWarehouseScope: () => ({ scope: 'all', setScope: vi.fn() }),
}))

const stop = (sequence: number, locationId: number, code: string, legDistanceM: number) => ({
  sequence, locationId, code, productId: 7, orderItemId: null, orderId: null, qtyBase: 1, legDistanceM,
})
const ANSWER: ProductWhereabouts = {
  mode: 'engine',
  product: { id: 7, name: 'Chicken Breast 5kg' },
  homeBin: { locationId: 10, code: 'A-03-02' },
  stock: [
    { locationId: 10, code: 'A-03-02', onHand: 12, available: 12, badge: 'home' },
    { locationId: 2, code: 'MAIN', onHand: 10, available: 10, badge: 'at_dock' },
  ],
  homeQty: 12, offHomeQty: 0, atDockQty: 10,
  newDelivery: {
    source: 'overflow', locationId: 11, code: 'B-11-04', homeQty: 0, overflowQty: 6,
    reason: 'Home A-03-02 is full — goes to overflow B-11-04, nearest to home.', quantity: 6,
  },
  putawayWalk: { stops: [stop(1, 11, 'B-11-04', 9)], totalDistanceM: 9, unreachableCount: 0, steps: ['1. B-11-04 — 9 m'] },
  pickWalk: { stops: [stop(1, 10, 'A-03-02', 14)], totalDistanceM: 14, unreachableCount: 0, steps: ['1. A-03-02 — 14 m'] },
}

vi.mock('@/hooks/queries/useProductWhereabouts', () => ({
  useProductWhereabouts: (w: number | null, p: number | null) => {
    calls.push([w, p])
    return { data: p != null ? ANSWER : undefined, isLoading: false, isError: false }
  },
}))

import WhereIsItScreen from '@/components/inventory/WhereIsItScreen'

afterEach(() => cleanup())

const user = { id: 'u1', name: 'Wes', role: UserRole.WAREHOUSE, homeWarehouseId: 2 } as unknown as User

describe('WhereIsItScreen', () => {
  it('shows the summary and both walks as numbered step lists', () => {
    render(<WhereIsItScreen currentUser={user} />)
    const box = screen.getByLabelText(/scan or type a product/i)
    fireEvent.change(box, { target: { value: '9300601234567' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(calls.at(-1)).toEqual([2, 7])
    expect(screen.getByText(/is full — goes to overflow B-11-04/)).toBeTruthy()
    expect(screen.getByTestId('stock-2').textContent).toMatch(/at dock/i)

    const putaway = screen.getByRole('list', { name: /put away walk/i })
    const pick = screen.getByRole('list', { name: /pick walk/i })
    expect(putaway.textContent).toContain('1. B-11-04 — 9 m')
    expect(pick.textContent).toContain('1. A-03-02 — 14 m')
  })
})
