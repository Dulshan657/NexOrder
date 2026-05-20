// Microsoft Graph client for the PO Inbox poller.
//
// Symmetry with gmail.ts:
//   * refreshGraphAccessToken — exchange refresh token at the v2 endpoint
//   * listNewGraphMessages   — uses delta-link sync for incremental
//                              listing; falls back to the most recent 24h
//                              via $filter when no delta link is stored
//   * getGraphMessage         — fetches a single message with attachments
//                              expanded inline; normalizes into the same
//                              envelope shape Gmail returns so extract-po
//                              doesn't care about the provider
//
// Microsoft refresh tokens rotate on every exchange. The caller MUST
// persist the new refresh token returned alongside the access token —
// the prior one is invalidated. This is unlike Gmail where the refresh
// token is stable for the lifetime of the grant.

import { readEnv, sanitizeForLog } from './env.ts'
import { MIME_TYPES_WE_PROCESS, parseAddress } from './mime.ts'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const GRAPH_HOST_PREFIX = 'https://graph.microsoft.com/'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const FETCH_TIMEOUT_MS = 15_000
// Bounded follow-the-page loop. 24h of delta should resolve within a few
// pages; we cap at 50 to avoid an infinite loop if Microsoft ever returns
// a self-referential nextLink.
const MAX_DELTA_PAGES = 50

export class GraphError extends Error {
  readonly httpStatus: number
  /**
   * True when the failure means the stored grant is no longer valid and the
   * mailbox genuinely needs re-authorization (refresh token revoked, or
   * expired after the 90-day inactivity window). The poller treats this as a
   * real disconnect; every other failure is transient and retried with backoff.
   */
  readonly needsReauth: boolean
  constructor(message: string, httpStatus: number, needsReauth = false) {
    super(message)
    this.name = 'GraphError'
    this.httpStatus = httpStatus
    this.needsReauth = needsReauth
  }

  toEdgeResponseBody(): { code: 'INTERNAL'; message: string; status: number } {
    return { code: 'INTERNAL', message: `graph: ${this.message}`, status: 500 }
  }
}

// AADSTS sub-codes that mean the grant is dead and only a fresh interactive
// sign-in can fix it: expired/revoked token, token expired due to inactivity,
// and the generic "interaction required" family.
const AAD_REAUTH_CODES = [70000, 700082, 700084, 50173, 50078, 54005]

/**
 * Decide whether a failed token-endpoint response means the grant is dead.
 * Microsoft returns HTTP 400 with `error` of `invalid_grant` /
 * `interaction_required` and an `error_codes` array of AADSTS numbers; the
 * ones in AAD_REAUTH_CODES require the operator to reconnect. Anything else
 * (5xx, 429, network) is transient.
 */
function isGraphReauthResponse(status: number, rawBody: string): boolean {
  if (status !== 400) return false
  let parsed: { error?: unknown; error_codes?: unknown }
  try {
    parsed = JSON.parse(rawBody) as { error?: unknown; error_codes?: unknown }
  } catch {
    return false
  }
  if (parsed.error === 'invalid_grant' || parsed.error === 'interaction_required') {
    return true
  }
  return Array.isArray(parsed.error_codes) &&
    parsed.error_codes.some(code => AAD_REAUTH_CODES.includes(Number(code)))
}

export interface GraphAccessTokenResult {
  accessToken: string
  /** Microsoft rotates refresh tokens — callers MUST persist this. */
  newRefreshToken: string
  expiresInSeconds: number
}

const REQUIRED_GRAPH_SCOPES = 'https://graph.microsoft.com/Mail.Read offline_access'

/**
 * Exchange a refresh token for a fresh access token. Reads
 * OUTLOOK_OAUTH_CLIENT_ID and OUTLOOK_OAUTH_CLIENT_SECRET from env.
 */
