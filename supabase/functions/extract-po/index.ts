// extract-po Edge Function
//
// Service-role-only (called by poll-inbox or by an admin retry tool).
// Takes one inbound_message_id and runs the extraction pipeline:
//
//   1. Load inbound_messages + originals from Storage
//   2. Classify is-this-a-PO via gpt-4o-mini
//   3. If yes, extract fields:
//        PDF        -> gpt-4o (vision/file_data)
//        DOCX       -> mammoth -> text -> gpt-4o-mini
//        Image      -> gpt-4o (vision)
//        Body only  -> gpt-4o-mini
//   4. Resolve customer + each line's product via aliasResolver
//   5. Decide auto_approved vs needs_review, write pending_pos
//   6. If auto_approved, fire-and-forget approve-po
//
// Idempotency: pending_pos has UNIQUE(inbound_message_id). Re-running
// this function on the same row no-ops by detecting the existing row.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import mammoth from 'npm:mammoth@1.8.0'

import { corsHeadersFor } from '../_shared/cors.ts'
import { sanitizeForLog } from '../_shared/poInbox/env.ts'
import { fireAndForget, isServiceRoleBearer } from '../_shared/poInbox/dispatch.ts'
import {
  extractStructured,
  type AuditWriter,
  type ChatMessage,
} from '../_shared/poInbox/openai.ts'
import {
  EXTRACT_PO_SCHEMA,
  EXTRACT_PO_SYSTEM_PROMPT,
  type ExtractedPo,
  IS_PO_SCHEMA,
  type IsPoResult,
} from '../_shared/poInbox/extractionSchema.ts'
import {
  AUTO_APPROVE_CONFIDENCE_THRESHOLD,
  decidePendingPoStatus,
} from '../_shared/poInbox/statusDecision.ts'
import {
  backfillAliasOrigin,
  resolveCustomer,
  resolveProduct,
  type SupabaseLike,
} from '../_shared/poInbox/aliasResolver.ts'
import { detectSenderMismatch } from '../_shared/poInbox/senderTrust.ts'
import { selectAttachments, type AttachmentMeta } from '../_shared/poInbox/attachmentSelect.ts'

interface ExtractRequest {
  inboundMessageId: string
}

/**
 * Read the auto-approval policy toggles from the singleton app_settings row
 * (mig 00044). Fails open to the historical always-on behaviour (both true) if
 * the row or columns are missing.
 */
async function loadAutoApprovePolicy(
  supa: SupabaseClient,
): Promise<{ enabled: boolean; blockOnSenderMismatch: boolean }> {
  const { data, error } = await supa
    .from('app_settings')
    .select('po_auto_approve_enabled, po_auto_approve_block_on_sender_mismatch')
    .eq('id', 1)
    .single()
  if (error || !data) return { enabled: true, blockOnSenderMismatch: true }
  return {
    enabled: (data as any).po_auto_approve_enabled !== false,
    blockOnSenderMismatch: (data as any).po_auto_approve_block_on_sender_mismatch !== false,
  }
}

const ARCHIVE_BUCKET = 'po-archive'
const FETCH_TIMEOUT_MS = 15_000

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return json({ error: { code: 'INVALID_INPUT', message: 'POST only' } }, 405, corsHeaders)
  }

  if (!isServiceRoleAuth(req)) {
    return json(
      { error: { code: 'UNAUTHORIZED', message: 'service_role required' } },
      401,
      corsHeaders,
    )
  }

  let body: ExtractRequest
  try {
    body = await req.json()
  } catch {
    return json({ error: { code: 'INVALID_INPUT', message: 'Body must be JSON' } }, 400, corsHeaders)
  }
  if (!body.inboundMessageId || typeof body.inboundMessageId !== 'string') {
    return json(
      { error: { code: 'INVALID_INPUT', message: 'inboundMessageId required' } },
      400,
      corsHeaders,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  try {
    const result = await runExtraction(serviceClient, body.inboundMessageId)
    if (result.kind === 'auto_approved') {
      dispatchApprove(supabaseUrl, serviceKey, result.pendingPoId)
    }
    return json({ ok: true, ...result }, 200, corsHeaders)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[extract-po] failed:', sanitizeForLog(message))
    await markInboundFailed(serviceClient, body.inboundMessageId, message)
    return json(
      { error: { code: 'INTERNAL', message: 'Extraction failed' } },
      500,
      corsHeaders,
    )
  }
})

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// extract-po is invoked only by poll-inbox (or by an operator retry tool
// running with the service-role key). It does not use _shared/auth.ts'
// requireAuth — that helper needs a user JWT + profiles lookup, which is
// inappropriate for a service-to-service call.
function isServiceRoleAuth(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!expected) return false
  return isServiceRoleBearer(req.headers.get('Authorization'), expected)
}

