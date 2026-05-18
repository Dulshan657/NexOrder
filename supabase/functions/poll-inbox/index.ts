// poll-inbox Edge Function
//
// Invoked every minute by the pg_cron + pg_net job documented in
// migration 00020 and the OAUTH_SETUP runbook. For each active
// email_accounts row:
//
//   1. Decrypt the refresh token, exchange for an access token
//   2. List new messages since the stored watermark
//   3. For each new message:
//      a. Fetch the full envelope + attachments
//      b. Upload original payload + attachments to po-archive Storage
//      c. INSERT inbound_messages (provider_message_id UNIQUE — dedupes)
//      d. Fire-and-forget extract-po HTTP call
//   4. Update the watermark + last_sync_at on the account
//   5. Failure: flip status='error', last_error=...; the admin UI surfaces
//      this and exposes a Reconnect CTA.
//
// Authentication: the cron job sends `Authorization: Bearer
// <POLL_INBOX_CRON_TOKEN>`. The function refuses any call without it,
// even from a service-role JWT — this token is the only legitimate
// invocation path.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { decryptToken, encryptToken } from '../_shared/poInbox/encryption.ts'
import { sanitizeForLog } from '../_shared/poInbox/env.ts'
import { fireAndForget } from '../_shared/poInbox/dispatch.ts'
import {
  attachmentPath,
  formatLastError,
  isAuthorizedCronCall,
  originalPath,
  storagePrefixFor,
} from '../_shared/poInbox/pollDispatch.ts'
import {
  getGmailAttachmentBytes,
  getGmailMessage,
  type GmailMessageEnvelope,
  listNewGmailMessages,
  refreshGmailAccessToken,
} from '../_shared/poInbox/gmail.ts'
import {
  getGraphMessage,
  type GraphMessageEnvelope,
  listNewGraphMessages,
  refreshGraphAccessToken,
} from '../_shared/poInbox/graph.ts'

const ARCHIVE_BUCKET = 'po-archive'
// Per-cycle cap so a backlog never causes the function to exceed its
// wall-clock budget. Unprocessed messages stay queued and pick up next tick.
const MAX_MESSAGES_PER_ACCOUNT = 25
const FETCH_TIMEOUT_MS = 15_000

interface AccountRow {
  id: string
  provider: 'gmail' | 'outlook'
  email_address: string
  oauth_refresh_token_encrypted: string
  watermark: string | null
  status: 'active' | 'paused' | 'error'
  connected_by: string
}

