import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// The dock flow end to end (NX-0005): scan to count, keyboard pick from search,
// required lot/expiry, totals in the scan bar, and labels rendering by
// themselves once the receipt is recorded.

const { receiveMock, printMock, requirementsRef, platesRef } = vi.hoisted(() => ({
  receiveMock: vi.fn(),
  printMock: vi.fn(),
  requirementsRef: { current: new Map<number, { lot: boolean; expiry: boolean }>() },
  platesRef: { current: [] as unknown[] },
}))

vi.mock('@/hooks/queries/useReceiveStock', () => ({
  useReceiveStock: () => ({ mutateAsync: receiveMock, isPending: false }),
  useReceiptPlates: (id: number | null) => ({ data: id == null ? undefined : platesRef.current }),
}))
vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePrintPlateLabels: () => ({ mutateAsync: printMock, isPending: false }),
}))
vi.mock('@/hooks/queries/useReceivingRequirements', () => ({
  useReceivingRequirements: () => ({ data: requirementsRef.current }),
}))
vi.mock('@/hooks/queries/useInventoryBalances', () => ({
  useRecentReceipts: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/hooks/queries/useWarehouses', () => ({
  useWarehouses: () => ({ data: [{ id: 1, name: 'MAIN', isActive: true, code: 'MAIN' }] }),
}))
vi.mock('@/hooks/queries/useSuppliers', () => ({
  useSuppliers: () => ({ data: [{ id: 1, name: 'Acme Foods' }] }),
}))
vi.mock('@/hooks/queries/useLevelRoles', async () => {
  const { FALLBACK_LEVEL_ROLES } = await import('@/lib/levelRoles')
  return { useLevelRoles: () => ({ data: FALLBACK_LEVEL_ROLES }) }
})
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
  useToastActions: () => ({ addToast: vi.fn() }),
}))
vi.mock('@/hooks/queries/useSettings', () => ({
  useSettings: () => ({ data: null }),
}))

import ReceiveStockView from '@/components/inventory/ReceiveStockView'
import { UserRole, type Product, type User } from '@/types'

function product(id: number, name: string, sku: string): Product {
  return {
    id, sku, name, description: '', price: 1, category: 'Other',
    inventory: 0, available: 0, unit: 'each', cartonSize: 1, supplierId: 1,
    suppliers: [{ supplierId: 1, isPrimary: true, sortOrder: 0 }],
  } as Product
}

const products = [
  product(1, 'Coconut Milk', 'AYM-COC-001'),
  product(2, 'Noodles', 'AYM-NDL-002'),
]

const currentUser = { id: 1, name: 'Ada', role: UserRole.ADMIN } as unknown as User