interface InboundMessageRow {
  id: string
  email_account_id: string
  from_address: string
  subject: string | null
  storage_path_prefix: string
  processing_status: string
}

type ExtractionOutcome =
  | { kind: 'skipped_not_po'; reason: string }
  | { kind: 'already_extracted'; pendingPoId: string }
  | { kind: 'needs_review'; pendingPoId: string }
  | { kind: 'auto_approved'; pendingPoId: string }

async function runExtraction(
  serviceClient: SupabaseClient,
  inboundMessageId: string,
): Promise<ExtractionOutcome> {
  // 1. Load + claim the message
  const message = await loadInboundMessage(serviceClient, inboundMessageId)

  // Already-processed short-circuit (idempotency)
  const existing = await loadExistingPendingPo(serviceClient, inboundMessageId)
  if (existing) {
    return { kind: 'already_extracted', pendingPoId: existing.id }
  }

  await updateInboundStatus(serviceClient, inboundMessageId, 'extracting')

  // 2. Load original payload + attachments from Storage
  const docs = await loadDocuments(serviceClient, message)

  const auditWriter = serviceClient as unknown as AuditWriter

  // 3. Classify
  const isPo = await classifyIsPurchaseOrder({
    audit: auditWriter,
    inboundMessageId,
    docs,
  })

  if (!isPo.is_purchase_order) {
    await updateInboundStatus(serviceClient, inboundMessageId, 'skipped_not_po', {
      classification_reason: isPo.classification_reason,
    })
    return { kind: 'skipped_not_po', reason: isPo.classification_reason }
  }

  // 4. Extract structured fields
  const extracted = await extractPoFields({
    audit: auditWriter,
    inboundMessageId,
    docs,
  })

  // 5. Resolve customer + each line product
  const customerResolution = await resolveCustomer({
    supa: serviceClient as unknown as SupabaseLike,
    audit: auditWriter,
    inboundMessageId,
    edgeFunction: 'extract-po',
    fromAddress: message.from_address || null,
    customerNameRaw: extracted.customer_name_raw,
  })

  const matchedItems: Array<{
    po_line_index: number
    product_id: number | null
    quantity: number
    pack_size: number | null
    confidence: number
  }> = []

  const productAliasInsertedIds: string[] = []
  if (customerResolution.horecaId !== null) {
    for (let i = 0; i < extracted.lines.length; i++) {
      const line = extracted.lines[i]
      const product = await resolveProduct({
        supa: serviceClient as unknown as SupabaseLike,
        audit: auditWriter,
        inboundMessageId,
        edgeFunction: 'extract-po',
        horecaId: customerResolution.horecaId,
        itemCodeRaw: line.item_code_raw,
        descriptionRaw: line.description_raw,
      })
      if (product.aliasInsertedId) productAliasInsertedIds.push(product.aliasInsertedId)
      matchedItems.push({
        po_line_index: i,
        product_id: product.productId,
        quantity: line.quantity,
        pack_size: product.defaultPackSize ?? line.pack_size_raw ?? null,
        confidence: product.confidence,
      })
    }
  } else {
    // No customer match -> we can't resolve products either (per-customer aliases).
    for (let i = 0; i < extracted.lines.length; i++) {
      matchedItems.push({
        po_line_index: i,
        product_id: null,
        quantity: extracted.lines[i].quantity,
        pack_size: extracted.lines[i].pack_size_raw ?? null,
        confidence: 0,
      })
    }
  }

  // 5b. Sender / customer mismatch (anti-spoofing). Only meaningful once a
  //     customer is resolved: does the inbound sender belong to that
  //     customer? A mismatch forces human review and never auto-approves.
  const senderTrust = customerResolution.horecaId !== null
    ? await detectSenderMismatch({
        supa: serviceClient as unknown as SupabaseLike,
        fromAddress: message.from_address || null,
        horecaId: customerResolution.horecaId,
      })
    : { flagged: false, sender: null }

  // 5c. Auto-approval policy (app_settings, mig 00044). Missing row/columns ⇒
  //     default true (historical always-on behaviour).
  const autoApprovePolicy = await loadAutoApprovePolicy(serviceClient)

  // 6. Decide status
  const decision = decidePendingPoStatus({
    confidence: extracted.confidence,
    customerResolved: customerResolution.horecaId !== null,
    allLinesResolved:
      matchedItems.length > 0 && matchedItems.every(m => m.product_id !== null),
    senderMismatch: senderTrust.flagged,
    autoApproveEnabled: autoApprovePolicy.enabled,
    blockOnSenderMismatch: autoApprovePolicy.blockOnSenderMismatch,
  })

  // 7. Persist the pending_pos row
  const standardized = {
    ...extracted,
    source: {
      channel: 'email',
      format: docs.primaryFormat,
      original_filename: docs.primaryFilename,
      message_id: inboundMessageId,
      received_at: new Date().toISOString(),
    },
    extraction: {
      model: 'gpt-4o',
      extracted_at: new Date().toISOString(),
      confidence_overall: decision.confidenceOverall,
    },
  }

  // All rows start as 'needs_review' regardless of decision.status.
  // approve-po atomically flips the status to 'approved' (human path) or
  // 'auto_approved' (auto path) when it creates the order. Routing the
  // decision through the auto-approval fire-and-forget below keeps the
  // pending_pos status state-machine driven by approve-po, eliminating a
  // window where 'auto_approved' could be observed without an
  // approved_order_id.
  const { data: pending, error: insertError } = await serviceClient
    .from('pending_pos')
    .insert({
      inbound_message_id: inboundMessageId,
      extracted_po: standardized,
      confidence_overall: decision.confidenceOverall,
      confidence_fields: {
        per_field: extracted.confidence,
        gating_reasons: decision.reason,
        customer_match: customerResolution.matchSource,
        ...(senderTrust.flagged
          ? {
              sender_mismatch: {
                flagged: true,
                sender: senderTrust.sender,
                horeca_id: customerResolution.horecaId,
              },
            }
          : {}),
      },
      matched_horeca_id: customerResolution.horecaId,
      matched_items: matchedItems,
      status: 'needs_review',
    })
    .select('id')
    .single()
  if (insertError || !pending) {
    throw new Error(`pending_pos insert: ${insertError?.message ?? 'no row returned'}`)
  }
  const pendingPoId = (pending as { id: string }).id

  // Backfill pending_po_id on any aliases this extraction auto-created.
  // The resolver writes alias rows BEFORE pending_pos exists (FK would fail);
  // origin tracing stamps the link now that pendingPoId is known.
  await backfillAliasOrigin(
    serviceClient as unknown as SupabaseLike,
    pendingPoId,
    customerResolution.aliasInsertedId ? [customerResolution.aliasInsertedId] : [],
    productAliasInsertedIds,
  )

  await updateInboundStatus(serviceClient, inboundMessageId, 'extracted')

  if (decision.status === 'auto_approved') {
    return { kind: 'auto_approved', pendingPoId }
  }
  return { kind: 'needs_review', pendingPoId }
}

