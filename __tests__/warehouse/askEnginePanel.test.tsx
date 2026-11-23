// NX-0039 A11/A12: Ask the engine is one tabbed card, and putaway takes a scan.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mutateAsync = vi.fn().mockResolvedValue({ mode: 'engine', recommendations: [] })

vi.mock('@/hooks/queries/useProducts', () => ({
  useProducts: () => ({ data: [{ id: 7, name: 'Chicken Breast 5kg', sku: 'CHK-5', barcode: '9300601234567' }] }),
}))
vi.mock('@/hooks/queries/useProductWhereabouts', () => ({
  useProductWhereabouts: () => ({ data: undefined, isLoading: false, isError: false }),
}))
vi.mock('@/hooks/queries/usePutawayRecommendation', () => ({
  useRecommendPutaway: () => ({ mutateAsync, data: undefined, isPending: false, isError: false }),
}))
vi.mock('@/hooks/queries/usePickQueue', () => ({ usePickQueue: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/useSimulation', () => ({
  useRunSimulation: () => ({ mutate: vi.fn(), data: undefined, isPending: false, isError: false }),
}))

import { AskEnginePanel } from '@/components/inventory/warehouse/AskEnginePanel'

afterEach(() => cleanup())

function renderPanel(canSimulate = true) {
  return render(
    <AskEnginePanel
      canSimulate={canSimulate}
      warehouseId={2}
      layoutId={3}
      onPutawayResult={vi.fn()}
      routeOrderIds={[]}
      onRouteOrderIdsChange={vi.fn()}
      onProductWalk={vi.fn()}
      onHighlight={vi.fn()}
    />,
  )
}

describe('AskEnginePanel', () => {
  it('the putaway tab takes a scanned product', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: /put away/i }))
    // No product dropdown any more.
    expect(screen.queryByRole('combobox')).toBeNull()
    const box = screen.getByLabelText(/scan or type a product/i)
    fireEvent.change(box, { target: { value: '9300601234567' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /where would it go/i }))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseId: 2, dryRun: true, lines: [expect.objectContaining({ product_id: 7 })] }),
    )
  })

  it('is one card with a tab per question and no test bench box', () => {
    const { container } = renderPanel()
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      'Find a product', 'Put away', 'Pick route', 'Simulate',
    ])
    expect(screen.getByText(/preview only — nothing moves/i)).toBeTruthy()
    expect(container.textContent).not.toMatch(/test bench/i)
    // The first tab is open.
    expect(screen.getByRole('tab', { name: /find a product/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText(/scan or type a product/i)).toBeTruthy()
  })

  // NX-0046 A4: wie-simulate is Admin/Manager only; a tab that always errors is
  // worse than no tab.
  it('offers no Simulate tab to someone who cannot run one', () => {
    renderPanel(false)
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      'Find a product', 'Put away', 'Pick route',
    ])
  })
})
