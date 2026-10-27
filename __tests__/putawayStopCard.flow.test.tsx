// NX-0007 — the putaway stop as the owner described it: scan the item, scan the
// bin, Enter. A question only when one is forced (a different bin, a short
// count, no home yet), and Back on every step until Confirm.
//
// The happy path is driven by keyboard events only, the way a wedge scanner
// drives it: no fireEvent.click before the payload is sent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { completeMock, tasksMock, routeMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  tasksMock: vi.fn(),
  routeMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useOpenPutaways: () => tasksMock(),
  useAssignedPutaways: () => tasksMock(),
  usePutawayRoute: () => routeMock(),
  useCompletePutaway: () => ({ mutateAsync: completeMock, isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({ data: [], isLoading: false, isError: false }),
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

import { PutawayStopCard } from '@/components/inventory/putaway/PutawayStopCard'
import PutawayWalkView from '@/components/inventory/PutawayWalkView'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

const BARCODE = '9312000000036'
const BIN = { code: 'MAIN-F01-R09', name: null, isActive: true }

function row(over: Partial<PendingPutawayRow> = {}): PendingPutawayRow {
  return {
    id: 498,
    productId: 3,
    quantity: 12,
    recommendedLocationId: 537,
    explanation: { engineVersion: 'v1', layoutId: 1, candidatesConsidered: 3, hardFilters: [], winner: null, alternatives: [] },
    createdAt: '2026-10-27T00:00:00Z',
    product: { id: 3, name: 'Coconut Milk 400ml', sku: 'AYM-COC-003', barcode: BARCODE } as Product,
    receipt: null,
    huId: 900,
    huType: 'carton',
    huCode: 'HU-000900',
    huLabelPrinted: false,
    huStatus: 'open',
    assignedLocationId: null,
    assignedAt: null,
    status: 'suggested',
    suggestionSource: 'home',
    ...over,
  }
}

/** Opened by a scan of the product, as the walk's scan bar opens it. */
function mount(over: Partial<PendingPutawayRow> = {}) {
  return render(
    <PutawayStopCard
      row={row(over)}
      bin={BIN}
      sequence={1}
      legDistanceM={null}
      reachable
      active
      disabled={false}
      warehouseId={1}
      unlabelledTwins={[]}
      openRequest={{ productCode: BARCODE }}
      onActivate={() => {}}
      onDone={() => {}}
    />,
  )
}

function scan(labelPattern: RegExp, code: string) {
  const input = screen.getByLabelText(labelPattern) as HTMLInputElement
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

function qtyField(): HTMLInputElement {
  return screen.getByLabelText(/How much did you put away/i) as HTMLInputElement
}

function pressEnterOnQty() {
  fireEvent.keyDown(qtyField(), { key: 'Enter' })
}

beforeEach(() => {
  completeMock.mockReset()
  completeMock.mockResolvedValue({
    status: 'accepted', placedElsewhere: false, scanVerified: true,
    actualLocationCode: BIN.code, remainderQty: 0, remainderStatus: null, homeSet: false,
  })
})
afterEach(cleanup)

describe('PutawayStopCard flow', () => {
  it('completes a suggested task with scan, scan, Enter and no clicks', async () => {
    mount()
    // The scan that opened the stop already proved the item: straight to the bin.
    scan(/Scan the bin/, BIN.code)
    pressEnterOnQty()
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    const payload = completeMock.mock.calls[0][0]
    expect(payload.recommendationId).toBe(498)
    expect(payload.scan).toMatchObject({ locationCode: BIN.code, productCode: BARCODE })
    expect(payload.quantity).toBeUndefined()
    expect(payload.overrideReason).toBeUndefined()
  })

  it('says why this bin and sends make_home when ticked', async () => {
    const { unmount } = mount({ suggestionSource: 'home' })
    expect(screen.getByText(/^Home bin$/)).toBeTruthy()
    expect(screen.queryByLabelText(/Make this the home bin/i)).toBeNull()
    unmount()

    mount({ suggestionSource: 'overflow' })
    expect(screen.getByText(/home is full/i)).toBeTruthy()
    cleanup()

    mount({ suggestionSource: 'engine' })
    expect(screen.getByText(/No home yet/i)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Make this the home bin/i))
    scan(/Scan the bin/, BIN.code)
    pressEnterOnQty()
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    expect(completeMock.mock.calls[0][0].makeHome).toBe(true)
  })

  it('asks for a reason when a different bin is scanned', async () => {
    mount()
    scan(/Scan the bin/, 'MAIN-F01-R10')
    const confirmButton = screen.getByRole('button', { name: /^Confirm$/ }) as HTMLButtonElement
    expect(confirmButton.disabled).toBe(true)
    pressEnterOnQty()
    expect(completeMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    expect(confirmButton.disabled).toBe(false)
    pressEnterOnQty()
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    expect(completeMock.mock.calls[0][0].overrideReason).toBe('full')
  })

  it('Back returns one step without sending', () => {
    mount()
    // Bin → back to identifying the item.
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }))
    expect(screen.getByLabelText(/Scan the product/i)).toBeTruthy()
    // Forward again, then Count → back to the bin.
    scan(/Scan the product/i, BARCODE)
    scan(/Scan the bin/, BIN.code)
    expect(qtyField()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }))
    expect(screen.getByLabelText(/Scan the bin/)).toBeTruthy()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('flags a short count', async () => {
    mount()
    scan(/Scan the bin/, BIN.code)
    fireEvent.change(qtyField(), { target: { value: '10' } })
    pressEnterOnQty()
    // A short count is a question, not a silent partial.
    expect(completeMock).not.toHaveBeenCalled()
    expect(screen.getByText(/Short by 2/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Flag 2 short/i }))
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    expect(completeMock.mock.calls[0][0]).toMatchObject({ quantity: 10, short: true })
  })

  it('a mixed plate lists its products', async () => {
    const plate = { huId: 950, huCode: 'HU-000950', huLabelPrinted: true }
    tasksMock.mockReturnValue({
      data: [
        row({ id: 601, productId: 3, ...plate }),
        row({
          id: 602, productId: 20, recommendedLocationId: 539, ...plate,
          product: { id: 20, name: 'Thai Red Curry Paste 195g', sku: 'AYM-CUR-001', barcode: '074250000202' } as Product,
        }),
      ],
      isLoading: false, isError: false,
    })
    routeMock.mockReturnValue({ data: { mode: 'legacy' }, isLoading: false, isError: false })
    render(<PutawayWalkView warehouseId={1} />)

    scan(/Scan a plate, carton or bin/i, plate.huCode)
    // The plate holds two products: say so and let the operator choose.
    expect(screen.getByText(/HU-000950 holds 2 products/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Thai Red Curry Paste 195g/ }))
    // The plate scan is the evidence; the card opens at the bin step.
    expect(screen.getByLabelText(/Scan the bin/)).toBeTruthy()
  })
})
