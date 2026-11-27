// NX-0049: one product per location. When the server would refuse the scanned
// location (the location already holds another product, or the home rule), the
// card says so AT the location scan and stays there; the walker never reaches
// the count to be refused at Confirm.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { completeMock, unassignMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  unassignMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useCompletePutaway: () => ({ mutateAsync: completeMock, isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: unassignMock, isPending: false }),
  useConfirmOverflow: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    status: 'assigned',
    assignedLocationId: 5001,
    assignedAt: '2026-11-09T00:01:00Z',
    suggestionSource: 'home',
    ...over,
  }
}

function mount(checkLocation?: (recommendationId: number, locationCode: string) => Promise<string | null>) {
  return render(
    <PutawayStopCard
      row={row({ suggestionSource: 'engine' })}
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
      {...({ checkLocation } as Record<string, unknown>)}
    />,
  )
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /TST-HOME Product 200/i }))
}

function scanBin(code: string) {
  const input = screen.getByLabelText(/Scan the location/)
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

afterEach(() => {
  cleanup()
  completeMock.mockReset()
})

describe('PutawayStopCard', () => {
  it('a refused location is shown at the scan and the count step is not reached', async () => {
    const refusal = `${OTHER} already holds TST-OTHER (Other product). Put this in an empty location.`
    const check = vi.fn(async () => refusal)
    mount(check)
    open()
    scanBin(OTHER)
    await waitFor(() => expect(screen.getByText(refusal)).toBeTruthy())
    expect(check).toHaveBeenCalledWith(901, OTHER)
    expect(screen.queryByText(/How much did you put away/)).toBeNull()
    expect(screen.getByLabelText(/Scan the location/)).toBeTruthy()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('an allowed location moves on to the count', async () => {
    mount(vi.fn(async () => null))
    open()
    scanBin(HOME)
    await waitFor(() => expect(screen.getByText(/How much did you put away/)).toBeTruthy())
  })

  it('a slow refusal for an earlier scan never lands after a later scan moved on', async () => {
    let releaseSlow: (v: string) => void = () => {}
    const slow = new Promise<string>((resolve) => { releaseSlow = resolve })
    const check = vi.fn()
      .mockImplementationOnce(() => slow)
      .mockImplementationOnce(async () => null)
    mount(check)
    open()
    scanBin(OTHER)
    scanBin(HOME)
    await waitFor(() => expect(screen.getByText(/How much did you put away/)).toBeTruthy())
    releaseSlow(`${OTHER} already holds TST-OTHER (Other product). Put this in an empty location.`)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/already holds TST-OTHER/)).toBeNull()
    expect(screen.getByText(/How much did you put away/)).toBeTruthy()
  })

  it('when the check itself fails the walker is not stopped (the server judges at Confirm)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(vi.fn(async () => { throw new Error('offline') }))
    open()
    scanBin(HOME)
    await waitFor(() => expect(screen.getByText(/How much did you put away/)).toBeTruthy())
    warn.mockRestore()
  })
})
