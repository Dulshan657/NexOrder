// ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
//
// The receipt line's "Pallet / carton" column stacked two selects: a plate
// PICKER ("Pallet 1", "Carton 2", "+ New unit…") over a TYPE selector. It read
// specific → general while the data ran general → specific — the type select's
// value came off the PLATE, not the line — so on a shared plate, changing one
// line's type silently retyped every sibling.
//
// The fix is structural rather than a guard: a normal line owns its plate
// one-for-one, so there is nothing to share. Declaring a MIXED pallet, which is
// the only case that ever wanted a shared plate, moved to its own card where
// the container owns the type and the member lines cannot argue with it.
//
// Nothing changed server-side. `receive-stock`'s `createPlates` already
// accepted one declared plate carrying several lines — that IS a mixed pallet —
// so these tests assert the PAYLOAD, which is the contract that was always
// there and the thing a UI rewrite can quietly break.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { receiveMock } = vi.hoisted(() => ({ receiveMock: vi.fn() }))

vi.mock('@/hooks/queries/useReceiveStock', () => ({
  useReceiveStock: () => ({ mutateAsync: receiveMock, isPending: false }),
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
vi.mock('@/hooks/useToasts', () => ({ useToasts: () => ({ addToast: vi.fn() }) }))

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
  product(3, 'Rice Flour', 'AYM-RIC-003'),
]

const currentUser = { id: 1, name: 'Ada', role: UserRole.ADMIN } as unknown as User

const renderView = () =>
  render(<ReceiveStockView products={products} currentUser={currentUser} />)

function pickAcme() {
  fireEvent.focus(screen.getByLabelText('Supplier'))
  fireEvent.click(screen.getByRole('button', { name: 'Acme Foods' }))
}

/** Search a product and click it out of the dropdown, as an operator would. */
function addProduct(name: string) {
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name, 'i') }))
}

/** Fill every staged line's quantity, so all of them count as valid. */
function fillQuantities(...qtys: string[]) {
  const boxes = screen.getAllByPlaceholderText('0')
  qtys.forEach((q, i) => fireEvent.change(boxes[i], { target: { value: q } }))
}

const arrivedOnSelects = () =>
  screen.queryAllByLabelText(/Arrived on, for line/i) as HTMLSelectElement[]

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: /^Receive \d+ line/i }))

/** The single argument `receive-stock` was called with. */
const payload = () => receiveMock.mock.calls[0][0] as {
  lines: Array<{ product_id: number; plate_key: string; quantity: number }>
  plates: Array<{ key: string; hu_type: 'pallet' | 'carton' }>
}

beforeEach(() => {
  receiveMock.mockReset()
  receiveMock.mockResolvedValue({ lines_received: 2, location_id: 1 })
})
afterEach(cleanup)

describe('a normal line owns its own plate', () => {
  it('gives each line its own Arrived on, and changing one leaves the other alone', () => {
    // THE REGRESSION. Under the old control both lines read their type from a
    // plate, and on a shared plate one change moved both.
    renderView()
    pickAcme()
    addProduct('Coconut Milk')
    addProduct('Noodles')

    const selects = arrivedOnSelects()
    expect(selects).toHaveLength(2)
    expect(selects.map((s) => s.value)).toEqual(['pallet', 'pallet'])

    fireEvent.change(selects[0], { target: { value: 'carton' } })

    expect(arrivedOnSelects().map((s) => s.value)).toEqual(['carton', 'pallet'])
  })

  it('sends one plate per line, carrying the type each line was set to', () => {
    renderView()
    pickAcme()
    addProduct('Coconut Milk')
    addProduct('Noodles')
    fireEvent.change(arrivedOnSelects()[0], { target: { value: 'carton' } })
    fillQuantities('10', '20')
    submit()

    const { lines, plates } = payload()
    expect(plates).toHaveLength(2)
    expect(new Set(lines.map((l) => l.plate_key)).size).toBe(2)
    const typeOf = (productId: number) =>
      plates.find((p) => p.key === lines.find((l) => l.product_id === productId)!.plate_key)!.hu_type
    expect(typeOf(1)).toBe('carton')
    expect(typeOf(2)).toBe('pallet')
  })
})

