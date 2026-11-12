// NX-0036 A2/A5: the find bar in the 3D view.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Product } from '@/types'
import type { BinContentRow } from '@/components/inventory/warehouse/useWarehouseViewerModel'
import { FindStockBar } from '@/components/inventory/warehouse/three/FindStockBar'

afterEach(() => cleanup())

const row = (productId: number, onHand: number): BinContentRow =>
  ({ productId, productName: null, sizeFactor: 1, onHand, allocated: 0, slots: onHand })

const binContents = new Map<number, BinContentRow[]>([
  [10, [row(7, 40)]],
  [11, [row(7, 12)]],
  [1, [row(7, 24)]],
])
const products = [
  { id: 7, name: 'Basil', sku: 'BAS-1', cartonSize: 6, price: 0 },
  { id: 9, name: 'Not on this site', sku: 'NOS-1', cartonSize: 1, price: 0 },
] as Product[]

function Harness({ onChange = vi.fn(), productId = null as number | null }) {
  return (
    <FindStockBar
      products={products}
      binContents={binContents}
      placedIds={new Set([10, 11])}
      productId={productId}
      onChange={onChange}
    />
  )
}

describe('FindStockBar', () => {
  it('picking a product reports its locations and the counts', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /find stock/i }))
    // Only products in stock on this site are offered.
    expect(screen.queryByText('Not on this site')).toBeNull()
    fireEvent.click(screen.getByText('Basil'))
    expect(onChange).toHaveBeenCalledWith(7)

    rerender(<Harness onChange={onChange} productId={7} />)
    expect(screen.getByText(/2 locations/)).toBeTruthy()
    expect(screen.getByText(/24 units not in a rack/)).toBeTruthy()
  })

  it('Clear ends the search', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} productId={7} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
