import { describe, it, expect } from 'vitest'

import { computeAliasDiff } from '../supabase/functions/_shared/poInbox/aliasDiff'

const baseInput = () => ({
  extracted: {
    customer_name_raw: 'Acme Foods, Pty. Ltd.',
    lines: [
      { item_code_raw: '402', description_raw: 'Tomato Sauce' },
      { item_code_raw: null, description_raw: 'Chilli Sauce 500ml' },
    ],
  },
  originallyMatchedHorecaId: 7,
  originallyMatchedItems: [
    { po_line_index: 0, product_id: 11 },
    { po_line_index: 1, product_id: null },
  ],
  approvedHorecaId: 7,
  approvedItems: [
    { po_line_index: 0, product_id: 11 },
    { po_line_index: 1, product_id: 22 },
  ],
  fromAddress: 'orders@acme-foods.com',
})

describe('computeAliasDiff — customer aliases', () => {
  it('writes both sender_email and sender_domain aliases when fromAddress is present', () => {
    const diff = computeAliasDiff(baseInput())
    const types = diff.customerAliases.map(a => a.source_type)
    expect(types).toContain('sender_email')
    expect(types).toContain('sender_domain')
  })

  it('lowercases and trims the email + strips www. from domain', () => {
    const diff = computeAliasDiff({
      ...baseInput(),
      fromAddress: '  Orders@WWW.Acme-Foods.COM ',
    })
    const senderEmail = diff.customerAliases.find(a => a.source_type === 'sender_email')
    const senderDomain = diff.customerAliases.find(a => a.source_type === 'sender_domain')
    expect(senderEmail?.source_value).toBe('orders@www.acme-foods.com')
    // We strip www. from the domain portion when forming the sender_domain
    // alias (the resolver's normalizeDomain mirrors this behaviour).
    expect(senderDomain?.source_value).toBe('acme-foods.com')
  })

  it('includes a po_text alias when the PO printed a customer name', () => {
    const diff = computeAliasDiff(baseInput())
    const poText = diff.customerAliases.find(a => a.source_type === 'po_text')
    expect(poText?.source_value).toBe('acme foods pty ltd')
  })

  it('skips email/domain aliases when fromAddress is empty', () => {
    const diff = computeAliasDiff({ ...baseInput(), fromAddress: null })
    expect(diff.customerAliases.find(a => a.source_type === 'sender_email')).toBeUndefined()
    expect(diff.customerAliases.find(a => a.source_type === 'sender_domain')).toBeUndefined()
  })

  it('skips po_text when there is no extracted customer name', () => {
    const diff = computeAliasDiff({
      ...baseInput(),
      extracted: { ...baseInput().extracted, customer_name_raw: null },
    })
    expect(diff.customerAliases.find(a => a.source_type === 'po_text')).toBeUndefined()
  })

  it('uses the approved horeca_id even when the original match was different', () => {
    const diff = computeAliasDiff({
      ...baseInput(),
      originallyMatchedHorecaId: 999,
      approvedHorecaId: 7,
    })
    for (const a of diff.customerAliases) expect(a.horeca_id).toBe(7)
  })
})

describe('computeAliasDiff — product aliases', () => {
  it('writes one alias row per approved line', () => {
    const diff = computeAliasDiff(baseInput())
    expect(diff.productAliases).toHaveLength(2)
  })

  it('normalizes the item code (lowercase, strip leading zeros before letters)', () => {
    const diff = computeAliasDiff({
      ...baseInput(),
      extracted: {
        ...baseInput().extracted,
        lines: [
          { item_code_raw: '  ITM-0402 ', description_raw: 'Tomato Sauce' },
          { item_code_raw: '00ABC', description_raw: 'Chilli Sauce' },
        ],
      },
    })
    expect(diff.productAliases[0].source_code).toBe('itm0402')
    expect(diff.productAliases[1].source_code).toBe('abc')
  })

  it('normalizes the description (lowercase, strip punctuation)', () => {
    const diff = computeAliasDiff({
      ...baseInput(),
      extracted: {
        ...baseInput().extracted,
        lines: [
          { item_code_raw: null, description_raw: 'Tomato Sauce, 500ml.' },
          { item_code_raw: '402', description_raw: null },
        ],
      },
    })
    expect(diff.productAliases[0].source_description).toBe('tomato sauce 500ml')
    expect(diff.productAliases[1].source_description).toBeNull()
  })

  it('skips lines where both code and description are empty', () => {
    const diff = computeAliasDiff({
      ...baseInput(),
      extracted: {
        ...baseInput().extracted,
        lines: [
          { item_code_raw: null, description_raw: null },
          { item_code_raw: '402', description_raw: 'Tomato Sauce' },
        ],
      },
    })
    expect(diff.productAliases).toHaveLength(1)
    expect(diff.productAliases[0].source_code).toBe('402')
  })

  it('uses the approved product_id (operator-corrected)', () => {
    const diff = computeAliasDiff({
      ...baseInput(),
      approvedItems: [
        { po_line_index: 0, product_id: 999 },   // operator corrected AI's 11
        { po_line_index: 1, product_id: 22 },
      ],
    })
    expect(diff.productAliases[0].product_id).toBe(999)
  })

  it('handles approved lines that reference an out-of-range extracted line', () => {
    // Should never happen in practice, but the diff function must not throw.
    const diff = computeAliasDiff({
      ...baseInput(),
      approvedItems: [
        { po_line_index: 0, product_id: 11 },
        { po_line_index: 99, product_id: 22 },
      ],
    })
    expect(diff.productAliases).toHaveLength(1)
  })

  it('all product aliases reference the approved horeca_id', () => {
    const diff = computeAliasDiff(baseInput())
    for (const a of diff.productAliases) expect(a.horeca_id).toBe(7)
  })
})
