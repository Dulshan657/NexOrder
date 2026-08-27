// ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
//
// The putaway walk asked "scan the plate — expecting HU-000509" for a plate
// whose sticker had never been printed. `receive-stock` mints a handling unit
// for every line and renders no label, so the code existed in the database and
// on nothing else. The operator, holding a carton with `4796009868869` printed
// on it, scanned that and was told "That is plate 4796009868869, but this task
// is for HU-000509" — a sentence that calls a barcode a plate and offers no way
// forward. There was no skip, and the only exit was abandoning the stop.
//
// The server was never the obstacle: `checkPutawayScan` has always accepted and
// validated `productCode`, and `complete-putaway`'s schema has always taken it.
// The card simply never populated it. So these tests assert the PAYLOAD and the
// PROMPT — the contract that already existed, and the question that was wrong.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { completeMock, unassignMock, printMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  unassignMock: vi.fn(),
  printMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useCompletePutaway: () => ({ mutateAsync: completeMock, isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: unassignMock, isPending: false }),
}))
vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePrintPlateLabels: () => ({ mutateAsync: printMock, isPending: false }),
  usePlanBreakdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBreakDownPallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({ useToasts: () => ({ addToast: vi.fn() }) }))

import { PutawayStopCard } from '@/components/inventory/putaway/PutawayStopCard'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

/** The exact demo fixture: a CARTON plate, never labelled, holding a product
 *  whose own barcode is printed on the box. */
function row(over: Partial<PendingPutawayRow> = {}): PendingPutawayRow {
  return {
    id: 498,
    productId: 56,
    quantity: 12,
    recommendedLocationId: 2993,
    explanation: {
      engineVersion: 'v1', layoutId: 1, candidatesConsidered: 3,
      hardFilters: [], winner: null, alternatives: [],
    },
    createdAt: '2026-08-27T00:52:43Z',
    product: {
      id: 56, name: 'Abalone Sauce 210ml', sku: 'AYM-SAU-018', barcode: '4796009868869',
    } as Product,
    receipt: null,
    huId: 273,
    huType: 'carton',
    huCode: 'HU-000509',
    huLabelPrinted: false,
    huStatus: 'stored',
    assignedLocationId: 2993,
    assignedAt: '2026-08-27T01:01:45Z',
    ...over,
  }
}

const BIN = { code: 'AMADIYA-FAST.A-2-1-L5', name: 'Fast Movers · Rack 2 · L5', isActive: true }

function mount(over: Partial<PendingPutawayRow> = {}, twins: Array<{ huCode: string; quantity: number }> = []) {
  return render(
    <PutawayStopCard
      row={row(over)}
      bin={BIN}
      sequence={1}
      legDistanceM={12}
      reachable
      active
      disabled={false}
      warehouseId={2873}
      unlabelledTwins={twins}
      onActivate={() => {}}
      onDone={() => {}}
    />,
  )
}

/** Open the stop — collapsed cards render a button, not the scan fields. */
function open() {
  fireEvent.click(screen.getByRole('button', { name: /Abalone Sauce 210ml/i }))
}

function scan(labelPattern: RegExp, code: string) {
  const input = screen.getByLabelText(labelPattern)
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

afterEach(() => {
  cleanup()
  completeMock.mockReset()
  printMock.mockReset()
})

describe('putaway walk — identifying an unlabelled carton', () => {
  it('asks for the PRODUCT barcode, not the plate', () => {
    mount()
    open()
    expect(screen.getByLabelText(/Scan the product — expecting 4796009868869/)).toBeTruthy()
    expect(screen.queryByLabelText(/expecting HU-000509/)).toBeNull()
  })

  it('accepts the product barcode and sends it as productCode', async () => {
    completeMock.mockResolvedValue({ actualLocationCode: BIN.code, remainderQty: 0, placedElsewhere: false })
    mount()
    open()
    scan(/Scan the product/, '4796009868869')
    scan(/Scan the bin/, 'AMADIYA-FAST.A-2-1-L5')
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }))

    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    const payload = completeMock.mock.calls[0][0]
    expect(payload.recommendationId).toBe(498)
    expect(payload.scan.productCode).toBe('4796009868869')
    // The plate key stays absent: the operator never produced plate evidence,
    // and sending both would claim proof nobody supplied.
    expect(payload.scan.handlingUnitCode).toBeUndefined()
    expect(payload.scan.locationCode).toBe('AMADIYA-FAST.A-2-1-L5')
  })

  it('still accepts the plate code, and sends THAT instead', async () => {
    completeMock.mockResolvedValue({ actualLocationCode: BIN.code, remainderQty: 0, placedElsewhere: false })
    mount()
    open()
    // Asking for one thing does not mean refusing the other — an operator who
    // does have the sticker should never be turned away for using it.
    scan(/Scan the product/, 'HU-000509')
    scan(/Scan the bin/, 'AMADIYA-FAST.A-2-1-L5')
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }))

    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    const payload = completeMock.mock.calls[0][0]
    expect(payload.scan.handlingUnitCode).toBe('HU-000509')
    expect(payload.scan.productCode).toBeUndefined()
  })

  it('refuses an unrelated code by naming the product, not a plate', () => {
    mount()
    open()
    scan(/Scan the product/, 'SOMETHING-ELSE')
    expect(screen.getByText(/That item is not AYM-SAU-018/)).toBeTruthy()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('offers to print a plate label, quietly, in case the barcode is damaged', () => {
    mount()
    open()
    expect(screen.getByText(/Barcode damaged or missing\?/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Print a plate label/i })).toBeTruthy()
  })

  it('warns that a barcode cannot tell two unlabelled plates of one product apart', () => {
    mount({}, [{ huCode: 'HU-000508', quantity: 6 }])
    open()
    expect(screen.getByText(/HU-000508 \(6\)/)).toBeTruthy()
    expect(screen.getByText(/can't prove which one you're carrying/)).toBeTruthy()
  })
})

describe('putaway walk — the other branches of the rule', () => {
  it('asks for the plate once a sticker exists', () => {
    mount({ huLabelPrinted: true })
    open()
    expect(screen.getByLabelText(/Scan the plate — expecting HU-000509/)).toBeTruthy()
    // Nothing to print — it is printed.
    expect(screen.queryByRole('button', { name: /Print a plate label/i })).toBeNull()
  })

  it('asks for the plate on an unlabelled PALLET, and says the label is missing', () => {
    // A carton barcode names the SKU and cannot distinguish two pallets of it,
    // so this is the case that genuinely wants a sticker.
    mount({ huType: 'pallet' })
    open()
    expect(screen.getByLabelText(/Scan the plate — expecting HU-000509/)).toBeTruthy()
    expect(screen.getByText(/No label has ever been printed for HU-000509/)).toBeTruthy()
  })

  it('skips straight to the bin when nothing can identify the goods', () => {
    mount({ product: { id: 56, name: 'Abalone Sauce 210ml', sku: 'AYM-SAU-018', barcode: null } as Product })
    open()
    expect(screen.getByLabelText(/Scan the bin/)).toBeTruthy()
    // …but still offers the sticker that would have answered the question.
    expect(screen.getByText(/No label has ever been printed for HU-000509/)).toBeTruthy()
  })

  it('warns when the task has outlived its plate', () => {
    // A count, adjustment or transfer at the warehouse root can consume a
    // plate's stock without touching this task. The walk kept sending people to
    // a rack and the placement died as "reserved for an order".
    mount({ huStatus: 'empty' })
    open()
    expect(screen.getByText(/is recorded as empty/)).toBeTruthy()
  })
})
