import { describe, it, expect } from 'vitest'

import {
  validateProductSuppliers,
  deriveDefaultSupplierLinks,
  type ProductSupplierInput,
} from '../supabase/functions/_shared/productSupplierValidation'
import { buildBulkSupplierLinks } from '../supabase/functions/_shared/productBulk'

function link(overrides: Partial<ProductSupplierInput> = {}): ProductSupplierInput {
  return { supplier_id: 1, is_primary: false, sort_order: 0, ...overrides }
}

describe('validateProductSuppliers', () => {
  it('accepts a single primary link', () => {
    expect(validateProductSuppliers([link({ is_primary: true })])).toEqual({ ok: true })
  })

  it('accepts a list with NO primary — the RPC promotes the first', () => {
    // products.supplier_id is NOT NULL, so something always becomes primary;
    // rejecting here would make plain lists unusable.
    expect(validateProductSuppliers([link({ supplier_id: 1 }), link({ supplier_id: 2 })]))
      .toEqual({ ok: true })
  })

  // NOTE: `result.ok === false` (not `!result.ok`) — without strictNullChecks TS
  // won't narrow a discriminated union through a negated boolean-property check.
  it('rejects an empty list', () => {
    const result = validateProductSuppliers([])
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error).toMatch(/at least one supplier/i)
  })

  it('rejects two primaries', () => {
    const result = validateProductSuppliers([
      link({ supplier_id: 1, is_primary: true }),
      link({ supplier_id: 2, is_primary: true }),
    ])
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error).toMatch(/only one supplier/i)
  })

  it('rejects a duplicate supplier (the unique index would 23505)', () => {
    const result = validateProductSuppliers([link({ supplier_id: 5 }), link({ supplier_id: 5 })])
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error).toMatch(/twice/i)
  })

  it('rejects a negative cost price but allows an absent one', () => {
    expect(validateProductSuppliers([link({ cost_price: -1 })]).ok).toBe(false)
    expect(validateProductSuppliers([link({ cost_price: 0 })]).ok).toBe(true)
    expect(validateProductSuppliers([link({ cost_price: null })]).ok).toBe(true)
    expect(validateProductSuppliers([link()]).ok).toBe(true)
  })

  it('rejects a non-integer supplier id', () => {
    expect(validateProductSuppliers([link({ supplier_id: 1.5 })]).ok).toBe(false)
    expect(validateProductSuppliers([link({ supplier_id: 0 })]).ok).toBe(false)
  })
})

describe('deriveDefaultSupplierLinks', () => {
  it('turns the legacy single supplier_id into one primary link', () => {
    expect(deriveDefaultSupplierLinks(7)).toEqual([
      { supplier_id: 7, is_primary: true, sort_order: 0 },
    ])
  })
})

describe('buildBulkSupplierLinks (CSV import)', () => {
  const baseRow = {
    sku: 'A-1', name: 'A', price: 1, category: 'Other', unit: 'each', carton_size: 1,
  }
  const resolved = new Map([['beta foods', 2], ['gamma trading', 3]])

  it('makes the resolved primary supplier the primary link', () => {
    expect(buildBulkSupplierLinks(baseRow as any, 1, resolved)).toEqual([
      { supplier_id: 1, supplier_sku: null, is_primary: true, sort_order: 0 },
    ])
  })

  it('appends additional suppliers in CSV order with positional part numbers', () => {
    const row = {
      ...baseRow,
      additional_suppliers: ['Beta Foods', 'Gamma Trading'],
      supplier_skus: ['AF-1001', 'BF-22', 'GT-9'],
    }
    expect(buildBulkSupplierLinks(row as any, 1, resolved)).toEqual([
      { supplier_id: 1, supplier_sku: 'AF-1001', is_primary: true, sort_order: 0 },
      { supplier_id: 2, supplier_sku: 'BF-22', is_primary: false, sort_order: 1 },
      { supplier_id: 3, supplier_sku: 'GT-9', is_primary: false, sort_order: 2 },
    ])
  })

  it('keeps alignment when a middle part number is blank', () => {
    const row = {
      ...baseRow,
      additional_suppliers: ['Beta Foods', 'Gamma Trading'],
      supplier_skus: ['AF-1001', null, 'GT-9'],
    }
    const links = buildBulkSupplierLinks(row as any, 1, resolved)
    expect(links.map(l => l.supplier_sku)).toEqual(['AF-1001', null, 'GT-9'])
  })

  it('skips an additional supplier that duplicates the primary', () => {
    // A duplicate supplier_id would trip the table's unique index; the product
    // is already created by this point, so dropping it beats failing the row.
    const row = { ...baseRow, additional_suppliers: ['Beta Foods'] }
    expect(buildBulkSupplierLinks(row as any, 2, resolved)).toEqual([
      { supplier_id: 2, supplier_sku: null, is_primary: true, sort_order: 0 },
    ])
  })

  it('skips an additional supplier that failed to resolve', () => {
    const row = { ...baseRow, additional_suppliers: ['Nowhere Ltd'] }
    expect(buildBulkSupplierLinks(row as any, 1, resolved)).toHaveLength(1)
  })

  it('trims blank part numbers to null', () => {
    const row = { ...baseRow, supplier_skus: ['   '] }
    expect(buildBulkSupplierLinks(row as any, 1, resolved)[0].supplier_sku).toBeNull()
  })
})
