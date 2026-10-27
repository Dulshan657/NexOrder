// NX-0007 — one product split across its home bin and an overflow bin is two
// tasks. Scanning that product must open the HOME task straight away (no "2
// tasks match — pick one"), and once it is placed the overflow task opens next,
// at the bin step, without another scan of the product.
//
// Found by the end-to-end run on dev: the first receipt filled the home bin, so
// the second was split home 8 + overflow 64 and the scan stopped at a chooser.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const { tasksMock, completeMock } = vi.hoisted(() => ({ tasksMock: vi.fn(), completeMock: vi.fn() }))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useOpenPutaways: () => tasksMock(),
  useAssignedPutaways: () => tasksMock(),
  usePutawayRoute: () => ({ data: { mode: 'legacy' }, isLoading: false, isError: false }),
  useCompletePutaway: () => ({ mutateAsync: completeMock, isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({
    data: [
      { id: 501, code: 'MAIN-F02-R09', name: null, isActive: true, kind: 'BIN' },
      { id: 502, code: 'MAIN-F01-R09', name: null, isActive: true, kind: 'BIN' },
    ],
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePrintPlateLabels: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePlanBreakdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBreakDownPallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
  useToastActions: () => ({ addToast: vi.fn() }),
}))

import PutawayWalkView from '@/components/inventory/PutawayWalkView'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

const PRODUCT = { id: 3, name: 'Coconut Milk 400ml', sku: 'AYM-COC-003', barcode: '9312000000036' } as Product

function task(over: Partial<PendingPutawayRow>): PendingPutawayRow {
  return {
    id: 0,
    productId: 3,
    quantity: 1,
    recommendedLocationId: null,
    explanation: { engineVersion: 'v1', layoutId: 1, candidatesConsidered: 1, hardFilters: [], winner: null, alternatives: [] },
    createdAt: '2026-10-27T00:00:00Z',
    product: PRODUCT,
    receipt: null,
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: false,
    huStatus: null,
    assignedLocationId: null,
    assignedAt: null,
    status: 'suggested',
    ...over,
  }
}

// Overflow sorts FIRST by bin code (F01 < F02 is reversed here on purpose), so
// a pass cannot come from list order alone: home must be chosen by its source.
const overflow = task({ id: 901, quantity: 64, recommendedLocationId: 502, suggestionSource: 'overflow' })
const home = task({ id: 902, quantity: 8, recommendedLocationId: 501, suggestionSource: 'home' })

afterEach(() => { cleanup(); vi.clearAllMocks() })

function scanBar(code: string) {
  const bar = screen.getByLabelText(/Scan a plate, carton or bin/i) as HTMLInputElement
  fireEvent.change(bar, { target: { value: code } })
  fireEvent.keyDown(bar, { key: 'Enter' })
}

describe('one product, home + overflow', () => {
  it('a product scan opens the home task, with no chooser', () => {
    tasksMock.mockReturnValue({ data: [overflow, home], isLoading: false, isError: false })
    render(<PutawayWalkView warehouseId={1} />)

    scanBar('9312000000036')

    expect(screen.queryByRole('group', { name: 'Choose what to put away' })).toBeNull()
    expect(screen.getByLabelText(/Scan the bin — expecting MAIN-F02-R09/)).toBeTruthy()
  })

  it('placing the home share opens the overflow share at the bin step', async () => {
    tasksMock.mockReturnValue({ data: [overflow, home], isLoading: false, isError: false })
    completeMock.mockResolvedValue({ actualLocationCode: 'MAIN-F02-R09', remainderQty: 0, remainderStatus: null, placedElsewhere: false })
    render(<PutawayWalkView warehouseId={1} />)

    scanBar('9312000000036')
    const bin = screen.getByLabelText(/Scan the bin — expecting MAIN-F02-R09/) as HTMLInputElement
    fireEvent.change(bin, { target: { value: 'MAIN-F02-R09' } })
    fireEvent.keyDown(bin, { key: 'Enter' })
    const qty = screen.getByLabelText('How much did you put away?')
    await act(async () => { fireEvent.keyDown(qty, { key: 'Enter' }) })

    expect(completeMock).toHaveBeenCalledWith(expect.objectContaining({ recommendationId: 902 }))
    expect(screen.getByLabelText(/Scan the bin — expecting MAIN-F01-R09/)).toBeTruthy()
  })
})
