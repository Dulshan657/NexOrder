import { describe, it, expect } from 'vitest'

import { toProduct, fromProduct } from '../lib/adapters'

// Minimal products row; toProduct only reads the fields asserted here. Cast keeps
// the fixture small without enumerating every nullable column.
const baseRow = {
  id: 3,
  sku: 'AYM-COC-003',
  name: 'Coconut Milk 400ml',
  description: null,
  price: 4.9,
  category: 'Coconut',
  inventory: 79,
  available: 19,
  image_url: null,
  unit: 'can',
  carton_size: 12,
  dietary_labels: null,
  supplier_id: 1,
} as unknown as Parameters<typeof toProduct>[0]

describe('toProduct — available mapping (mig 00041)', () => {
  it('maps the reservable available cache distinctly from on-hand inventory', () => {
    const p = toProduct(baseRow)
    expect(p.inventory).toBe(79)
    expect(p.available).toBe(19)
  })

  it('falls back to inventory when available is absent (pre-migration row)', () => {
    const { available, ...withoutAvailable } = baseRow as Record<string, unknown>
    const p = toProduct(withoutAvailable as Parameters<typeof toProduct>[0])
    expect(p.available).toBe(79)
  })
})

// The server (`mutate-product`) rejects image_url as '' (must be a valid URL
// or null/absent), but ProductForm's "no image" state is ''. fromProduct maps
// '' -> null at the adapter boundary so clearing an image on update works
// instead of failing INVALID_INPUT.
describe('fromProduct — imageUrl mapping', () => {
  it('maps an empty string imageUrl to null', () => {
    const row = fromProduct({ imageUrl: '' })
    expect(row).toEqual({ image_url: null })
  })

  it('passes a non-empty imageUrl through unchanged', () => {
    const row = fromProduct({ imageUrl: 'https://cdn.test/product.webp' })
    expect(row).toEqual({ image_url: 'https://cdn.test/product.webp' })
  })

  it('omits image_url entirely when imageUrl is undefined (partial patch)', () => {
    const row = fromProduct({ name: 'Coconut Milk' })
    expect(row).not.toHaveProperty('image_url')
  })

  it('maps null imageUrl through unchanged', () => {
    const row = fromProduct({ imageUrl: null as unknown as string })
    expect(row).toEqual({ image_url: null })
  })
})

describe('fromProduct — sku / cartonSize mapping', () => {
  it('maps sku and cartonSize to snake_case columns', () => {
    const row = fromProduct({ sku: 'AYM-COC-003', cartonSize: 12 })
    expect(row).toEqual({ sku: 'AYM-COC-003', carton_size: 12 })
  })

  it('omits sku/carton_size when not provided', () => {
    const row = fromProduct({ name: 'Coconut Milk' })
    expect(row).not.toHaveProperty('sku')
    expect(row).not.toHaveProperty('carton_size')
  })
})
