// What went wrong starting Nex Assistant, in the words the sheet shows.
//
// PURE. Three sources, each mapped once:
//   getUserMedia      NotAllowedError/SecurityError -> mic-denied, NotFoundError and
//                     the rest -> no-mic
//   voice-session     the Edge Function's envelope (`code`, `details`), read off the
//                     VoiceSessionError the service throws
//   the SDP exchange  RealtimeConnectError's kind (expired / connect-failed)
// The server's own message is shown where it has one: it says how long until the
// budget resets, or how long the burst limit lasts.

export type VoiceErrorKind =
  | 'mic-denied'
  | 'no-mic'
  | 'offline'
  | 'rate-limited'
  | 'budget'
  | 'module-off'
  | 'forbidden'
  | 'upstream'
  | 'connect-failed'
  | 'expired'

export interface VoiceError {
  readonly kind: VoiceErrorKind
  readonly message: string
}

export const MIC_DENIED_MESSAGE = 'Microphone access was blocked. Allow the mic for this site and try again.'

const DEFAULT_MESSAGES: Readonly<Record<VoiceErrorKind, string>> = {
  'mic-denied': MIC_DENIED_MESSAGE,
  'no-mic': 'No microphone was found. Connect one, or type instead.',
  offline: 'You are offline. Reconnect and try again.',
  'rate-limited': 'Too many assistant sessions were started. Try again shortly.',
  budget: "You've used today's assistant time.",
  'module-off': 'The assistant is not enabled for your company.',
  forbidden: 'The assistant is not available for your role.',
  upstream: 'The assistant is unavailable right now. Try again shortly.',
  'connect-failed': 'Could not connect to the assistant. Check your connection and try again.',
  expired: 'The assistant connection timed out before it opened. Try again.',
}

/** The error of this kind, with the server's message when it gave one. */
export function voiceError(kind: VoiceErrorKind, message?: string | null): VoiceError {
  const text = typeof message === 'string' && message.trim().length > 0 ? message.trim() : DEFAULT_MESSAGES[kind]
  return { kind, message: text }
}

function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null | undefined)?.name
  return typeof name === 'string' ? name : ''
}

/** A getUserMedia rejection. The mic-denied text is fixed: the browser's is not user-facing. */
export function micError(error: unknown): VoiceError {
  const name = errorName(error)
  if (name === 'NotAllowedError' || name === 'SecurityError') return voiceError('mic-denied')
  return voiceError('no-mic')
}

interface EnvelopeLike {
  code?: unknown
  message?: unknown
  details?: unknown
}

function detailField(details: unknown, field: string): unknown {
  return details && typeof details === 'object' ? (details as Record<string, unknown>)[field] : undefined
}

/** A startVoiceSession rejection. `online` is navigator.onLine at the time. */
export function startError(error: unknown, online: boolean): VoiceError {
  const e = (error ?? {}) as EnvelopeLike
  const code = typeof e.code === 'string' ? e.code : null
  const message = typeof e.message === 'string' ? e.message : null
  if (code === 'TOO_MANY_REQUESTS') {
    return detailField(e.details, 'code') === 'DAILY_BUDGET' ? voiceError('budget', message) : voiceError('rate-limited', message)
  }
  if (code === 'FORBIDDEN') {
    return detailField(e.details, 'module') !== undefined ? voiceError('module-off', message) : voiceError('forbidden', message)
  }
  if (code === null && !online) return voiceError('offline')
  return voiceError('upstream', code === null ? null : message)
}
