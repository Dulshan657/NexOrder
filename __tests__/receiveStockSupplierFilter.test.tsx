import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// Receive Stock narrows its product picker to the delivering supplier (mig
// 00070) and matches that supplier's own part number, so goods-in can type
// straight off a delivery docket. The narrowing is SOFT — an unlinked product
// must never block a receipt — and the old per-line "Supplier override" column
// is gone, since a receipt only ever comes from one supplier.

vi.mock('@/hooks/queries/useReceiveStock', () => ({
  useReceiveStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/useInventoryBalances', () => ({
  useRecentReceipts: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/hooks/queries/useWarehouses', () => ({
  useWarehouses: () => ({ data: [{ id: 1, name: 'MAIN', isActive: true }] }),
}))
vi.mock('@/hooks/queries/useSuppliers', () => ({
  useSuppliers: () => ({
    data: [{ id: 1, name: 'Acme Foods' }, { id: 2, name: 'Beta Trading' }],
  }),
}))
vi.mock('@/hooks/useToasts', () => ({ useToasts: () => ({ addToast: vi.fn() }) }))

import ReceiveStockView from '@/components/inventory/ReceiveStockView'
import { UserRole, type Product, type User } from '@/types'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, sku: 'SKU-1', name: 'Product One', description: '', price: 1,
    category: 'Other', inventory: 0, available: 0, unit: 'each', cartonSize: 1,
    supplierId: 1,
    ...overrides,
  } as Product
}

// Linked to Acme (1) with Acme's own part number; Beta (2) also supplies it.
const coconut = product({
  id: 1, sku: 'AYM-COC-001', name: 'Coconut Milk',
  suppliers: [
    { supplierId: 1, supplierSku: 'ACME-77', isPrimary: true, sortOrder: 0 },
    { supplierId: 2, isPrimary: false, sortOrder: 1 },
  ],
})
// Beta only.
const noodles = product({
  id: 2, sku: 'AYM-NDL-002', name: 'Noodles', supplierId: 2,
  suppliers: [{ supplierId: 2, isPrimary: true, sortOrder: 0 }],
})
const products = [coconut, noodles]

const currentUser = { id: 1, name: 'Ada', role: UserRole.ADMIN } as unknown as User

function renderView() {
  return render(<ReceiveStockView products={products} currentUser={currentUser} />)
}

/** Pick "Acme Foods" in the header supplier combobox. */
function pickAcme() {
  fireEvent.focus(screen.getByLabelText('Supplier'))
  fireEvent.click(screen.getByRole('button', { name: 'Acme Foods' }))
}

function searchFor(text: string) {
  const input = screen.getByLabelText('Search products')
  fireEvent.change(input, { target: { value: text } })
}

afterEach(cleanup)

describe('ReceiveStockView — supplier-scoped product picker', () => {
  it('searches the whole catalogue before a supplier is chosen', () => {
    renderView()
    searchFor('noodles')
    expect(screen.getByText('Noodles')).toBeTruthy()
  })

  it('hides products the selected supplier does not supply', () => {
    renderView()
    pickAcme()
    searchFor('noodles')
    // Noodles is Beta-only, so it drops out of an Acme delivery.
    expect(screen.queryByText('Noodles')).toBeNull()
  })

  it('still finds the selected supplier’s own products', () => {
    renderView()
    pickAcme()
    searchFor('coconut')
    expect(screen.getByText('Coconut Milk')).toBeTruthy()
  })

  it('reports how many products the supplier supplies', () => {
    renderView()
    pickAcme()
    expect(screen.getByText(/Showing 1 product from/)).toBeTruthy()
  })

  it('matches the supplier’s own part number', () => {
    renderView()
    pickAcme()
    searchFor('acme-77')
    expect(screen.getByText('Coconut Milk')).toBeTruthy()
  })

  it('offers a widen escape when the filtered search finds nothing', () => {
    renderView()
    pickAcme()
    searchFor('noodles')
    const widen = screen.getByRole('button', { name: 'Search all products' })
    fireEvent.click(widen)
    // Soft filter: an unlinked product must never block a receipt.
    expect(screen.getByText('Noodles')).toBeTruthy()
  })

  it('"Show all products" widens the picker without clearing the supplier', () => {
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: 'Show all products' }))
    searchFor('noodles')
    expect(screen.getByText('Noodles')).toBeTruthy()
    // The header supplier is untouched — this only widens the picker.
    expect((screen.getByLabelText('Supplier') as HTMLInputElement).value).toBe('Acme Foods')
  })

  it('re-narrows when the supplier changes', () => {
    renderView()
    pickAcme()
    fireEvent.click(screen.getByRole('button', { name: 'Show all products' }))
    // Switch to Beta Trading — "show all" is per-delivery, not sticky. Retype
    // to filter the combobox, since it still holds "Acme Foods".
    const supplierInput = screen.getByLabelText('Supplier')
    fireEvent.change(supplierInput, { target: { value: 'Beta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Beta Trading' }))
    searchFor('coconut')
    expect(screen.getByText(/Showing 2 products from/)).toBeTruthy()
  })
})

describe('ReceiveStockView — receipt lines', () => {
  it('has no per-line supplier override column', () => {
    renderView()
    pickAcme()
    searchFor('coconut')
    fireEvent.click(screen.getByText('Coconut Milk'))

    // The staged line renders, but the redundant per-line picker is gone: the
    // header supplier is the single source of truth for a goods receipt.
    expect(screen.getByPlaceholderText('0')).toBeTruthy()
    expect(screen.queryByLabelText('Line supplier override')).toBeNull()
    expect(screen.queryByText('Use header supplier')).toBeNull()
  })

  it('shows the supplier’s part number on the staged line', () => {
    renderView()
    pickAcme()
    searchFor('coconut')
    fireEvent.click(screen.getByText('Coconut Milk'))
    expect(screen.getByText(/their ACME-77/)).toBeTruthy()
  })
})
