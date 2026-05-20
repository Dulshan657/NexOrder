// Customer + product resolution for extracted POs.
//
// Resolution order matches MVP_PLAN.md:
//
//   Customer
//     1. exact `po_customer_aliases.source_type='sender_email'` match
//     2. exact `po_customer_aliases.source_type='sender_domain'` match
//     3. exact (normalized) `po_customer_aliases.source_type='po_text'` match
//     4. exact `horecas.contact_email = lower(sender_email)` lookup
//        — deterministic; the contact_email column is user-curated on the
//        HoReCa record (added in migration 00021), so a hit is as
//        authoritative as an alias-table hit.  Sits AFTER the alias-table
//        steps so an operator-curated alias still overrides a stale
//        contact_email on the HoReCa.
//     5. AI fuzzy match against `horecas`; auto-create alias on ≥0.9
//     6. NULL — pending_po lands in needs_review
//
//   Product  (per line, scoped to the resolved customer)
//     1. exact `po_product_aliases(horeca_id, source_code)`
//     2. exact (normalized) `po_product_aliases(horeca_id, lower(source_description))`
//     3. AI fuzzy match against the customer's product catalog; alias on ≥0.9
//     4. NULL — that line forces needs_review
//
// The OpenAI fuzzy step is implemented as a constrained classifier rather
// than a free-form prompt: we hand the model the customer/product list and
// ask it to pick an index. JSON-schema mode keeps the result safe to parse.

import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizeItemCode,
  stripControlChars,
} from './normalize.ts'
import { extractStructured, type AuditWriter, type ExtractionPurpose } from './openai.ts'

// Structural interfaces for the Supabase client. We don't import supabase-js
// here so this file stays decoupled from the URL-imported SDK, but the
// shapes below cover the PostgREST query-builder surface the resolver
// actually uses. Anything outside this surface is intentionally unavailable
// so a misspelled column or wrong filter API fails to compile.
export type SupabaseQueryResult<TRow> = Promise<{
  data: TRow | null
  error: { message?: string } | null
}>
export type SupabaseListResult<TRow> = Promise<{
  data: TRow[] | null
  error: { message?: string } | null
}>
export interface SupabaseSelectBuilder<TRow> {
  eq(column: string, value: string | number): SupabaseSelectBuilder<TRow>
  order(
    column: string,
    options?: { ascending?: boolean },
  ): SupabaseSelectBuilder<TRow>
  limit(n: number): SupabaseSelectBuilder<TRow>
  maybeSingle(): SupabaseQueryResult<TRow>
  // also resolves directly for list queries
  then<TResolved>(
    onfulfilled: (value: { data: TRow[] | null; error: { message?: string } | null }) => TResolved,
  ): Promise<TResolved>
}
export interface SupabaseInsertBuilder {
  select(): Promise<{
    data: Array<{ id?: string }> | null
    error: { message?: string } | null
  }>
}
export interface SupabaseUpdateBuilder {
  eq(column: string, value: string | number): Promise<{
    error: { message?: string } | null
  }>
}
export interface SupabaseLike {
  from(table: string): {
    select(cols: string): SupabaseSelectBuilder<unknown>
    insert(row: Record<string, unknown>): SupabaseInsertBuilder
    update(row: Record<string, unknown>): SupabaseUpdateBuilder
  }
}

/** Clamp an AI-reported confidence to [0, 1]. JSON-schema strict mode
 *  should already enforce this, but a runtime guard avoids polluting the
 *  alias table on the off chance a model returns a value outside range. */
