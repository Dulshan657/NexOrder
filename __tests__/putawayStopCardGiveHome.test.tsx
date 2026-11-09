// NX-0033: a Manager or Admin can give a product with no home bin one, from the
// Walk. The offer shows on a stop for such a product (the planner tagged it
// `engine`); choosing a bin retargets the stop to it, insists on that bin at the
// scan, and sends make_home with the move. The home is set at completion, in the
// same transaction as the stock, so "Not now" and abandoning the stop leave
// nothing behind (plan ruling R5).
//
// Review Focus 4: when someone sets the home elsewhere while the manager is
// mid-stop, the server refuses make_home, and the card keeps the stop on the
// count with the server's words instead of resetting.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { completeMock, choicesMock, toastMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  choicesMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useCompletePutaway: () => ({ mutateAsync: completeMock, isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmOverflow: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
vi.mock('@/hooks/queries/useHomeBinChoices', () => ({
  useHomeBinChoices: (...args: unknown[]) => choicesMock(...args),
}))

import { PutawayStopCard } from '@/components/inventory/putaway/PutawayStopCard'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

const ENGINE = 'TST-WALK-E1'
const CHOSEN = 'TST-WALK-N1'
const SKU = 'TST-WALK-200'
const BIN = { code: ENGINE, name: ENGINE, isActive: true }

const OFFER = 'This product has no home bin. Give it one?'

/** A loose line the planner put through the engine because its product has no
 *  home. No plate and no product barcode, so the stop opens on the bin scan. */
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
    product: { id: 77, name: 'TST-WALK Product 200', sku: SKU, barcode: null } as Product,
    receipt: null,
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: null,
    huStatus: null,
    status: 'assigned',
    assignedLocationId: 5001,
    assignedAt: '2026-11-09T00:01:00Z',
    suggestionSource: 'engine',
    ...over,
  }
}

function mount(over: Partial<PendingPutawayRow> = {}, canSetHome = true) {
  return render(
    <PutawayStopCard
      row={row(over)}
      bin={BIN}
      sequence={1}
      legDistanceM={5}
      reachable
      active
      disabled={false}
      warehouseId={2873}
      canSetHome={canSetHome}
      unlabelledTwins={[]}
      onActivate={() => {}}
      onDone={() => {}}
    />,
  )
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /TST-WALK Product 200/i }))
}

function scanBin(label: RegExp | string, code: string) {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

/** Open the chooser and pick the bin from the list. */
function giveHome(code = CHOSEN) {
  fireEvent.click(screen.getByRole('button', { name: 'Give it a home' }))
  fireEvent.change(screen.getByLabelText('Or pick a bin'), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: 'Make this its home' }))
}

const BINS = [
  { binId: 6001, binCode: CHOSEN, binName: 'TST-WALK Bay One' },
  { binId: 6002, binCode: 'TST-WALK-N2', binName: null },
]

afterEach(() => {
  cleanup()
  completeMock.mockReset()
  choicesMock.mockReset()
  toastMock.mockReset()
})

function withChoices() {
  choicesMock.mockReturnValue({ data: BINS, isLoading: false, isError: false, error: null })
}

