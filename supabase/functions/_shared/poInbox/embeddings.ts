// Embeddings for the product catalog, and for a PO line being matched against it.
//
// Deliberately a sibling of openai.ts rather than a function inside it. That
// file's `OpenAIBaseParams.model` is the union `'gpt-4o-mini' | 'gpt-4o'`, and
// widening it to admit an embedding model would let a chat call pass one — a
// mistake nothing else would catch, since Edge Functions are excluded from
// `tsc --noEmit`. Same retry shape, same audit row, separate model type.
//
// Both runtimes matter here: `productEmbedText` is imported by the embed job
// (which writes `content_hash`) and by anything checking staleness (which
// recomputes it). One definition, or the hash stops describing the text.

import { readEnv } from './env.ts'
import { promptHash } from './openaiCost.ts'
import type { AuditWriter, ExtractionPurpose } from './openai.ts'

const OPENAI_BASE = 'https://api.openai.com/v1'
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = 500
const FETCH_TIMEOUT_MS = 30_000

/**
 * The only embedding model this codebase uses. Its 1536 dimensions are baked
 * into `product_embeddings.embedding` (mig 00089), so changing it is a migration
 * plus a full re-embed, not a constant edit.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

/** OpenAI accepts many inputs per call; 100 keeps a request comfortably small. */
export const EMBED_BATCH_SIZE = 100

/** USD per 1M input tokens for the embedding model, as of 2026-07. */
export const EMBEDDING_INPUT_PER_1M = 0.02

export interface ProductEmbedSource {
  sku?: string | null
  name?: string | null
  category?: string | null
}

/**
 * The exact text that gets embedded for a product, and therefore the exact text
 * `content_hash` is taken over.
 *
 * Kept deliberately boring: SKU, name, category, in that order, whitespace
 * collapsed. Two properties matter more than cleverness here — it must be STABLE
 * (any change re-embeds the entire catalog) and it must be the single definition,
 * because the job that writes the hash and the check that decides a row is stale
 * both call this.
 */
export function productEmbedText(product: ProductEmbedSource): string {
  return [product.sku, product.name, product.category]
    .map(part => (part ?? '').replace(/\s+/g, ' ').trim())
    .filter(part => part.length > 0)
    .join(' · ')
}

/** SHA-256 of `productEmbedText`, hex. Reuses the hash helper openai.ts uses. */
export function productEmbedHash(product: ProductEmbedSource): Promise<string> {
  return promptHash(productEmbedText(product))
}

/**
 * The text used to search for a PO line's product.
 *
 * Mirrors `productEmbedText`'s shape so the query and the corpus sit in the same
 * space: a line's item code plays the role of the SKU and its description the
 * role of the name. The line has no category, so that slot is simply absent.
 */
export function poLineEmbedText(itemCode: string | null, description: string | null): string {
  return productEmbedText({ sku: itemCode, name: description, category: null })
}

export class EmbeddingError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'EmbeddingError'
    this.status = status
  }
}

