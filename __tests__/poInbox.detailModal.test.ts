import { describe, it, expect } from 'vitest'

import { buildEditableLines } from '../components/admin/POInboxDetailModal'

describe('buildEditableLines', () => {
  it('overlays matched_items onto extracted_lines by po_line_index', () => {
    const lines = [
      { line_no: 1, item_code_raw: '402', description_raw: 'Tomato Sauce', quantity: 12, uom: 'Pallet', pack_size_raw: null, unit_price: 3.5, notes: null },
      { line_no: 2, item_code_raw: '500', description_raw: 'Chilli Sauce', quantity: 6, uom: 'Case', pack_size_raw: 12, unit_price: null, notes: null },
    ]
    const matched = [
      { po_line_index: 0, product_id: 11, quantity: 12, pack_size: 1, confidence: 1.0 },
      { po_line_index: 1, product_id: null, quantity: 6, pack_size: 12, confidence: 0 },
    ]
    const out = buildEditableLines(lines, matched)
    expect(out).toHaveLength(2)
    expect(out[0].productId).toBe(11)
    expect(out[0].rawCode).toBe('402')
    expect(out[0].rawDescription).toBe('Tomato Sauce')
    expect(out[1].productId).toBeNull()
    expect(out[1].packSize).toBe(12)
    expect(out[0].unitPrice).toBe(3.5)
    expect(out[1].unitPrice).toBeNull()
  })

  it('falls back to raw pack_size when matched_items has no pack_size', () => {
    const lines = [
      { line_no: 1, item_code_raw: 'X', description_raw: 'Y', quantity: 1, uom: null, pack_size_raw: 24, unit_price: null, notes: null },
    ]
    const matched = [{ po_line_index: 0, product_id: 5, quantity: 1, pack_size: null, confidence: 1 }]
    const out = buildEditableLines(lines, matched)
    expect(out[0].packSize).toBe(24)
  })

  it('handles missing matched_items entry (no AI match for that line)', () => {
    const lines = [
      { line_no: 1, item_code_raw: 'X', description_raw: 'Y', quantity: 7, uom: null, pack_size_raw: null, unit_price: null, notes: null },
    ]
    const out = buildEditableLines(lines, [])
    expect(out).toHaveLength(1)
    expect(out[0].productId).toBeNull()
    expect(out[0].quantity).toBe(7)
  })

  it('preserves po_line_index identity (not array position)', () => {
    const lines = [
      { line_no: 1, item_code_raw: 'a', description_raw: null, quantity: 1, uom: null, pack_size_raw: null, unit_price: null, notes: null },
      { line_no: 2, item_code_raw: 'b', description_raw: null, quantity: 2, uom: null, pack_size_raw: null, unit_price: null, notes: null },
    ]
    const matched = [{ po_line_index: 1, product_id: 99, quantity: 2, pack_size: null, confidence: 1 }]
    const out = buildEditableLines(lines, matched)
    expect(out[0].productId).toBeNull()
    expect(out[1].productId).toBe(99)
  })
})
