// The Stock lookup's screen routing, and the two things it must never do:
// dead-end a plate scan, and print money to a Warehouse login.
//
// A plate scan reaching "unknown code" is the specific defect this cluster was
// built to remove. The gun beeps when a barcode DECODES, so the operator knows
// the label read — being told the warehouse has never heard of it is the worst
// available answer, and it is what happened before, because `buildScanIndex`
// cannot carry handling units and nothing fell through to a point lookup.
//
// Note on what CANNOT be asserted here: jsdom applies no Tailwind, so container
// queries and `hidden` have no computed effect. Layout is checked at 360px in
// the mobile Playwright project; this file is about which screen appears and
// what is on it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { HandlingUnitHit } from '@/services/supabase/inventoryService'
import type { ScanMatch } from '@/lib/scan/resolveScan'
import { UserRole, type Product, type User } from '@/types'

const balances = [
  {
    balanceId: 1, batchId: null, lotCode: null, expiryDate: null,
    locationId: 5, locationCode: 'WH1-A-1', locationName: 'Chiller · Rack 1',
    onHand: 12, allocated: 2, available: 10,
  },
]

vi.mock('@/hooks/queries/useInventoryBalances', () => ({
  useLocations: () => ({ data: [{ id: 5, code: 'WH1-A-1', name: 'Chiller · Rack 1', isActive: true, materializedPath: 'WH1/A' }] }),
  useBalancesByProduct: () => ({ data: balances, isLoading: false, isError: false }),
  useHandlingUnitByCode: () => ({ data: null, isFetching: false, isError: false, isSuccess: true }),
}))
vi.mock('@/hooks/queries/useProductHomeBins', () => ({
  useProductHomeBins: () => ({ data: [] }),
}))
vi.mock('@/hooks/queries/useCountBin', () => ({
  useLocationCountSheet: () => ({ data: [], isLoading: false, isError: false }),
}))

// Imported after the mocks so the module graph picks them up.
const { StockLookupPanel } = await import('@/components/stock/lookup/StockLookupPanel')

afterEach(cleanup)

const PRODUCT = {
  id: 1, sku: 'AYM-COC-001', name: 'Coconut Milk', description: '', price: 4.25,
  category: 'Other', inventory: 12, available: 10, unit: 'each', cartonSize: 12,
  supplierId: 1, barcode: '9312345678907',
} as Product

const PLATE: HandlingUnitHit = {
  id: 9, code: 'HU-000123', huType: 'pallet', status: 'stored',
  warehouseId: 1, locationId: 5, locationCode: 'WH1-A-1', locationName: 'Chiller · Rack 1',
  labelPrinted: true,
  lines: [
    { productId: 1, sku: 'AYM-COC-001', name: 'Coconut Milk', batchId: null, lotCode: 'L44', expiryDate: null, locationId: 5, onHand: 12, allocated: 0 },
  ],
}

function user(role: UserRole): User {
  return { id: 1, name: 'Operator', email: 'o@example.com', role } as User
}

function renderPanel(screenProp: any, role = UserRole.MANAGER) {
  return render(
    <StockLookupPanel
      screen={screenProp}
      products={[PRODUCT]}
      currentUser={user(role)}
      globalThreshold={10}
      scopeId={null}
      scopeLabel={null}
      onCountBin={() => {}}
      onSearchCatalogue={() => {}}
      onPick={() => {}}
    />,
  )
}

describe('StockLookupPanel routing', () => {
  it('renders the plate screen for a handling-unit hit, and never the miss screen', () => {
    renderPanel({ kind: 'plate', plate: PLATE })

    expect(screen.getByText('HU-000123')).toBeTruthy()
    expect(screen.getByText('Coconut Milk')).toBeTruthy()
    // The regression, stated directly.
    expect(screen.queryByText(/No match for that code/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/unknown/i)
  })

  it('holds a resolving screen rather than showing a miss it may contradict', () => {
    renderPanel({ kind: 'resolving', code: 'HU-000123' })

    expect(screen.getByText('Looking up')).toBeTruthy()
    expect(screen.getByText('HU-000123')).toBeTruthy()
    expect(screen.queryByText(/No match for that code/i)).toBeNull()
  })

  it('offers every candidate of an ambiguous scan and commits to none', () => {
    const onPick = vi.fn()
    const candidates: ScanMatch[] = [
      { kind: 'location', location: { id: 5, code: 'WH1-A-1', name: 'Chiller · Rack 1', isActive: true } },
      { kind: 'product', product: { id: 1, sku: 'WH1-A-1', name: 'Coconut Milk', barcode: null }, matchedOn: 'sku' },
    ]

    render(
      <StockLookupPanel
        screen={{ kind: 'ambiguous', normalized: 'WH1-A-1', candidates }}
        products={[PRODUCT]}
        currentUser={user(UserRole.MANAGER)}
        globalThreshold={10}
        scopeId={null}
        scopeLabel={null}
        onCountBin={() => {}}
        onSearchCatalogue={() => {}}
        onPick={onPick}
      />,
    )

    expect(screen.getByText(/means more than one thing/i)).toBeTruthy()
    // One button per candidate, and nothing chosen on the operator's behalf.
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(candidates.length)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('quotes the normalized code on a genuine miss', () => {
    renderPanel({ kind: 'unknown', normalized: 'ZZZ-NOPE' })
    expect(screen.getByText('ZZZ-NOPE')).toBeTruthy()
    expect(screen.getByText(/No match for that code/i)).toBeTruthy()
  })
})

describe('StockLookupPanel money gating', () => {
  it('hides the sell price from a Warehouse login', () => {
    renderPanel({ kind: 'product', product: { id: 1, sku: PRODUCT.sku, name: PRODUCT.name, barcode: PRODUCT.barcode }, matchedOn: 'barcode' }, UserRole.WAREHOUSE)

    expect(screen.getByText('Coconut Milk')).toBeTruthy()
    // Absent, not blanked — no label, no dash, no empty row.
    expect(screen.queryByText('Sell price')).toBeNull()
    expect(document.body.textContent).not.toContain('4.25')
  })

  it('shows it to a Manager', () => {
    renderPanel({ kind: 'product', product: { id: 1, sku: PRODUCT.sku, name: PRODUCT.name, barcode: PRODUCT.barcode }, matchedOn: 'barcode' }, UserRole.MANAGER)

    expect(screen.getByText('Sell price')).toBeTruthy()
    expect(screen.getByText('$4.25')).toBeTruthy()
  })

  it('names how the scan matched, so a mis-scan is legible', () => {
    renderPanel({ kind: 'product', product: { id: 1, sku: PRODUCT.sku, name: PRODUCT.name, barcode: PRODUCT.barcode }, matchedOn: 'batchBarcode' })
    expect(screen.getByText('matched on a batch barcode')).toBeTruthy()
  })
})
