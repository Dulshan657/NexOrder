// Pure helpers used by poll-inbox to:
//   * Authenticate the inbound cron request via shared-secret bearer
//   * Build storage paths for archived originals
//   * Map provider error codes to friendly last_error strings
//
// No DB, no fetch — pure logic only. Unit-tested via vitest.

import { readEnv, sanitizeForLog } from './env.ts'

// Slashes + ASCII control chars + DEL. Constructed via RegExp so the
// literal control codes never appear in source text (which some editors
// will silently normalize away).
const PATH_UNSAFE = new RegExp('[/\\\\\\u0000-\\u001F\\u007F]', 'g')

/**
 * Constant-time compare for two short strings. Defends against timing
 * attacks on the cron token comparison.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Validate the Authorization header against POLL_INBOX_CRON_TOKEN.
 * Returns true on match; false on any error (missing token, wrong scheme,
 * wrong value, env not configured).
 */
export function isAuthorizedCronCall(authHeader: string | null): boolean {
  if (!authHeader) return false
  const expected = readEnv('POLL_INBOX_CRON_TOKEN')
  if (!expected) {
    console.warn('[poll-inbox] POLL_INBOX_CRON_TOKEN not configured — refusing all calls')
    return false
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  return constantTimeEquals(match[1].trim(), expected)
}

/**
 * Compute the storage path prefix for an inbound message.
 *   po-archive/{accountId}/{providerMessageId}/
 */
export function storagePrefixFor(accountId: string, providerMessageId: string): string {
  // providerMessageId may contain URL-safe characters (Microsoft uses /);
  // encode it so the path is filesystem-safe.
  const safeMsgId = encodeURIComponent(providerMessageId)
  return `${accountId}/${safeMsgId}`
}

/**
 * Compute the in-bucket key for the original .eml-equivalent archive of an
 * inbound message. Gmail gives us a JSON payload, Graph gives us a JSON
 * envelope — we store both as application/json named `original.json` so
 * the archive layer is provider-independent.
 */
export function originalPath(prefix: string): string {
  return `${prefix}/original.json`
}

/**
 * Compute the in-bucket key for an attachment, derived from its filename.
 * Filename is sanitized to remove path traversal sequences and reserved
 * characters; if every character is stripped we fall back to a positional
 * fallback name so the upload still works.
 */
export function attachmentPath(prefix: string, index: number, filename: string): string {
  const cleaned = filename
    .replace(/\\/g, '/')                       // normalize Windows slashes
    .replace(/\.\.+/g, '_')                    // strip parent-dir traversal
    .replace(PATH_UNSAFE, '_')                 // strip slashes + control chars
    .replace(/^\.+/, '_')                      // strip leading dots (hidden files)
    .slice(0, 200)
    .trim()
  // Treat "every char became underscore" the same as empty — a filename
  // like '////' shouldn't pass through as '____'.
  const hasSignal = cleaned && /[^_]/.test(cleaned)
  const safe = hasSignal ? cleaned : `attachment-${index}`
  return `${prefix}/${index}-${safe}`
}

/**
 * Best-effort short, human-readable summary of a provider error to store
 * in email_accounts.last_error. Avoids dumping raw provider JSON.
 */
export function formatLastError(err: unknown): string {
  if (err instanceof Error) {
    return sanitizeForLog(`${err.name}: ${err.message}`, 240)
  }
  return sanitizeForLog(String(err), 240)
}
