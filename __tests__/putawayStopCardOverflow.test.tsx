// NX-0033: the walk card for an overflow line that waits for someone's yes.
//
// The product's home was full, so the engine suggested another bin and nobody has
// said yes to it yet. The walker's bin scan IS the yes: scanning the suggested
// bin confirms it (a compare-and-set on the server, so a desk redirect made after
// the walk loaded cannot be confirmed by a stale scan), and only then does the
// card move on to the count. Any other bin is refused at the scan and nothing is
// sent: the walker either confirms this one or leaves the line for the desk.
//
// Review Focus 1: when the desk got there first the server refuses, and the card
// shows the server's own words and does not move on to the count.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { completeMock, unassignMock, confirmMock, toastMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  unassignMock: vi.fn(),
  confirmMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useCompletePutaway: () => ({ mutateAsync: completeMock, isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: unassignMock, isPending: false }),
  useConfirmOverflow: () => ({ mutateAsync: confirmMock, isPending: false }),
}))
vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePrintPlateLabels: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePlanBreakdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBreakDownPallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: toastMock }),
  useToastActions: () => ({ addToast: toastMock }),
}))

import { PutawayStopCard } from '@/components/inventory/putaway/PutawayStopCard'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

const SUGGESTED = 'TST-WALK-O1'
const OTHER = 'TST-WALK-O2'
const BIN = { code: SUGGESTED, name: SUGGESTED, isActive: true }

/** A loose overflow line awaiting confirmation, with no plate and no product
 *  barcode, so the stop opens straight on the bin scan. */
function row(over: Partial<PendingPutawayRow> = {}): PendingPutawayRow {
  return {
    id: 901,
    productId: 77,
    quantity: 24,
    recommendedLocationId: 5002,
    explanation: {
      engineVersion: 'v1', layoutId: 1, candidatesConsidered: 3,
      hardFilters: [], winner: null, alternatives: [],
    },
    createdAt: '2026-11-09T00:00:00Z',
    product: { id: 77, name: 'TST-WALK Product 100', sku: 'TST-WALK-100', barcode: null } as Product,
    receipt: null,
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: null,
    huStatus: null,
    status: 'suggested',
    assignedLocationId: null,
    assignedAt: null,
    suggestionSource: 'overflow',
    ...over,
  }
}

function mount(over: Partial<PendingPutawayRow> = {}, onDone = () => {}) {
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
      onDone={onDone}
    />,
  )
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /TST-WALK Product 100/i }))
}

