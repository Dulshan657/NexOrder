// What a picker is told when record-pick or record-short-pick says no.
//
// supabase-js turns any non-2xx into a FunctionsHttpError whose own message is the
// generic "Edge Function returned a non-2xx status code"; the real answer is the
// `{ error: { code, message, details: { reason } } }` body left on its `.context`.
// Before NX-0029 the pick row showed the generic text. `toPickCallError` reads the
// body once, in the service, so every screen gets a plain Error that already carries
// the `reason`.
//
// `reason` is the stable marker (a copy edit must not change behaviour); the words are
// ours, written for someone standing at the rack, and say what to DO. A reason this
// file has no words for falls back to the server's own message, which for the
// operator-facing codes (CONFLICT, INVALID_INPUT, FORBIDDEN) is already plain.

import { extractFunctionErrorEnvelope } from '@/lib/functionError'

export interface PickCallErrorInfo {
  /** `details.reason` of the refusal, e.g. HELD_AT_OTHER_WAREHOUSE, or null. */
  reason: string | null
  /** The function's `error.code`, e.g. CONFLICT, or null when there was no envelope. */
  code: string | null
  /** HTTP status, or null when the call never got a response (offline). */
  status: number | null
}

/** A failed pick call. A plain Error plus the structured answer, so a screen can
 *  branch on `reason` and show `message` without decoding anything itself. */
export class PickCallError extends Error implements PickCallErrorInfo {
  readonly reason: string | null
  readonly code: string | null
  readonly status: number | null

  constructor(message: string, info: Partial<PickCallErrorInfo> = {}) {
    super(message)
    this.name = 'PickCallError'
    this.reason = info.reason ?? null
    this.code = info.code ?? null
    this.status = info.status ?? null
  }
}

/** The refusals a picker can meet, in what to do about each. */
const WORDS: Readonly<Record<string, string>> = {
  HELD_AT_OTHER_WAREHOUSE:
    'Another warehouse still holds stock for this line. Ask them to pick it, or ask a manager to finish the line short.',
  BAD_LOCATION:
    'That bin is not in a warehouse that is picking this order. Check the bin label and try again.',
  LINE_CLOSED_SHORT:
    'This line was already finished short, so it cannot be picked. Put anything you took back.',
  ORDER_CANCELLED: 'This order was cancelled. Stop picking it and put anything already taken back.',
  NOT_YOUR_WAREHOUSE: 'You can only finish a line short at your own warehouse.',
}

/** Read a failed call into a PickCallError. Never throws. */
export async function toPickCallError(error: unknown, fallback: string): Promise<PickCallError> {
  const envelope = await extractFunctionErrorEnvelope(error)
  if (envelope) {
    const reason = (envelope.details as { reason?: unknown } | null | undefined)?.reason
    return new PickCallError(envelope.message ?? fallback, {
      reason: typeof reason === 'string' ? reason : null,
      code: envelope.code,
      status: envelope.status,
    })
  }
  const own = error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
  return new PickCallError(own)
}

/** The sentence to show for a failed pick call: our words for a known reason, else
 *  the server's message, else `fallback`. Duck-typed on `reason`, so it reads any
 *  error that carries one. */
export function refusalMessage(error: unknown, fallback: string): string {
  const reason = (error as { reason?: unknown } | null | undefined)?.reason
  if (typeof reason === 'string' && WORDS[reason]) return WORDS[reason]
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return fallback
}
