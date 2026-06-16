// Gmail API client for the PO Inbox poller.
//
// Pure HTTP via fetch — no googleapis SDK — so the helper runs natively
// in the Deno Edge Function runtime without npm: imports.
//
// What lives here:
//   * OAuth refresh-token exchange
//   * incremental message listing via users.history.list with fallback
//     to users.messages.list when historyId has aged out
//   * full message fetch (format=full) and attachment fetch (raw bytes)
//
// MIME walking + header parsing lives in mime.ts so it's vitest-friendly.

import { readEnv, sanitizeForLog } from './env.ts'
import {
  decodeGmailBase64,
  extractGmailBodies,
  type GmailPart,
  getGmailHeader,
  listGmailAttachments,
  parseAddress,
  type GmailAttachmentRef,
} from './mime.ts'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FETCH_TIMEOUT_MS = 15_000

export class GmailError extends Error {
  readonly httpStatus: number
  /**
   * True when the failure means the stored grant is no longer valid and the
   * mailbox genuinely needs re-authorization (e.g. the refresh token was
   * revoked or expired). The poller treats this as a real disconnect; every
   * other failure is transient and retried with backoff.
   */
  readonly needsReauth: boolean
  constructor(message: string, httpStatus: number, needsReauth = false) {
    super(message)
    this.name = 'GmailError'
    this.httpStatus = httpStatus
    this.needsReauth = needsReauth
  }

  toEdgeResponseBody(): { code: 'INTERNAL'; message: string; status: number } {
    return { code: 'INTERNAL', message: `gmail: ${this.message}`, status: 500 }
  }
}

/**
 * Decide whether a failed token-endpoint response means the grant is dead.
 * Google returns HTTP 400 with `{"error":"invalid_grant"}` when the refresh
 * token has been revoked or expired, and `"unauthorized_client"` when the
 * grant is no longer authorized — both require the operator to reconnect.
 * Anything else (5xx, 429, network) is transient.
 */
function isGmailReauthResponse(status: number, rawBody: string): boolean {
  if (status !== 400) return false
  let code: unknown
  try {
    code = (JSON.parse(rawBody) as { error?: unknown }).error
  } catch {
    return false
  }
  return code === 'invalid_grant' || code === 'unauthorized_client'
}

/**
 * A 403 with "insufficient authentication scopes" / "Insufficient Permission"
 * means the stored grant is missing the gmail.readonly scope — e.g. the user
 * didn't tick "View your email messages and settings" on Google's consent
 * screen, or the mailbox was connected before that scope was requested.
 * Retrying never fixes this; only reconnecting with the scope granted does, so
 * we treat it like a reauth failure (status='error' + Reconnect CTA) rather
 * than retrying with backoff forever.
 */
export function isGmailScopeError(status: number, rawBody: string): boolean {
  return status === 403 && rawBody.toLowerCase().includes('insufficient')
}

/**
 * Build a GmailError from a failed API response, reading the body once and
 * classifying insufficient-scope 403s as needing reconnect.
 */
async function gmailApiError(label: string, resp: Response): Promise<GmailError> {
  const body = await resp.text()
  return new GmailError(
    `${label} failed: ${resp.status} ${sanitizeForLog(body)}`,
    resp.status,
    isGmailScopeError(resp.status, body),
  )
}

export interface GmailAccessToken {
  accessToken: string
  expiresInSeconds: number
}

/**
 * Exchange a refresh token for a fresh access token. Reads
 * GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET from env.
 */
export async function refreshGmailAccessToken(
  refreshToken: string,
): Promise<GmailAccessToken> {
  const clientId = readEnv('GMAIL_OAUTH_CLIENT_ID')
  const clientSecret = readEnv('GMAIL_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new GmailError(
      'GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET not configured',
      500,
    )
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const raw = await resp.text()
  if (!resp.ok) {
    // sanitizeForLog redacts token-shaped substrings before logging the
    // upstream response body. Google sometimes echoes the refresh token
    // back in error_description on 400s.
    throw new GmailError(
      `Token refresh failed: ${resp.status} ${sanitizeForLog(raw)}`,
      resp.status,
      isGmailReauthResponse(resp.status, raw),
    )
  }
  let json: { access_token?: string; expires_in?: number } = {}
  try {
    json = JSON.parse(raw)
  } catch {
    throw new GmailError('Token refresh returned non-JSON', 200)
  }
  if (!json.access_token) {
    throw new GmailError('Token refresh returned no access_token', 200)
  }
  return {
    accessToken: json.access_token,
    expiresInSeconds: json.expires_in ?? 3600,
  }
}

