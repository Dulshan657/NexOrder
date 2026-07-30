import { describe, it, expect, beforeEach, vi } from 'vitest'

// Both the pick and the embedding call are mocked, so these tests are about ONE
// question: which candidate list does the resolver put in front of the model, and
// does every failure mode fall back to the catalog rather than failing the PO.
vi.mock('../supabase/functions/_shared/poInbox/openai.ts', () => ({
  extractStructured: vi.fn(),
}))
vi.mock('../supabase/functions/_shared/poInbox/embeddings.ts', async () => {
  const actual = await import('../supabase/functions/_shared/poInbox/embeddings.ts')
  return { ...actual, embedTexts: vi.fn() }
})

import { extractStructured } from '../supabase/functions/_shared/poInbox/openai.ts'
import { embedTexts } from '../supabase/functions/_shared/poInbox/embeddings.ts'
import {
  resolveProduct,
  PRODUCT_CANDIDATE_LIMIT,
  type SupabaseLike,
} from '../supabase/functions/_shared/poInbox/aliasResolver'
import { makeFakeSupabase, noopAudit } from './support/fakeSupabase'

const aiMock = vi.mocked(extractStructured)
const embedMock = vi.mocked(embedTexts)

const HORECA_ID = 7

/** A catalog big enough that "did it send everything?" is visibly different. */
const CATALOG = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  sku: `SKU-${i + 1}`,
  name: `Product ${i + 1}`,
  carton_size: 12,
  is_active: true,
}))

function vectorResult() {
  return {
    vectors: [Array.from({ length: 1536 }, () => 0.01)],
    inputTokens: 8,
    costUsd: 0.0000002,
    model: 'text-embedding-3-small',
  }
}

function aiPick(matchedProductId: number | null, confidence: number) {
  return {
    data: { matched_product_id: matchedProductId, default_pack_size: null, confidence },
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    costUsd: null,
    model: 'gpt-4o-mini',
  }
}

/**
 * The fake client with an `rpc` bolted on. Delegating rather than spreading
 * because the fake is a class instance and a spread would drop its methods.
 */
function withRpc(
  supa: SupabaseLike,
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>,
): SupabaseLike {
  return { from: (table: string) => supa.from(table), rpc }
}

function baseInput(supa: SupabaseLike) {
  return {
    supa,
    audit: noopAudit,
    inboundMessageId: 'msg-1',
    edgeFunction: 'extract-po',
    horecaId: HORECA_ID,
    itemCodeRaw: 'WIDGET-9',
    descriptionRaw: 'Blue widget, 12 pack',
  }
}

/** How many candidates the model was actually shown, read off the prompt. */
function candidateCountFromPrompt(): number {
  const call = aiMock.mock.calls[0][0] as { messages: Array<{ content: string }> }
  const userContent = call.messages[1].content
  const catalogBlock = userContent.split('carton_size\n')[1] ?? ''
  return catalogBlock.split('\n').filter(line => line.trim().length > 0).length
}

beforeEach(() => {
  aiMock.mockReset()
  embedMock.mockReset()
})

describe('vector retrieval shortlists the candidates', () => {
  it('sends the model the RPC hits instead of the whole catalog', async () => {
    const handle = makeFakeSupabase({ tables: { products: CATALOG } })
    const shortlist = CATALOG.slice(0, PRODUCT_CANDIDATE_LIMIT)
      .map(p => ({ id: p.id, sku: p.sku, name: p.name, carton_size: p.carton_size, similarity: 0.9 }))
    const rpc = vi.fn().mockResolvedValue({ data: shortlist, error: null })
    embedMock.mockResolvedValue(vectorResult())
    aiMock.mockResolvedValue(aiPick(1, 0.95))

    const result = await resolveProduct(baseInput(withRpc(handle.supa, rpc)) as never)

    expect(rpc).toHaveBeenCalledWith('match_products', expect.objectContaining({
      p_limit: PRODUCT_CANDIDATE_LIMIT,
    }))
    expect(candidateCountFromPrompt()).toBe(PRODUCT_CANDIDATE_LIMIT)
    expect(candidateCountFromPrompt()).toBeLessThan(CATALOG.length)
    expect(result.productId).toBe(1)
    // The decision semantics are untouched: still an AI match, still aliased.
    expect(result.matchSource).toBe('ai_fuzzy_match')
  })

  it('passes the embedding as a Postgres vector literal', async () => {
    const handle = makeFakeSupabase({ tables: { products: CATALOG } })
    const shortlist = CATALOG.slice(0, 5)
      .map(p => ({ ...p, similarity: 0.8 }))
    const rpc = vi.fn().mockResolvedValue({ data: shortlist, error: null })
    embedMock.mockResolvedValue(vectorResult())
    aiMock.mockResolvedValue(aiPick(null, 0))

    await resolveProduct(baseInput(withRpc(handle.supa, rpc)) as never)

    const args = rpc.mock.calls[0][1] as { p_query: string }
    expect(typeof args.p_query).toBe('string')
    expect(args.p_query.startsWith('[')).toBe(true)
    expect(args.p_query.endsWith(']')).toBe(true)
  })
})

