// The HoReCa tab as the office works from it (NX-0027): a Details view first, a Sales view
// behind a toggle, and a brand and a missing details filter on top of the search that was
// already there. Rendered through the component, because what matters is what is on screen.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import type { HoReCa } from '@/types'
import { ACME, ADMIN, CORNER, CUSTOMERS, CUSTOMER_NAMES, DUNES, EASTSIDE, HARBOUR } from './support/customerTabFixtures'

// The assigned-reps picker and the QR panels are covered by their own tests.
vi.mock('@/components/qr/AssignedRepsPicker', () => ({ default: () => null }))
vi.mock('@/components/qr/AssignedRepsSummary', () => ({ default: () => null }))
vi.mock('@/components/qr/QrAccessPanel', () => ({ default: () => null }))

import HoReCaListView from '@/components/HoReCaListView'

const DETAILS_HEADERS = ['Customer', 'Contact', 'Phone', 'Email', 'Address', 'ABN', 'Brands', 'Actions']
const SALES_HEADERS = ['Customer', 'Tier', 'Segment', 'Credit Limit', 'Last Order', 'Outstanding', 'Actions']

const renderList = (customers: HoReCa[] = CUSTOMERS) =>
  render(<HoReCaListView hoReCas={customers} orders={[]} invoices={[]} currentUser={ADMIN} />)

const headers = (): string[] =>
  screen
    .queryAllByRole('columnheader')
    .map((th) => th.textContent?.trim() ?? '')
    .filter(Boolean)

/** The customers on screen, in the order of CUSTOMER_NAMES. */
const shown = (): string[] => CUSTOMER_NAMES.filter((name) => screen.queryByText(name) !== null)

const cell = (customer: string, header: string): HTMLElement => {
  const index = screen.getAllByRole('columnheader').findIndex((th) => th.textContent?.trim() === header)
  expect(index, `a "${header}" column`).toBeGreaterThanOrEqual(0)
  const row = screen.getByText(customer).closest('tr') as HTMLElement
  return within(row).getAllByRole('cell')[index]
}