let clock = 0
beforeEach(() => {
  receiveMock.mockReset()
  printMock.mockReset()
  requirementsRef.current = new Map()
  platesRef.current = []
  // ScanField drops an identical code committed within 250ms (a doubled
  // terminator). Two deliberate scans in a test happen in the same tick, so
  // give each one its own second.
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderView = (onOpenPutaway?: (id: number) => void) =>
  render(<ReceiveStockView products={products} currentUser={currentUser} onOpenPutaway={onOpenPutaway} />)

function pickAcme() {
  fireEvent.focus(screen.getByLabelText('Supplier'))
  fireEvent.click(screen.getByRole('button', { name: 'Acme Foods' }))
}

/** A scan as the field sees it: the code lands, then the terminating Enter. */
function scanCode(code: string) {
  const input = screen.getByLabelText('Search products')
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

const quantityBoxes = () => screen.getAllByLabelText(/^Quantity for /) as HTMLInputElement[]
const dock = () => document.querySelector('[data-scan-dock]') as HTMLElement
const receiveButton = () => within(dock()).getByRole('button', { name: /^Receive/ }) as HTMLButtonElement

describe('Receive Stock flow', () => {
  it('scanning the same barcode twice leaves one line at quantity 2', () => {
    renderView()
    pickAcme()
    scanCode('AYM-COC-001')
    scanCode('AYM-COC-001')

    const boxes = quantityBoxes()
    expect(boxes).toHaveLength(1)
    expect(boxes[0].value).toBe('2')
  })

  it('a product that requires an expiry blocks Receive until one is entered', () => {
    requirementsRef.current = new Map([[1, { lot: false, expiry: true }]])
    renderView()
    pickAcme()
    scanCode('AYM-COC-001')

    expect(receiveButton().disabled).toBe(true)
    const expiry = screen.getByLabelText('Expiry for Coconut Milk (required)')
    fireEvent.change(expiry, { target: { value: '2027-03-01' } })
    expect(receiveButton().disabled).toBe(false)
  })

  it('keeps Receive disabled while ANY line lacks a required field, not just the only one', () => {
    // Review finding: with one complete and one incomplete line, Receive used
    // to send the complete one and wipe the screen — the incomplete goods
    // vanished from the receipt without ever reaching stock.
    requirementsRef.current = new Map([[1, { lot: false, expiry: true }]])
    renderView()
    pickAcme()
    scanCode('AYM-COC-001')
    scanCode('AYM-NDL-002')

    expect(receiveButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Expiry for Coconut Milk (required)'), { target: { value: '2027-03-01' } })
    expect(receiveButton().disabled).toBe(false)
  })

  it('does not collapse the delivery details while a supplier name is still being typed', () => {
    // Review finding: the strip collapsed on the first keystroke, hiding the
    // very input being typed into. It may collapse only on a COMMITTED pick.
    renderView()
    const supplier = screen.getByLabelText('Supplier')
    fireEvent.change(supplier, { target: { value: 'Ac' } })
    expect(screen.queryByTestId('receipt-header-toggle')?.getAttribute('aria-expanded') ?? 'true').toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Acme Foods' }))
    expect(screen.getByTestId('receipt-header-toggle').getAttribute('aria-expanded')).toBe('false')
  })

  it('ignores scans while the receipt is being saved, and says so', async () => {
    // Review finding: a scan landing during the save counted onto a line the
    // server had already been sent, and the reset then discarded it.
    let resolveReceive: (v: unknown) => void = () => {}
    receiveMock.mockImplementation(() => new Promise((r) => { resolveReceive = r }))
    renderView()
    pickAcme()
    scanCode('AYM-COC-001')
    fireEvent.click(receiveButton())
    scanCode('AYM-COC-001')

    expect((quantityBoxes()[0]).value).toBe('1')
    expect(screen.getByText(/Saving the receipt/i)).toBeTruthy()
    await act(async () => { resolveReceive({ lines_received: 1, location_id: 1, putaway: null }) })
  })

  it('lifts the delivery details above the scan bar only while the supplier list is open', () => {
    // `.glass-card` carries backdrop-blur, which makes the card a stacking
    // context — so the list's own z-index counts only INSIDE it, and the sticky
    // scan bar and the lines painted over it. jsdom has no stacking, so the
    // class is what can be pinned here.
    renderView()
    const strip = screen.getByRole('region', { name: 'Delivery details' })
    expect(strip.className).not.toMatch(/\bz-30\b/)

    fireEvent.focus(screen.getByLabelText('Supplier'))
    expect(strip.className).toMatch(/\bz-30\b/)

    fireEvent.click(screen.getByRole('button', { name: 'Acme Foods' }))
    expect(strip.className).not.toMatch(/\bz-30\b/)
  })

  it('lets a line added by hand be given its product', () => {
    // A hand-added line used to arrive with no product and nothing on the row
    // to choose one with — a dead line that could only be deleted.
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: /Add a line by hand/ }))

    const picker = screen.getByLabelText('Product for new line')
    fireEvent.change(picker, { target: { value: 'nood' } })
    fireEvent.click(screen.getByRole('option', { name: /Noodles/ }))

    expect(screen.getByLabelText('Quantity for Noodles')).toBeTruthy()
    expect(screen.queryByLabelText('Product for new line')).toBeNull()
  })

  it('ArrowDown then Enter adds the highlighted search result', () => {
    renderView()
    pickAcme()
    const input = screen.getByLabelText('Search products')
    fireEvent.change(input, { target: { value: 'nood' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByLabelText('Quantity for Noodles')).toBeTruthy()
  })

  it('the scan bar shows the staged totals beside Receive', () => {
    renderView()
    pickAcme()
    scanCode('AYM-COC-001')
    scanCode('AYM-COC-001')
    scanCode('AYM-NDL-002')

    const totals = within(dock()).getByTestId('receive-totals')
    expect(totals.textContent).toMatch(/2 lines/)
    expect(totals.textContent).toMatch(/2 plates/)
    expect(totals.textContent).toMatch(/3 each/)
    expect(receiveButton().disabled).toBe(false)
  })

  it('a recorded receipt renders its labels without a click and offers Go to putaway', async () => {
    receiveMock.mockResolvedValue({ lines_received: 1, receipt_id: 77, location_id: 1, putaway: null })
    printMock.mockResolvedValue({ signedUrl: 'https://example.test/sheet.pdf' })
    platesRef.current = [
      { id: 5, code: 'HU-000005', huType: 'pallet', labelPrinted: false,
        products: [{ id: 1, sku: 'AYM-COC-001', name: 'Coconut Milk', barcode: null }] },
    ]
    const onOpenPutaway = vi.fn()
    renderView(onOpenPutaway)
    pickAcme()
    scanCode('AYM-COC-001')
    await act(async () => { fireEvent.click(receiveButton()) })

    await waitFor(() => expect(printMock).toHaveBeenCalledWith([5]))
    const link = await screen.findByRole('link', { name: /Print 1 label/ })
    expect(link.getAttribute('href')).toBe('https://example.test/sheet.pdf')

    fireEvent.click(screen.getByRole('button', { name: /Go to putaway/ }))
    expect(onOpenPutaway).toHaveBeenCalledWith(1)
  })
})
