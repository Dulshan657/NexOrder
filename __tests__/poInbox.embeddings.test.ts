import { describe, it, expect } from 'vitest'

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  poLineEmbedText,
  productEmbedHash,
  productEmbedText,
  toVectorLiteral,
} from '../supabase/functions/_shared/poInbox/embeddings.ts'
import { MODEL_PRICING, computeCostUsd } from '../supabase/functions/_shared/poInbox/openaiCost.ts'

// productEmbedText is load-bearing in a way that is easy to miss: content_hash is
// taken over its output, so any change to it silently invalidates every row in
// product_embeddings and triggers a full re-embed. These tests pin the shape.

describe('productEmbedText', () => {
  it('joins sku, name and category in that order', () => {
    expect(productEmbedText({ sku: 'AYM-1', name: 'Coconut Milk', category: 'Canned' }))
      .toBe('AYM-1 · Coconut Milk · Canned')
  })

  it('drops absent parts rather than leaving empty separators', () => {
    expect(productEmbedText({ sku: 'AYM-1', name: null, category: undefined }))
      .toBe('AYM-1')
    expect(productEmbedText({ sku: null, name: 'Coconut Milk', category: '' }))
      .toBe('Coconut Milk')
  })

  it('collapses whitespace so formatting noise does not change the hash', async () => {
    const tidy = { sku: 'AYM-1', name: 'Coconut Milk', category: 'Canned' }
    const messy = { sku: ' AYM-1 ', name: 'Coconut\n  Milk', category: '  Canned' }
    expect(productEmbedText(messy)).toBe(productEmbedText(tidy))
    expect(await productEmbedHash(messy)).toBe(await productEmbedHash(tidy))
  })

  it('returns the empty string when there is nothing to embed', () => {
    // The job relies on this to skip a product rather than store a vector for the
    // empty string, which would sit near everything.
    expect(productEmbedText({ sku: null, name: null, category: null })).toBe('')
    expect(productEmbedText({})).toBe('')
  })
})

describe('productEmbedHash', () => {
  it('is stable for the same input', async () => {
    const product = { sku: 'AYM-1', name: 'Coconut Milk', category: 'Canned' }
    expect(await productEmbedHash(product)).toBe(await productEmbedHash(product))
  })

  it('changes when any embedded field changes', async () => {
    const base = { sku: 'AYM-1', name: 'Coconut Milk', category: 'Canned' }
    const renamed = { ...base, name: 'Coconut Cream' }
    const recategorised = { ...base, category: 'Chilled' }
    const resku = { ...base, sku: 'AYM-2' }

    const baseHash = await productEmbedHash(base)
    expect(await productEmbedHash(renamed)).not.toBe(baseHash)
    expect(await productEmbedHash(recategorised)).not.toBe(baseHash)
    expect(await productEmbedHash(resku)).not.toBe(baseHash)
  })

  it('is a hex sha-256', async () => {
    expect(await productEmbedHash({ sku: 'AYM-1' })).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('poLineEmbedText', () => {
  it('puts the PO line in the same space as the catalog', () => {
    // Item code plays the role of the SKU, description the role of the name, so a
    // query and a product are embedded in the same shape.
    expect(poLineEmbedText('AYM-1', 'Coconut Milk 400ml'))
      .toBe(productEmbedText({ sku: 'AYM-1', name: 'Coconut Milk 400ml', category: null }))
  })

  it('handles a line with only a description', () => {
    expect(poLineEmbedText(null, 'Coconut Milk 400ml')).toBe('Coconut Milk 400ml')
  })

  it('is empty when the line carries neither, so retrieval is skipped', () => {
    expect(poLineEmbedText(null, null)).toBe('')
  })
})

describe('toVectorLiteral', () => {
  it('formats a Postgres vector literal', () => {
    expect(toVectorLiteral([0.1, -0.2, 0])).toBe('[0.1,-0.2,0]')
  })

  it('round-trips through JSON as a bracketed list of the right width', () => {
    const literal = toVectorLiteral(Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0))
    expect(JSON.parse(literal)).toHaveLength(EMBEDDING_DIMENSIONS)
  })
})

describe('embedding cost is priced, not guessed', () => {
  it('knows the embedding model', () => {
    expect(MODEL_PRICING[EMBEDDING_MODEL]).toBeDefined()
    expect(MODEL_PRICING[EMBEDDING_MODEL].outputPer1M).toBe(0)
  })

  it('prices an embedding call with no completion tokens', () => {
    // 1M input tokens at $0.02.
    expect(computeCostUsd(EMBEDDING_MODEL, 1_000_000, 0)).toBeCloseTo(0.02, 6)
  })

  it('is dramatically cheaper than the catalog prompt it replaces', () => {
    // The old path sent ~15k tokens of catalog to gpt-4o-mini per unmatched line;
    // the new one embeds ~10 tokens of query text. Both priced from one table.
    const oldCost = computeCostUsd('gpt-4o-mini', 15_000, 50) ?? 0
    const newCost = computeCostUsd(EMBEDDING_MODEL, 10, 0) ?? 0
    expect(newCost).toBeLessThan(oldCost / 100)
  })
})
