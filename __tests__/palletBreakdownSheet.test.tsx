// Pallet break-down at putaway — the PAYLOAD.
//
// The contract this file guards is the request `break-down-putaway` receives:
// base quantities converted from whatever unit the operator counted in, and one
// destination per portion. Everything downstream — the plate type, the engine's
// candidate set for each portion, what `v_bin_fill` charges each bay — is
// derived from those two fields, so a UI change that quietly sends cartons where
// base units belong would corrupt stock in three places at once and look fine on
// screen. Same reason receiveMixedPallet.test.tsx asserts a payload.
//
// The allocation arithmetic itself lives in palletBreakdown.test.ts; this is
// about what leaves the browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { planMock, commitMock, printMock } = vi.hoisted(() => ({
  planMock: vi.fn(),
  commitMock: vi.fn(),
  printMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePlanBreakdown: () => ({ mutateAsync: planMock, isPending: false }),
  useBreakDownPallet: () => ({ mutateAsync: commitMock, isPending: false }),
  usePrintPlateLabels: () => ({ mutateAsync: printMock, isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({ useToasts: () => ({ addToast: vi.fn() }) }))
vi.mock('@/hooks/queries/useSettings', () => ({
  // The AU standard pallet is what palletSpecFromSettings falls back to, so a
  // null row still yields a spec — layers are available whenever the carton box
  // is, which is what these fixtures exercise.
  useSettings: () => ({ data: null }),
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => ({
    data: [
      { id: 501, code: 'MAIN-B-1-1' },
      { id: 502, code: 'MAIN-B-2-1' },
    ],
  }),
}))
// The destination picker is exercised on its own elsewhere; here it is reduced
// to the one thing this file cares about — that whatever it confirms reaches the
// payload as `location_id`.
vi.mock('@/components/inventory/putaway/BinPickerSheet', () => ({
  BinPickerSheet: ({ onConfirm }: { onConfirm: (id: number, qty: number, override: boolean) => void }) => (
    <button onClick={() => onConfirm(501, 0, false)}>confirm-bin</button>
  ),
}))

import { PalletBreakdownSheet } from '@/components/inventory/putaway/PalletBreakdownSheet'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'

/** 480 base units on one pallet: 40 cartons of 12. */
const row = {
  id: 77,
  productId: 9,
  quantity: 480,
  recommendedLocationId: 501,
  explanation: {} as never,
  createdAt: '2026-08-26T00:00:00Z',
  receipt: null,
  huId: 3001,
  huType: 'pallet',
  huCode: 'HU-000042',
  assignedLocationId: 501,
  assignedAt: '2026-08-26T00:00:00Z',
  product: {
    id: 9,
    sku: 'AYM-COC-001',
    name: 'Coconut Milk',
    unit: 'each',
    cartonSize: 12,
    barcode: null,
    uoms: [
      { id: 1, productId: 9, code: 'each', factorToBase: 1, isBase: true, isOrderable: true, isReceivable: true },
      { id: 2, productId: 9, code: 'carton', factorToBase: 12, isBase: false, isOrderable: true, isReceivable: true },
    ],
  },
} as unknown as PendingPutawayRow

const renderSheet = () =>
  render(
    <PalletBreakdownSheet
      open
      warehouseId={1}
      row={row}
      onClose={() => {}}
      onDone={() => {}}
    />,
  )

/** Step one is the plate scan, exactly as the stop card demands. */
function scanPlate() {
  const field = screen.getByLabelText(/Scan the pallet/i)
  fireEvent.change(field, { target: { value: 'HU-000042' } })
  fireEvent.keyDown(field, { key: 'Enter' })
}

function setCount(index: number, value: string) {
  fireEvent.change(screen.getByLabelText(`Portion ${index} quantity`), { target: { value } })
}

function setUnit(index: number, value: string) {
  fireEvent.change(screen.getByLabelText(`Portion ${index} unit`), { target: { value } })
}

/** Open the destination picker for a portion, then confirm the stub's bin. */
function chooseBin(index = 1) {
  fireEvent.click(screen.getAllByText('Choose a bin')[index - 1])
  fireEvent.click(screen.getByText('confirm-bin'))
}

beforeEach(() => {
  planMock.mockReset()
  commitMock.mockReset()
  printMock.mockReset()
  commitMock.mockResolvedValue({
    parentId: 77, parentRemaining: 408, parentClosed: false,
    plates: [{
      recommendationId: 78, handlingUnitId: 4001, code: 'HU-000091',
      huType: 'carton', quantity: 72, locationId: 501, locationCode: 'MAIN-B-1-1',
    }],
  })
})
afterEach(cleanup)

describe('PalletBreakdownSheet payload', () => {
  it('refuses to open the portion sheet until the pallet is scanned', () => {
    renderSheet()
    expect(screen.getByLabelText(/Scan the pallet/i)).toBeTruthy()
    expect(screen.queryByLabelText('Portion 1 quantity')).toBeNull()
  })

  it('will not let a wrong plate through', () => {
    renderSheet()
    const field = screen.getByLabelText(/Scan the pallet/i)
    fireEvent.change(field, { target: { value: 'HU-999999' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.queryByLabelText('Portion 1 quantity')).toBeNull()
  })

  it('sends BASE units, not the count that was typed', async () => {
    renderSheet()
    scanPlate()
    setCount(1, '6')            // six CARTONS
    chooseBin()
    fireEvent.click(screen.getByRole('button', { name: /Break into/i }))

    await waitFor(() => expect(commitMock).toHaveBeenCalledTimes(1))
    expect(commitMock.mock.calls[0][0]).toMatchObject({
      recommendationId: 77,
      portions: [{ baseQty: 72, countedUnit: 'carton', locationId: 501 }],
    })
  })

  it('carries the counted unit so the server can derive the plate type', async () => {
    renderSheet()
    scanPlate()
    setUnit(1, 'base')
    setCount(1, '5')
    chooseBin()
    fireEvent.click(screen.getByRole('button', { name: /Break into/i }))

    await waitFor(() => expect(commitMock).toHaveBeenCalledTimes(1))
    expect(commitMock.mock.calls[0][0].portions[0]).toMatchObject({
      baseQty: 5, countedUnit: 'base',
    })
  })

  it('holds the commit until every portion has a bin', () => {
    renderSheet()
    scanPlate()
    setCount(1, '6')
    // No bin chosen: planBreakdown refuses the sheet, so the button is disabled
    // and nothing can be sent. This is the client half of the server's
    // "every portion needs a destination bin".
    const button = screen.getByRole('button', { name: /Break into/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(commitMock).not.toHaveBeenCalled()
  })

  it('refuses more than the pallet holds, and says by how much', () => {
    renderSheet()
    scanPlate()
    setCount(1, '50')           // 600 base units off a 480-unit pallet
    chooseBin()
    expect(screen.getByText(/120 each more than the pallet holds/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Break into/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says plainly when the pallet ends up empty', () => {
    renderSheet()
    scanPlate()
    setCount(1, '40')           // the whole 480
    chooseBin()
    expect(screen.getByText(/Nothing stays on the pallet/i)).toBeTruthy()
  })

  it('offers the labels only after the break-down has committed', async () => {
    renderSheet()
    scanPlate()
    setCount(1, '6')
    chooseBin()
    expect(screen.queryByRole('button', { name: /Print 1 label/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Break into/i }))
    await waitFor(() => expect(screen.getByText('HU-000091')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Print 1 label/i })).toBeTruthy()
  })

  // Found in a browser, not by a test: the engine returned no bin for the SKU,
  // the sheet said nothing, and pressing Suggest bins looked like a dead button.
  it('says so when the engine has no bin to offer', async () => {
    planMock.mockResolvedValue({
      mode: 'engine', parentRemaining: 408, parentClosed: false,
      portions: [{
        index: 0, baseQty: 72, countedUnit: 'carton', huType: 'carton',
        recommendedLocationId: null, alternatives: [], explanation: {}, locationId: null,
      }],
    })
    renderSheet()
    scanPlate()
    setCount(1, '6')
    fireEvent.click(screen.getByRole('button', { name: /Suggest bins/i }))
    await waitFor(() => expect(screen.getByText(/No bin the engine will offer/i)).toBeTruthy())
  })

  it('drops a stale engine verdict when the quantity changes under it', async () => {
    planMock.mockResolvedValue({
      mode: 'engine', parentRemaining: 408, parentClosed: false,
      portions: [{
        index: 0, baseQty: 72, countedUnit: 'carton', huType: 'carton',
        recommendedLocationId: null, alternatives: [], explanation: {}, locationId: null,
      }],
    })
    renderSheet()
    scanPlate()
    setCount(1, '6')
    fireEvent.click(screen.getByRole('button', { name: /Suggest bins/i }))
    await waitFor(() => expect(screen.getByText(/No bin the engine will offer/i)).toBeTruthy())

    // 'no bin for 6 cartons' says nothing about 2, so it must not linger.
    setCount(1, '2')
    expect(screen.queryByText(/No bin the engine will offer/i)).toBeNull()
  })

  it('renders the label sheet as a LINK, never a programmatic open', async () => {
    printMock.mockResolvedValue({ signedUrl: 'https://example.test/sheet.pdf', labelCount: 1, storagePath: 'x' })
    renderSheet()
    scanPlate()
    setCount(1, '6')
    chooseBin()
    fireEvent.click(screen.getByRole('button', { name: /Break into/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Print 1 label/i })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Print 1 label/i }))
    // window.open after an await is popup-blocked, so the URL has to arrive as
    // something the operator taps.
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Open the label sheet/i }) as HTMLAnchorElement
      expect(link.href).toBe('https://example.test/sheet.pdf')
    })
    expect(printMock).toHaveBeenCalledWith([4001])
  })
})