interface CycleResult {
  accountId: string
  emailAddress: string
  provider: 'gmail' | 'outlook'
  status: 'ok' | 'error'
  newMessages: number
  fellBackToList: boolean
  errorMessage?: string
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'POST only' } }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!isAuthorizedCronCall(req.headers.get('Authorization'))) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Cron token required' } }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const { data: accountsData, error: listError } = await serviceClient
    .from('email_accounts')
    .select('id, provider, email_address, oauth_refresh_token_encrypted, watermark, status, connected_by')
    .eq('status', 'active')
  if (listError) {
    console.warn('[poll-inbox] failed to list email_accounts:', listError.message)
    return new Response(
      JSON.stringify({ error: { code: 'INTERNAL', message: 'List accounts failed' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  const accounts = (accountsData ?? []) as AccountRow[]

  // Run accounts in parallel — provider APIs are the bottleneck, not the DB.
  const results = await Promise.all(
    accounts.map(account => processAccount(account, serviceClient, supabaseUrl, serviceKey)),
  )

  return new Response(JSON.stringify({ ok: true, accounts: results }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

async function processAccount(
  account: AccountRow,
  serviceClient: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
): Promise<CycleResult> {
  try {
    const refreshToken = await decryptToken(account.oauth_refresh_token_encrypted)

    if (account.provider === 'gmail') {
      return await processGmail(account, refreshToken, serviceClient, supabaseUrl, serviceKey)
    }
    return await processOutlook(account, refreshToken, serviceClient, supabaseUrl, serviceKey)
  } catch (err) {
    const message = formatLastError(err)
    console.warn(`[poll-inbox] account ${account.email_address} failed:`, message)
    await markAccountErrored(serviceClient, account.id, message)
    return {
      accountId: account.id,
      emailAddress: account.email_address,
      provider: account.provider,
      status: 'error',
      newMessages: 0,
      fellBackToList: false,
      errorMessage: message,
    }
  }
}

async function processGmail(
  account: AccountRow,
  refreshToken: string,
  serviceClient: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
): Promise<CycleResult> {
  const { accessToken } = await refreshGmailAccessToken(refreshToken)
  const { messages, nextWatermark, fellBackToList } = await listNewGmailMessages(
    accessToken,
    account.watermark,
  )

  const toProcess = messages.slice(0, MAX_MESSAGES_PER_ACCOUNT)
  let stored = 0
  for (const ref of toProcess) {
    const envelope = await getGmailMessage(accessToken, ref.id)
    const persisted = await persistInboundMessage(
      serviceClient,
      account,
      envelope.id,
      envelope,
      async () => downloadGmailAttachments(accessToken, envelope),
    )
    if (persisted.inserted) {
      stored++
      dispatchExtractPo(supabaseUrl, serviceKey, persisted.inboundMessageId)
    }
  }

  await markAccountSynced(serviceClient, account.id, nextWatermark)

  return {
    accountId: account.id,
    emailAddress: account.email_address,
    provider: 'gmail',
    status: 'ok',
    newMessages: stored,
    fellBackToList,
  }
}

async function processOutlook(
  account: AccountRow,
  refreshToken: string,
  serviceClient: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
): Promise<CycleResult> {
  const refreshed = await refreshGraphAccessToken(refreshToken)
  // Microsoft rotates refresh tokens on every exchange — persist the new
  // one before we do anything else, otherwise a crash mid-cycle would
  // leave us with an invalidated old token.
  //
  // If encryption itself fails we cannot persist either token: throwing
  // here would mark the account 'error' via markAccountErrored which is
  // the right outcome. We surface a clear message so the operator knows
  // to investigate PO_ENCRYPTION_KEY rather than the OAuth grant.
  let newEncryptedRefresh: string
  try {
    newEncryptedRefresh = await encryptToken(refreshed.newRefreshToken)
  } catch (err) {
    throw new Error(
      `Microsoft token rotation: encryption failed — re-authorization required. ` +
      `Underlying: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
    )
  }
  await serviceClient
    .from('email_accounts')
    .update({
      oauth_refresh_token_encrypted: newEncryptedRefresh,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id)

  const { messages, nextWatermark, fellBackToList } = await listNewGraphMessages(
    refreshed.accessToken,
    account.watermark,
  )

  const toProcess = messages.slice(0, MAX_MESSAGES_PER_ACCOUNT)
  let stored = 0
  for (const ref of toProcess) {
    const envelope = await getGraphMessage(refreshed.accessToken, ref.id)
    const persisted = await persistInboundMessage(
      serviceClient,
      account,
      envelope.id,
      envelope,
      async () => extractGraphAttachments(envelope),
    )
    if (persisted.inserted) {
      stored++
      dispatchExtractPo(supabaseUrl, serviceKey, persisted.inboundMessageId)
    }
  }

  await markAccountSynced(serviceClient, account.id, nextWatermark)

  return {
    accountId: account.id,
    emailAddress: account.email_address,
    provider: 'outlook',
    status: 'ok',
    newMessages: stored,
    fellBackToList,
  }
}

interface AttachmentToUpload {
  filename: string
  mimeType: string
  bytes: Uint8Array
}

async function downloadGmailAttachments(
  accessToken: string,
  envelope: GmailMessageEnvelope,
): Promise<AttachmentToUpload[]> {
  const out: AttachmentToUpload[] = []
  for (const ref of envelope.attachments) {
    try {
      const bytes = await getGmailAttachmentBytes(accessToken, envelope.id, ref.attachmentId)
      out.push({ filename: ref.filename, mimeType: ref.mimeType, bytes })
    } catch (err) {
      console.warn(
        `[poll-inbox] attachment download failed for ${envelope.id}/${ref.filename}:`,
        sanitizeForLog(err instanceof Error ? err.message : String(err)),
      )
    }
  }
  return out
}

function extractGraphAttachments(envelope: GraphMessageEnvelope): AttachmentToUpload[] {
  // Graph returns the content inline as base64; decode and forward.
  return envelope.attachments.map(a => ({
    filename: a.filename,
    mimeType: a.mimeType,
    bytes: base64ToBytes(a.contentBytesBase64),
  }))
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

interface PersistResult {
  inserted: boolean
  inboundMessageId: string
}

async function persistInboundMessage(
  serviceClient: SupabaseClient,
  account: AccountRow,
  providerMessageId: string,
  envelope: GmailMessageEnvelope | GraphMessageEnvelope,
  loadAttachments: () => Promise<AttachmentToUpload[]>,
): Promise<PersistResult> {
  // 1) Idempotency pre-check. UNIQUE(email_account_id, provider_message_id)
  //    is the real reservation — the row is only claimed by the INSERT below.
  //    Two overlapping cron ticks may both upload to Storage before one
  //    hits the unique-violation fallback; that's wasted bandwidth but
  //    upsert: true on the storage upload makes it safe. The race window
  //    is bounded by the wall-clock between this SELECT and the INSERT.
  const prefix = storagePrefixFor(account.id, providerMessageId)
  const { data: existing } = await serviceClient
    .from('inbound_messages')
    .select('id')
    .eq('email_account_id', account.id)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle()
  if (existing) {
    return { inserted: false, inboundMessageId: (existing as { id: string }).id }
  }

  // 2) Upload original payload + attachments before inserting the row, so
  //    a Storage failure doesn't leave us with a DB pointer to nothing.
  await uploadJson(serviceClient, originalPath(prefix), envelope.rawPayload)
  const attachments = await loadAttachments()
  let i = 0
  for (const att of attachments) {
    await uploadBinary(
      serviceClient,
      attachmentPath(prefix, i, att.filename),
      att.bytes,
      att.mimeType,
    )
    i++
  }

  // 3) Insert the row. If a race already wrote it (e.g., two cron ticks
  //    overlapped) the UNIQUE constraint rejects us; treat that as
  //    "already exists" and fetch the existing row.
  const { data: inserted, error: insertError } = await serviceClient
    .from('inbound_messages')
    .insert({
      email_account_id: account.id,
      provider_message_id: providerMessageId,
      from_address: envelope.fromAddress ?? '',
      subject: envelope.subject,
      received_at: envelope.receivedAt,
      storage_path_prefix: `${ARCHIVE_BUCKET}/${prefix}`,
      processing_status: 'queued',
    })
    .select('id')
    .single()
  if (insertError) {
    const isUniqueViolation = insertError.code === '23505'
    if (!isUniqueViolation) throw new Error(`inbound_messages insert: ${insertError.message}`)
    const { data: existingAfterRace } = await serviceClient
      .from('inbound_messages')
      .select('id')
      .eq('email_account_id', account.id)
      .eq('provider_message_id', providerMessageId)
      .single()
    return { inserted: false, inboundMessageId: (existingAfterRace as { id: string }).id }
  }
  return { inserted: true, inboundMessageId: (inserted as { id: string }).id }
}

async function uploadJson(
  serviceClient: SupabaseClient,
  path: string,
  payload: unknown,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const { error } = await serviceClient.storage
    .from(ARCHIVE_BUCKET)
    .upload(path, bytes, { contentType: 'application/json', upsert: true })
  if (error) throw new Error(`storage upload ${path}: ${error.message}`)
}

async function uploadBinary(
  serviceClient: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await serviceClient.storage
    .from(ARCHIVE_BUCKET)
    .upload(path, bytes, { contentType, upsert: true })
  if (error) throw new Error(`storage upload ${path}: ${error.message}`)
}

async function markAccountSynced(
  serviceClient: SupabaseClient,
  accountId: string,
  watermark: string,
): Promise<void> {
  const { error } = await serviceClient
    .from('email_accounts')
    .update({
      watermark,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) {
    console.warn('[poll-inbox] failed to update watermark for', accountId, error.message)
  }
}

async function markAccountErrored(
  serviceClient: SupabaseClient,
  accountId: string,
  message: string,
): Promise<void> {
  const { error } = await serviceClient
    .from('email_accounts')
    .update({
      status: 'error',
      last_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) {
    console.warn('[poll-inbox] failed to flip account to error:', accountId, error.message)
  }
}

/**
 * Fire-and-forget extract-po dispatch. The shared helper uses
 * EdgeRuntime.waitUntil when available so the platform keeps the
 * isolate alive until the outbound request actually drains.
 */
function dispatchExtractPo(
  supabaseUrl: string,
  serviceKey: string,
  inboundMessageId: string,
): void {
  fireAndForget({
    url: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/extract-po`,
    serviceKey,
    body: { inboundMessageId },
    label: `poll-inbox -> extract-po(${inboundMessageId})`,
    timeoutMs: FETCH_TIMEOUT_MS,
  })
}
