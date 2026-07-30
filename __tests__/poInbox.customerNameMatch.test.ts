import { describe, it, expect } from 'vitest'

import {
  detectCustomerNameMismatch,
  isCustomerNameMismatch,
  normalizeForCompare,
} from '../supabase/functions/_shared/poInbox/customerNameMatch'
import { makeFakeSupabase } from './support/fakeSupabase'

// The real incident this closes: a PO printing "Hallidays Heating and Cooling
// Pty Ltd", emailed from an address learned for Executive Heating & Cooling,
// resolved to Executive via the sender_email alias and raised nothing.
// customerNameMatch.ts imports aliasResolver type-only, so openai.ts never
// loads — no module mock needed, same as poInbox.detectSenderMismatch.test.ts.

const EXECUTIVE = 'Executive Heating & Cooling'
const HALLIDAYS = 'Hallidays Heating and Cooling Pty Ltd'
const HORECA_ID = 18

describe('normalizeForCompare', () => {
  it('strips punctuation and trailing legal suffixes', () => {
    expect(normalizeForCompare('Executive Heating & Cooling Pty Ltd')).toBe(
      'executive heating cooling',
    )
    expect(normalizeForCompare('Acme Foods, Pty. Ltd.')).toBe('acme foods')
    expect(normalizeForCompare('Widgets Limited')).toBe('widgets')
  })

  it('sheds stacked suffixes, not just the last one', () => {
    expect(normalizeForCompare('Tridon Pty Ltd')).toBe('tridon')
  })

  it('leaves a suffix that is not trailing alone', () => {
    // "Ltd" mid-name is part of the trading name, not an entity marker.
    expect(normalizeForCompare('Ltd Brands Group')).toBe('ltd brands group')
  })

  it('returns empty for null, undefined and punctuation-only input', () => {
    expect(normalizeForCompare(null)).toBe('')
    expect(normalizeForCompare(undefined)).toBe('')
    expect(normalizeForCompare('   ')).toBe('')
    expect(normalizeForCompare('---')).toBe('')
  })
})

describe('isCustomerNameMismatch', () => {
  it('flags the Hallidays-on-Executive case', () => {
    expect(isCustomerNameMismatch(HALLIDAYS, EXECUTIVE)).toBe(true)
  })

  it('does not flag the exact customer name', () => {
    expect(isCustomerNameMismatch(EXECUTIVE, EXECUTIVE)).toBe(false)
  })

  it('tolerates a legal suffix the customer record omits', () => {
    // The false positive that would have blocked the ActronAir auto-approve arc.
    expect(isCustomerNameMismatch('Executive Heating & Cooling Pty Ltd', EXECUTIVE)).toBe(false)
  })

  it('tolerates containment in either direction', () => {
    expect(isCustomerNameMismatch('Sydney Tools', 'Sydney Tools Wollongong')).toBe(false)
    expect(isCustomerNameMismatch('Sydney Tools Wollongong', 'Sydney Tools')).toBe(false)
  })

  it('is case- and punctuation-insensitive', () => {
    expect(isCustomerNameMismatch('EXECUTIVE HEATING AND COOLING', EXECUTIVE)).toBe(false)
  })

  it('treats "&" and "and" as the same word', () => {
    // The same firm's letterhead and customer record routinely disagree here.
    expect(isCustomerNameMismatch('Executive Heating and Cooling', EXECUTIVE)).toBe(false)
    expect(isCustomerNameMismatch('Young & Jacksons', 'Young and Jacksons')).toBe(false)
  })

  it('does not let the &/and fold merge genuinely different companies', () => {
    expect(isCustomerNameMismatch('Hallidays Heating & Cooling', EXECUTIVE)).toBe(true)
  })

  it('does not flag when the document names no customer', () => {
    // Extraction misses this field routinely; an absence contradicts nothing.
    expect(isCustomerNameMismatch(null, EXECUTIVE)).toBe(false)
    expect(isCustomerNameMismatch('', EXECUTIVE)).toBe(false)
    expect(isCustomerNameMismatch('   ', EXECUTIVE)).toBe(false)
  })

  it('does not flag when the customer cannot be named', () => {
    expect(isCustomerNameMismatch(HALLIDAYS, null)).toBe(false)
    expect(isCustomerNameMismatch(HALLIDAYS, '', [])).toBe(false)
  })

  it('accepts a learned po_text alias as a match', () => {
    // Repco's real aliases: a GPC-letterhead PO is legitimate for that customer.
    expect(
      isCustomerNameMismatch('GPC Asia Pacific Pty Ltd', 'Repco', [
        'tridon pty ltd',
        'gpc asia pacific pty ltd',
      ]),
    ).toBe(false)
  })

  it('still flags when no alias covers the document name', () => {
    expect(isCustomerNameMismatch(HALLIDAYS, 'Repco', ['gpc asia pacific pty ltd'])).toBe(true)
  })

  it('normalizes aliases stored in their printed form', () => {
    // mutate-po-alias stores source_value verbatim; comparison must normalize.
    expect(isCustomerNameMismatch('GPC Asia Pacific', 'Repco', ['GPC Asia Pacific Pty. Ltd.'])).toBe(
      false,
    )
  })
})

