// Per-account inbox poll engine.
//
// Extracted from poll-inbox so it can be reused both by the cron poller
// (poll-inbox, which fans this out over every eligible account) and by the
// on-demand retry-email-account function (which runs it for a single mailbox
// and reports the result inline). For one email_accounts row this:
//
//   1. Decrypt the refresh token, exchange for an access token
//   2. List new messages since the stored watermark
//   3. For each new message:
//      a. Fetch the full envelope + attachments
//      b. Upload original payload + attachments to po-archive Storage
//      c. INSERT inbound_messages (provider_message_id UNIQUE — dedupes)
//      d. Fire-and-forget extract-po HTTP call
//   4. Update the watermark + last_sync_at on the account (clears any
//      transient-failure backoff state)
//   5. Failure handling:
//      * genuine grant revocation -> status='error', last_error=...; the
//        admin UI surfaces this and exposes a Reconnect CTA
//      * everything else (timeouts, 5xx, 429, network) -> stays active,
//        bumps consecutive_failures + next_retry_at (capped backoff)

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { decryptToken, encryptToken } from './encryption.ts'
import { sanitizeForLog } from './env.ts'
import { fireAndForget } from './dispatch.ts'
import {
  attachmentPath,
  formatLastError,
  isReauthError,
  originalPath,
  retryBackoffMs,
  storagePrefixFor,
} from './pollDispatch.ts'
import {
  getGmailAttachmentBytes,
  getGmailMessage,
  type GmailMessageEnvelope,
  listNewGmailMessages,
  refreshGmailAccessToken,
} from './gmail.ts'
import {
  getGraphMessage,
  type GraphMessageEnvelope,
  listNewGraphMessages,
  refreshGraphAccessToken,
} from './graph.ts'

const ARCHIVE_BUCKET = 'po-archive'
// Per-cycle cap so a backlog never causes the function to exceed its
// wall-clock budget. Unprocessed messages stay queued and pick up next tick.
const MAX_MESSAGES_PER_ACCOUNT = 25
const FETCH_TIMEOUT_MS = 15_000

export interface AccountRow {
  id: string
  provider: 'gmail' | 'outlook'
  email_address: string
  oauth_refresh_token_encrypted: string
  watermark: string | null
  status: 'active' | 'paused' | 'error'
  connected_by: string
  consecutive_failures: number
  next_retry_at: string | null
}

export interface CycleResult {
  accountId: string
  emailAddress: string
  provider: 'gmail' | 'outlook'
  status: 'ok' | 'error'
  newMessages: number
  fellBackToList: boolean
  errorMessage?: string
}

export async function processAccount(
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
    // A genuine grant revocation (invalid_grant / expired refresh token) is
    // the ONLY non-user path that disconnects a mailbox — it truly needs the
    // operator to reconnect. Everything else is transient: keep the account
    // active and retry with backoff so a blip never silently signs it out.
    if (isReauthError(err)) {
      console.warn(`[poll-inbox] account ${account.email_address} needs re-auth:`, message)
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
    console.warn(`[poll-inbox] account ${account.email_address} transient failure:`, message)
    await markAccountTransientFailure(serviceClient, account, message)
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
  /** Carried into the archive manifest so extract-po can deprioritize
   *  inline signature/logo images. */
  inline: boolean
  size: number
}

async function downloadGmailAttachments(
  accessToken: string,
  envelope: GmailMessageEnvelope,
): Promise<AttachmentToUpload[]> {
  const out: AttachmentToUpload[] = []
  for (const ref of envelope.attachments) {
    try {
      const bytes = await getGmailAttachmentBytes(accessToken, envelope.id, ref.attachmentId)
      out.push({
        filename: ref.filename,
        mimeType: ref.mimeType,
        bytes,
        inline: ref.inline,
        size: ref.size || bytes.length,
      })
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
  return envelope.attachments.map(a => {
    const bytes = base64ToBytes(a.contentBytesBase64)
    return {
      filename: a.filename,
      mimeType: a.mimeType,
      bytes,
      inline: a.inline,
      size: a.size || bytes.length,
    }
  })
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

  // 2) Upload attachments + original payload before inserting the row, so
  //    a Storage failure doesn't leave us with a DB pointer to nothing.
  //    Attachments are uploaded FIRST so we can record each one's stored
  //    object name + inline flag + size into the archived manifest, which
  //    extract-po uses to deprioritize inline signature/logo images.
  const attachments = await loadAttachments()
  const manifest: Array<{
    storedName: string
    filename: string
    mimeType: string
    size: number
    inline: boolean
  }> = []
  let i = 0
  for (const att of attachments) {
    const fullPath = attachmentPath(prefix, i, att.filename)
    await uploadBinary(serviceClient, fullPath, att.bytes, att.mimeType)
    // storedName is the in-bucket object name (the segment after the prefix),
    // matching what extract-po / create-po-document-url see when listing.
    manifest.push({
      storedName: fullPath.slice(prefix.length + 1),
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      inline: att.inline,
    })
    i++
  }

  // We persist the *parsed* envelope (bodyText/bodyHtml) plus the attachment
  // manifest (overriding the provider refs with stored-name/inline metadata).
  // rawPayload stays nested for forensic re-parsing if MIME logic changes.
  await uploadJson(serviceClient, originalPath(prefix), { ...envelope, attachments: manifest })

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
      // A clean sync clears any transient-failure backoff state so the
      // account returns to the normal once-a-minute cadence.
      consecutive_failures: 0,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) {
    console.warn('[poll-inbox] failed to update watermark for', accountId, error.message)
  }
}

/**
 * Record a transient poll failure WITHOUT disconnecting the mailbox. The row
 * stays status='active'; we bump consecutive_failures and push next_retry_at
 * out by a capped exponential backoff so the account is retried later rather
 * than hammered every minute. This is what keeps a connection "signed in"
 * through provider outages, rate limits, and network blips.
 */
async function markAccountTransientFailure(
  serviceClient: SupabaseClient,
  account: AccountRow,
  message: string,
): Promise<void> {
  const consecutiveFailures = account.consecutive_failures + 1
  const nextRetryAt = new Date(Date.now() + retryBackoffMs(consecutiveFailures)).toISOString()
  const { error } = await serviceClient
    .from('email_accounts')
    .update({
      last_error: message,
      consecutive_failures: consecutiveFailures,
      next_retry_at: nextRetryAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id)
  if (error) {
    console.warn('[poll-inbox] failed to record transient failure for', account.id, error.message)
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