async function loadInboundMessage(
  serviceClient: SupabaseClient,
  id: string,
): Promise<InboundMessageRow> {
  const { data, error } = await serviceClient
    .from('inbound_messages')
    .select('id, email_account_id, from_address, subject, storage_path_prefix, processing_status')
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`inbound_messages not found: ${id}`)
  return data as InboundMessageRow
}

async function loadExistingPendingPo(
  serviceClient: SupabaseClient,
  inboundMessageId: string,
): Promise<{ id: string } | null> {
  const { data } = await serviceClient
    .from('pending_pos')
    .select('id')
    .eq('inbound_message_id', inboundMessageId)
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

async function updateInboundStatus(
  serviceClient: SupabaseClient,
  id: string,
  status: 'queued' | 'extracting' | 'extracted' | 'failed' | 'skipped_not_po',
  extra: Record<string, unknown> = {},
): Promise<void> {
  const payload: Record<string, unknown> = {
    processing_status: status,
    updated_at: new Date().toISOString(),
    ...extra,
  }
  const { error } = await serviceClient
    .from('inbound_messages')
    .update(payload)
    .eq('id', id)
  if (error) {
    console.warn(`[extract-po] failed to set inbound status=${status}:`, error.message)
  }
}

async function markInboundFailed(
  serviceClient: SupabaseClient,
  id: string,
  message: string,
): Promise<void> {
  const truncated = message.length > 500 ? `${message.slice(0, 500)}…` : message
  await updateInboundStatus(serviceClient, id, 'failed', {
    failure_reason: truncated,
  })
}

interface LoadedDocuments {
  /** Plain text content (email body, or extracted from a DOCX). */
  bodyText: string | null
  /** PDF bytes if there is exactly one PDF attachment. */
  pdf: { bytes: Uint8Array; filename: string } | null
  /** Image bytes (JPG/PNG/etc) if there is exactly one image attachment. */
  image: { bytes: Uint8Array; mimeType: string; filename: string } | null
  /** Diagnostics for the standardized PO source field. */
  primaryFormat: 'pdf' | 'docx' | 'text' | 'image'
  primaryFilename: string | null
}

interface ArchiveEnvelope {
  bodyText?: string | null
  bodyHtml?: string | null
  // poll-inbox writes a manifest of stored attachments (storedName + inline +
  // size). Older archives may carry only the provider refs (no storedName);
  // loadDocuments falls back to listing storage in that case.
  attachments?: Array<{
    storedName?: string
    filename?: string
    mimeType?: string
    size?: number
    inline?: boolean
  }>
}

async function loadDocuments(
  serviceClient: SupabaseClient,
  message: InboundMessageRow,
): Promise<LoadedDocuments> {
  const prefix = message.storage_path_prefix.replace(/^po-archive\//, '')
  const originalPath = `${prefix}/original.json`
  const { data: originalBlob, error: originalError } = await serviceClient.storage
    .from(ARCHIVE_BUCKET)
    .download(originalPath)
  if (originalError || !originalBlob) {
    throw new Error(`original.json not found at ${originalPath}: ${originalError?.message}`)
  }

  let envelope: ArchiveEnvelope = {}
  try {
    envelope = JSON.parse(await originalBlob.text())
  } catch {
    // Some providers stuff non-envelope JSON into original; treat as
    // empty envelope and rely on attachments only.
    envelope = {}
  }

  // Build the attachment manifest. Prefer the persisted manifest written by
  // poll-inbox (carries storedName + inline + size); fall back to listing
  // storage for older archives that predate the manifest. In the fallback,
  // inline is unknown but the signature heuristic (filename/size/gif) still
  // demotes most signatures — which is what lets reprocessing fix old rows.
  const manifest = await buildAttachmentManifest(serviceClient, prefix, envelope)

  // Choose the primary document with a deliberate precedence — a real
  // attachment always beats an inline signature/logo image (see
  // _shared/poInbox/attachmentSelect.ts).
  const sel = selectAttachments(manifest)

  const download = async (storedName: string): Promise<Blob | null> => {
    const { data: blob, error: blobError } = await serviceClient.storage
      .from(ARCHIVE_BUCKET)
      .download(`${prefix}/${storedName}`)
    if (blobError || !blob) {
      console.warn(`[extract-po] could not download ${prefix}/${storedName}:`, blobError?.message)
      return null
    }
    return blob
  }

  let pdf: LoadedDocuments['pdf'] = null
  let image: LoadedDocuments['image'] = null
  let docxText: string | null = null
  let primaryFormat: LoadedDocuments['primaryFormat'] = 'text'
  let primaryFilename: string | null = null

  if (sel.pdf) {
    const blob = await download(sel.pdf.storedName)
    if (blob) {
      pdf = { bytes: new Uint8Array(await blob.arrayBuffer()), filename: sel.pdf.storedName }
      primaryFormat = 'pdf'
      primaryFilename = sel.pdf.storedName
    }
  }

  if (sel.docx) {
    const blob = await download(sel.docx.storedName)
    if (blob) {
      // Mammoth's options.buffer is forwarded to JSZip.loadAsync (accepts
      // Uint8Array), sidestepping Deno's spotty Node-Buffer polyfill.
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const result = await mammoth.extractRawText({ buffer: bytes })
        docxText = result.value
        if (primaryFormat === 'text') {
          primaryFormat = 'docx'
          primaryFilename = sel.docx.storedName
        }
      } catch (err) {
        console.warn(
          `[extract-po] mammoth failed on ${sel.docx.storedName}:`,
          sanitizeForLog(err instanceof Error ? err.message : String(err)),
        )
      }
    }
  }

  // A genuine (non-signature) image is the primary only when there's no PDF.
  if (sel.image && !pdf) {
    const blob = await download(sel.image.storedName)
    if (blob) {
      image = {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mimeType: (blob.type || sel.image.mimeType || '').toLowerCase(),
        filename: sel.image.storedName,
      }
      if (primaryFormat === 'text' || primaryFormat === 'docx') {
        primaryFormat = 'image'
        primaryFilename = sel.image.storedName
      }
    }
  }

  const bodyText = envelope.bodyText ?? null
  const combinedText = [docxText, bodyText].filter(Boolean).join('\n\n').trim() || null

  // Last resort: an email that is ONLY a signature/inline image (no real
  // attachment and no text) still needs *something* to extract from.
  if (!pdf && !image && !combinedText && sel.weakImage) {
    const blob = await download(sel.weakImage.storedName)
    if (blob) {
      image = {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mimeType: (blob.type || sel.weakImage.mimeType || '').toLowerCase(),
        filename: sel.weakImage.storedName,
      }
      primaryFormat = 'image'
      primaryFilename = sel.weakImage.storedName
    }
  }

  return {
    bodyText: combinedText,
    pdf,
    image,
    primaryFormat,
    primaryFilename,
  }
}

/**
 * Resolve the stored-attachment manifest for a message. Uses the manifest
 * persisted in original.json when present (storedName + inline + size), else
 * lists the storage prefix (older archives — inline unknown, classification
 * falls back to filename/size/mime heuristics).
 */
async function buildAttachmentManifest(
  serviceClient: SupabaseClient,
  prefix: string,
  envelope: ArchiveEnvelope,
): Promise<AttachmentMeta[]> {
  const persisted = Array.isArray(envelope.attachments) ? envelope.attachments : []
  const hasManifest = persisted.length > 0 && persisted.every(a => typeof a?.storedName === 'string')
  if (hasManifest) {
    return persisted
      .map(a => ({
        storedName: a.storedName as string,
        filename: a.filename ?? (a.storedName as string),
        mimeType: a.mimeType ?? '',
        size: typeof a.size === 'number' ? a.size : 0,
        inline: a.inline === true,
      }))
      .sort((x, y) => x.storedName.localeCompare(y.storedName))
  }

  const { data: listing, error: listError } = await serviceClient.storage
    .from(ARCHIVE_BUCKET)
    .list(prefix)
  if (listError) {
    throw new Error(`storage list ${prefix}: ${listError.message}`)
  }
  return (listing ?? [])
    .filter(entry => entry.name && entry.name !== 'original.json')
    .map(entry => {
      const meta = (entry.metadata ?? {}) as { size?: number; mimetype?: string }
      return {
        storedName: entry.name,
        filename: entry.name,
        mimeType: (meta.mimetype ?? '').toLowerCase(),
        size: typeof meta.size === 'number' ? meta.size : 0,
        inline: false,
      }
    })
    .sort((x, y) => x.storedName.localeCompare(y.storedName))
}

async function classifyIsPurchaseOrder(params: {
  audit: AuditWriter
  inboundMessageId: string
  docs: LoadedDocuments
}): Promise<IsPoResult> {
  // Use the cheapest signal first: the email body or DOCX text. PDFs and
  // images are sent to the expensive extractor only when classification
  // returns is_purchase_order=true. If there's no text, we use a single
  // OCR-light prompt sentence to ask the model whether the attachment
  // looks like a PO.
  const userParts: Array<{ type: 'text'; text: string }> = [
    {
      type: 'text',
      text:
        params.docs.bodyText
          ? `Email body / document text:\n\n${params.docs.bodyText.slice(0, 8_000)}`
          : 'No textual body — the email only has an attachment. Treat that as a likely PO if the format is PDF/DOCX/image.',
    },
  ]
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You classify inbound emails as purchase orders or not. ' +
        'A purchase order is a request from a customer asking the recipient to supply goods. ' +
        'Newsletters, signatures, auto-replies, internal notes, and marketing are NOT POs. ' +
        'Reply strictly per the JSON schema.',
    },
    { role: 'user', content: userParts },
  ]

  const result = await extractStructured<IsPoResult>({
    audit: params.audit,
    inboundMessageId: params.inboundMessageId,
    edgeFunction: 'extract-po',
    purpose: 'classify_is_po',
    model: 'gpt-4o-mini',
    messages,
    jsonSchema: { name: 'is_po', schema: IS_PO_SCHEMA, strict: true },
  })
  return result.data
}

