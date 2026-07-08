import { describe, it, expect } from 'vitest'

import { buildProductPayload, type ProductFormData } from '../lib/productFormPayload'

const validFormData: ProductFormData = {
  sku: 'AYM-COC-003',
  name: 'Coconut Milk 400ml',
  description: 'Rich, creamy coconut milk.',
  price: '4.90',
  category: 'Coconut',
  unit: 'can',
  imageUrl: '',
  supplierId: '1',
  cartonSize: '12',
  cubicMetersUnit: '',
  cubicMetersCarton: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  sizeFactor: '1',
}

describe('buildProductPayload', () => {
  it('builds a valid create payload from complete form data', () => {
    const result = buildProductPayload(validFormData)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.data).toMatchObject({
      sku: 'AYM-COC-003',
      name: 'Coconut Milk 400ml',
      description: 'Rich, creamy coconut milk.',
      price: 4.9,
      category: 'Coconut',
      unit: 'can',
      supplierId: 1,
      cartonSize: 12,
    })
  })

  it('trims sku and name', () => {
    const result = buildProductPayload({ ...validFormData, sku: '  AYM-COC-003  ', name: '  Coconut Milk  ' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.data.sku).toBe('AYM-COC-003')
    expect(result.data.name).toBe('Coconut Milk')
  })

  it('rejects a missing SKU', () => {
    const result = buildProductPayload({ ...validFormData, sku: '   ' })
    expect(result).toEqual({ ok: false, error: 'SKU is required.' })
  })

  it('rejects a missing name', () => {
    const result = buildProductPayload({ ...validFormData, name: '' })
    expect(result).toEqual({ ok: false, error: 'Product name is required.' })
  })

  it('rejects a missing description', () => {
    const result = buildProductPayload({ ...validFormData, description: '   ' })
    expect(result).toEqual({ ok: false, error: 'Description is required.' })
  })

  it('rejects an invalid price', () => {
    const result = buildProductPayload({ ...validFormData, price: 'not-a-number' })
    expect(result).toEqual({ ok: false, error: 'Price must be a valid, non-negative number.' })
  })

  it('rejects a negative price', () => {
    const result = buildProductPayload({ ...validFormData, price: '-5' })
    expect(result).toEqual({ ok: false, error: 'Price must be a valid, non-negative number.' })
  })

  it('rejects a missing supplier', () => {
    const result = buildProductPayload({ ...validFormData, supplierId: '' })
    expect(result).toEqual({ ok: false, error: 'Please select a supplier.' })
  })

  it('rejects a carton size below 1', () => {
    const result = buildProductPayload({ ...validFormData, cartonSize: '0' })
    expect(result).toEqual({ ok: false, error: 'Carton size must be a whole number of at least 1.' })
  })

  it('rejects a non-numeric carton size', () => {
    const result = buildProductPayload({ ...validFormData, cartonSize: '' })
    expect(result).toEqual({ ok: false, error: 'Carton size must be a whole number of at least 1.' })
  })

  describe('imageUrl handling', () => {
    it('omits imageUrl on create when empty', () => {
      const result = buildProductPayload({ ...validFormData, imageUrl: '   ' }, { isEdit: false })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data).not.toHaveProperty('imageUrl')
    })

    it('includes imageUrl on create when non-empty', () => {
      const result = buildProductPayload({ ...validFormData, imageUrl: 'https://cdn.test/x.webp' }, { isEdit: false })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data.imageUrl).toBe('https://cdn.test/x.webp')
    })

    it('includes an empty imageUrl on edit so the caller can clear it', () => {
      const result = buildProductPayload({ ...validFormData, imageUrl: '' }, { isEdit: true })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data.imageUrl).toBe('')
    })

    it('includes a non-empty imageUrl on edit', () => {
      const result = buildProductPayload({ ...validFormData, imageUrl: 'https://cdn.test/x.webp' }, { isEdit: true })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data.imageUrl).toBe('https://cdn.test/x.webp')
    })
  })

  it('omits optional numeric fields when blank', () => {
    const result = buildProductPayload(validFormData)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.data.cubicMetersUnit).toBeUndefined()
    expect(result.data.cubicMetersCarton).toBeUndefined()
    expect(result.data.lengthCm).toBeUndefined()
    expect(result.data.widthCm).toBeUndefined()
    expect(result.data.heightCm).toBeUndefined()
  })

  it('parses optional numeric fields when provided', () => {
    const result = buildProductPayload({
      ...validFormData,
      cubicMetersUnit: '0.0007',
      cubicMetersCarton: '0.009',
      lengthCm: '10',
      widthCm: '5',
      heightCm: '5',
      sizeFactor: '2',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.data.cubicMetersUnit).toBe(0.0007)
    expect(result.data.cubicMetersCarton).toBe(0.009)
    expect(result.data.lengthCm).toBe(10)
    expect(result.data.widthCm).toBe(5)
    expect(result.data.heightCm).toBe(5)
    expect(result.data.sizeFactor).toBe(2)
  })
})