describe('a mixed pallet', () => {
  it('collects everything added while it is open onto ONE plate', () => {
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: /Mixed pallet/i }))
    addProduct('Coconut Milk')
    addProduct('Noodles')
    addProduct('Rice Flour')
    fillQuantities('10', '20', '30')
    submit()

    const { lines, plates } = payload()
    expect(lines).toHaveLength(3)
    expect(plates).toHaveLength(1)
    expect(plates[0].hu_type).toBe('pallet')
    expect(new Set(lines.map((l) => l.plate_key))).toEqual(new Set([plates[0].key]))
  })

  it('withholds Arrived on from its members — the container decides', () => {
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: /Mixed pallet/i }))
    addProduct('Coconut Milk')
    addProduct('Noodles')

    expect(arrivedOnSelects()).toHaveLength(0)
    expect(screen.getByText('Mixed pallet 1')).toBeTruthy()
  })

  it('says out loud that it is capturing, so a forgotten target cannot hide', () => {
    // A target left set would silently pile a whole delivery onto one pallet,
    // and `handleDockScan` funnels through the same `addProduct` — so a scan
    // follows it too. The badge is what stops that being invisible.
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: /Mixed pallet/i }))
    expect(screen.getByText(/Scans land here/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Done$/ }))
    expect(screen.queryByText(/Scans land here/i)).toBeNull()
  })

  it('stops capturing after Done, so the next product is its own unit', () => {
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: /Mixed pallet/i }))
    addProduct('Coconut Milk')
    fireEvent.click(screen.getByRole('button', { name: /^Done$/ }))
    addProduct('Noodles')
    fillQuantities('10', '20')
    submit()

    const { lines, plates } = payload()
    expect(plates).toHaveLength(2)
    expect(new Set(lines.map((l) => l.plate_key)).size).toBe(2)
  })

  it('takes its lines with it when removed — the goods left together', () => {
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: /Mixed pallet/i }))
    addProduct('Coconut Milk')
    addProduct('Noodles')
    fireEvent.click(screen.getByRole('button', { name: /Remove Mixed pallet 1/i }))

    expect(screen.queryByText('Coconut Milk')).toBeNull()
    expect(screen.queryByText('Noodles')).toBeNull()
  })

  it('survives with no lines yet, because the operator just created it', () => {
    // `referencedPlates` keeps an empty plate out of the payload, so this can
    // never send the server a plate it would reject as an orphan.
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: /Mixed pallet/i }))
    expect(screen.getByText('Mixed pallet 1')).toBeTruthy()
    expect(screen.getByText(/Nothing on this pallet yet/i)).toBeTruthy()
  })
})

describe('the payload contract', () => {
  it('never names a plate_key it did not declare', () => {
    // `createPlates` rejects the WHOLE receipt on an undeclared plate_key, so a
    // line pointing at a dropped plate fails a real delivery at the dock. This
    // is what the functional `setPlates` in `addProduct` protects: two scans
    // landing in one React batch both read the same `plates` from their own
    // render closure, and the second used to drop the first's plate.
    renderView()
    pickAcme()
    addProduct('Coconut Milk')
    addProduct('Noodles')
    addProduct('Rice Flour')
    fillQuantities('1', '2', '3')
    submit()

    const { lines, plates } = payload()
    const declared = new Set(plates.map((p) => p.key))
    for (const line of lines) expect(declared.has(line.plate_key)).toBe(true)
    expect(plates).toHaveLength(3)
  })

  it('drops a plate whose only line was never given a quantity', () => {
    renderView()
    pickAcme()
    addProduct('Coconut Milk')
    addProduct('Noodles')
    fillQuantities('10') // Noodles left blank — not a valid line.
    submit()

    const { lines, plates } = payload()
    expect(lines).toHaveLength(1)
    expect(plates).toHaveLength(1)
    expect(plates[0].key).toBe(lines[0].plate_key)
  })
})
