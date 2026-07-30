// Extract a human-readable message from a supabase-js Functions error.
//
// `supabase.functions.invoke` returns a `FunctionsHttpError` for any non-2xx
// response, whose `.message` is the generic "Edge Function returned a non-2xx
// status code". The actual structured body our Edge Functions return —
// `{ error: { code, message } }` via _shared/errors.ts — is left on the raw
// Response at `.context`. Without reading it the operator never sees WHY a
// call failed (e.g. "Insufficient stock for X: 0 available, 2 requested").
//
// This reads that body and returns its `error.message`, falling back to the
// error's own message and finally the caller-supplied fallback.

interface MaybeHttpError {
  context?: unknown
}

/** The structured `details` an Edge Function attached to a failure, if any.
 *
 *  Separate from the message on purpose: callers that need to BRANCH on why a
 *  call failed (offering "Place anyway" for a level-role refusal, say) must key
 *  off a stable marker, never off prose that a copy edit could change. */
export async function extractFunctionErrorDetails(error: unknown): Promise<unknown> {
  const context = (error as MaybeHttpError | null | undefined)?.context
  if (!(context instanceof Response)) return undefined
  try {
    const body = (await context.clone().json()) as { error?: { details?: unknown } } | null
    return body?.error?.details
  } catch {
    return undefined
  }
}

/** Render an Edge Function's schema-validation `details` as `path: message`.
 *
 *  "Invalid request body" is a true statement and a useless one — the operator
 *  cannot act on it and neither can the next engineer. The function attaches the
 *  offending field paths as `{ issues: [{ path, message }] }`; this turns them
 *  into a suffix worth reading. Capped at three because the first one is almost
 *  always the whole story. Returns '' for any other details shape, so callers can
 *  append it unconditionally.
 *
 *  Pure and total: never throws on a malformed `details`. */
export function describeValidationIssues(details: unknown): string {
  const issues = (details as { issues?: unknown } | null | undefined)?.issues
  if (!Array.isArray(issues)) return ''
  const parts = issues
    .filter((i): i is { path?: unknown; message?: unknown } => !!i && typeof i === 'object')
    .map((i) => {
      const path = typeof i.path === 'string' ? i.path : ''
      const message = typeof i.message === 'string' ? i.message : ''
      if (!message) return path
      return path ? `${path}: ${message}` : message
    })
    .filter((s) => s.length > 0)
    .slice(0, 3)
  return parts.join('; ')
}

export async function extractFunctionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  const context = (error as MaybeHttpError | null | undefined)?.context
  if (context instanceof Response) {
    // Non-2xx HTTP error: the structured body is the ONLY useful message.
    // The error's own `.message` is the generic "non-2xx status code" string
    // we exist to suppress, so we never fall back to it here.
    try {
      // clone() so we never consume a body another caller might read.
      const body = (await context.clone().json()) as { error?: { message?: unknown } } | null
      const message = body?.error?.message
      if (typeof message === 'string' && message.trim().length > 0) {
        return message
      }
    } catch {
      // Body wasn't JSON, was empty, or was already consumed — fall through.
    }
    return fallback
  }

  // No Response context (network/fetch error or arbitrary Error): the error's
  // own message is the most specific signal available.
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message
  }
  return fallback
}