function readApiKey(): string {
  const key = readEnv('OPENAI_API_KEY')
  if (!key) throw new EmbeddingError('OPENAI_API_KEY is not configured', null)
  return key
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

async function backoffDelay(attempt: number): Promise<void> {
  const factor = 2 ** (attempt - 1)
  const jitter = 0.75 + Math.random() * 0.5
  await new Promise(resolve => setTimeout(resolve, Math.round(DEFAULT_BACKOFF_MS * factor * jitter)))
}

export interface EmbedResult {
  /** One vector per input, in input order. */
  vectors: number[][]
  inputTokens: number
  costUsd: number
  model: string
}

export interface EmbedParams {
  texts: readonly string[]
  /** Optional — when supplied, one po_extraction_audit row is written per call. */
  audit?: AuditWriter
  inboundMessageId?: string | null
  edgeFunction?: string
  purpose?: ExtractionPurpose
  maxAttempts?: number
}

/**
 * Embed up to EMBED_BATCH_SIZE texts in one call.
 *
 * Returns vectors in input order — the caller relies on positional alignment to
 * pair a vector back to its product, so a provider that ever returned them out of
 * order would corrupt the table silently. OpenAI returns an `index` on each item;
 * this sorts by it rather than trusting arrival order.
 */
export async function embedTexts(params: EmbedParams): Promise<EmbedResult> {
  const texts = params.texts.filter(text => text.length > 0)
  if (texts.length === 0) {
    return { vectors: [], inputTokens: 0, costUsd: 0, model: EMBEDDING_MODEL }
  }
  if (texts.length > EMBED_BATCH_SIZE) {
    throw new EmbeddingError(
      `embedTexts called with ${texts.length} inputs; cap is ${EMBED_BATCH_SIZE}. Batch upstream.`,
      null,
    )
  }

  const apiKey = readApiKey()
  const maxAttempts = Math.min(Math.max(params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 1), 5)
  const startedAt = Date.now()

  let lastError: EmbeddingError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${OPENAI_BASE}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })

      const raw = await response.text()
      if (!response.ok) {
        const err = new EmbeddingError(
          `embeddings request failed (${response.status}): ${raw.slice(0, 300)}`,
          response.status,
        )
        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          lastError = err
          await backoffDelay(attempt)
          continue
        }
        throw err
      }

      const json = JSON.parse(raw) as {
        data?: Array<{ index?: number; embedding?: number[] }>
        usage?: { prompt_tokens?: number }
      }
      const rows = json.data ?? []
      if (rows.length !== texts.length) {
        throw new EmbeddingError(
          `embeddings returned ${rows.length} vectors for ${texts.length} inputs`,
          null,
        )
      }

      const vectors = [...rows]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(row => row.embedding ?? [])

      for (const vector of vectors) {
        if (vector.length !== EMBEDDING_DIMENSIONS) {
          throw new EmbeddingError(
            `embedding width ${vector.length} != ${EMBEDDING_DIMENSIONS}; refusing to store`,
            null,
          )
        }
      }

      const inputTokens = json.usage?.prompt_tokens ?? 0
      const costUsd = (inputTokens / 1_000_000) * EMBEDDING_INPUT_PER_1M

      await writeEmbedAudit(params, {
        inputTokens,
        costUsd,
        latencyMs: Date.now() - startedAt,
        success: true,
        errorMessage: null,
      })

      return { vectors, inputTokens, costUsd, model: EMBEDDING_MODEL }
    } catch (err) {
      const wrapped = err instanceof EmbeddingError
        ? err
        : new EmbeddingError(err instanceof Error ? err.message : String(err), null)
      lastError = wrapped
      // A non-HTTP failure (timeout, DNS) is worth one more try too.
      if (attempt < maxAttempts && wrapped.status === null && !/refusing to store|cap is/.test(wrapped.message)) {
        await backoffDelay(attempt)
        continue
      }
      break
    }
  }

  const failure = lastError ?? new EmbeddingError('embeddings failed for an unknown reason', null)
  await writeEmbedAudit(params, {
    inputTokens: 0,
    costUsd: 0,
    latencyMs: Date.now() - startedAt,
    success: false,
    errorMessage: failure.message,
  })
  throw failure
}

async function writeEmbedAudit(
  params: EmbedParams,
  outcome: {
    inputTokens: number
    costUsd: number
    latencyMs: number
    success: boolean
    errorMessage: string | null
  },
): Promise<void> {
  if (!params.audit) return
  try {
    const hash = await promptHash(params.texts.join('\n'))
    const { error } = await params.audit.from('po_extraction_audit').insert({
      inbound_message_id: params.inboundMessageId ?? null,
      edge_function: params.edgeFunction ?? 'embed',
      purpose: params.purpose ?? 'product_embed',
      model: EMBEDDING_MODEL,
      prompt_hash: hash || null,
      input_tokens: outcome.inputTokens,
      // Embeddings produce no completion tokens. 0 rather than NULL so a
      // SUM over the column stays honest.
      output_tokens: 0,
      latency_ms: outcome.latencyMs,
      cost_usd: Number(outcome.costUsd.toFixed(6)),
      success: outcome.success,
      error_message: outcome.errorMessage ? outcome.errorMessage.slice(0, 1000) : null,
    })
    if (error) console.warn('[embeddings] po_extraction_audit insert failed:', error)
  } catch (err) {
    // Audit must never block the caller — same rule as openai.ts.
    console.warn('[embeddings] po_extraction_audit insert threw:', err)
  }
}

/** Postgres vector literal: `[0.1,0.2,...]`. What the RPC's parameter expects. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`
}
