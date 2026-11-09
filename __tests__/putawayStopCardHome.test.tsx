// NX-0032: the walk card and a task sent to the product's HOME bin.
//
// While a home has room putaway must land there, and the server refuses any other
// bin. So when the task the planner sent home is scanned into a different bay, the
// card says so at the bin scan and stays there for a rescan; it does not move on
// to the count and wait for Confirm to be refused. Overflow and engine tasks keep
// the older rule: a different bay is allowed and recorded.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { completeMock, unassignMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  unassignMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useCompletePutaway: () => ({ mutateAsync: completeMock, isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: unassignMock, isPending: false }),
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
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

const HOME = 'TST-HOME-B1'
const OTHER = 'TST-HOME-B2'
const BIN = { code: HOME, name: HOME, isActive: true }

/** A loose line with no plate and no product barcode: nothing to identify, so the
 *  stop opens straight on the bin scan. */
function row(over: Partial<PendingPutawayRow> = {}): PendingPutawayRow {
  return {
    id: 901,
    productId: 77,
    quantity: 24,
    recommendedLocationId: 5001,
    explanation: {
      engineVersion: 'v1', layoutId: 1, candidatesConsidered: 3,
      hardFilters: [], winner: null, alternatives: [],
    },
    createdAt: '2026-11-09T00:00:00Z',
    product: { id: 77, name: 'TST-HOME Product 200', sku: 'TST-HOME-200', barcode: null } as Product,
    receipt: null,
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: null,
    huStatus: null,
    assignedLocationId: 5001,
    assignedAt: '2026-11-09T00:01:00Z',
    suggestionSource: 'home',
    ...over,
  }
}

function mount(over: Partial<PendingPutawayRow> = {}) {
  return render(
    <PutawayStopCard
      row={row(over)}
      bin={BIN}
      sequence={1}
      legDistanceM={5}
      reachable
      active
      disabled={false}
      warehouseId={1}
      unlabelledTwins={[]}
      onActivate={() => {}}
      onDone={() => {}}
    />,
  )
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /TST-HOME Product 200/i }))
}

function scanBin(code: string) {
  const input = screen.getByLabelText(/Scan the bin/)
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

afterEach(() => {
  cleanup()
  completeMock.mockReset()
})

describe('putaway walk card — a task sent to the product home', () => {
  it('refuses another bay at the bin scan and stays there for a rescan', () => {
    mount()
    open()
    scanBin(OTHER)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(`This product's home bin is ${HOME}. Scan ${HOME}.`)
    // Still on the bin step: the scan field is there, the count step is not.
    expect(screen.getByLabelText(/Scan the bin/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Confirm/i })).toBeNull()
    expect(screen.queryByText(/That's allowed/)).toBeNull()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('moves on to the count once the home bin is scanned, and sends that bin', async () => {
    completeMock.mockResolvedValue({ actualLocationCode: HOME, remainderQty: 0, placedElsewhere: false })
    mount()
    open()
    scanBin(OTHER)
    scanBin(HOME)

    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }))
    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    expect(completeMock.mock.calls[0][0].scan.locationCode).toBe(HOME)
  })

  it('says it is the home bin instead of "a different bay is fine"', () => {
    mount()
    open()
    expect(screen.getByText(/home bin\. It goes here while the home has room/)).toBeTruthy()
    expect(screen.queryByText(/A different bay is fine/)).toBeNull()
  })

  it('leaves a task the desk assigned to another bin to the server', () => {
    // Suggested the home (5001) but assigned elsewhere (5002): the desk made its
    // own call, and the server judges it against the room at the home.
    mount({ assignedLocationId: 5002 })
    open()
    scanBin(OTHER)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeTruthy()
  })
})

describe('putaway walk card — overflow and engine tasks', () => {
  it.each(['overflow', 'engine', null] as const)(
    'accepts a different bay for a %s task and says it is recorded',
    (source) => {
      mount({ suggestionSource: source })
      open()
      expect(screen.getByText(/A different bay is fine/)).toBeTruthy()
      scanBin(OTHER)

      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByText(/That's allowed/)).toBeTruthy()
      expect(screen.getByRole('button', { name: /Confirm/i })).toBeTruthy()
    },
  )
})