function clampConfidence(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export const CUSTOMER_AUTO_ALIAS_THRESHOLD = 0.9
export const PRODUCT_AUTO_ALIAS_THRESHOLD = 0.9

export type AliasMatchSource =
  | 'sender_email_alias'
  | 'sender_domain_alias'
  | 'po_text_alias'
  | 'horeca_contact_email'
  | 'ai_fuzzy_match'
  | 'product_code_alias'
  | 'product_desc_alias'

export interface CustomerResolution {
  horecaId: number | null
  confidence: number       // 1.0 for deterministic hits, model-reported for AI
  matchSource: AliasMatchSource | null
  /**
   * UUID of the alias row this call inserted (AI auto-create at >= threshold),
   * or null if no row was written. extract-po uses these IDs to backfill
   * `pending_po_id` on the alias row once the pending_pos row exists.
   */
  aliasInsertedId: string | null
}

export interface ProductResolution {
  productId: number | null
  defaultPackSize: number | null
  confidence: number
  matchSource: AliasMatchSource | null
  aliasInsertedId: string | null
}

// ----------------------------------------------------------------------
// Customer resolution
// ----------------------------------------------------------------------

export interface ResolveCustomerInput {
  supa: SupabaseLike
  audit: AuditWriter
  inboundMessageId: string | null
  edgeFunction: string
  fromAddress: string | null
  customerNameRaw: string | null
}

interface HoRecaRow {
  id: number
  name: string
  address: string
}

interface CustomerAliasRow {
  horeca_id: number
}

export async function resolveCustomer(
  input: ResolveCustomerInput,
): Promise<CustomerResolution> {
  const { supa } = input

  // 1. sender_email
  const senderEmail = normalizeEmail(input.fromAddress)
  if (senderEmail) {
    const hit = await fetchCustomerAlias(supa, 'sender_email', senderEmail)
    if (hit) return deterministic(hit.horeca_id, 'sender_email_alias')
  }

  // 2. sender_domain
  const domain = normalizeDomain(deriveDomain(input.fromAddress))
  if (domain) {
    const hit = await fetchCustomerAlias(supa, 'sender_domain', domain)
    if (hit) return deterministic(hit.horeca_id, 'sender_domain_alias')
  }

  // 3. po_text (normalized customer name)
  const normName = normalizeCompanyName(input.customerNameRaw)
  if (normName) {
    const hit = await fetchCustomerAlias(supa, 'po_text', normName)
    if (hit) return deterministic(hit.horeca_id, 'po_text_alias')
  }

  // 4. horecas.contact_email exact match (lower-cased). Deterministic and
  //    auditable: the column is user-curated on the HoReCa record.
  if (senderEmail) {
    const horecaId = await fetchHorecaByContactEmail(supa, senderEmail)
    if (horecaId !== null) return deterministic(horecaId, 'horeca_contact_email')
  }

  // 5. AI fuzzy match. Only fire when there is a customer name to match
  //    against — sender-only matching is best left to the alias table.
  if (!normName) return missing()

  const candidates = await fetchHoRecaCatalog(supa)
  if (candidates.length === 0) return missing()

  const ai = await aiPickCustomer({
    audit: input.audit,
    inboundMessageId: input.inboundMessageId,
    edgeFunction: input.edgeFunction,
    customerNameRaw: input.customerNameRaw ?? '',
    candidates,
  })

  if (
    ai.matchedHorecaId === null ||
    ai.confidence < CUSTOMER_AUTO_ALIAS_THRESHOLD
  ) {
    return {
      horecaId: ai.matchedHorecaId,
      confidence: ai.confidence,
      matchSource: ai.matchedHorecaId !== null ? 'ai_fuzzy_match' : null,
      aliasInsertedId: null,
    }
  }

  // High-confidence AI match → write alias for next time.
  const aliasInsertedId = await writeCustomerAlias(supa, {
    source_type: 'po_text',
    source_value: normName,
    horeca_id: ai.matchedHorecaId,
    confidence_at_creation: ai.confidence,
    // created_by NULL means "AI auto-created"; the column accepts NULL.
    created_by: null,
  })

  return {
    horecaId: ai.matchedHorecaId,
    confidence: ai.confidence,
    matchSource: 'ai_fuzzy_match',
    aliasInsertedId,
  }
}

function deterministic(
  horecaId: number,
  source: AliasMatchSource,
): CustomerResolution {
  return {
    horecaId,
    confidence: 1.0,
    matchSource: source,
    aliasInsertedId: null,
  }
}

function missing(): CustomerResolution {
  return { horecaId: null, confidence: 0, matchSource: null, aliasInsertedId: null }
}

function deriveDomain(fromAddress: string | null): string | null {
  if (!fromAddress) return null
  const at = fromAddress.lastIndexOf('@')
  if (at <= 0 || at === fromAddress.length - 1) return null
  return fromAddress.slice(at + 1)
}

async function fetchCustomerAlias(
  supa: SupabaseLike,
  sourceType: 'sender_email' | 'sender_domain' | 'po_text',
  sourceValue: string,
): Promise<CustomerAliasRow | null> {
  const result = await (supa
    .from('po_customer_aliases')
    .select('horeca_id') as unknown as SupabaseSelectBuilder<CustomerAliasRow>)
    .eq('source_type', sourceType)
    .eq('source_value', sourceValue)
    .maybeSingle()
  if (result.error) {
    console.warn('[aliasResolver] customer alias lookup failed:', result.error.message)
    return null
  }
  return result.data
}

/**
 * Look up a HoReCa whose curated contact_email matches the inbound sender.
 * Returns the HoReCa id on a unique hit, null otherwise. Note: the migration
 * 00021 index is on `lower(contact_email)`, and senderEmail is already
 * lower-cased by normalizeEmail() upstream, so an .eq() comparison hits the
 * index cleanly.
 */
async function fetchHorecaByContactEmail(
  supa: SupabaseLike,
  senderEmail: string,
): Promise<number | null> {
  const result = await (supa
    .from('horecas')
    .select('id') as unknown as SupabaseSelectBuilder<{ id: number }>)
    .eq('contact_email', senderEmail)
    .maybeSingle()
  if (result.error) {
    console.warn('[aliasResolver] horeca contact_email lookup failed:', result.error.message)
    return null
  }
  return result.data?.id ?? null
}

async function fetchHoRecaCatalog(supa: SupabaseLike): Promise<HoRecaRow[]> {
  const result = await (supa
    .from('horecas')
    .select('id, name, address') as unknown as SupabaseSelectBuilder<HoRecaRow>)
    .order('name', { ascending: true })
    .limit(500)
  if (result.error) {
    console.warn('[aliasResolver] horecas catalog fetch failed:', result.error.message)
    return []
  }
  return result.data ?? []
}

async function writeCustomerAlias(
  supa: SupabaseLike,
  row: {
    source_type: 'sender_email' | 'sender_domain' | 'po_text'
    source_value: string
    horeca_id: number
    confidence_at_creation: number
    created_by: string | null
  },
): Promise<string | null> {
  const { data, error } = await supa.from('po_customer_aliases').insert(row).select()
  if (error) {
    // Likely a race with another extraction that already wrote the same alias.
    // The unique constraint enforces idempotency; we don't surface it.
    console.warn('[aliasResolver] customer alias insert skipped:', error.message)
    return null
  }
  const inserted = Array.isArray(data) ? data[0] : null
  return inserted?.id ?? null
}

interface AiCustomerPick {
  matchedHorecaId: number | null
  confidence: number
}

const CUSTOMER_PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matched_horeca_id: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
      description: 'horeca id of the best match, or null when no candidate is convincing',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: '0.0–1.0 estimate of confidence; 0 when matched_horeca_id is null',
    },
  },
  required: ['matched_horeca_id', 'confidence'],
} as const

