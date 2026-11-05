// Made-up customers for the customer tab tests (NX-0027). This repo is public: none of
// these is a real business, person, number or address.
//
// Five customers, picked so each rule has a customer on both sides of it:
//   missing details:  Corner Kitchen (address is the placeholder), Dunes Hotel (everything),
//                     Harbour Cafe (no phone)
//   NOT missing:      Acme Foods (complete), Eastside Bistro (only the ABN is absent)
//   Zephyr Pickles:   Acme Foods, Harbour Cafe (typed in lower case)
//   Quill Biscuits:   Corner Kitchen, Eastside Bistro, Harbour Cafe
//   no brands at all: Dunes Hotel, whose `buysBrands` is undefined

import { UserRole, type HoReCa, type User } from '@/types'

export const ADMIN: User = { id: 1, name: 'Ada Admin', email: 'ada@example.com', role: UserRole.ADMIN }

export const ACME: HoReCa = {
  id: 1,
  name: 'Acme Foods',
  address: '1 Test St, Sydney NSW 2000',
  contactName: 'Jo Example',
  phone: '0400 000 001',
  billingEmail: 'accounts@acmefoods.example',
  abn: '12345678901',
  buysBrands: ['Zephyr Pickles'],
  tier: 'Gold',
  creditLimit: 5000,
}

export const HARBOUR: HoReCa = {
  id: 2,
  name: 'Harbour Cafe',
  address: '2 Quay Rd, Sydney NSW 2000',
  contactName: 'Sam Sample',
  billingEmail: 'ap@harbourcafe.example',
  abn: '23456789012',
  buysBrands: ['zephyr pickles', 'Quill Biscuits'],
  tier: 'Silver',
}

export const CORNER: HoReCa = {
  id: 3,
  name: 'Corner Kitchen',
  address: 'Address needed',
  contactName: 'Pat Placeholder',
  phone: '0400 000 003',
  billingEmail: 'hello@cornerkitchen.example',
  abn: '34567890123',
  buysBrands: ['Quill Biscuits'],
}

export const DUNES: HoReCa = {
  id: 4,
  name: 'Dunes Hotel',
  address: '4 Beach Rd, Sydney NSW 2000',
}

export const EASTSIDE: HoReCa = {
  id: 5,
  name: 'Eastside Bistro',
  address: '5 Hill St, Sydney NSW 2000',
  contactName: 'Lee Sample',
  phone: '0400 000 005',
  billingEmail: 'cafe@eastside.example',
  buysBrands: ['Quill Biscuits'],
}

/** In the order the list shows them: by name. */
export const CUSTOMERS: HoReCa[] = [ACME, CORNER, DUNES, EASTSIDE, HARBOUR]

export const CUSTOMER_NAMES: string[] = CUSTOMERS.map((c) => c.name)