async function authedGet(
  accessToken: string,
  path: string,
  query?: Record<string, string>,
): Promise<Response> {
  const url = new URL(`${GMAIL_BASE}${path}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  }
  return await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
}

export interface NewMessageRef {
  id: string
  threadId: string
}

export interface ListNewMessagesResult {
  /** Message IDs the poller has not seen before. */
  messages: NewMessageRef[]
  /** Updated historyId to persist as the new watermark. */
  nextWatermark: string
  /**
   * True when the prior watermark had aged out and we fell back to a
   * full-listing path. Used by the poller to log a one-line note.
   */
  fellBackToList: boolean
}

interface HistoryListResponse {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }>
  }>
  historyId?: string
  nextPageToken?: string
}

interface MessageListResponse {
  messages?: Array<{ id?: string; threadId?: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

interface ProfileResponse {
  historyId?: string
}

interface HistoryWalkResult {
  ok: boolean   // false when Gmail 404'd the watermark
  messages: NewMessageRef[]
  finalHistoryId: string | null
}

async function walkHistory(
  accessToken: string,
  priorWatermark: string,
): Promise<HistoryWalkResult> {
  const messages: NewMessageRef[] = []
  const seen = new Set<string>()
  let finalHistoryId: string | null = null
  let pageToken: string | undefined

  do {
    const params: Record<string, string> = { startHistoryId: priorWatermark }
    if (pageToken) params.pageToken = pageToken
    const resp = await authedGet(accessToken, '/history', params)
    if (resp.status === 404) {
      return { ok: false, messages: [], finalHistoryId: null }
    }
    if (!resp.ok) {
      throw await gmailApiError('history.list', resp)
    }
    const body = (await resp.json()) as HistoryListResponse
    for (const entry of body.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const msg = added.message
        if (msg?.id && msg?.threadId && !seen.has(msg.id)) {
          seen.add(msg.id)
          messages.push({ id: msg.id, threadId: msg.threadId })
        }
      }
    }
    if (body.historyId) finalHistoryId = body.historyId
    pageToken = body.nextPageToken
  } while (pageToken)

  return { ok: true, messages, finalHistoryId }
}

async function walkFullList(accessToken: string): Promise<NewMessageRef[]> {
  // Initial sync or fallback: list messages from the last 24 hours via
  // Gmail's search query language. q=newer_than:1d keeps the result
  // bounded; the dedupe key on inbound_messages catches anything we
  // might re-list on a subsequent run.
  const messages: NewMessageRef[] = []
  const seen = new Set<string>()
  let pageToken: string | undefined
  do {
    const params: Record<string, string> = { q: 'newer_than:1d', maxResults: '50' }
    if (pageToken) params.pageToken = pageToken
    const resp = await authedGet(accessToken, '/messages', params)
    if (!resp.ok) {
      throw await gmailApiError('messages.list', resp)
    }
    const body = (await resp.json()) as MessageListResponse
    for (const m of body.messages ?? []) {
      if (m.id && m.threadId && !seen.has(m.id)) {
        seen.add(m.id)
        messages.push({ id: m.id, threadId: m.threadId })
      }
    }
    pageToken = body.nextPageToken
  } while (pageToken)
  return messages
}

/**
 * Incremental message listing. Tries history.list first; if the saved
 * watermark is too old (Gmail returns 404), falls back to a windowed
 * messages.list call covering the last 24 hours and surfaces that via
 * `fellBackToList`. Returns the new historyId watermark.
 */
export async function listNewGmailMessages(
  accessToken: string,
  priorWatermark: string | null,
): Promise<ListNewMessagesResult> {
  if (priorWatermark) {
    const history = await walkHistory(accessToken, priorWatermark)
    if (history.ok) {
      // Even when there are zero new messages, refresh the watermark to
      // the current historyId so the next poll starts from here.
      const watermark = history.finalHistoryId
        ?? (await fetchProfile(accessToken)).historyId
        ?? priorWatermark
      return {
        messages: history.messages,
        nextWatermark: watermark,
        fellBackToList: false,
      }
    }
  }

  // Initial sync OR history-aged-out fallback.
  const messages = await walkFullList(accessToken)
  const watermark = (await fetchProfile(accessToken)).historyId ?? priorWatermark ?? ''
  return {
    messages,
    nextWatermark: watermark,
    fellBackToList: true,
  }
}

async function fetchProfile(accessToken: string): Promise<ProfileResponse> {
  const resp = await authedGet(accessToken, '/profile')
  if (!resp.ok) {
    throw await gmailApiError('profile.get', resp)
  }
  return (await resp.json()) as ProfileResponse
}

export interface GmailMessageEnvelope {
  id: string
  threadId: string
  fromAddress: string | null
  fromName: string | null
  subject: string | null
  receivedAt: string  // ISO timestamp
  bodyText: string | null
  bodyHtml: string | null
  attachments: GmailAttachmentRef[]
  rawPayload: unknown  // full Gmail payload, for archive
}

/**
 * Fetch a single Gmail message (format=full) and return a normalized
 * envelope ready to persist as an inbound_messages row.
 */
export async function getGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageEnvelope> {
  const resp = await authedGet(accessToken, `/messages/${encodeURIComponent(messageId)}`, {
    format: 'full',
  })
  if (!resp.ok) {
    throw await gmailApiError('messages.get', resp)
  }
  const json = (await resp.json()) as {
    id?: string
    threadId?: string
    internalDate?: string
    payload?: GmailPart
  }
  if (!json.id || !json.threadId) {
    throw new GmailError('messages.get returned no id/threadId', 200)
  }
  const headers = json.payload?.headers
  const fromHeader = getGmailHeader(headers, 'From')
  const { email, name } = parseAddress(fromHeader)
  const subject = getGmailHeader(headers, 'Subject') || null
  const internalMs = json.internalDate ? Number(json.internalDate) : NaN
  const receivedAt = Number.isFinite(internalMs) && internalMs > 0
    ? new Date(internalMs).toISOString()
    : new Date().toISOString()
  const bodies = extractGmailBodies(json.payload)

  return {
    id: json.id,
    threadId: json.threadId,
    fromAddress: email,
    fromName: name,
    subject,
    receivedAt,
    bodyText: bodies.text,
    bodyHtml: bodies.html,
    attachments: listGmailAttachments(json.payload),
    rawPayload: json,
  }
}

/**
 * Download attachment bytes for a known attachmentId on a known message.
 */
export async function getGmailAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const resp = await authedGet(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  )
  if (!resp.ok) {
    throw await gmailApiError('attachments.get', resp)
  }
  const json = (await resp.json()) as { data?: string }
  if (!json.data) {
    throw new GmailError('attachments.get returned no data', 200)
  }
  return decodeGmailBase64(json.data)
}
