// embed-products Edge Function
//
// Keeps public.product_embeddings (mig 00089) in step with the catalog so
// aliasResolver can shortlist candidates for an unmatched PO line instead of
// handing the model all 500 rows it is capped at today.
//
// Idempotent by content hash. Every product's embed text is hashed with the same
// `productEmbedText`/`productEmbedHash` the table was written with, and only rows
// whose hash differs (or are missing entirely) are sent to OpenAI. Running this
// twice in a row therefore embeds zero rows and costs nothing — which is the
// property that makes it safe to attach to a cron.
//
// AUTH. verify_jwt = false in config.toml, because the callers are pg_cron and
// server-to-server invocations holding the service-role key (sb_secret_*, which
// is not JWT-format and the platform gateway would 401). The in-body gate below
// is therefore the ONLY thing standing in front of this function — never remove
// it, and never add the config.toml entry without it.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { isAuthorizedCronCall, isServiceRoleCall } from '../_shared/cronToken.ts'
import {
  EMBEDDING_MODEL,
  EMBED_BATCH_SIZE,
  embedTexts,
  productEmbedHash,
  productEmbedText,
  toVectorLiteral,
} from '../_shared/poInbox/embeddings.ts'

const inputSchema = z.object({
  /** Cap the work in one invocation. Absent = every stale product. */
  limit: z.number().int().positive().max(5000).optional(),
  /** Report what would be embedded without calling OpenAI or writing. */
  dry_run: z.boolean().optional(),
  /** Re-embed everything even if the hash matches — after a model change. */
  force: z.boolean().optional(),
})

interface ProductRow {
  id: number
  sku: string | null
  name: string | null
  category: string | null
}

interface ExistingRow {
  product_id: number
  content_hash: string
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // The gate. A cron token OR the service-role key; nothing else gets in.
    const authHeader = req.headers.get('Authorization')
    const authorized =
      isServiceRoleCall(authHeader) ||
      isAuthorizedCronCall(authHeader, 'EMBED_PRODUCTS_CRON_TOKEN')
    if (!authorized) {
      throw new EdgeFunctionError('UNAUTHORIZED', 'This function requires a service-role or cron token')
    }

    const body = await req.json().catch(() => ({}))
    const parsed = inputSchema.safeParse(body ?? {})
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const { limit, dry_run: dryRun, force } = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    // Active products only: an embedding for a retired product would keep being
    // returned as a candidate by match_products, which filters on is_active too.
    const { data: products, error: productsError } = await admin
      .from('products')
      .select('id, sku, name, category')
      .not('is_active', 'is', false)
      .order('id', { ascending: true })
    if (productsError) {
      throw new EdgeFunctionError('INTERNAL', `product fetch failed: ${productsError.message}`)
    }

    const { data: existing, error: existingError } = await admin
      .from('product_embeddings')
      .select('product_id, content_hash')
    if (existingError) {
      throw new EdgeFunctionError('INTERNAL', `embedding fetch failed: ${existingError.message}`)
    }

    const knownHash = new Map<number, string>(
      ((existing ?? []) as ExistingRow[]).map(row => [row.product_id, row.content_hash]),
    )

    // Decide staleness with the same function that produced the stored hash.
    const stale: Array<{ product: ProductRow; text: string; hash: string }> = []
    for (const product of ((products ?? []) as ProductRow[])) {
      const text = productEmbedText(product)
      // A product with no sku, name or category has nothing to embed. Skip rather
      // than store a vector for the empty string, which would match everything.
      if (!text) continue
      const hash = await productEmbedHash(product)
      if (!force && knownHash.get(product.id) === hash) continue
      stale.push({ product, text, hash })
    }

    const targeted = typeof limit === 'number' ? stale.slice(0, limit) : stale
    const skippedByLimit = stale.length - targeted.length

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        model: EMBEDDING_MODEL,
        products_active: (products ?? []).length,
        already_current: (products ?? []).length - stale.length,
        stale: stale.length,
        would_embed: targeted.length,
        skipped_by_limit: skippedByLimit,
      }, corsHeaders)
    }

    let embedded = 0
    let inputTokens = 0
    let costUsd = 0

    for (let offset = 0; offset < targeted.length; offset += EMBED_BATCH_SIZE) {
      const batch = targeted.slice(offset, offset + EMBED_BATCH_SIZE)
      const result = await embedTexts({
        texts: batch.map(row => row.text),
        audit: admin as any,
        edgeFunction: 'embed-products',
        purpose: 'product_embed',
      })
      inputTokens += result.inputTokens
      costUsd += result.costUsd

      // Positional alignment: embedTexts sorts by the provider's `index`, so
      // vectors[i] belongs to batch[i]. Asserted rather than assumed.
      if (result.vectors.length !== batch.length) {
        throw new EdgeFunctionError(
          'INTERNAL',
          `embedding count ${result.vectors.length} != batch ${batch.length}`,
        )
      }

      const rows = batch.map((row, index) => ({
        product_id: row.product.id,
        content_hash: row.hash,
        embedding: toVectorLiteral(result.vectors[index]),
        model: result.model,
        updated_at: new Date().toISOString(),
      }))

      const { error: upsertError } = await admin
        .from('product_embeddings')
        .upsert(rows, { onConflict: 'product_id' })
      if (upsertError) {
        throw new EdgeFunctionError('INTERNAL', `embedding upsert failed: ${upsertError.message}`)
      }
      embedded += rows.length
    }

    // Drop embeddings for products that are gone or retired. The FK cascade covers
    // deletion; this covers deactivation, which no constraint can see.
    const activeIds = new Set(((products ?? []) as ProductRow[]).map(row => row.id))
    const orphanIds = [...knownHash.keys()].filter(id => !activeIds.has(id))
    if (orphanIds.length > 0) {
      const { error: deleteError } = await admin
        .from('product_embeddings')
        .delete()
        .in('product_id', orphanIds)
      if (deleteError) {
        // Not fatal: a stale vector for a retired product is filtered out by
        // match_products anyway, so report it rather than failing the run.
        console.warn('[embed-products] orphan cleanup failed:', deleteError.message)
      }
    }

    return json({
      ok: true,
      model: EMBEDDING_MODEL,
      products_active: (products ?? []).length,
      embedded,
      already_current: (products ?? []).length - stale.length,
      skipped_by_limit: skippedByLimit,
      orphans_removed: orphanIds.length,
      input_tokens: inputTokens,
      cost_usd: Number(costUsd.toFixed(6)),
    }, corsHeaders)
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

function json(payload: unknown, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
