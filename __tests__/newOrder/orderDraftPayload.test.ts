import { describe, expect, it } from 'vitest'

import { parseOrderDraftRequest } from '../../supabase/functions/_shared/orderDraftPayload'

const upsert = (over: Record<string, unknown> = {}) => ({
  action: 'upsert',
  hoReCaId: 10,
  lines: [{ productId: 1, uomId: 12, quantity: 3 }],
  deliveryDate: '2026-12-01',
  notes: 'Back door',
  ...over,
})

describe('orderDraftPayload', () => {
  it('rejects a line without a productId', () => {
    const result = parseOrderDraftRequest(upsert({ lines: [{ uomId: null, quantity: 1 }] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/lines\[0\]\.productId/)
  })

  it('accepts a full upsert and normalises absent optionals to null', () => {
    const result = parseOrderDraftRequest(upsert({ lines: [{ productId: 1, quantity: 2 }], notes: undefined }))
    expect(result).toEqual({
      ok: true,
      value: {
        action: 'upsert',
        id: null,
        hoReCaId: 10,
        lines: [{ productId: 1, uomId: null, quantity: 2 }],
        deliveryDate: '2026-12-01',
        notes: null,
      },
    })
  })

  it('accepts an empty draft (no customer, no lines yet)', () => {
    expect(parseOrderDraftRequest(upsert({ hoReCaId: null, lines: [] })).ok).toBe(true)
  })

  it('accepts a mid-edit quantity of zero but not a negative or fractional one', () => {
    expect(parseOrderDraftRequest(upsert({ lines: [{ productId: 1, quantity: 0 }] })).ok).toBe(true)
    expect(parseOrderDraftRequest(upsert({ lines: [{ productId: 1, quantity: -1 }] })).ok).toBe(false)
    expect(parseOrderDraftRequest(upsert({ lines: [{ productId: 1, quantity: 1.5 }] })).ok).toBe(false)
  })

  it('rejects a malformed date, an over-long note and too many lines', () => {
    expect(parseOrderDraftRequest(upsert({ deliveryDate: '01/12/2026' })).ok).toBe(false)
    expect(parseOrderDraftRequest(upsert({ notes: 'x'.repeat(2001) })).ok).toBe(false)
    const many = Array.from({ length: 501 }, (_, i) => ({ productId: i + 1, quantity: 1 }))
    expect(parseOrderDraftRequest(upsert({ lines: many })).ok).toBe(false)
  })

  it('requires a uuid to update or delete', () => {
    const id = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b'
    expect(parseOrderDraftRequest(upsert({ id })).ok).toBe(true)
    expect(parseOrderDraftRequest(upsert({ id: 'nope' })).ok).toBe(false)
    expect(parseOrderDraftRequest({ action: 'delete', id })).toEqual({ ok: true, value: { action: 'delete', id } })
    expect(parseOrderDraftRequest({ action: 'delete' }).ok).toBe(false)
  })

  it('rejects an unknown action and a non-object body', () => {
    expect(parseOrderDraftRequest({ action: 'purge' }).ok).toBe(false)
    expect(parseOrderDraftRequest(null).ok).toBe(false)
  })
})
