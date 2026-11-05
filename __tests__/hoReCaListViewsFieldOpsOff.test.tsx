// The customer tab with Field Ops switched off (NX-0027, A2: "both views work with Field Ops on
// or off"). The suite runs with every module on, and a build flag cannot be flipped inside a
// run, so this file replaces the one flag the list could read. It is its own file because a
// module mock applies to the whole file.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { ADMIN, CUSTOMERS, CUSTOMER_NAMES } from './support/customerTabFixtures'

vi.mock('@/lib/modules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/modules')>()),
  MODULE_FIELD_OPS: false,
}))
// The assigned-reps picker and the QR panels are covered by their own tests.
vi.mock('@/components/qr/AssignedRepsPicker', () => ({ default: () => null }))
vi.mock('@/components/qr/AssignedRepsSummary', () => ({ default: () => null }))
vi.mock('@/components/qr/QrAccessPanel', () => ({ default: () => null }))

import { MODULE_FIELD_OPS } from '@/lib/modules'
import HoReCaListView from '@/components/HoReCaListView'

const DETAILS_HEADERS = ['Customer', 'Contact', 'Phone', 'Email', 'Address', 'ABN', 'Brands', 'Actions']
const SALES_HEADERS = ['Customer', 'Tier', 'Segment', 'Credit Limit', 'Last Order', 'Outstanding', 'Actions']

const headers = (): string[] =>
  screen
    .queryAllByRole('columnheader')
    .map((th) => th.textContent?.trim() ?? '')
    .filter(Boolean)

const shown = (): string[] => CUSTOMER_NAMES.filter((name) => screen.queryByText(name) !== null)

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('customer tab views with Field Ops off', () => {
  it('runs with the module off, so the tests below mean something', () => {
    expect(MODULE_FIELD_OPS).toBe(false)
  })

  it('opens on the details view, switches to the sales view and back', () => {
    render(<HoReCaListView hoReCas={CUSTOMERS} orders={[]} invoices={[]} currentUser={ADMIN} />)

    expect(headers()).toEqual(DETAILS_HEADERS)
    expect(shown()).toEqual(CUSTOMER_NAMES)

    fireEvent.click(screen.getByRole('button', { name: 'Sales' }))
    expect(headers()).toEqual(SALES_HEADERS)

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(headers()).toEqual(DETAILS_HEADERS)
  })

  it('still filters by brand and by missing details, in either view', () => {
    render(<HoReCaListView hoReCas={CUSTOMERS} orders={[]} invoices={[]} currentUser={ADMIN} />)

    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Quill Biscuits' } })
    fireEvent.click(screen.getByRole('button', { name: 'Missing details' }))
    expect(shown()).toEqual(['Corner Kitchen', 'Harbour Cafe'])

    fireEvent.click(screen.getByRole('button', { name: 'Sales' }))
    expect(shown()).toEqual(['Corner Kitchen', 'Harbour Cafe'])
    const row = screen.getByText('Harbour Cafe').closest('tr') as HTMLElement
    expect(within(row).getByText('Silver')).toBeTruthy()
  })
})
