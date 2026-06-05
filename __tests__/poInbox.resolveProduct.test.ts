import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the OpenAI wrapper so the AI fuzzy-match branch is deterministic.
// See poInbox.resolveCustomer.test.ts for why this path resolves to the same
// module the resolver imports.
vi.mock('../supabase/functions/_shared/poInbox/openai.ts', () => ({
  extractStructured: vi.fn(),
}))

import { extractStructured } from '../supabase/functions/_shared/poInbox/openai.ts'
import { resolveProduct, PRODUCT_AUTO_ALIAS_THRESHOLD } from '../supabase/functions/_shared/poInbox/aliasResolver'
import { makeFakeSupabase, noopAudit } from './support/fakeSupabase'
import type { FakeSupabaseOptions } from './support/fakeSupabase'

const aiMock = vi.mocked(extractStructured)

const HORECA_ID = 7

beforeEach(() => {
  aiMock.mockReset()
})

function setup(options: FakeSupabaseOptions, overrides: Partial<Parameters<typeof resolveProduct>[0]> = {}) {
  const handle = makeFakeSupabase(options)
  const input = {
    supa: handle.supa,
    audit: noopAudit,
    inboundMessageId: 'msg-1',
    edgeFunction: 'extract-po',
    horecaId: HORECA_ID,
    itemCodeRaw: null as string | null,
    descriptionRaw: null as string | null,
    ...overrides,
  }
  return { ...handle, input }
}

/** Shape the resolver reads off `extractStructured` for product matching. */
function aiPick(matchedProductId: number | null, defaultPackSize: number | null, confidence: number) {
  return {
    data: { matched_product_id: matchedProductId, default_pack_size: defaultPackSize, confidence },
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    costUsd: null,
    model: 'gpt-4o-mini',
  }
}

describe('PRODUCT_AUTO_ALIAS_THRESHOLD', () => {
  it('is the 0.9 the spec calls out, inside the (0, 1] range', () => {
    expect(PRODUCT_AUTO_ALIAS_THRESHOLD).toBeGreaterThan(0)
    expect(PRODUCT_AUTO_ALIAS_THRESHOLD).toBeLessThanOrEqual(1)
    expect(PRODUCT_AUTO_ALIAS_THRESHOLD).toBe(0.9)
  })
})

describe('resolveProduct — deterministic alias steps', () => {
  it('matches an exact item-code alias (confidence 1.0, no AI)', async () => {
    const { input } = setup({
      tables: { po_product_aliases: [{ horeca_id: HORECA_ID, source_code: 'sku100', product_id: 99, default_pack_size: 6 }] },
    }, { itemCodeRaw: 'SKU100' })
    const result = await resolveProduct(input)
    expect(result).toEqual({
      productId: 99,
      defaultPackSize: 6,
      confidence: 1.0,
      matchSource: 'product_code_alias',
      aliasInsertedId: null,
    })
    expect(aiMock).not.toHaveBeenCalled()
  })

  it('falls through to a normalized-description alias when no code matches', async () => {
    const { input } = setup({
      tables: { po_product_aliases: [{ horeca_id: HORECA_ID, source_description: 'whole milk 2l', product_id: 99, default_pack_size: null }] },
    }, { descriptionRaw: 'Whole Milk 2L' })
    const result = await resolveProduct(input)
    expect(result.productId).toBe(99)
    expect(result.matchSource).toBe('product_desc_alias')
    expect(result.defaultPackSize).toBeNull()
  })

  it('prefers a code alias over a description alias when both would match', async () => {
    const { input } = setup({
      tables: {
        po_product_aliases: [
          { horeca_id: HORECA_ID, source_code: 'sku100', product_id: 11, default_pack_size: 6 },
          { horeca_id: HORECA_ID, source_description: 'whole milk 2l', product_id: 22, default_pack_size: 12 },
        ],
      },
    }, { itemCodeRaw: 'SKU100', descriptionRaw: 'Whole Milk 2L' })
    const result = await resolveProduct(input)
    expect(result.productId).toBe(11)
    expect(result.matchSource).toBe('product_code_alias')
  })

  it('does not match an alias scoped to a different horeca', async () => {
    const { input } = setup({
      tables: {
        po_product_aliases: [{ horeca_id: 999, source_code: 'sku100', product_id: 99, default_pack_size: 6 }],
        products: [],
      },
    }, { itemCodeRaw: 'SKU100' })
    const result = await resolveProduct(input)
    expect(result.productId).toBeNull()
    expect(aiMock).not.toHaveBeenCalled()
  })
})