const button = (name: string) => screen.getByRole('button', { name })
const brandSelect = () => screen.getByLabelText('Brand') as HTMLSelectElement
const pickBrand = (brand: string) => fireEvent.change(brandSelect(), { target: { value: brand } })
const search = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search by name or address...'), { target: { value: text } })

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('customer tab views', () => {
  it('opens on the details view with contact, phone, email, address, ABN and brands', () => {
    renderList()

    expect(headers()).toEqual(DETAILS_HEADERS)
    expect(button('Details').getAttribute('aria-pressed')).toBe('true')
    expect(button('Sales').getAttribute('aria-pressed')).toBe('false')
    expect(shown()).toEqual(CUSTOMER_NAMES)

    expect(cell('Acme Foods', 'Contact').textContent).toBe('Jo Example')
    expect(cell('Acme Foods', 'Phone').textContent).toBe('0400 000 001')
    expect(cell('Acme Foods', 'Email').textContent).toBe('accounts@acmefoods.example')
    expect(cell('Acme Foods', 'Address').textContent).toBe('1 Test St, Sydney NSW 2000')
    expect(cell('Acme Foods', 'ABN').textContent).toBe('12345678901')
    expect(cell('Acme Foods', 'Brands').textContent).toBe('Zephyr Pickles')
    expect(cell('Harbour Cafe', 'Brands').textContent).toBe('zephyr pickles, Quill Biscuits')

    // The sales figures are on the other view.
    for (const sales of ['Tier', 'Segment', 'Credit Limit', 'Last Order', 'Outstanding']) {
      expect(screen.queryByRole('columnheader', { name: sales }), sales).toBeNull()
    }
  })

  it('switches to the sales columns and back', () => {
    renderList()

    fireEvent.click(button('Sales'))
    expect(headers()).toEqual(SALES_HEADERS)
    expect(button('Sales').getAttribute('aria-pressed')).toBe('true')
    expect(button('Details').getAttribute('aria-pressed')).toBe('false')
    expect(shown()).toEqual(CUSTOMER_NAMES)
    expect(cell('Acme Foods', 'Tier').textContent).toBe('Gold')
    expect(cell('Acme Foods', 'Credit Limit').textContent).toBe('$5,000')
    expect(cell('Dunes Hotel', 'Tier').textContent).toBe('--')
    expect(screen.queryByRole('columnheader', { name: 'Phone' })).toBeNull()

    fireEvent.click(button('Details'))
    expect(headers()).toEqual(DETAILS_HEADERS)
    expect(button('Details').getAttribute('aria-pressed')).toBe('true')
    expect(cell('Acme Foods', 'Phone').textContent).toBe('0400 000 001')
  })

  it('filters to one brand\'s buyers from the brands on the customers', () => {
    renderList()

    // Every brand the customers buy, once each, sorted, with no brand written in the code.
    const options = Array.from(brandSelect().options).map((o) => o.textContent)
    expect(options).toEqual(['All brands', 'Quill Biscuits', 'Zephyr Pickles'])

    // Harbour Cafe typed the brand in lower case and is still a buyer.
    pickBrand('Zephyr Pickles')
    expect(shown()).toEqual(['Acme Foods', 'Harbour Cafe'])

    pickBrand('Quill Biscuits')
    expect(shown()).toEqual(['Corner Kitchen', 'Eastside Bistro', 'Harbour Cafe'])

    pickBrand('')
    expect(shown()).toEqual(CUSTOMER_NAMES)
  })

  it('filters to customers with missing details', () => {
    renderList()

    const chip = button('Missing details')
    expect(chip.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chip)
    // Corner Kitchen has only the placeholder for an address, Dunes Hotel has nothing, Harbour
    // Cafe has no phone. Eastside Bistro lacks only an ABN, which does not count.
    expect(shown()).toEqual(['Corner Kitchen', 'Dunes Hotel', 'Harbour Cafe'])
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/3 customers/)).toBeTruthy()

    fireEvent.click(chip)
    expect(shown()).toEqual(CUSTOMER_NAMES)
    expect(chip.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows a missing value and the address placeholder as missing', () => {
    renderList()

    // A customer with nothing filled in: every details cell says so, in words.
    for (const [header, field] of [
      ['Contact', 'contact'],
      ['Phone', 'phone'],
      ['Email', 'email'],
      ['ABN', 'ABN'],
      ['Brands', 'brands'],
    ]) {
      const missing = within(cell('Dunes Hotel', header)).getByText('Missing')
      expect(missing.textContent, header).toBe(`Missing ${field}`)
      // Muted, and still readable: stone-500 or darker on white.
      expect(missing.className, header).toMatch(/text-stone-(500|600)/)
    }
    expect(cell('Dunes Hotel', 'Address').textContent).toBe('4 Beach Rd, Sydney NSW 2000')

    // The placeholder reads as missing, never as an address.
    expect(within(cell('Corner Kitchen', 'Address')).getByText('Missing').textContent).toBe('Missing address')
    expect(screen.queryByText(/address needed/i)).toBeNull()
    expect(document.body.textContent).not.toMatch(/address needed/i)
    expect(document.body.innerHTML).not.toMatch(/address needed/i)

    // A customer that has a value shows the value and no "Missing" beside it.
    expect(within(cell('Corner Kitchen', 'Phone')).queryByText('Missing')).toBeNull()
    expect(within(cell('Acme Foods', 'ABN')).queryByText('Missing')).toBeNull()
  })
})

