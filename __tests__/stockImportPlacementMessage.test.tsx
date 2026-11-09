import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// NX-0032: the opening-stock import places each received line with a
// decide-putaway override (roleOverride). Since the home bin is enforced, that
// override is refused for a homed product going into a non-home bin while its
// home has room, and the server says why ("Put this in its home bin ..."). The
// operator must read the server's words first, not a generic wrapper with the
// reason buried in brackets; the "finish it from the Putaway queue" advice
// stays, after it. Made-up data only.

const HOME_MSG =
  'Put this in its home bin TST-HOME-A1; it still has room for 6. If it is full, ask a manager to set its maximum.'

const receiveMutate = vi.fn()
const decidePutaway = vi.fn()

vi.mock('@/hooks/queries/useWarehouses', () => ({
  useWarehouses: () => ({ data: [{ id: 7, name: 'Test Warehouse', isActive: true }] }),
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({
    data: [{ id: 51, code: 'TST-BIN-01', kind: 'BIN', isActive: true }],
  }),
}))
vi.mock('@/hooks/queries/useReceiveStock', () => ({
  useReceiveStock: () => ({ mutateAsync: receiveMutate, isPending: false }),
}))
vi.mock('@/hooks/queries/useLayouts', () => ({ useLayouts: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/useLabelJobs', () => ({ useLayoutLabelStatus: () => ({ data: undefined }) }))
vi.mock('@/services/supabase/putawayService', () => ({
  decidePutaway: (...args: unknown[]) => decidePutaway(...args),
}))

import { StockImportModal } from '@/components/admin/StockImportModal'
import type { Product } from '@/types'

const products = [
  { id: 300, sku: 'TST-HOME-200', name: 'Made-up product', cartonSize: 12, inventory: 0 },
] as unknown as Product[]

async function importCsv(csv: string): Promise<void> {
  render(<StockImportModal products={products} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('Destination warehouse'), { target: { value: '7' } })

  const file = new File([csv], 'opening.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file] })
  fireEvent.change(input)
  await screen.findByText('1 valid')

  fireEvent.click(screen.getByRole('button', { name: /Import 1 row/ }))
}

afterEach(() => {
  cleanup()
  receiveMutate.mockReset()
  decidePutaway.mockReset()
})

describe('StockImportModal — a placement the home rule refuses', () => {
  it("shows the server's message first, then the Putaway-queue advice", async () => {
    receiveMutate.mockResolvedValue({
      putaway: { mode: 'engine', recommendations: [{ recommendationId: 901, quantity: 24 }] },
    })
    decidePutaway.mockRejectedValue(new Error(HOME_MSG))

    await importCsv('sku,quantity,bin_code\nTST-HOME-200,24,TST-BIN-01')

    const banner = await screen.findByText(/did not import/)
    const text = (banner.textContent ?? '').trim()
    expect(text.startsWith(`Rows 1–1 did not import: ${HOME_MSG}`)).toBe(true)
    expect(text).not.toContain(`(${HOME_MSG})`)
    expect(text).toContain('TST-BIN-01')
    expect(text).toMatch(/finish it from the Putaway queue\.$/)
    expect(decidePutaway).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: 901, decision: 'override', chosenLocationId: 51, roleOverride: true,
    }))
  })
})
