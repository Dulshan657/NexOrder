import { describe, expect, it } from 'vitest'
import { builderLabel } from '../components/admin/poInboxFormat'
import { EXTRACT_PO_SCHEMA, EXTRACT_PO_SYSTEM_PROMPT } from '../supabase/functions/_shared/poInbox/extractionSchema'

describe('builderLabel', () => {
  it('returns the builder name as printed', () => {
    expect(builderLabel('Metricon Homes')).toBe('Metricon Homes')
  })

  it('trims surrounding whitespace', () => {
    // The source PDFs put the "Builder:" label and its value on separate
    // lines, so extraction routinely carries a leading space.
    expect(builderLabel(' Metricon Homes')).toBe('Metricon Homes')
    expect(builderLabel('Metricon Homes \n')).toBe('Metricon Homes')
  })

  it('treats a blank value as no builder', () => {
    // A PO that prints the "Builder:" heading with nothing under it.
    expect(builderLabel('')).toBeNull()
    expect(builderLabel('   ')).toBeNull()
    expect(builderLabel('\n\t ')).toBeNull()
  })

  it('treats an absent value as no builder', () => {
    // null: document named none. undefined: row extracted before the field
    // shipped, so the JSONB key does not exist at all.
    expect(builderLabel(null)).toBeNull()
    expect(builderLabel(undefined)).toBeNull()
  })

  it('preserves interior whitespace and punctuation', () => {
    expect(builderLabel('  Metricon  Homes Pty Ltd.  ')).toBe('Metricon  Homes Pty Ltd.')
  })
})

describe('EXTRACT_PO_SCHEMA builder field', () => {
  it('declares builder as a nullable string', () => {
    expect(EXTRACT_PO_SCHEMA.properties.builder).toBeDefined()
    expect(EXTRACT_PO_SCHEMA.properties.builder.type).toEqual(['string', 'null'])
  })

  it('lists builder in the root required array', () => {
    // Load-bearing, and it fails at OpenAI request time rather than compile
    // time: the schema is sent with strict:true + additionalProperties:false,
    // under which a property missing from `required` is rejected outright
    // (400 invalid_schema) and every extraction in the pipeline stops.
    expect(EXTRACT_PO_SCHEMA.required).toContain('builder')
  })

  it('keeps every declared property listed in required', () => {
    // Generalises the rule above so a future field cannot reintroduce the bug.
    const declared = Object.keys(EXTRACT_PO_SCHEMA.properties)
    expect([...EXTRACT_PO_SCHEMA.required].sort()).toEqual(declared.sort())
  })

  it('does not give builder a confidence sibling', () => {
    // Deliberate: builder is informational and gates nothing, matching the
    // customer_id_guess precedent. Adding one would drag in ExtractedConfidence
    // and statusDecision's explicit key list.
    expect(Object.keys(EXTRACT_PO_SCHEMA.properties.confidence.properties)).not.toContain('builder')
  })

  it('tells the model what a builder is, and what it is not', () => {
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('builder is the home builder')
    // The disambiguation is the point of the bullet: a PO names a supplier and
    // a customer too, and the model must not confuse them for the builder.
    expect(EXTRACT_PO_SYSTEM_PROMPT).toContain('NOT the customer placing the order')
  })
})