async function aiPickCustomer(params: {
  audit: AuditWriter
  inboundMessageId: string | null
  edgeFunction: string
  customerNameRaw: string
  candidates: HoRecaRow[]
}): Promise<AiCustomerPick> {
  // Strip control chars so a stray \t or \n in a horeca name doesn't
  // corrupt the table structure the model is asked to parse.
  const list = params.candidates
    .map(c => `${c.id}\t${stripControlChars(c.name)}\t${stripControlChars(c.address)}`)
    .join('\n')
  const result = await extractStructured<{ matched_horeca_id: number | null; confidence: number }>({
    audit: params.audit,
    inboundMessageId: params.inboundMessageId,
    edgeFunction: params.edgeFunction,
    purpose: 'customer_match' satisfies ExtractionPurpose,
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a deterministic matcher. Given a raw customer name from a purchase order ' +
          'and a tab-separated catalog of (id, name, address) candidates, pick the single best ' +
          'match. Return matched_horeca_id=null and confidence=0 if no candidate is plausibly the ' +
          'same business. Confidence is 1.0 only when the names are virtually identical; lower it ' +
          'for partial matches or ambiguous candidates.',
      },
      {
        role: 'user',
        content: `Raw customer name from PO: ${JSON.stringify(params.customerNameRaw)}\n\nCandidates:\nid\tname\taddress\n${list}`,
      },
    ],
    jsonSchema: {
      name: 'customer_pick',
      schema: CUSTOMER_PICK_SCHEMA,
      strict: true,
    },
  })

  return {
    matchedHorecaId: result.data.matched_horeca_id ?? null,
    confidence: clampConfidence(result.data.confidence),
  }
}

// ----------------------------------------------------------------------
// Product resolution
// ----------------------------------------------------------------------

export interface ResolveProductInput {
  supa: SupabaseLike
  audit: AuditWriter
  inboundMessageId: string | null
  edgeFunction: string
  horecaId: number
  itemCodeRaw: string | null
  descriptionRaw: string | null
}

