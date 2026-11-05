import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v3'

import { fromHoReCa, toHoReCa } from '@/lib/adapters'
import type { Database } from '@/lib/database.types'

// NX-0018: a customer's contact person, phone, ABN, billing email and the brands they buy.
//
// `horecaBodySchema` is the request body mutate-horeca validates. The function
// imports zod from esm.sh, which vitest cannot load, so the schema lives in a
// zod-free `_shared` module that takes the zod namespace as an argument. The
// function passes in the one it runs with; this file passes in the client's
// `zod/v3`, the same API as the 3.23.8 the function pins.
//
// The module is loaded INSIDE the tests that need it, not imported at the top.
// On the base commit it does not exist, and a top-level import would stop this
// whole file loading, so the mapping test below could never fail by assertion.

type HoReCaRow = Database['public']['Tables']['horecas']['Row']

const row: HoReCaRow = {
  id: 7,
  name: 'Example Cafe Pty Ltd',
  address: '1 Test St, Sydney NSW 2000',
  discount_percent: null,
  credit_limit: null,
  show_stock_tab: null,
  tier: null,
  lat: null,
  lng: null,
  created_at: '2026-11-05T00:00:00Z',
  is_temporary: false,
  created_by_user_id: null,
  reviewed_at: null,
  reviewed_by: null,
  contact_name: null,
  phone: null,
  abn: null,
  billing_email: null,
  buys_brands: [],
}

async function loadHorecaBodySchema() {
  const { buildHorecaBodySchema } = await import('@/supabase/functions/_shared/horecaBody')
  return buildHorecaBodySchema(z)
}

const valid = { name: 'Example Cafe Pty Ltd', address: '1 Test St, Sydney NSW 2000' }

