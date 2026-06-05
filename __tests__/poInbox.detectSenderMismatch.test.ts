import { describe, it, expect } from 'vitest'

import { detectSenderMismatch } from '../supabase/functions/_shared/poInbox/senderTrust'
import { makeFakeSupabase } from './support/fakeSupabase'

// detectSenderMismatch builds the trusted-exact address set for a HoReCa
// (curated contact_email + learned sender_email aliases) and flags any sender
// that isn't in it. senderTrust.ts imports aliasResolver type-only, so it never
// loads openai.ts — no module mock is needed here.

const CONTACT = 'orders@grandhotelsydney.com.au'
const HORECA_ID = 7

function seed(options?: {
  contactEmail?: string | null
  senderEmailAliases?: string[]
  senderDomainAliases?: string[]
}) {
  const aliases = [
    ...(options?.senderEmailAliases ?? []).map(v => ({
      horeca_id: HORECA_ID,
      source_type: 'sender_email',
      source_value: v,
    })),
    ...(options?.senderDomainAliases ?? []).map(v => ({
      horeca_id: HORECA_ID,
      source_type: 'sender_domain',
      source_value: v,
    })),
  ]
  return makeFakeSupabase({
    tables: {
      horecas: [{ id: HORECA_ID, contact_email: options?.contactEmail ?? null }],
      po_customer_aliases: aliases,
    },
  })
}

describe('detectSenderMismatch', () => {
  it('does not flag when the sender matches the curated contact_email', async () => {
    const { supa } = seed({ contactEmail: CONTACT })
    const result = await detectSenderMismatch({ supa, fromAddress: CONTACT, horecaId: HORECA_ID })
    expect(result.flagged).toBe(false)
    expect(result.sender).toBe(CONTACT)
  })

  it('does not flag when the sender matches a learned sender_email alias (no contact_email)', async () => {
    const { supa } = seed({ contactEmail: null, senderEmailAliases: ['chef@grandhotelsydney.com.au'] })
    const result = await detectSenderMismatch({
      supa,
      fromAddress: 'chef@grandhotelsydney.com.au',
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(false)
  })

  it('flags an unknown sender (neither contact_email nor any alias)', async () => {
    const { supa } = seed({ contactEmail: CONTACT })
    const result = await detectSenderMismatch({
      supa,
      fromAddress: 'imposter@gmail.com',
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(true)
    expect(result.sender).toBe('imposter@gmail.com')
  })

  it('does NOT trust a sender_domain alias — a new mailbox at a known company still flags', async () => {
    const { supa } = seed({
      contactEmail: null,
      senderDomainAliases: ['grandhotelsydney.com.au'],
    })
    const result = await detectSenderMismatch({
      supa,
      fromAddress: 'newhire@grandhotelsydney.com.au',
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(true)
  })

  it('flags and reports a null sender when fromAddress is absent', async () => {
    const { supa } = seed({ contactEmail: CONTACT })
    const result = await detectSenderMismatch({ supa, fromAddress: null, horecaId: HORECA_ID })
    expect(result.flagged).toBe(true)
    expect(result.sender).toBeNull()
  })

  it('is case- and whitespace-insensitive when matching the trusted set', async () => {
    const { supa } = seed({ contactEmail: CONTACT })
    const result = await detectSenderMismatch({
      supa,
      fromAddress: '  Orders@GrandHotelSydney.COM.au ',
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(false)
    expect(result.sender).toBe(CONTACT)
  })

  it('swallows a contact_email lookup error and falls back to alias trust', async () => {
    const { supa } = makeFakeSupabase({
      tables: {
        horecas: [{ id: HORECA_ID, contact_email: CONTACT }],
        po_customer_aliases: [
          { horeca_id: HORECA_ID, source_type: 'sender_email', source_value: 'chef@grandhotelsydney.com.au' },
        ],
      },
      selectErrors: { horecas: 'boom' },
    })
    // contact_email read errors out, but the alias read still trusts the chef address.
    const trusted = await detectSenderMismatch({
      supa,
      fromAddress: 'chef@grandhotelsydney.com.au',
      horecaId: HORECA_ID,
    })
    expect(trusted.flagged).toBe(false)
    // ...and the (now-unreachable) contact address flags, since its lookup failed.
    const flagged = await detectSenderMismatch({ supa, fromAddress: CONTACT, horecaId: HORECA_ID })
    expect(flagged.flagged).toBe(true)
  })
})
