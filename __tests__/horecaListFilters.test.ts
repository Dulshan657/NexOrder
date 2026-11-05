import { describe, expect, it } from 'vitest'

import type { HoReCa } from '@/types'

// NX-0027: the rules behind the customer list's brand and missing details filters.
//
// The module is loaded INSIDE each test, not imported at the top. On the base commit it
// does not exist, and a top-level import would stop this whole file loading, so no test
// in it could be reported as failing on its own (the same reason horecaContactFields
// gives for loading `horecaBody` late).
const load = () => import('@/lib/horecaListFilters')

const customer = (over: Partial<HoReCa> = {}): HoReCa => ({
  id: 1,
  name: 'Acme Foods',
  address: '1 Test St, Sydney NSW 2000',
  contactName: 'Jo Example',
  phone: '0400 000 001',
  billingEmail: 'accounts@example.com',
  abn: '12345678901',
  buysBrands: ['Harbour Dairy'],
  ...over,
})

// Freezes every level, so a rule that edits its input throws instead of passing quietly.
const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen)
    Object.freeze(value)
  }
  return value
}

describe('customer list filters', () => {
  it('counts a blank value or the address placeholder as missing but not a missing ABN', async () => {
    const { hasMissingDetails, ADDRESS_PLACEHOLDER } = await load()

    expect(ADDRESS_PLACEHOLDER).toBe('Address needed')
    expect(hasMissingDetails(customer())).toBe(false)

    // Each of phone, email and contact on its own is enough, whether absent, empty or spaces.
    for (const field of ['phone', 'billingEmail', 'contactName'] as const) {
      expect(hasMissingDetails(customer({ [field]: undefined })), `${field} absent`).toBe(true)
      expect(hasMissingDetails(customer({ [field]: '' })), `${field} empty`).toBe(true)
      expect(hasMissingDetails(customer({ [field]: '   ' })), `${field} spaces`).toBe(true)
    }

    // The address counts when blank or when it is the placeholder, however it is typed.
    expect(hasMissingDetails(customer({ address: '' }))).toBe(true)
    expect(hasMissingDetails(customer({ address: '   ' }))).toBe(true)
    expect(hasMissingDetails(customer({ address: ADDRESS_PLACEHOLDER }))).toBe(true)
    expect(hasMissingDetails(customer({ address: '  address NEEDED ' }))).toBe(true)
    // An address that merely mentions the words is a real address.
    expect(hasMissingDetails(customer({ address: 'Address Needed Lane, Sydney NSW 2000' }))).toBe(false)

    // A missing ABN alone does not count, and nor do missing brands.
    expect(hasMissingDetails(customer({ abn: undefined }))).toBe(false)
    expect(hasMissingDetails(customer({ abn: '' }))).toBe(false)
    expect(hasMissingDetails(customer({ buysBrands: undefined }))).toBe(false)
    expect(hasMissingDetails(customer({ buysBrands: [] }))).toBe(false)
  })

  it('lists each brand once, sorted, ignoring case and spacing', async () => {
    const { brandOptions } = await load()

    const customers = frozen([
      customer({ id: 1, buysBrands: ['Harbour Dairy', ' bluegum bakery '] }),
      customer({ id: 2, buysBrands: ['HARBOUR DAIRY', 'Bluegum Bakery', 'Northfield  Pickles'] }),
      customer({ id: 3, buysBrands: ['northfield pickles', 'Acme Spread'] }),
    ])

    // The first spelling seen is the one shown, trimmed; the order is alphabetical.
    expect(brandOptions(customers)).toEqual(['Acme Spread', 'bluegum bakery', 'Harbour Dairy', 'Northfield Pickles'])
  })

  it('lists no brands for an empty list or for customers who buy none', async () => {
    const { brandOptions } = await load()

    expect(brandOptions([])).toEqual([])
    expect(
      brandOptions([
        customer({ id: 1, buysBrands: undefined }),
        customer({ id: 2, buysBrands: [] }),
        customer({ id: 3, buysBrands: ['', '   '] }),
      ]),
    ).toEqual([])
  })

  it('ignores a brand entry that is not text', async () => {
    const { brandOptions, matchesBrand } = await load()

    // A row read back from the database is not checked by the compiler.
    const odd = customer({ buysBrands: ['Harbour Dairy', null, 7, undefined] as unknown as string[] })

    expect(brandOptions([odd])).toEqual(['Harbour Dairy'])
    expect(matchesBrand(odd, 'Harbour Dairy')).toBe(true)
  })

  it('matches a customer to a brand ignoring case and spacing', async () => {
    const { matchesBrand } = await load()

    const buyer = customer({ buysBrands: ['Harbour Dairy', 'Bluegum  Bakery'] })

    expect(matchesBrand(buyer, 'Harbour Dairy')).toBe(true)
    expect(matchesBrand(buyer, '  harbour dairy ')).toBe(true)
    expect(matchesBrand(buyer, 'BLUEGUM BAKERY')).toBe(true)
    expect(matchesBrand(buyer, 'Northfield Pickles')).toBe(false)
    // A part of a brand is not the brand.
    expect(matchesBrand(buyer, 'Harbour')).toBe(false)
  })

  it('does not match a customer whose brands are undefined or empty', async () => {
    const { matchesBrand } = await load()

    expect(matchesBrand(customer({ buysBrands: undefined }), 'Harbour Dairy')).toBe(false)
    expect(matchesBrand(customer({ buysBrands: [] }), 'Harbour Dairy')).toBe(false)
  })

  it('treats no brand chosen as matching every customer', async () => {
    const { matchesBrand } = await load()

    expect(matchesBrand(customer({ buysBrands: undefined }), '')).toBe(true)
    expect(matchesBrand(customer({ buysBrands: ['Harbour Dairy'] }), '   ')).toBe(true)
  })

  it('shows an address only when it is a real one', async () => {
    const { cleanAddress, isAddressMissing } = await load()

    expect(cleanAddress('  1 Test St, Sydney NSW 2000 ')).toBe('1 Test St, Sydney NSW 2000')
    expect(cleanAddress('Address needed')).toBe('')
    expect(cleanAddress(' ADDRESS  NEEDED ')).toBe('')
    expect(cleanAddress('   ')).toBe('')
    // A row read back from the database is not checked by the compiler.
    expect(cleanAddress(null)).toBe('')
    expect(cleanAddress(undefined)).toBe('')
    expect(isAddressMissing(null)).toBe(true)
    expect(isAddressMissing('1 Test St')).toBe(false)
  })

  it('lists the brands a customer buys once each, trimmed, in the order given', async () => {
    const { customerBrands } = await load()

    expect(customerBrands(customer({ buysBrands: [' Harbour  Dairy', 'harbour dairy', '', 'Acme Spread'] }))).toEqual([
      'Harbour Dairy',
      'Acme Spread',
    ])
    expect(customerBrands(customer({ buysBrands: undefined }))).toEqual([])
  })

  it('resolves a chosen brand to the spelling on offer, or to none once nobody buys it', async () => {
    const { resolveBrand } = await load()

    const options = ['Acme Spread', 'Harbour Dairy']
    expect(resolveBrand(options, 'Harbour Dairy')).toBe('Harbour Dairy')
    // The spelling on offer can change when the customers do.
    expect(resolveBrand(options, 'harbour  dairy ')).toBe('Harbour Dairy')
    expect(resolveBrand(options, 'Northfield Pickles')).toBe('')
    expect(resolveBrand(options, '')).toBe('')
    expect(resolveBrand([], 'Harbour Dairy')).toBe('')
  })

  it('reads a customer without changing it', async () => {
    const { hasMissingDetails, brandOptions, matchesBrand } = await load()

    const original = frozen(customer({ buysBrands: ['Harbour Dairy', ' harbour dairy'] }))
    const before = JSON.stringify(original)

    hasMissingDetails(original)
    brandOptions([original])
    matchesBrand(original, 'harbour dairy')

    expect(JSON.stringify(original)).toBe(before)
  })
})
