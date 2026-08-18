import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// The catalogue importer must accept categories the database has never seen.
// `lib/productImportRow.ts` used to reject anything outside the 13 demo
// built-ins plus whatever the loaded catalog already used, which on an EMPTY
// tenant database rejects EVERY category in the file — it made a first
// catalogue load impossible through this screen for anyone whose categories
// aren't the demo's.
//
// The row-level rule is unit-tested in productImportRow.test.ts. What can only
// be tested here, with the component mounted, is the part the operator sees and
// the part no single row can do for itself:
//
//   - the category cell is free text with ONE shared <datalist>, not a
//     <select> whose options are a fixed list (and not a per-row <select>,
//     which froze Chrome on the replenishment grid at this row count),
//   - the "will create N new categories" banner, and
//   - the FILE-WIDE case fold: rows validate independently, so "BEAM" on one
//     row and "Beam" on another would otherwise send two spellings and create
//     two categories.

vi.mock('@/hooks/queries/useProducts', () => ({
  useBulkCreateProducts: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { ProductImportModal } from '@/components/admin/ProductImportModal'
import { CATEGORY_DATALIST_ID } from '@/components/admin/import/ProductPreviewRow'
import type { Supplier } from '@/types'

const suppliers = [{ id: 1, name: 'Acme Foods' }] as Supplier[]

const HEADERS = 'sku,name,price,category,unit,supplier_name,carton_size'
const row = (sku: string, category: string) =>
  `${sku},Product ${sku},9.99,${category},each,Acme Foods,12`

/**
 * Drive the modal's real dropzone with a real File, so the CSV goes through
 * `parseFileToRecords` exactly as it does for an operator. `file.text()` is not
 * implemented in jsdom, so it is stubbed per-File rather than globally.
 */
async function importCsv(csv: string) {
  render(<ProductImportModal suppliers={suppliers} catalog={[]} onClose={() => {}} />)
  const file = new File([csv], 'catalogue.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) })

  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input).toBeTruthy()
  Object.defineProperty(input, 'files', { value: [file] })
  fireEvent.change(input)
  // The dropzone reads the file asynchronously before setting state.
  await screen.findByText(/valid/)
}

afterEach(cleanup)

describe('ProductImportModal — categories the catalog has never seen', () => {
  it('accepts 3 unknown categories and names them in the banner', async () => {
    await importCsv([
      HEADERS,
      row('SKU-1', 'Sri Lankan Spices'),
      row('SKU-2', 'Rice'),
      row('SKU-3', 'Ayurvedic'),
    ].join('\n'))

    expect(screen.getByText('3 valid')).toBeTruthy()
    const banner = screen.getByText(/Will create 3 new categories/)
    expect(banner.textContent).toContain('Ayurvedic')
    expect(banner.textContent).toContain('Rice')
    expect(banner.textContent).toContain('Sri Lankan Spices')
  })

  // The whole point of the file-wide fold. Two spellings of one category must
  // resolve to one, or the import silently creates both.
  it('folds two spellings of a new category into one', async () => {
    await importCsv([HEADERS, row('SKU-1', 'BEAM'), row('SKU-2', 'Beam')].join('\n'))

    expect(screen.getByText('2 valid')).toBeTruthy()
    const banner = screen.getByText(/Will create 1 new categor/)
    expect(banner.textContent).toContain('BEAM')
  })

  // Case-folding onto an EXISTING category still wins over creating a new one.
  it('does not offer to create a category that only differs in case from a built-in', async () => {
    await importCsv([HEADERS, row('SKU-1', 'coconut')].join('\n'))

    expect(screen.getByText('1 valid')).toBeTruthy()
    expect(screen.queryByText(/Will create .* new categor/)).toBeNull()
  })

  it('rejects a category longer than the column allows, and reports why', async () => {
    await importCsv([HEADERS, row('SKU-1', 'x'.repeat(61))].join('\n'))

    expect(screen.getByText('1 error')).toBeTruthy()
    expect(screen.getByText(/60 characters or fewer/)).toBeTruthy()
  })

  it('renders the category cell as free text pointing at ONE shared datalist', async () => {
    await importCsv([
      HEADERS,
      row('SKU-1', 'Sri Lankan Spices'),
      row('SKU-2', 'Rice'),
    ].join('\n'))

    // A <select> cannot express a category that isn't already an option, and a
    // per-row one is the documented Chrome-freezing pattern. Asserted on the
    // tag, not the ARIA role: a datalist-backed <input> is itself a combobox,
    // so role alone does not tell the two apart.
    const grid = document.querySelector('table') as HTMLTableElement
    expect(grid.querySelectorAll('select')).toHaveLength(0)

    const cells = document.querySelectorAll(`input[list="${CATEGORY_DATALIST_ID}"]`)
    expect(cells).toHaveLength(2)
    expect((cells[0] as HTMLInputElement).value).toBe('Sri Lankan Spices')

    // Exactly one datalist for the whole grid, however many rows there are.
    const lists = document.querySelectorAll(`datalist#${CATEGORY_DATALIST_ID}`)
    expect(lists).toHaveLength(1)
    // It suggests both the built-ins and the categories this file introduces.
    const options = [...lists[0].querySelectorAll('option')].map(o => o.getAttribute('value'))
    expect(options).toContain('Coconut')
    expect(options).toContain('Sri Lankan Spices')
  })

  it('lets an operator type a brand-new category into a rejected row and fixes it', async () => {
    await importCsv([HEADERS, row('SKU-1', '')].join('\n'))
    expect(screen.getByText('1 error')).toBeTruthy()

    const cell = document.querySelector(`input[list="${CATEGORY_DATALIST_ID}"]`) as HTMLInputElement
    fireEvent.change(cell, { target: { value: 'Ayurvedic' } })

    expect(await screen.findByText('1 valid')).toBeTruthy()
    expect(screen.getByText(/Will create 1 new categor/).textContent).toContain('Ayurvedic')
  })
})