describe('every retrieval failure falls back to the catalog', () => {
  it('falls back when the client has no rpc at all', async () => {
    // This is the existing test harness, unchanged — which is the point: the
    // absence of rpc is the seam, not something a test has to stub out.
    const handle = makeFakeSupabase({ tables: { products: CATALOG } })
    aiMock.mockResolvedValue(aiPick(3, 0.95))

    const result = await resolveProduct(baseInput(handle.supa) as never)

    expect(embedMock).not.toHaveBeenCalled()
    expect(candidateCountFromPrompt()).toBe(CATALOG.length)
    expect(result.productId).toBe(3)
  })

  it('falls back when the RPC errors', async () => {
    const handle = makeFakeSupabase({ tables: { products: CATALOG } })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })
    embedMock.mockResolvedValue(vectorResult())
    aiMock.mockResolvedValue(aiPick(4, 0.95))

    const result = await resolveProduct(baseInput(withRpc(handle.supa, rpc)) as never)

    expect(candidateCountFromPrompt()).toBe(CATALOG.length)
    expect(result.productId).toBe(4)
  })

  it('falls back when the embedding call throws', async () => {
    const handle = makeFakeSupabase({ tables: { products: CATALOG } })
    const rpc = vi.fn()
    embedMock.mockRejectedValue(new Error('OPENAI_API_KEY is not configured'))
    aiMock.mockResolvedValue(aiPick(5, 0.95))

    const result = await resolveProduct(baseInput(withRpc(handle.supa, rpc)) as never)

    expect(rpc).not.toHaveBeenCalled()
    expect(candidateCountFromPrompt()).toBe(CATALOG.length)
    expect(result.productId).toBe(5)
  })

  it('falls back when the index returns too few hits to trust', async () => {
    // Two hits means the table is barely populated; the catalog is the better
    // answer, not a shortlist of two.
    const handle = makeFakeSupabase({ tables: { products: CATALOG } })
    const rpc = vi.fn().mockResolvedValue({
      data: CATALOG.slice(0, 2).map(p => ({ ...p, similarity: 0.5 })),
      error: null,
    })
    embedMock.mockResolvedValue(vectorResult())
    aiMock.mockResolvedValue(aiPick(6, 0.95))

    const result = await resolveProduct(baseInput(withRpc(handle.supa, rpc)) as never)

    expect(candidateCountFromPrompt()).toBe(CATALOG.length)
    expect(result.productId).toBe(6)
  })

  it('never reaches retrieval when a deterministic alias already matched', async () => {
    const handle = makeFakeSupabase({
      tables: {
        products: CATALOG,
        po_product_aliases: [
          // Stored normalized: normalizeItemCode('WIDGET-9') === 'widget9'.
          { horeca_id: HORECA_ID, source_code: 'widget9', product_id: 42, default_pack_size: 6 },
        ],
      },
    })
    const rpc = vi.fn()

    const result = await resolveProduct(baseInput(withRpc(handle.supa, rpc)) as never)

    expect(result.productId).toBe(42)
    expect(result.confidence).toBe(1)
    expect(rpc).not.toHaveBeenCalled()
    expect(embedMock).not.toHaveBeenCalled()
    expect(aiMock).not.toHaveBeenCalled()
  })
})
