import { describe, it, expect } from 'vitest'

import { toProduct } from '../lib/adapters'

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
