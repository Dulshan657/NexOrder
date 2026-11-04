import { describe, it, expect } from 'vitest'
import { mkProduct } from '../fixtures'
import { findProduct } from '../../lib/voice/findProduct'

const catalogue = [
  mkProduct({ id: 39, sku: 'OYS210', name: 'Oyster Sauce 210ml', category: 'Asian Sauces' }),
  mkProduct({ id: 40, sku: 'OYS510', name: 'Oyster Sauce 510ml', category: 'Asian Sauces' }),
  mkProduct({ id: 8, sku: 'COC400', name: 'Coconut Cream 400ml', category: 'Coconut' }),
  mkProduct({ id: 9, sku: 'CMK400', name: 'Coconut Milk 400ml', category: 'Coconut' }),
  mkProduct({ id: 80, sku: 'RN200', name: 'Rice Noodles 200g', category: 'Noodles' }),
  mkProduct({ id: 81, sku: 'JR5', name: 'Jasmine Rice 5kg', category: 'Rice' }),
]

describe('findProduct', () => {
  it('folds spoken units', () => {
    // Transcribed speech says "210 mill", "210 millilitres" or "210 ml" for 210ml.
    for (const said of ['oyster sauce 210 mill', 'Oyster Sauce 210 millilitres', 'oyster sauce 210 ml', 'Oyster Sauce 210ML']) {
      const got = findProduct(said, catalogue)
      expect(got.candidates[0], said).toMatchObject({ id: 39, name: 'Oyster Sauce 210ml', score: 100 })
      expect(got.ambiguous, said).toBe(false)
    }
    expect(findProduct('rice noodles 200 grams', catalogue).candidates[0]).toMatchObject({ id: 80, score: 100 })
    expect(findProduct('jasmine rice five kilos', catalogue).candidates[0]?.id).toBe(81)
    expect(findProduct('jasmine rice 5 kilos', catalogue).candidates[0]).toMatchObject({ id: 81, score: 100 })
  })

  it('says ambiguous when two products match equally', () => {
    const got = findProduct('oyster sauce', catalogue)
    expect(got.candidates.map((c) => c.id).sort()).toEqual([39, 40])
    expect(got.ambiguous).toBe(true)
    // Naming the size settles it.
    expect(findProduct('oyster sauce 510', catalogue).ambiguous).toBe(false)
  })

  it('carries the sku and category so Nex can tell them apart', () => {
    expect(findProduct('coconut milk', catalogue).candidates[0]).toMatchObject({ id: 9, sku: 'CMK400', category: 'Coconut' })
  })

  it('matches nothing for an empty query or an unrelated word', () => {
    expect(findProduct('   ', catalogue)).toEqual({ candidates: [], ambiguous: false })
    expect(findProduct('zebra', catalogue).candidates).toEqual([])
  })
})
