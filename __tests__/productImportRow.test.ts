import { describe, it, expect } from 'vitest'

import { validateCatalogRow, type CatalogImportContext } from '../lib/productImportRow'
import { CATEGORIES } from '../constants'

function ctx(overrides: Partial<CatalogImportContext> = {}): CatalogImportContext {
  return {
    suppliersByName: new Map([
      ['ayam brand malaysia', 1],
      ['v2food', 4],
    ]),
    categories: new Set(CATEGORIES),
    ...overrides,
  }
}

const validRec: Record<string, string> = {
  sku: 'AYM-COC-010',
  name: 'Coconut Cream 400ml',
  description: 'Rich coconut cream.',
  price: '5.20',
  category: 'coconut',
  unit: 'can',
  carton_size: '12',
  supplier_name: 'AYAM Brand Malaysia',
  image_url: '',
  cubic_meters_unit: '',
  cubic_meters_carton: '',
  length_cm: '',
  width_cm: '',
  height_cm: '',
  size_factor: '',
}

describe('validateCatalogRow', () => {
  it('accepts an operator-created category once it is in the context set', () => {
    // Categories are open-ended since mig 00069; ProductImportModal builds this
    // set from CATEGORIES merged with the categories already in the catalog.
    const result = validateCatalogRow(
      { ...validRec, category: 'frozen dumplings' },
      ctx({ categories: new Set([...CATEGORIES, 'Frozen Dumplings']) }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.category).toBe('Frozen Dumplings')
  })

  it('builds a row for a known supplier (id, no supplier_name, not created)', () => {
    const result = validateCatalogRow(validRec, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.supplierWillBeCreated).toBe(false)
    expect(result.supplierName).toBe('AYAM Brand Malaysia')
    expect(result.row.supplier_id).toBe(1)
    expect(result.row).not.toHaveProperty('supplier_name')
  })

  it('builds a row for an unknown supplier (supplier_name set, supplier_id absent, will be created)', () => {
    const rec = { ...validRec, supplier_name: 'Brand New Co' }
    const result = validateCatalogRow(rec, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.supplierWillBeCreated).toBe(true)
    expect(result.supplierName).toBe('Brand New Co')
    expect(result.row).not.toHaveProperty('supplier_id')
    expect(result.row.supplier_name).toBe('Brand New Co')
  })

  it('produces snake_case keys in the output row', () => {
    const result = validateCatalogRow(validRec, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row).toMatchObject({
      sku: 'AYM-COC-010',
      name: 'Coconut Cream 400ml',
      price: 5.2,
      unit: 'can',
      carton_size: 12,
    })
  })

  it('case-folds category to the canonical casing', () => {
    const result = validateCatalogRow({ ...validRec, category: 'COCONUT' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.category).toBe('Coconut')
  })

  it('rejects an unknown category', () => {
    const result = validateCatalogRow({ ...validRec, category: 'Bogus' }, ctx())
    expect(result).toEqual({ ok: false, error: 'Unknown category: Bogus', field: 'category' })
  })

  it('rejects a missing price', () => {
    const result = validateCatalogRow({ ...validRec, price: '' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error('expected error result')
    expect(result.error).toMatch(/price/i)
  })

  it('rejects a thousands-separator price ("1,234") instead of silently truncating it', () => {
    const result = validateCatalogRow({ ...validRec, price: '1,234' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error('expected error result')
    expect(result.error).toMatch(/price/i)
  })

  it('rejects a currency-symbol price ("$4.50")', () => {
    const result = validateCatalogRow({ ...validRec, price: '$4.50' }, ctx())
    expect(result.ok).toBe(false)
  })

  it('rejects a trailing-garbage price ("4.5abc")', () => {
    const result = validateCatalogRow({ ...validRec, price: '4.5abc' }, ctx())
    expect(result.ok).toBe(false)
  })

  it('rejects a negative price after passing the strict-format check', () => {
    const result = validateCatalogRow({ ...validRec, price: '-5' }, ctx())
    expect(result.ok).toBe(false)
  })

  it('rejects a thousands-separator carton_size', () => {
    const result = validateCatalogRow({ ...validRec, carton_size: '1,200' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error('expected error result')
    expect(result.error).toMatch(/carton_size/i)
  })

  it('rejects a decimal carton_size instead of silently truncating it (FIX 5)', () => {
    const result = validateCatalogRow({ ...validRec, carton_size: '12.9' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error('expected error result')
    expect(result.error).toMatch(/carton_size/i)
    expect(result.error).toMatch(/whole number/i)
  })

  it('accepts a whole-number carton_size', () => {
    const result = validateCatalogRow({ ...validRec, carton_size: '12' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.carton_size).toBe(12)
  })

  it('rejects a malformed dimension field (length_cm)', () => {
    const result = validateCatalogRow({ ...validRec, length_cm: '10cm' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error('expected error result')
    expect(result.error).toMatch(/length_cm/i)
  })

  it('accepts a well-formed dimension field', () => {
    const result = validateCatalogRow({ ...validRec, length_cm: '10.5' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.length_cm).toBe(10.5)
  })

  it('rejects a missing unit', () => {
    const result = validateCatalogRow({ ...validRec, unit: '' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error('expected error result')
    expect(result.error).toMatch(/unit/i)
  })

  it('rejects a malformed image_url', () => {
    const result = validateCatalogRow({ ...validRec, image_url: 'not-a-url' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error('expected error result')
    expect(result.error).toMatch(/image_url/i)
  })

  it('accepts a well-formed image_url', () => {
    const result = validateCatalogRow({ ...validRec, image_url: 'https://cdn.test/x.webp' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.image_url).toBe('https://cdn.test/x.webp')
  })

  it('rejects a missing supplier_name', () => {
    const result = validateCatalogRow({ ...validRec, supplier_name: '' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error('expected error result')
    expect(result.error).toMatch(/supplier/i)
  })

  it('rejects a missing SKU (delegated to buildProductPayload)', () => {
    const result = validateCatalogRow({ ...validRec, sku: '' }, ctx())
    expect(result).toEqual({ ok: false, error: 'SKU is required.' })
  })

  it('rejects a missing name (delegated to buildProductPayload)', () => {
    const result = validateCatalogRow({ ...validRec, name: '' }, ctx())
    expect(result).toEqual({ ok: false, error: 'Product name is required.' })
  })

  it('accepts a blank description — the import path is not stricter than the server (FIX 4)', () => {
    const result = validateCatalogRow({ ...validRec, description: '' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row).not.toHaveProperty('description')
  })

  it('accepts a whitespace-only description, treating it as blank (FIX 4)', () => {
    const result = validateCatalogRow({ ...validRec, description: '   ' }, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row).not.toHaveProperty('description')
  })

  it('still includes a non-empty description in the row', () => {
    const result = validateCatalogRow(validRec, ctx())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.description).toBe('Rich coconut cream.')
  })
})

// Multi-supplier columns (mig 00070): `additional_suppliers` and `supplier_skus`
// are both ';'-delimited, and the part numbers are POSITIONAL over
// [supplier_name, ...additional_suppliers].
describe('validateCatalogRow — multiple suppliers', () => {
  it('omits both columns entirely when neither is supplied', () => {
    const result = validateCatalogRow(validRec, ctx())
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row).not.toHaveProperty('additional_suppliers')
    expect(result.row).not.toHaveProperty('supplier_skus')
    expect(result.newSupplierNames).toEqual([])
  })

  it('splits additional suppliers and trims each name', () => {
    const result = validateCatalogRow(
      { ...validRec, additional_suppliers: 'V2food; Beta Foods ' },
      ctx(),
    )
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.additional_suppliers).toEqual(['V2food', 'Beta Foods'])
  })

  it('reports every supplier on the row that does not exist yet', () => {
    // 'AYAM Brand Malaysia' and 'V2food' are in the ctx map; 'Beta Foods' isn't.
    const result = validateCatalogRow(
      { ...validRec, additional_suppliers: 'V2food;Beta Foods' },
      ctx(),
    )
    if (!result.ok) throw new Error('expected ok result')
    expect(result.newSupplierNames).toEqual(['Beta Foods'])
  })

  it('includes an unknown PRIMARY supplier in newSupplierNames too', () => {
    const result = validateCatalogRow(
      { ...validRec, supplier_name: 'Brand New Co', additional_suppliers: 'Beta Foods' },
      ctx(),
    )
    if (!result.ok) throw new Error('expected ok result')
    expect(result.newSupplierNames).toEqual(['Brand New Co', 'Beta Foods'])
  })

  it('maps part numbers positionally over [primary, ...additional]', () => {
    const result = validateCatalogRow(
      { ...validRec, additional_suppliers: 'V2food', supplier_skus: 'AYM-1;V2-9' },
      ctx(),
    )
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.supplier_skus).toEqual(['AYM-1', 'V2-9'])
  })

  it('preserves an empty slot rather than shifting later part numbers', () => {
    // "A;;C" must stay aligned — collapsing it would put C on the wrong supplier.
    const result = validateCatalogRow(
      { ...validRec, additional_suppliers: 'V2food;Beta Foods', supplier_skus: 'AYM-1;;BF-3' },
      ctx(),
    )
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.supplier_skus).toEqual(['AYM-1', null, 'BF-3'])
  })

  it('accepts fewer part numbers than suppliers', () => {
    const result = validateCatalogRow(
      { ...validRec, additional_suppliers: 'V2food', supplier_skus: 'AYM-1' },
      ctx(),
    )
    if (!result.ok) throw new Error('expected ok result')
    expect(result.row.supplier_skus).toEqual(['AYM-1'])
  })

  // NOTE: `result.ok === false` (not `!result.ok`) — without strictNullChecks TS
  // won't narrow a discriminated union through a negated boolean-property check.
  it('rejects MORE part numbers than suppliers instead of truncating', () => {
    const result = validateCatalogRow({ ...validRec, supplier_skus: 'AYM-1;ORPHAN' }, ctx())
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.field).toBe('supplier_skus')
  })

  it('rejects a supplier listed twice on the same row', () => {
    const result = validateCatalogRow(
      { ...validRec, additional_suppliers: 'V2food;v2food' },
      ctx(),
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.field).toBe('additional_suppliers')
  })

  it('rejects an additional supplier that repeats the primary', () => {
    const result = validateCatalogRow(
      { ...validRec, additional_suppliers: 'ayam brand malaysia' },
      ctx(),
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) expect(result.error).toMatch(/twice/i)
  })
})