export async function refreshGraphAccessToken(
  refreshToken: string,
): Promise<GraphAccessTokenResult> {
  const clientId = readEnv('OUTLOOK_OAUTH_CLIENT_ID')
  const clientSecret = readEnv('OUTLOOK_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new GraphError(
      'OUTLOOK_OAUTH_CLIENT_ID / OUTLOOK_OAUTH_CLIENT_SECRET not configured',
      500,
    )
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: REQUIRED_GRAPH_SCOPES,
  })

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const raw = await resp.text()
  if (!resp.ok) {
    throw new GraphError(
      `Token refresh failed: ${resp.status} ${sanitizeForLog(raw)}`,
      resp.status,
      isGraphReauthResponse(resp.status, raw),
    )
  }
  let json: { access_token?: string; refresh_token?: string; expires_in?: number } = {}
  try {
    json = JSON.parse(raw)
  } catch {
    throw new GraphError('Token refresh returned non-JSON', 200)
  }
  if (!json.access_token || !json.refresh_token) {
    throw new GraphError(
      'Token refresh returned no access_token / refresh_token',
      200,
    )
  }
  return {
    accessToken: json.access_token,
    newRefreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in ?? 3600,
  }
}

/**
 * Defensive URL allowlist: Graph's nextLink/deltaLink are taken from a
 * provider-controlled JSON field. If the response is ever tampered with
 * (compromise upstream, MITM bypassing CT, etc.) an attacker could
 * redirect our bearer token to an internal endpoint. We accept only
 * URLs on the official Graph host.
 */
function assertGraphUrl(url: string): void {
  if (!url.startsWith(GRAPH_HOST_PREFIX)) {
    throw new GraphError(
      `Refusing to follow non-Graph URL from API response: ${sanitizeForLog(url, 120)}`,
      500,
    )
  }
}

async function authedGet(accessToken: string, url: string): Promise<Response> {
  assertGraphUrl(url)
  return await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
}

export interface NewGraphMessageRef {
  id: string
  conversationId: string
}

export interface ListNewGraphMessagesResult {
  messages: NewGraphMessageRef[]
  /** New deltaLink to persist as the watermark. */
  nextWatermark: string
  fellBackToList: boolean
}