describe('customer tab views, around the edges', () => {
  it('reads a value that is only spaces as missing', () => {
    renderList([{ ...ACME, phone: '   ', contactName: '', buysBrands: ['', '  '] }])

    expect(within(cell('Acme Foods', 'Phone')).getByText('Missing')).toBeTruthy()
    expect(within(cell('Acme Foods', 'Contact')).getByText('Missing')).toBeTruthy()
    expect(within(cell('Acme Foods', 'Brands')).getByText('Missing')).toBeTruthy()
  })

  it('keeps both toggle buttons, the filters and a 0 count when there are no customers', () => {
    renderList([])

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/0 customers/)).toBeTruthy()
    expect(screen.getByText('No customers match your filters')).toBeTruthy()
    expect(button('Details')).toBeTruthy()
    expect(button('Sales')).toBeTruthy()
    expect(button('Missing details')).toBeTruthy()
    // No customers, no brands: the list offers only "All brands".
    expect(Array.from(brandSelect().options).map((o) => o.textContent)).toEqual(['All brands'])

    fireEvent.click(button('Sales'))
    expect(button('Sales').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('builds the brand list from whatever brands the customers have', () => {
    renderList([{ ...ACME, buysBrands: ['Mulberry Jams'] }, { ...HARBOUR, buysBrands: ['mulberry jams ', 'Oakleaf Tea'] }])

    expect(Array.from(brandSelect().options).map((o) => o.textContent)).toEqual([
      'All brands',
      'Mulberry Jams',
      'Oakleaf Tea',
    ])
  })

  it('combines the brand filter with the search', () => {
    renderList()

    pickBrand('Quill Biscuits')
    search('kitchen')
    expect(shown()).toEqual(['Corner Kitchen'])

    // Acme Foods is a customer the search finds, but it does not buy this brand.
    search('acme')
    expect(shown()).toEqual([])
    expect(screen.getByText('No customers match your filters')).toBeTruthy()

    search('')
    expect(shown()).toEqual(['Corner Kitchen', 'Eastside Bistro', 'Harbour Cafe'])
  })

  it('combines the missing details filter with the brand filter', () => {
    renderList()

    pickBrand('Quill Biscuits')
    fireEvent.click(button('Missing details'))
    // Eastside Bistro buys the brand but lacks only an ABN.
    expect(shown()).toEqual(['Corner Kitchen', 'Harbour Cafe'])

    pickBrand('Zephyr Pickles')
    expect(shown()).toEqual(['Harbour Cafe'])

    pickBrand('')
    expect(shown()).toEqual(['Corner Kitchen', 'Dunes Hotel', 'Harbour Cafe'])
  })

  it('keeps the filters when the view is switched', () => {
    renderList()

    pickBrand('Quill Biscuits')
    fireEvent.click(button('Missing details'))
    fireEvent.click(button('Sales'))
    expect(shown()).toEqual(['Corner Kitchen', 'Harbour Cafe'])

    fireEvent.click(button('Details'))
    expect(shown()).toEqual(['Corner Kitchen', 'Harbour Cafe'])
  })

  it('lists a customer whose brands are undefined, and under no brand', () => {
    renderList()

    expect(DUNES.buysBrands).toBeUndefined()
    expect(shown()).toContain('Dunes Hotel')

    for (const brand of ['Quill Biscuits', 'Zephyr Pickles']) {
      pickBrand(brand)
      expect(shown(), brand).not.toContain('Dunes Hotel')
    }
  })

  it('still filters by tier and by search on the details view', () => {
    renderList()

    fireEvent.change(screen.getByDisplayValue('All Tiers'), { target: { value: 'Gold' } })
    expect(shown()).toEqual(['Acme Foods'])

    fireEvent.change(screen.getByDisplayValue('Gold'), { target: { value: 'all' } })
    search('beach rd')
    expect(shown()).toEqual(['Dunes Hotel'])
  })

  it('does not find the address placeholder when searching addresses', () => {
    renderList()

    search('needed')
    expect(shown()).toEqual([])
  })

  it('drops the brand chosen once no customer buys it', () => {
    const view = renderList()

    pickBrand('Zephyr Pickles')
    expect(shown()).toEqual(['Acme Foods', 'Harbour Cafe'])

    // Both customers are edited to buy something else; the filter must not hide everyone.
    view.rerender(
      <HoReCaListView
        hoReCas={[{ ...ACME, buysBrands: ['Quill Biscuits'] }, { ...HARBOUR, buysBrands: [] }, CORNER, DUNES, EASTSIDE]}
        orders={[]}
        invoices={[]}
        currentUser={ADMIN}
      />,
    )
    expect(brandSelect().value).toBe('')
    expect(shown()).toEqual(CUSTOMER_NAMES)
  })

  it('keeps the action menu the first button in a row, as the edit and delete menu needs', () => {
    render(
      <HoReCaListView
        hoReCas={CUSTOMERS}
        orders={[]}
        invoices={[]}
        currentUser={ADMIN}
        onUpdateHoReCa={vi.fn()}
        onDeleteHoReCa={vi.fn()}
      />,
    )

    const row = screen.getByText('Acme Foods').closest('tr') as HTMLElement
    fireEvent.click(within(row).getAllByRole('button')[0])
    expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Delete/ })).toBeTruthy()
  })
})
