// What the PIN fields on the QR & PINs panel show as a manager types.
//
// The verdict is `validatePin` from supabase/functions/_shared/qrPin.ts -- the very
// module `mutate-qr-access` uses to refuse a PIN -- so the form never accepts one
// the server will reject for being weak or malformed. What this file adds is
// WHEN to say so: a manager who has typed "12" has not made a mistake yet, so a
// too-short PIN is only reported once they leave the field (or try to save), while
// a PIN that is already weak ("1234", "0000") is reported the moment it is whole.
//
// Uniqueness within the venue is a database fact; the server reports it as
// QR_PIN_TAKEN and the panel shows that message under the field.

import {
  QR_PIN_MAX_LENGTH,
  QR_PIN_MIN_LENGTH,
  describePinProblem,
  validatePin,
} from '@/supabase/functions/_shared/qrPin'

export { QR_PIN_MAX_LENGTH, QR_PIN_MIN_LENGTH }

/** Digits only, at most six. Keeps a pasted "12 34" or "12-34" usable instead of refused. */
export function sanitizePinInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, QR_PIN_MAX_LENGTH)
}

export interface PinFeedback {
  /** The PIN may be sent (the server can still refuse it as taken). */
  ok: boolean
  /** What to show under the field right now, or null. */
  error: string | null
}

/**
 * @param touched the field has been left once, or a save was attempted: only then
 *                is an incomplete PIN worth a complaint.
 */
export function pinFeedback(pin: string, touched: boolean): PinFeedback {
  const check = validatePin(pin)
  if (check.ok === true) return { ok: true, error: null }
  if (check.reason === 'weak') return { ok: false, error: describePinProblem('weak') }
  // 'format': for sanitized input that only ever means too short (or empty).
  return { ok: false, error: touched ? describePinProblem('format') : null }
}