describe('putaway walk card — a product with no home', () => {
  it('offers a Manager "This product has no home bin. Give it one?"', () => {
    mount()
    open()

    expect(screen.getByText(OFFER)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Give it a home' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
  })

  it('offers nothing to a Warehouse user', () => {
    mount({}, false)
    open()

    expect(screen.queryByText(OFFER)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Give it a home' })).toBeNull()
  })

  it.each([
    ['a home task', { suggestionSource: 'home' as const }],
    ['an overflow task', { suggestionSource: 'overflow' as const }],
    ['a desk-redirected task', { suggestionSource: 'desk' as const }],
    ['a task with no recorded source', { suggestionSource: null }],
  ])('offers nothing on %s', (_name, over) => {
    mount(over)
    open()

    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('offers nothing on an overflow line that still waits for its yes', () => {
    mount({
      suggestionSource: 'overflow', status: 'suggested',
      assignedLocationId: null, assignedAt: null,
    })
    open()

    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('offers it on the identify step as well as the bin step, and not at the count', () => {
    mount({ huId: 3001, huType: 'pallet', huCode: 'TST-WALK-HU1', huLabelPrinted: true, huStatus: 'open' })
    open()
    // Identify step: carrying the right thing is still to be shown.
    expect(screen.getByText(OFFER)).toBeTruthy()

    scanBin(/plate/i, 'TST-WALK-HU1')
    expect(screen.getByText(OFFER)).toBeTruthy()

    scanBin(/Scan the bin/, ENGINE)
    expect(screen.getByLabelText(/How much did you put away/)).toBeTruthy()
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('"Not now" keeps the engine bin and sends no make_home', async () => {
    completeMock.mockResolvedValue({
      actualLocationCode: ENGINE, remainderQty: 0, placedElsewhere: false, homeSet: false,
    })
    mount()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

    expect(screen.queryByText(OFFER)).toBeNull()
    expect(choicesMock).not.toHaveBeenCalled()
    scanBin(/Scan the bin — expecting TST-WALK-E1/, ENGINE)
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }))

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    expect(completeMock.mock.calls[0][0]).not.toHaveProperty('makeHome')
    expect(completeMock.mock.calls[0][0].scan.locationCode).toBe(ENGINE)
  })

  it('closing the chooser without choosing brings the offer back', () => {
    withChoices()
    mount()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Give it a home' }))
    expect(screen.getByText(`Give ${SKU} a home bin`)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(`Give ${SKU} a home bin`)).toBeNull()
    expect(screen.getByText(OFFER)).toBeTruthy()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it("asks for the bins with the stop's own line, so its reservation does not count", () => {
    withChoices()
    mount()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Give it a home' }))

    expect(choicesMock).toHaveBeenCalledWith(2873, 77, true, 901)
  })

  it('choosing a home retargets the stop and sends make_home with a scan of that bin', async () => {
    withChoices()
    completeMock.mockResolvedValue({
      actualLocationCode: CHOSEN, remainderQty: 0, placedElsewhere: false, homeSet: true,
    })
    mount()
    open()
    giveHome()

    // The hero is the chosen bin now, and the offer has done its job.
    expect(screen.getByText(CHOSEN)).toBeTruthy()
    expect(screen.queryByText(ENGINE)).toBeNull()
    expect(screen.queryByText(OFFER)).toBeNull()
    expect(screen.getByLabelText(`Scan ${CHOSEN} — it becomes the home bin`)).toBeTruthy()

    // The engine's bin is refused now, and nothing moves on.
    scanBin(`Scan ${CHOSEN} — it becomes the home bin`, ENGINE)
    expect(screen.getByRole('alert').textContent).toBe(`Scan ${CHOSEN}, the bin you chose as its home.`)
    expect(screen.queryByLabelText(/How much did you put away/)).toBeNull()

    // Typed in lower case: the field ignores the same string twice inside 250 ms.
    scanBin(`Scan ${CHOSEN} — it becomes the home bin`, CHOSEN.toLowerCase())
    fireEvent.click(await screen.findByRole('button', { name: /Confirm/i }))

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    const sent = completeMock.mock.calls[0][0]
    expect(sent.makeHome).toBe(true)
    expect(sent.scan.locationCode).toBe(CHOSEN.toLowerCase())
    expect(sent.recommendationId).toBe(901)
    expect(toastMock).toHaveBeenCalledWith(`Placed in ${CHOSEN} — it is now ${SKU}'s home bin`, 'success')
  })

  it('puts the focus on the scan field of the stop once a home is chosen, so the gun can scan', () => {
    withChoices()
    mount()
    open()
    giveHome()

    expect(document.activeElement).toBe(screen.getByLabelText(`Scan ${CHOSEN} — it becomes the home bin`))
  })

  it('sends the scan of the chosen bin as the manager typed it', async () => {
    withChoices()
    completeMock.mockResolvedValue({
      actualLocationCode: CHOSEN, remainderQty: 0, placedElsewhere: false, homeSet: true,
    })
    mount()
    open()
    giveHome()
    scanBin(`Scan ${CHOSEN} — it becomes the home bin`, CHOSEN)
    fireEvent.click(await screen.findByRole('button', { name: /Confirm/i }))

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    expect(completeMock.mock.calls[0][0]).toMatchObject({
      makeHome: true,
      scan: { locationCode: CHOSEN },
    })
  })

  it('says so when someone set a home for the product meanwhile and it was placed anyway', async () => {
    withChoices()
    completeMock.mockResolvedValue({
      actualLocationCode: CHOSEN, remainderQty: 0, placedElsewhere: false, homeSet: false,
    })
    mount()
    open()
    giveHome()
    scanBin(`Scan ${CHOSEN} — it becomes the home bin`, CHOSEN)
    fireEvent.click(await screen.findByRole('button', { name: /Confirm/i }))

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1))
    expect(toastMock).toHaveBeenCalledWith(
      `Placed in ${CHOSEN} — someone set a home for ${SKU} meanwhile`,
      'info',
    )
  })

  it("keeps the stop open with the server's words when the home was set meanwhile", async () => {
    withChoices()
    const refusal = 'this product already has a home bin; change it in the home bin editor'
    completeMock.mockRejectedValue(new Error(refusal))
    mount()
    open()
    giveHome()
    scanBin(`Scan ${CHOSEN} — it becomes the home bin`, CHOSEN)
    fireEvent.click(await screen.findByRole('button', { name: /Confirm/i }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(refusal))
    // Still on the count, with the chosen bin and the Confirm button: not reset.
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeTruthy()
    expect(screen.getByLabelText(/How much did you put away/)).toBeTruthy()
    // The chosen bin is still the destination (the progress rail echoes it too).
    expect(screen.getAllByText(CHOSEN).length).toBeGreaterThan(0)
    expect(screen.queryByText(ENGINE)).toBeNull()
  })

  it('cancelling the stop after choosing leaves nothing behind', () => {
    withChoices()
    mount()
    open()
    giveHome()
    expect(screen.getByText(CHOSEN)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel this stop' }))
    expect(completeMock).not.toHaveBeenCalled()

    // Reopened, it is the engine's stop again, with the offer to make.
    open()
    expect(screen.getByText(ENGINE)).toBeTruthy()
    expect(screen.queryByText(CHOSEN)).toBeNull()
    expect(screen.getByText(OFFER)).toBeTruthy()
  })
})
