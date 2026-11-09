// HomeBinProblemsPanel -- the "Home bin problems" panel above the Replenishment
// setup grid (NX-0032). It lists each home putaway cannot use: the SKU, the bin
// and every problem's message; or says "No problems".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const { health, refetch } = vi.hoisted(() => ({ health: vi.fn(), refetch: vi.fn() }))

vi.mock('@/hooks/queries/useHomeBinHealth', () => ({
  useHomeBinHealth: (...args: unknown[]) => health(...args),
}))

import HomeBinProblemsPanel from '@/components/inventory/replen/HomeBinProblemsPanel'

const loaded = (rows: unknown[], checked = rows.length) => ({
  data: { warehouseId: 7, checked, rows },
  isLoading: false,
  isFetching: false,
  error: null,
  refetch,
})

const row = (o: Record<string, unknown> = {}) => ({
  productId: 1,
  sku: 'TST-HOME-200',
  binId: 20,
  binCode: 'TST-A-01-1',
  problems: [
    { code: 'inactive', message: 'Bin TST-A-01-1 is inactive, so putaway never offers it.' },
    { code: 'full', message: 'Bin TST-A-01-1 is full: it has no room left for TST-HOME-200.' },
  ],
  ...o,
})

beforeEach(() => {
  health.mockReset()
  refetch.mockReset()
})
afterEach(cleanup)

describe('HomeBinProblemsPanel', () => {
  it('asks for this warehouse', () => {
    health.mockReturnValue(loaded([]))
    render(<HomeBinProblemsPanel warehouseId={7} />)
    expect(health).toHaveBeenCalledWith(7)
  })

  it('shows the SKU, the bin and every problem message for each home', () => {
    health.mockReturnValue(loaded([
      row(),
      row({
        productId: 2, sku: 'TST-HOME-201', binCode: 'TST-A-01-2',
        problems: [{ code: 'no_dock_route', message: 'Bin TST-A-01-2 has no walking route from a dock.' }],
      }),
    ], 5))
    render(<HomeBinProblemsPanel warehouseId={7} />)

    expect(screen.getByRole('heading', { name: /home bin problems/i })).toBeTruthy()
    const items = screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-home') !== null)
    expect(items).toHaveLength(2)

    const first = within(items[0])
    expect(first.getByText('TST-HOME-200')).toBeTruthy()
    expect(first.getAllByText(/TST-A-01-1/).length).toBeGreaterThan(0)
    expect(first.getByText('Bin TST-A-01-1 is inactive, so putaway never offers it.')).toBeTruthy()
    expect(first.getByText('Bin TST-A-01-1 is full: it has no room left for TST-HOME-200.')).toBeTruthy()

    const second = within(items[1])
    expect(second.getByText('TST-HOME-201')).toBeTruthy()
    expect(second.getByText('Bin TST-A-01-2 has no walking route from a dock.')).toBeTruthy()
    expect(screen.queryByText('No problems')).toBeNull()
  })

  it('says how many homes have problems out of how many were checked', () => {
    health.mockReturnValue(loaded([row()], 5))
    render(<HomeBinProblemsPanel warehouseId={7} />)
    expect(screen.getByText(/1 of 5 home bins/i)).toBeTruthy()
  })

  it('says "No problems" when there are none', () => {
    health.mockReturnValue(loaded([], 12))
    render(<HomeBinProblemsPanel warehouseId={7} />)
    expect(screen.getByRole('heading', { name: /home bin problems/i })).toBeTruthy()
    expect(screen.getByText('No problems')).toBeTruthy()
    expect(screen.getByText(/12 home bins checked/i)).toBeTruthy()
  })

  it('says it is checking while the answer is on its way', () => {
    health.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, error: null, refetch })
    render(<HomeBinProblemsPanel warehouseId={7} />)
    expect(screen.getByText(/checking home bins/i)).toBeTruthy()
    expect(screen.queryByText('No problems')).toBeNull()
  })

  it('shows the failure, not "No problems", and offers another try', () => {
    health.mockReturnValue({
      data: undefined, isLoading: false, isFetching: false, refetch,
      error: new Error('Could not check home bins, try again.'),
    })
    render(<HomeBinProblemsPanel warehouseId={7} />)
    expect(screen.getByText('Could not check home bins, try again.')).toBeTruthy()
    expect(screen.queryByText('No problems')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('checks again on request', () => {
    health.mockReturnValue(loaded([]))
    render(<HomeBinProblemsPanel warehouseId={7} />)
    fireEvent.click(screen.getByRole('button', { name: /check again/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