async function extractPoFields(params: {
  audit: AuditWriter
  inboundMessageId: string
  docs: LoadedDocuments
}): Promise<ExtractedPo> {
  const userParts: Array<{
    type: 'text' | 'image_url' | 'file'
    text?: string
    image_url?: { url: string }
    file?: { filename: string; file_data: string }
  }> = []

  if (params.docs.pdf) {
    // OpenAI Chat Completions accepts inline PDFs via a `file` content
    // part with a data URL. The previous `input_file` shape belongs to
    // the newer Responses API and is rejected here (HTTP 400).
    const b64 = bytesToBase64(params.docs.pdf.bytes)
    userParts.push({ type: 'text', text: 'The purchase order is in the attached PDF.' })
    userParts.push({
      type: 'file' as const,
      file: {
        filename: params.docs.primaryFilename ?? 'purchase-order.pdf',
        file_data: `data:application/pdf;base64,${b64}`,
      },
    })
  } else if (params.docs.image) {
    const b64 = bytesToBase64(params.docs.image.bytes)
    userParts.push({ type: 'text', text: 'The purchase order is in the attached scanned image.' })
    userParts.push({
      type: 'image_url',
      image_url: { url: `data:${params.docs.image.mimeType};base64,${b64}` },
    })
  } else if (params.docs.bodyText) {
    // Hard cap text content to 8k chars. Aligns with the classifier
    // budget and limits the prompt-injection blast radius — a
    // malicious PO can't smuggle instructions in unread positions.
    userParts.push({ type: 'text', text: params.docs.bodyText.slice(0, 8_000) })
  } else {
    throw new Error('extract-po: no document content to extract from')
  }

  // PDF/image extraction uses gpt-4o (vision-capable). Text-only uses
  // the cheaper gpt-4o-mini.
  const model: 'gpt-4o' | 'gpt-4o-mini' =
    params.docs.pdf || params.docs.image ? 'gpt-4o' : 'gpt-4o-mini'

  const messages: ChatMessage[] = [
    { role: 'system', content: EXTRACT_PO_SYSTEM_PROMPT },
    { role: 'user', content: userParts },
  ]

  const result = await extractStructured<ExtractedPo>({
    audit: params.audit,
    inboundMessageId: params.inboundMessageId,
    edgeFunction: 'extract-po',
    purpose:
      params.docs.pdf
        ? 'extract_pdf'
        : params.docs.image
          ? 'extract_image'
          : params.docs.bodyText && (params.docs.primaryFormat === 'docx')
            ? 'extract_docx'
            : 'extract_text',
    model,
    messages,
    jsonSchema: { name: 'extracted_po', schema: EXTRACT_PO_SCHEMA, strict: true },
  })
  return result.data
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function dispatchApprove(supabaseUrl: string, serviceKey: string, pendingPoId: string): void {
  fireAndForget({
    url: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/approve-po`,
    serviceKey,
    body: { pendingPoId, mode: 'auto' },
    label: `extract-po -> approve-po(${pendingPoId})`,
    timeoutMs: FETCH_TIMEOUT_MS,
  })
}

// Expose the auto-approve constant for cross-module reference.
export { AUTO_APPROVE_CONFIDENCE_THRESHOLD }