interface ProductAliasRow {
  product_id: number
  default_pack_size: number | null
}

interface ProductRow {
  id: number
  sku: string
  name: string
  carton_size: number
}

export async function resolveProduct(
  input: ResolveProductInput,
): Promise<ProductResolution> {
  const { supa } = input

  // 1. exact item-code alias
  const code = normalizeItemCode(input.itemCodeRaw)
  if (code) {
    const hit = await fetchProductAliasByCode(supa, input.horecaId, code)
    if (hit) return deterministicProduct(hit, 'product_code_alias')
  }

  // 2. exact normalized-description alias
  const desc = normalizeCompanyName(input.descriptionRaw)
  if (desc) {
    const hit = await fetchProductAliasByDesc(supa, input.horecaId, desc)
    if (hit) return deterministicProduct(hit, 'product_desc_alias')
  }

  // 3. AI fuzzy match. Skip when we have neither a code nor a description.
  if (!code && !desc) return missingProduct()

  const catalog = await fetchProductCatalog(supa)
  if (catalog.length === 0) return missingProduct()

  const ai = await aiPickProduct({
    audit: input.audit,
    inboundMessageId: input.inboundMessageId,
    edgeFunction: input.edgeFunction,
    itemCodeRaw: input.itemCodeRaw ?? '',
    descriptionRaw: input.descriptionRaw ?? '',
    candidates: catalog,
  })

  if (
    ai.matchedProductId === null ||
    ai.confidence < PRODUCT_AUTO_ALIAS_THRESHOLD
  ) {
    return {
      productId: ai.matchedProductId,
      defaultPackSize: null,
      confidence: ai.confidence,
      matchSource: ai.matchedProductId !== null ? 'ai_fuzzy_match' : null,
      aliasInsertedId: null,
    }
  }

  // High-confidence AI match → write the alias for this customer.
  const aliasInsertedId = await writeProductAlias(supa, {
    horeca_id: input.horecaId,
    source_code: code || null,
    source_description: desc || null,
    product_id: ai.matchedProductId,
    default_pack_size: ai.defaultPackSize,
    confidence_at_creation: ai.confidence,
    created_by: null,
  })

  return {
    productId: ai.matchedProductId,
    defaultPackSize: ai.defaultPackSize,
    confidence: ai.confidence,
    matchSource: 'ai_fuzzy_match',
    aliasInsertedId,
  }
}

function deterministicProduct(
  row: ProductAliasRow,
  source: AliasMatchSource,
): ProductResolution {
  return {
    productId: row.product_id,
    defaultPackSize: row.default_pack_size,
    confidence: 1.0,
    matchSource: source,
    aliasInsertedId: null,
  }
}

function missingProduct(): ProductResolution {
  return {
    productId: null,
    defaultPackSize: null,
    confidence: 0,
    matchSource: null,
    aliasInsertedId: null,
  }
}

async function fetchProductAliasByCode(
  supa: SupabaseLike,
  horecaId: number,
  code: string,
): Promise<ProductAliasRow | null> {
  const result = await (supa
    .from('po_product_aliases')
    .select('product_id, default_pack_size') as unknown as SupabaseSelectBuilder<ProductAliasRow>)
    .eq('horeca_id', horecaId)
    .eq('source_code', code)
    .maybeSingle()
  if (result.error) {
    console.warn('[aliasResolver] product code lookup failed:', result.error.message)
    return null
  }
  return result.data
}

async function fetchProductAliasByDesc(
  supa: SupabaseLike,
  horecaId: number,
  desc: string,
): Promise<ProductAliasRow | null> {
  // Use .eq() not .ilike() — desc is already lowercased + de-punctuated by
  // normalizeCompanyName, and ilike would interpret % / _ as wildcards
  // which would match unrelated products (e.g., "50% milk blend" -> any).
  const result = await (supa
    .from('po_product_aliases')
    .select('product_id, default_pack_size') as unknown as SupabaseSelectBuilder<ProductAliasRow>)
    .eq('horeca_id', horecaId)
    .eq('source_description', desc)
    .maybeSingle()
  if (result.error) {
    console.warn('[aliasResolver] product desc lookup failed:', result.error.message)
    return null
  }
  return result.data
}