function scan(label: RegExp, code: string) {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

const scanBin = (code: string) => scan(new RegExp(`Scan ${SUGGESTED} to confirm`), code)

afterEach(() => {
  cleanup()
  completeMock.mockReset()
  unassignMock.mockReset()
  confirmMock.mockReset()
  toastMock.mockReset()
})

describe('putaway walk card — overflow awaiting confirmation', () => {
  it('shows "Home full — put in <bin>?" and asks to scan that bin to confirm', () => {
    mount()
    open()

    expect(screen.getByText(`Home full — put in ${SUGGESTED}?`)).toBeTruthy()
    expect(screen.getByLabelText(`Scan ${SUGGESTED} to confirm`)).toBeTruthy()
    expect(screen.getByText('Scanning this bin confirms it. The desk can choose another bin instead.')).toBeTruthy()
    // Not the ordinary prompt, and not the "a different bay is fine" helper.
    expect(screen.queryByLabelText(/Scan the bin/)).toBeNull()
    expect(screen.queryByText(/A different bay is fine/)).toBeNull()
  })

  it('says it is a decision on the collapsed row too', () => {
    mount()
    expect(screen.getByText('Home full — confirm')).toBeTruthy()
  })

  it('scanning the suggested bin confirms it, then moves on to the count', async () => {
    confirmMock.mockResolvedValue({ assignedId: 901 })
    mount()
    open()
    scanBin(SUGGESTED)

    await waitFor(() => expect(screen.getByLabelText(/How much did you put away/)).toBeTruthy())
    expect(confirmMock).toHaveBeenCalledTimes(1)
    // The code the walker scanned, not the card's own idea of the bin (M1): the
    // server resolves it and compares it with the line's bin under the row lock.
    expect(confirmMock).toHaveBeenCalledWith({ recommendationId: 901, locationCode: SUGGESTED })
    expect(toastMock).toHaveBeenCalledWith(`Confirmed — put it in ${SUGGESTED}`, 'success')
    // Nothing is placed by a confirmation: that is the count step's Confirm.
    expect(completeMock).not.toHaveBeenCalled()
    // Confirmed, so it is no longer asking.
    expect(screen.queryByText(/Home full — put in/)).toBeNull()
  })

  it('accepts the suggested bin however it is typed', async () => {
    confirmMock.mockResolvedValue({ assignedId: 901 })
    mount()
    open()
    scanBin(` ${SUGGESTED.toLowerCase()}\n`)

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    expect(confirmMock).toHaveBeenCalledWith({ recommendationId: 901, locationCode: SUGGESTED })
  })

  it('another bin is refused at the scan and nothing is sent', () => {
    mount()
    open()
    scanBin(OTHER)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(
      `Scan ${SUGGESTED} to confirm this overflow bin, or leave it for the desk to choose another.`,
    )
    expect(confirmMock).not.toHaveBeenCalled()
    // Still on the bin step: the count is not offered.
    expect(screen.queryByLabelText(/How much did you put away/)).toBeNull()
    expect(screen.getByLabelText(`Scan ${SUGGESTED} to confirm`)).toBeTruthy()
  })

  it("shows the server's refusal and refreshes the walk when the desk got there first", async () => {
    const refusal = 'This line was already dealt with (it is now assigned).'
    confirmMock.mockRejectedValue(new Error(refusal))
    mount()
    open()
    scanBin(SUGGESTED)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(refusal))
    // Said where the walker is looking, and again as a toast in case the refreshed
    // walk takes this stop away altogether.
    expect(toastMock).toHaveBeenCalledWith(refusal, 'error')
    expect(screen.queryByLabelText(/How much did you put away/)).toBeNull()
    // The refresh is the hook's own (it invalidates the lists on an error, which
    // useConfirmOverflow's test pins); the card only has to stay out of the count.
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('stays on the bin step after a refusal so the refreshed stop can be scanned', async () => {
    confirmMock.mockRejectedValueOnce(new Error('This line no longer waits for an overflow confirmation.'))
    confirmMock.mockResolvedValue({ assignedId: 901 })
    mount()
    open()
    scanBin(SUGGESTED)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    // Typed in lower case: the field ignores the same string twice inside 250 ms
    // (a CRLF terminator), and a test is faster than a person.
    scanBin(SUGGESTED.toLowerCase())
    await waitFor(() => expect(screen.getByLabelText(/How much did you put away/)).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('hides "Put it back on the queue" until confirmed', async () => {
    confirmMock.mockResolvedValue({ assignedId: 901 })
    mount()
    open()
    expect(screen.queryByRole('button', { name: /Put it back on the queue/ })).toBeNull()

    scanBin(SUGGESTED)
    await waitFor(() => expect(screen.getByLabelText(/How much did you put away/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Put it back on the queue/ })).toBeTruthy()
  })

  it('hides "Break down" on a pallet until confirmed', async () => {
    confirmMock.mockResolvedValue({ assignedId: 901 })
    mount({ huId: 3001, huType: 'pallet', huCode: 'TST-WALK-HU1', huLabelPrinted: true, huStatus: 'open' })
    open()
    scan(/plate/i, 'TST-WALK-HU1')
    expect(screen.getByLabelText(`Scan ${SUGGESTED} to confirm`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Break down/ })).toBeNull()

    scanBin(SUGGESTED)
    await waitFor(() => expect(screen.getByLabelText(/How much did you put away/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Break down/ })).toBeTruthy()
  })

  it('treats a single-product pallet as an ordinary stop, with no confirmation', () => {
    mount({ unitLoad: true })
    open()

    expect(screen.queryByText(/Home full/)).toBeNull()
    expect(screen.getByLabelText(/Scan the bin/)).toBeTruthy()
    expect(screen.getByText(/A different bay is fine/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Put it back on the queue/ })).toBeTruthy()
  })

  it('treats an assigned overflow line as an ordinary stop', () => {
    mount({ status: 'assigned', assignedLocationId: 5002, assignedAt: '2026-11-09T00:01:00Z' })
    open()

    expect(screen.queryByText(/Home full/)).toBeNull()
    expect(screen.getByLabelText(/Scan the bin/)).toBeTruthy()
    expect(confirmMock).not.toHaveBeenCalled()
  })
})
