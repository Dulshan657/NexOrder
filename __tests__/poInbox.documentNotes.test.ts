import { describe, expect, it } from 'vitest'
import {
  composeOrderNotes,
  documentNoteText,
} from '../supabase/functions/_shared/poInbox/documentNotes'
import {
  EXTRACT_PO_SCHEMA,
  EXTRACT_PO_SYSTEM_PROMPT,
} from '../supabase/functions/_shared/poInbox/extractionSchema'

// The real thing, off PO 228686 — the note runs onto a second line listing the
// part it applies to, which is why nothing here may collapse whitespace.
const REAL_NOTE =
  "Don't deliver outdoor unit as it will be called up at a later date.\n*LRC-170DS"

// Off PO 228332. Note it is nowhere near the "Deliver To" on the same page
// (7 Austral Place, Hallam) — that is the whole reason both fields exist.
const REAL_JOB_ADDRESS = 'Lot 21/21 Coomleigh Avenue, 752041, Glen Waverley, VIC, 3150'

describe('documentNoteText', () => {
  it('returns the block as printed', () => {
    expect(documentNoteText(REAL_NOTE)).toBe(REAL_NOTE)
  })

  it('trims the surrounding whitespace extraction leaves behind', () => {
    expect(documentNoteText('  Deliver after 7am \n')).toBe('Deliver after 7am')
  })

  it('preserves interior line breaks', () => {
    // The affected part numbers are listed one per line under the note; folding
    // them into one line would make the block unreadable.
    expect(documentNoteText(REAL_NOTE)).toContain('\n*LRC-170DS')
  })

  it('treats a heading with nothing under it as no block', () => {
    expect(documentNoteText('')).toBeNull()
    expect(documentNoteText('   ')).toBeNull()
    expect(documentNoteText('\n\t ')).toBeNull()
  })

  it('treats absent and null as no block', () => {
    // undefined: a row extracted before these fields shipped, so the JSONB key
    // does not exist. null: the document had no such block.
    expect(documentNoteText(undefined)).toBeNull()
    expect(documentNoteText(null)).toBeNull()
  })
})

describe('composeOrderNotes', () => {
  it('labels the delivery instructions when both blocks are present', () => {
    const out = composeOrderNotes({
      notes: REAL_NOTE,
      delivery_instructions: 'METRICON PROMO PRICING',
    })
    expect(out).toContain(REAL_NOTE)
    expect(out).toContain('Delivery instructions:\nMETRICON PROMO PRICING')
  })

  it('leaves a lone note bare', () => {
    // The common case, and it reads better on the order without a heading.
    expect(composeOrderNotes({ notes: REAL_NOTE })).toBe(REAL_NOTE)
  })

  it('labels lone delivery instructions, so they are not read as a note', () => {
    expect(composeOrderNotes({ delivery_instructions: '*2 systems' })).toBe(
      'Delivery instructions:\n*2 systems',
    )
  })

  it('returns null when the document carried neither', () => {
    // Load-bearing: approve-po writes this straight into orders.notes, and a
    // null must stay a null rather than becoming an empty string.
    expect(composeOrderNotes({})).toBeNull()
    expect(composeOrderNotes({ notes: null, delivery_instructions: null })).toBeNull()
    expect(composeOrderNotes({ notes: '   ', delivery_instructions: '' })).toBeNull()
    expect(composeOrderNotes(null)).toBeNull()
    expect(composeOrderNotes(undefined)).toBeNull()
  })

  it('always labels the job address, even alone', () => {
    // Unlike a note, a bare street address in a picking instruction is
    // indistinguishable from the place the goods are going — which it is not.
    expect(composeOrderNotes({ job_address: REAL_JOB_ADDRESS })).toBe(
      `Job address:\n${REAL_JOB_ADDRESS}`,
    )
  })

  it('carries all three blocks, note first and each other under its heading', () => {
    const out = composeOrderNotes({
      notes: REAL_NOTE,
      delivery_instructions: '*2 systems',
      job_address: REAL_JOB_ADDRESS,
    })
    expect(out).toBe(
      `${REAL_NOTE}\n\nDelivery instructions:\n*2 systems\n\nJob address:\n${REAL_JOB_ADDRESS}`,
    )
  })

  it('keeps the job address out of the delivery instructions', () => {
    // They answer different questions — where the work is vs how to deliver —
    // and folding them together is what the separate headings prevent.
    const out = composeOrderNotes({
      delivery_instructions: '*2 systems',
      job_address: REAL_JOB_ADDRESS,
    })
    expect(out).toBe(`Delivery instructions:\n*2 systems\n\nJob address:\n${REAL_JOB_ADDRESS}`)
  })

  it('still returns null when only a job address key is present but empty', () => {
    expect(composeOrderNotes({ job_address: null })).toBeNull()
    expect(composeOrderNotes({ job_address: '  ' })).toBeNull()
  })

  it('is unchanged for rows written before job_address shipped', () => {
    // The key is simply absent on those, which must read as "no block" rather
    // than throwing or emitting an empty heading.
    expect(composeOrderNotes({ notes: REAL_NOTE })).toBe(REAL_NOTE)
  })
})