function seed(options?: { name?: string | null; poTextAliases?: string[] }) {
  return makeFakeSupabase({
    tables: {
      horecas: [{ id: HORECA_ID, name: options?.name ?? EXECUTIVE }],
      po_customer_aliases: (options?.poTextAliases ?? []).map(v => ({
        horeca_id: HORECA_ID,
        source_type: 'po_text',
        source_value: v,
      })),
    },
  })
}

describe('detectCustomerNameMismatch', () => {
  it('flags a document naming a different company', async () => {
    const { supa } = seed()
    const result = await detectCustomerNameMismatch({
      supa,
      extractedName: HALLIDAYS,
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(true)
    expect(result.documentName).toBe(HALLIDAYS)
    expect(result.matchedName).toBe(EXECUTIVE)
  })

  it('does not flag the resolved customer', async () => {
    const { supa } = seed()
    const result = await detectCustomerNameMismatch({
      supa,
      extractedName: EXECUTIVE,
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(false)
  })

  it('does not flag a name covered by a learned po_text alias', async () => {
    const { supa } = seed({ name: 'Repco', poTextAliases: ['gpc asia pacific pty ltd'] })
    const result = await detectCustomerNameMismatch({
      supa,
      extractedName: 'GPC Asia Pacific Pty Ltd',
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(false)
  })

  it('reports a null documentName when the document names nobody', async () => {
    const { supa } = seed()
    const result = await detectCustomerNameMismatch({
      supa,
      extractedName: null,
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(false)
    expect(result.documentName).toBeNull()
  })

  it('fails OPEN when the customer lookup errors', async () => {
    // This gate blocks auto-approval; a transient read error must not start
    // holding every PO for review.
    const { supa } = makeFakeSupabase({
      tables: { horecas: [{ id: HORECA_ID, name: EXECUTIVE }], po_customer_aliases: [] },
      selectErrors: { horecas: 'boom' },
    })
    const result = await detectCustomerNameMismatch({
      supa,
      extractedName: HALLIDAYS,
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(false)
    expect(result.matchedName).toBeNull()
  })

  it('fails OPEN when the alias lookup errors', async () => {
    const { supa } = makeFakeSupabase({
      tables: { horecas: [{ id: HORECA_ID, name: EXECUTIVE }], po_customer_aliases: [] },
      selectErrors: { po_customer_aliases: 'boom' },
    })
    const result = await detectCustomerNameMismatch({
      supa,
      extractedName: HALLIDAYS,
      horecaId: HORECA_ID,
    })
    expect(result.flagged).toBe(false)
    expect(result.matchedName).toBe(EXECUTIVE)
  })
})