describe('resolveProduct — missing / no-match short-circuits', () => {
  it('returns missing without calling AI when neither code nor description is present', async () => {
    const { input } = setup({ tables: { po_product_aliases: [], products: [{ id: 99, sku: 'X', name: 'X', carton_size: 1 }] } })
    const result = await resolveProduct(input)
    expect(result).toEqual({ productId: null, defaultPackSize: null, confidence: 0, matchSource: null, aliasInsertedId: null })
    expect(aiMock).not.toHaveBeenCalled()
  })

  it('returns missing when a code is present but the product catalog is empty', async () => {
    const { input } = setup({ tables: { po_product_aliases: [], products: [] } }, { itemCodeRaw: 'SKU100' })
    const result = await resolveProduct(input)
    expect(result.productId).toBeNull()
    expect(aiMock).not.toHaveBeenCalled()
  })
})

describe('resolveProduct — AI fuzzy match', () => {
  const catalogOnly: FakeSupabaseOptions = {
    tables: { po_product_aliases: [], products: [{ id: 99, sku: 'SKU100', name: 'Whole Milk', carton_size: 6 }] },
  }

  it('writes a horeca-scoped alias and returns the match when AI confidence ≥ threshold', async () => {
    aiMock.mockResolvedValue(aiPick(99, 6, 0.95))
    const { input, db } = setup(catalogOnly, { itemCodeRaw: 'SKU100', descriptionRaw: 'Whole Milk 2L' })
    const result = await resolveProduct(input)

    expect(result.productId).toBe(99)
    expect(result.defaultPackSize).toBe(6)
    expect(result.confidence).toBe(0.95)
    expect(result.matchSource).toBe('ai_fuzzy_match')
    expect(result.aliasInsertedId).toBe('po_product_aliases-1')

    expect(aiMock).toHaveBeenCalledTimes(1)
    expect(db.inserted).toHaveLength(1)
    expect(db.inserted[0].table).toBe('po_product_aliases')
    expect(db.inserted[0].row).toMatchObject({
      horeca_id: HORECA_ID,
      source_code: 'sku100',
      source_description: 'whole milk 2l',
      product_id: 99,
      default_pack_size: 6,
      confidence_at_creation: 0.95,
      created_by: null,
    })
  })

  it('does not write an alias when AI confidence is below threshold', async () => {
    aiMock.mockResolvedValue(aiPick(99, 6, 0.6))
    const { input, db } = setup(catalogOnly, { itemCodeRaw: 'SKU100' })
    const result = await resolveProduct(input)

    expect(result.productId).toBe(99)
    expect(result.defaultPackSize).toBeNull() // below-threshold branch drops the pack size
    expect(result.confidence).toBe(0.6)
    expect(result.matchSource).toBe('ai_fuzzy_match')
    expect(result.aliasInsertedId).toBeNull()
    expect(db.inserted).toHaveLength(0)
  })

  it('returns a null match (no source) when AI finds no candidate', async () => {
    aiMock.mockResolvedValue(aiPick(null, null, 0))
    const { input, db } = setup(catalogOnly, { descriptionRaw: 'Totally Unknown Item' })
    const result = await resolveProduct(input)

    expect(result.productId).toBeNull()
    expect(result.matchSource).toBeNull()
    expect(result.aliasInsertedId).toBeNull()
    expect(db.inserted).toHaveLength(0)
  })
})
