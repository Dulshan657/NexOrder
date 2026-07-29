import { describe, expect, it } from 'vitest'
import { shipToDeliveryAddress } from '../supabase/functions/_shared/poInbox/deliveryAddress'
import { formatDeliveryAddress, orderDeliveryAddress } from '../lib/orderDeliveryAddress'

// PO 228332's real "Deliver To" block. Note the state and postcode are inside
// `city`: the extraction schema has no postcode field and its description says
// so ("Suburb/city (and state/postcode)").
const REAL_SHIP_TO = { name: null, street: '7 Austral Place', city: 'Hallam VIC 3803' }

// What extraction produced for the same POs BEFORE the label-binding rule
// shipped — the Supplier block, i.e. the business being asked to supply.
const SUPPLIER_BLOCK = { name: 'Actron Air', street: '2A Westall Road', city: 'Clayton VIC 3168' }

describe('shipToDeliveryAddress', () => {
  it('maps the printed block onto the orders.delivery_address shape', () => {
    expect(shipToDeliveryAddress({ ship_to: REAL_SHIP_TO })).toEqual({
      street: '7 Austral Place',
      city: 'Hallam VIC 3803',
      postcode: null,
      country: null,
      recipient_name: null,
      source_address_id: null,
    })
  })

  it('keeps the locality blob intact rather than guessing a postcode', () => {
    // Re-splitting "Hallam VIC 3803" is a guess this layer has no business
    // making, and a wrong split is worse than an honest single field.
    const out = shipToDeliveryAddress({ ship_to: REAL_SHIP_TO })
    expect(out?.city).toBe('Hallam VIC 3803')
    expect(out?.postcode).toBeNull()
  })

  it('carries a named recipient through', () => {
    expect(shipToDeliveryAddress({ ship_to: SUPPLIER_BLOCK })?.recipient_name).toBe('Actron Air')
  })

  it('never claims an address-book origin', () => {
    // source_address_id is what says "an operator picked this from the book".
    // A document-sourced address was picked by nobody, and approve-po relies on
    // this to avoid growing the customer's address book on every auto-approval.
    expect(shipToDeliveryAddress({ ship_to: REAL_SHIP_TO })?.source_address_id).toBeNull()
  })

  it('returns null when there is no usable street', () => {
    // NULL in that column has a defined meaning — "fall back to horecas.address"
    // (mig 00021). An object with a blank street would override that fallback
    // with nothing, which is strictly worse than not writing at all.
    expect(shipToDeliveryAddress({ ship_to: { name: 'X', street: null, city: 'Hallam' } })).toBeNull()
    expect(shipToDeliveryAddress({ ship_to: { name: null, street: '   ', city: null } })).toBeNull()
    expect(shipToDeliveryAddress({ ship_to: null })).toBeNull()
    expect(shipToDeliveryAddress({})).toBeNull()
    expect(shipToDeliveryAddress(null)).toBeNull()
    expect(shipToDeliveryAddress(undefined)).toBeNull()
  })
})

describe('formatDeliveryAddress', () => {
  it('joins the populated parts in postal order', () => {
    expect(
      formatDeliveryAddress({
        street: '7 Austral Place',
        city: 'Hallam',
        postcode: 'VIC 3803',
        country: null,
      }),
    ).toBe('7 Austral Place, Hallam VIC 3803')
  })

  it('omits the parts the document never carried', () => {
    expect(formatDeliveryAddress({ street: '7 Austral Place', city: 'Hallam VIC 3803' })).toBe(
      '7 Austral Place, Hallam VIC 3803',
    )
    expect(formatDeliveryAddress({ street: '7 Austral Place' })).toBe('7 Austral Place')
  })
})

describe('orderDeliveryAddress', () => {
  const hoReCa = { id: 18, name: 'Executive Heating & Cooling', address: 'PO Box 275, Hallam VIC 3803' } as never

  it('prefers the order\'s own snapshot and says so', () => {
    expect(
      orderDeliveryAddress({
        deliveryAddress: { street: '7 Austral Place', city: 'Hallam VIC 3803' },
        hoReCa,
      }),
    ).toEqual({ text: '7 Austral Place, Hallam VIC 3803', source: 'order' })
  })

  it('falls back to the customer address, flagged as such', () => {
    // Every order created before this shipped is in this state, and the flag is
    // what lets the UI say "this went to the account address" out loud instead
    // of leaving an operator to infer it.
    expect(orderDeliveryAddress({ deliveryAddress: undefined, hoReCa })).toEqual({
      text: 'PO Box 275, Hallam VIC 3803',
      source: 'customer',
    })
  })

  it('returns null when neither exists', () => {
    expect(
      orderDeliveryAddress({ deliveryAddress: undefined, hoReCa: { address: '  ' } as never }),
    ).toBeNull()
  })
})