describe('EXTRACT_PO_SCHEMA header fields', () => {
  it('declares notes and delivery_instructions as nullable strings', () => {
    expect(EXTRACT_PO_SCHEMA.properties.notes.type).toEqual(['string', 'null'])
    expect(EXTRACT_PO_SCHEMA.properties.delivery_instructions.type).toEqual(['string', 'null'])
  })

  it('lists both in the root required array', () => {
    // strict:true + additionalProperties:false means a declared property that
    // is missing from `required` is a 400 invalid_schema at request time, which
    // would stop every extraction in the pipeline.
    expect(EXTRACT_PO_SCHEMA.required).toContain('notes')
    expect(EXTRACT_PO_SCHEMA.required).toContain('delivery_instructions')
  })

  it('declares job_address, described and required', () => {
    // Same 400-on-omission rule as above. The description is not optional
    // either: a field with neither a description nor a prompt bullet has no
    // guidance at all, which is how a telephone number became a po_number.
    expect(EXTRACT_PO_SCHEMA.properties.job_address.type).toEqual(['string', 'null'])
    expect(EXTRACT_PO_SCHEMA.properties.job_address.description).toBeTruthy()
    expect(EXTRACT_PO_SCHEMA.required).toContain('job_address')
  })

  it('gives neither a confidence sibling', () => {
    // Same call as builder / customer_id_guess: informational, gates nothing,
    // and adding one would drag in ExtractedConfidence and statusDecision's
    // explicit key list.
    const keys = Object.keys(EXTRACT_PO_SCHEMA.properties.confidence.properties)
    expect(keys).not.toContain('notes')
    expect(keys).not.toContain('delivery_instructions')
    expect(keys).not.toContain('job_address')
  })

  it('describes po_number, which previously had no guidance at all', () => {
    // The gap that let a PO extract its buyer's telephone number as the PO
    // number, at confidence 1.0, and auto-approve on it.
    expect(EXTRACT_PO_SCHEMA.properties.po_number.description).toBeTruthy()
  })
})

describe('EXTRACT_PO_SYSTEM_PROMPT', () => {
  it('tells the model to bind values to their printed label', () => {
    // The root cause of both the po_number and ship_to misreads: these POs are
    // laid out in columns, so the nearest text is routinely the wrong text.
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('printed LABEL')
  })

  it('rules a telephone or fax number out as a po_number', () => {
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('never a')
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('telephone number')
  })

  it('distinguishes ship_to from the supplier block', () => {
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('ship_to is the DELIVERY address')
  })

  it('tells the model job_address and ship_to are different addresses', () => {
    // On a builder PO both are printed, and they are routinely different: the
    // goods go to the installer's yard while the job is on an estate. Without
    // this the model has two address-shaped blocks and one rule.
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('job_address is the site')
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('It is NOT ship_to')
  })

  it('separates the document-level blocks from the per-line notes', () => {
    // lines[].notes has the same key name, so without this the model merges them.
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('WHOLE-DOCUMENT blocks')
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('per-line notes inside')
  })
})
