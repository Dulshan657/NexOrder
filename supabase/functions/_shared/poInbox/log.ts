// Structured logging helper for the PO Inbox Edge Function fleet.
//
// Why a wrapper instead of bare console.warn:
//   * Supabase Edge Function logs are fed by stderr lines. JSON makes
//     them grep-able and Sentry-ready (Phase 2 wires the actual sink).
//   * Centralizing the log shape means a regex like
//       jq 'select(.scope=="po-inbox" and .severity=="error")'
//     works across every PO Inbox function without per-call massaging.
//   * Token/secret redaction is opt-in via sanitizeForLog on the call
//     site, but the helper enforces "no raw Error objects" — message
//     strings only.
//
// Drop-in for console.warn/error/info in the poInbox helpers. Existing
// callers that already use sanitizeForLog continue to work unchanged
// (this helper consumes already-sanitized strings).

import { sanitizeForLog } from './env.ts'

export type LogSeverity = 'info' | 'warn' | 'error'

export interface LogContext {
  /**
   * Logical scope — usually the Edge Function name (poll-inbox,
   * extract-po, etc.) or a sub-component (alias-resolver, openai).
   */
  scope: string
  /** Optional correlation id — inbound_message_id, pending_po_id, etc. */
  ref?: string
}

export interface LogPayload {
  /** Short human-readable message; sanitized via sanitizeForLog. */
  message: string
  /** Optional extra fields. Values stringified; tokens redacted. */
  data?: Record<string, unknown>
  /** When the cause is an unknown thrown value. */
  cause?: unknown
}

/**
 * Emit a single JSON log line. Always returns void; logging itself is
 * fire-and-forget and never throws (catches its own JSON.stringify
 * failures and falls back to a plain console.warn).
 */
export function logEvent(
  severity: LogSeverity,
  ctx: LogContext,
  payload: LogPayload,
): void {
  const causeMessage = payload.cause instanceof Error
    ? payload.cause.message
    : payload.cause == null
      ? undefined
      : String(payload.cause)

  const entry = {
    ts: new Date().toISOString(),
    severity,
    scope: ctx.scope,
    ref: ctx.ref,
    message: sanitizeForLog(payload.message, 1000),
    ...(payload.data ? { data: sanitizeData(payload.data) } : {}),
    ...(causeMessage ? { cause: sanitizeForLog(causeMessage, 500) } : {}),
  }

  let line: string
  try {
    line = JSON.stringify(entry)
  } catch {
    // Fall back to a minimal shape rather than swallow the event.
    line = `{"ts":"${entry.ts}","severity":"${severity}","scope":"${ctx.scope}","message":"<stringify failed>"}`
  }

  switch (severity) {
    case 'error':
      console.error(line)
      return
    case 'warn':
      console.warn(line)
      return
    default:
      console.log(line)
  }
}

function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v == null) {
      out[k] = v
      continue
    }
    if (typeof v === 'string') {
      out[k] = sanitizeForLog(v, 500)
      continue
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v
      continue
    }
    // Stringify everything else through sanitizeForLog so token-shaped
    // substrings inside nested objects don't leak.
    try {
      out[k] = sanitizeForLog(JSON.stringify(v), 500)
    } catch {
      out[k] = '<unserializable>'
    }
  }
  return out
}

/** Shortcut: logEvent('warn', ...). */
export function logWarn(ctx: LogContext, payload: LogPayload): void {
  logEvent('warn', ctx, payload)
}

/** Shortcut: logEvent('error', ...). */
export function logError(ctx: LogContext, payload: LogPayload): void {
  logEvent('error', ctx, payload)
}

/** Shortcut: logEvent('info', ...). */
export function logInfo(ctx: LogContext, payload: LogPayload): void {
  logEvent('info', ctx, payload)
}