interface GraphDeltaResponse {
  value?: Array<{
    id?: string
    conversationId?: string
    '@removed'?: { reason?: string }
  }>
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

/**
 * Incremental message listing using $delta. The first call (priorWatermark
 * null) discovers messages from the last 24 hours by composing a delta
 * URL with a $filter for receivedDateTime. Subsequent calls follow the
 * stored delta link directly.
 */
export async function listNewGraphMessages(
  accessToken: string,
  priorWatermark: string | null,
): Promise<ListNewGraphMessagesResult> {
  const collected: NewGraphMessageRef[] = []
  const seen = new Set<string>()
  const fellBackToList = priorWatermark === null
  let nextWatermark = ''

  let url = priorWatermark ?? buildInitialDeltaUrl()

  // Follow nextLink/deltaLink pages until we reach the final deltaLink.
  // Microsoft returns a deltaLink on the final page that we persist.
  for (let page = 0; page < MAX_DELTA_PAGES; page++) {
    const resp = await authedGet(accessToken, url)
    if (!resp.ok) {
      throw new GraphError(
        `delta failed: ${resp.status} ${sanitizeForLog(await resp.text())}`,
        resp.status,
      )
    }
    const body = (await resp.json()) as GraphDeltaResponse
    for (const m of body.value ?? []) {
      if (m['@removed']) continue
      if (m.id && m.conversationId && !seen.has(m.id)) {
        seen.add(m.id)
        collected.push({ id: m.id, conversationId: m.conversationId })
      }
    }
    if (body['@odata.deltaLink']) {
      assertGraphUrl(body['@odata.deltaLink'])
      nextWatermark = body['@odata.deltaLink']
      break
    }
    if (body['@odata.nextLink']) {
      url = body['@odata.nextLink']
      // assertGraphUrl runs inside the next authedGet call
      continue
    }
    break
  }

  if (!nextWatermark) {
    // Graph didn't hand us a deltaLink (shouldn't happen on a healthy
    // call). Fall back to the prior watermark to avoid losing the cursor.
    nextWatermark = priorWatermark ?? buildInitialDeltaUrl()
  }

  return { messages: collected, nextWatermark, fellBackToList }
}

function buildInitialDeltaUrl(): string {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const filter = `receivedDateTime ge ${since}`
  // /me/mailFolders/inbox/messages/delta supports $filter. /me/ is the
  // delegated-permission shape this OAuth design uses; switch to
  // /users/{upn}/ in Phase 2 if app-permission auth is introduced.
  return `${GRAPH_BASE}/me/mailFolders/inbox/messages/delta?$filter=${encodeURIComponent(filter)}`
}

export interface GraphAttachmentRef {
  id: string
  filename: string
  mimeType: string
  size: number
  contentBytesBase64: string  // Graph returns attachment bytes inline as base64
}

export interface GraphMessageEnvelope {
  id: string
  conversationId: string
  fromAddress: string | null
  fromName: string | null
  subject: string | null
  receivedAt: string
  bodyText: string | null
  bodyHtml: string | null
  attachments: GraphAttachmentRef[]
  rawPayload: unknown
}

interface GraphMessage {
  id?: string
  conversationId?: string
  receivedDateTime?: string
  subject?: string | null
  from?: { emailAddress?: { address?: string; name?: string } }
  body?: { contentType?: string; content?: string }
  bodyPreview?: string
  hasAttachments?: boolean
  attachments?: Array<{
    id?: string
    name?: string
    contentType?: string
    size?: number
    isInline?: boolean
    contentBytes?: string
    '@odata.type'?: string
  }>
}

/**
 * Fetch a single message with attachments expanded. Mirrors getGmailMessage.
 */
export async function getGraphMessage(
  accessToken: string,
  messageId: string,
): Promise<GraphMessageEnvelope> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$expand=attachments`
  const resp = await authedGet(accessToken, url)
  if (!resp.ok) {
    throw new GraphError(
      `messages.get failed: ${resp.status} ${sanitizeForLog(await resp.text())}`,
      resp.status,
    )
  }
  const msg = (await resp.json()) as GraphMessage
  if (!msg.id || !msg.conversationId) {
    throw new GraphError('messages.get returned no id/conversationId', 200)
  }

  const addr = msg.from?.emailAddress?.address ?? null
  const name = msg.from?.emailAddress?.name ?? null
  // Use parseAddress for symmetry even though Graph already structures the value;
  // it normalizes occasional quoted names returned by Graph.
  const parsed = parseAddress(addr ? `${name ?? ''} <${addr}>` : '')
  const fromAddress = parsed.email ?? addr
  const fromName = parsed.name ?? name

  const bodyContent = msg.body?.content ?? null
  const bodyType = (msg.body?.contentType ?? '').toLowerCase()
  const bodyText = bodyType === 'text' ? bodyContent : null
  const bodyHtml = bodyType === 'html' ? bodyContent : null

  const attachments: GraphAttachmentRef[] = []
  for (const a of msg.attachments ?? []) {
    if (a.isInline) continue
    if (!a.id || !a.name || !a.contentBytes) continue
    const mime = (a.contentType ?? '').toLowerCase()
    if (!MIME_TYPES_WE_PROCESS.has(mime)) continue
    attachments.push({
      id: a.id,
      filename: a.name,
      mimeType: mime,
      size: a.size ?? 0,
      contentBytesBase64: a.contentBytes,
    })
  }

  return {
    id: msg.id,
    conversationId: msg.conversationId,
    fromAddress,
    fromName,
    subject: msg.subject ?? null,
    receivedAt: msg.receivedDateTime ?? new Date().toISOString(),
    bodyText: bodyText ?? (bodyHtml ? null : msg.bodyPreview ?? null),
    bodyHtml,
    attachments,
    rawPayload: msg,
  }
}