async function fetchProductCatalog(supa: SupabaseLike): Promise<ProductRow[]> {
  // MVP scope: products are universal in NexOrder (no per-customer
  // catalog enforcement at the schema layer). Send all up to 500. The
  // alias write is still scoped to horeca_id, so a customer-A match
  // never affects customer-B's deterministic resolution.
  // Phase 2 polish: scope by horeca_pricing or pantry_items.
  const result = await (supa
    .from('products')
    .select('id, sku, name, carton_size') as unknown as SupabaseSelectBuilder<ProductRow>)
    .order('name', { ascending: true })
    .limit(500)
  if (result.error) {
    console.warn('[aliasResolver] product catalog fetch failed:', result.error.message)
    return []
  }
  return result.data ?? []
}

/**
 * Backfill pending_po_id on alias rows that were auto-inserted during this
 * extraction. The resolver writes alias rows BEFORE the pending_pos row
 * exists (the FK would otherwise fail), so extract-po calls this immediately
 * after persisting the pending_pos row to stamp the origin link. Failures
 * are logged-but-swallowed: a missing origin link is cosmetic only, the
 * alias itself still functions for future lookups.
 */
export async function backfillAliasOrigin(
  supa: SupabaseLike,
  pendingPoId: string,
  customerAliasIds: ReadonlyArray<string>,
  productAliasIds: ReadonlyArray<string>,
): Promise<void> {
  for (const id of customerAliasIds) {
    if (!id) continue
    const { error } = await supa
      .from('po_customer_aliases')
      .update({ pending_po_id: pendingPoId })
      .eq('id', id)
    if (error) {
      console.warn(
        '[aliasResolver] customer alias origin backfill failed:',
        error.message,
      )
    }
  }
  for (const id of productAliasIds) {
    if (!id) continue
    const { error } = await supa
      .from('po_product_aliases')
      .update({ pending_po_id: pendingPoId })
      .eq('id', id)
    if (error) {
      console.warn(
        '[aliasResolver] product alias origin backfill failed:',
        error.message,
      )
    }
  }
}

async function writeProductAlias(
  supa: SupabaseLike,
  row: {
    horeca_id: number
    source_code: string | null
    source_description: string | null
    product_id: number
    default_pack_size: number | null
    confidence_at_creation: number
    created_by: string | null
  },
): Promise<string | null> {
  const { data, error } = await supa.from('po_product_aliases').insert(row).select()
  if (error) {
    console.warn('[aliasResolver] product alias insert skipped:', error.message)
    return null
  }
  const inserted = Array.isArray(data) ? data[0] : null
  return inserted?.id ?? null
}

interface AiProductPick {
  matchedProductId: number | null
  defaultPackSize: number | null
  confidence: number
}

const PRODUCT_PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matched_product_id: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
      description: 'product id of the best match, or null when no candidate is convincing',
    },
    default_pack_size: {
      anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
      description: 'pack size to remember for next time, or null',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
  },
  required: ['matched_product_id', 'default_pack_size', 'confidence'],
} as const

async function aiPickProduct(params: {
  audit: AuditWriter
  inboundMessageId: string | null
  edgeFunction: string
  itemCodeRaw: string
  descriptionRaw: string
  candidates: ProductRow[]
}): Promise<AiProductPick> {
  const list = params.candidates
    .map(p => `${p.id}\t${stripControlChars(p.sku)}\t${stripControlChars(p.name)}\tcarton:${p.carton_size}`)
    .join('\n')
  const result = await extractStructured<{
    matched_product_id: number | null
    default_pack_size: number | null
    confidence: number
  }>({
    audit: params.audit,
    inboundMessageId: params.inboundMessageId,
    edgeFunction: params.edgeFunction,
    purpose: 'product_match' satisfies ExtractionPurpose,
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a deterministic matcher. Pick the single best product from the catalog ' +
          'that the PO line is asking for. Use both the item code and the free-text description ' +
          'when present; do not match on partial keyword overlap alone. Return matched_product_id=null ' +
          'and confidence=0 when no candidate is plausibly the same product.',
      },
      {
        role: 'user',
        content:
          `PO line item code: ${JSON.stringify(params.itemCodeRaw)}\n` +
          `PO line description: ${JSON.stringify(params.descriptionRaw)}\n\n` +
          `Catalog:\nid\tsku\tname\tcarton_size\n${list}`,
      },
    ],
    jsonSchema: {
      name: 'product_pick',
      schema: PRODUCT_PICK_SCHEMA,
      strict: true,
    },
  })

  return {
    matchedProductId: result.data.matched_product_id ?? null,
    defaultPackSize: result.data.default_pack_size ?? null,
    confidence: clampConfidence(result.data.confidence),
  }
}