describe('horeca contact fields', () => {
  it('maps the new contact fields from a row', () => {
    const h = toHoReCa({
      ...row,
      contact_name: 'Jane Citizen',
      phone: '0400 000 001',
      abn: '51824753556',
      billing_email: 'a@b.au',
      buys_brands: ['McCURRIE'],
    })
    expect(h).toMatchObject({
      contactName: 'Jane Citizen',
      phone: '0400 000 001',
      abn: '51824753556',
      billingEmail: 'a@b.au',
      buysBrands: ['McCURRIE'],
    })
  })

  it('maps a row that has none of them to empty values, never to a stray null', () => {
    const h = toHoReCa(row)
    expect(h.contactName).toBeUndefined()
    expect(h.phone).toBeUndefined()
    expect(h.abn).toBeUndefined()
    expect(h.billingEmail).toBeUndefined()
    expect(h.buysBrands).toEqual([])
  })

  it('sends the contact fields to the server, and a blank one clears the column', () => {
    expect(
      fromHoReCa({
        contactName: 'Jane Citizen',
        phone: '0400 000 001',
        abn: '51 824 753 556',
        billingEmail: 'accounts@example.com',
        buysBrands: ['McCURRIE'],
      }),
    ).toEqual({
      contact_name: 'Jane Citizen',
      phone: '0400 000 001',
      abn: '51 824 753 556',
      billing_email: 'accounts@example.com',
      buys_brands: ['McCURRIE'],
    })
    expect(fromHoReCa({ contactName: ' ', phone: '  ', abn: '', billingEmail: '', buysBrands: [] })).toEqual({
      contact_name: null,
      phone: null,
      abn: null,
      billing_email: null,
      buys_brands: [],
    })
    // A field the caller did not mention is not sent, so an update leaves it alone.
    expect(fromHoReCa({ name: 'Example Cafe' })).toEqual({ name: 'Example Cafe' })
  })

  it('rejects an ABN that is not 11 digits', async () => {
    const horecaBodySchema = await loadHorecaBodySchema()
    expect(horecaBodySchema.safeParse({ ...valid, abn: '123' }).success).toBe(false)
    expect(horecaBodySchema.safeParse({ ...valid, abn: '518247535561' }).success).toBe(false)
    expect(horecaBodySchema.safeParse({ ...valid, abn: '5182475355X' }).success).toBe(false)
    expect(horecaBodySchema.safeParse({ ...valid, abn: '' }).success).toBe(false)
  })

  it('ignores spaces in an ABN and stores it without them', async () => {
    const horecaBodySchema = await loadHorecaBodySchema()
    const parsed = horecaBodySchema.safeParse({ ...valid, abn: '51 824 753 556' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.abn).toBe('51824753556')
  })

  it('allows two customers to share a billing email', async () => {
    const horecaBodySchema = await loadHorecaBodySchema()
    const first = horecaBodySchema.safeParse({ ...valid, billing_email: 'accounts@example.com' })
    const second = horecaBodySchema.safeParse({
      name: 'Example Cafe Bondi',
      address: '2 Test St, Bondi NSW 2026',
      billing_email: 'accounts@example.com',
    })
    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(first.success && first.data.billing_email).toBe('accounts@example.com')

    // The schema cannot enforce uniqueness, so also read the column: it must not be
    // unique, and it must not be called `email`, which send-email reads to decide
    // where an order confirmation goes.
    const sql = readFileSync(
      join(__dirname, '..', 'supabase', 'migrations', '00138_horeca_contact_fields.sql'),
      'utf8',
    )
    const code = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS billing_email\s+TEXT\b/)
    expect(code).not.toMatch(/CREATE\s+UNIQUE|\bUNIQUE\s*\(|billing_email[^;,]*\bUNIQUE\b/i)
    expect(code).not.toMatch(/ADD COLUMN IF NOT EXISTS email\b/i)
  })

  it('rejects a billing email that is not an address, and lets any contact field be cleared', async () => {
    const horecaBodySchema = await loadHorecaBodySchema()
    expect(horecaBodySchema.safeParse({ ...valid, billing_email: 'not an email' }).success).toBe(false)
    expect(
      horecaBodySchema.safeParse({
        contact_name: null,
        phone: null,
        abn: null,
        billing_email: null,
        buys_brands: [],
      }).success,
    ).toBe(true)
  })

  it('trims a contact name and refuses a blank or oversized one', async () => {
    const horecaBodySchema = await loadHorecaBodySchema()
    const parsed = horecaBodySchema.safeParse({ ...valid, contact_name: '  Jane Citizen ' })
    expect(parsed.success && parsed.data.contact_name).toBe('Jane Citizen')
    expect(horecaBodySchema.safeParse({ ...valid, contact_name: '   ' }).success).toBe(false)
    expect(horecaBodySchema.safeParse({ ...valid, contact_name: 'x'.repeat(101) }).success).toBe(false)
  })

  it('takes a list of brands and refuses a blank entry', async () => {
    const horecaBodySchema = await loadHorecaBodySchema()
    const parsed = horecaBodySchema.safeParse({ ...valid, buys_brands: [' McCURRIE ', 'Bega'] })
    expect(parsed.success && parsed.data.buys_brands).toEqual(['McCURRIE', 'Bega'])
    expect(horecaBodySchema.safeParse({ ...valid, buys_brands: ['McCURRIE', ' '] }).success).toBe(false)
  })

  // The customer form checks these before it sends anything, with the rules the server
  // applies. The form's check and the schema are two readers of one set of rules, so
  // this holds them to the same answer on the same values. Blank is left out: the form
  // sends a blank as null (a clear), which the schema accepts.
  it('has the form check and the server schema agree on the same values', async () => {
    const { validateHoReCaContact } = await import('@/supabase/functions/_shared/horecaBody')
    const horecaBodySchema = await loadHorecaBodySchema()
    const samples = {
      billingEmail: ['a@b', 'a@b.c', 'ap@example.com', 'two words@example.com', ' padded@example.com ', 'a'.repeat(250) + '@b.co'],
      phone: ['0400 000 001', '0'.repeat(40), '0'.repeat(41), '  0400  '],
      contactName: ['Jane Citizen', 'x'.repeat(100), 'x'.repeat(101)],
      abn: ['51 824 753 556', '51824753556', '123', '5182475355X', '518247535561'],
    } as const
    const column = { billingEmail: 'billing_email', phone: 'phone', contactName: 'contact_name', abn: 'abn' } as const
    for (const field of Object.keys(samples) as Array<keyof typeof samples>) {
      for (const sample of samples[field]) {
        const formAccepts = validateHoReCaContact({ [field]: sample })[field] === undefined
        const serverAccepts = horecaBodySchema.safeParse({ ...valid, [column[field]]: sample }).success
        expect({ field, sample, accepted: formAccepts }).toEqual({ field, sample, accepted: serverAccepts })
      }
    }
    // And the cases that matter most are not both wrongly lenient.
    expect(validateHoReCaContact({ billingEmail: 'a@b' }).billingEmail).toMatch(/email/i)
    expect(validateHoReCaContact({ phone: '0'.repeat(41) }).phone).toBeTruthy()
    expect(validateHoReCaContact({ contactName: 'x'.repeat(101) }).contactName).toBeTruthy()
    expect(validateHoReCaContact({ billingEmail: '', phone: '', contactName: '', abn: '' })).toEqual({})
  })
})
