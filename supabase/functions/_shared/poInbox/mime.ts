// Pure MIME helpers extracted from Gmail / Microsoft Graph message
// payloads. No external imports — vitest-friendly.
//
// Both providers expose a tree-shaped message structure with text/html
// body parts and attachment parts that carry their own MIME headers.
// We normalize the shape into a flat record the extract-po pipeline
// can consume.

export interface ParsedAddress {
  email: string | null
  name: string | null
}

const ADDRESS_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

/**
 * Parse an RFC 5322 From: / To: header value. Handles three common
 * shapes:
 *   "Alice <alice@example.com>"
 *   "<alice@example.com>"
 *   "alice@example.com"
 * Returns `{ email: null, name: null }` for unparseable input.
 */
export function parseAddress(header: string | null | undefined): ParsedAddress {
  const value = (header ?? '').trim()
  if (!value) return { email: null, name: null }

  const angleMatch = value.match(/^(.*?)<([^>]+)>\s*$/)
  if (angleMatch) {
    const name = angleMatch[1].trim().replace(/^"+|"+$/g, '').trim() || null
    const email = angleMatch[2].trim() || null
    return { email, name }
  }

  const direct = value.match(ADDRESS_REGEX)
  if (direct) return { email: direct[0], name: null }

  return { email: null, name: value || null }
}

/**
 * Extract the domain portion of an email address (everything after the
 * last '@'). Useful for the sender_domain alias lookup.
 */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  return email.slice(at + 1).toLowerCase().trim() || null
}

/**
 * Decode Gmail's URL-safe base64 (uses - and _) into a UTF-8 string.
 * Gmail bodies and attachments are encoded this way.
 */
export function decodeGmailBase64(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * UTF-8 text version of decodeGmailBase64. Errors recovered.
 */
export function decodeGmailBase64Text(b64url: string): string {
  try {
    return new TextDecoder().decode(decodeGmailBase64(b64url))
  } catch {
    return ''
  }
}

// Gmail message-part shape — narrowed to the fields we read.
export interface GmailPart {
  partId?: string | null
  mimeType?: string | null
  filename?: string | null
  headers?: Array<{ name?: string | null; value?: string | null }> | null
  body?: {
    size?: number | null
    data?: string | null
    attachmentId?: string | null
  } | null
  parts?: GmailPart[] | null
}

export interface ExtractedBodies {
  text: string | null
  html: string | null
}

/**
 * Walk a Gmail message tree and pick the best text/html body. Prefers
 * the deepest text/plain and text/html parts; falls back to the root.
 */
export function extractGmailBodies(root: GmailPart | null | undefined): ExtractedBodies {
  if (!root) return { text: null, html: null }

  let text: string | null = null
  let html: string | null = null

  const walk = (part: GmailPart) => {
    const mime = (part.mimeType ?? '').toLowerCase()
    const data = part.body?.data
    if (data) {
      if (mime === 'text/plain' && !text) text = decodeGmailBase64Text(data)
      if (mime === 'text/html' && !html) html = decodeGmailBase64Text(data)
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(root)

  if (!text && !html) {
    const rootMime = (root.mimeType ?? '').toLowerCase()
    const rootData = root.body?.data
    if (rootData) {
      if (rootMime === 'text/plain') text = decodeGmailBase64Text(rootData)
      if (rootMime === 'text/html') html = decodeGmailBase64Text(rootData)
    }
  }

  return { text, html }
}

export interface GmailAttachmentRef {
  partId: string
  filename: string
  mimeType: string
  size: number
  attachmentId: string
  /** True for cid-referenced body parts (signatures/logos). Kept but
   *  deprioritized downstream so a real attachment always wins. */
  inline: boolean
}

// MIME types extract-po knows how to send to OpenAI. Anything outside
// this set is treated as an inline image or signature and ignored.
// Exported because both gmail.ts and graph.ts filter against it.
export const MIME_TYPES_WE_PROCESS = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
])

/**
 * Decide whether a Gmail part is an inline body part (e.g. a signature or
 * logo embedded via `<img src="cid:…">`) rather than a genuine attachment.
 * Inline when `Content-Disposition` starts with `inline`, or a `Content-ID`
 * is present and the disposition isn't explicitly `attachment`.
 */
export function gmailPartIsInline(part: GmailPart): boolean {
  const disposition = getGmailHeader(part.headers, 'Content-Disposition').trim().toLowerCase()
  if (disposition.startsWith('inline')) return true
  if (disposition.startsWith('attachment')) return false
  const contentId = getGmailHeader(part.headers, 'Content-ID').trim()
  return contentId.length > 0
}

/**
 * Flatten the message tree and return refs to every part whose MIME type is
 * one we know how to extract from. Inline images (signatures/logos) are KEPT
 * but tagged `inline: true` so extract-po can deprioritize them — a real
 * attachment always wins, and an inline image is used only as a last resort.
 */
export function listGmailAttachments(root: GmailPart | null | undefined): GmailAttachmentRef[] {
  if (!root) return []
  const refs: GmailAttachmentRef[] = []

  const walk = (part: GmailPart) => {
    const filename = (part.filename ?? '').trim()
    const mimeType = (part.mimeType ?? '').toLowerCase()
    const attachmentId = part.body?.attachmentId
    if (filename && attachmentId && MIME_TYPES_WE_PROCESS.has(mimeType)) {
      refs.push({
        partId: part.partId ?? '',
        filename,
        mimeType,
        size: part.body?.size ?? 0,
        attachmentId,
        inline: gmailPartIsInline(part),
      })
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(root)
  return refs
}

/**
 * Pull a header value (case-insensitive name match) out of Gmail's
 * `payload.headers` array.
 */
export function getGmailHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | null | undefined,
  name: string,
): string {
  if (!headers) return ''
  const needle = name.toLowerCase()
  for (const h of headers) {
    if ((h.name ?? '').toLowerCase() === needle) return h.value ?? ''
  }
  return ''
}
