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
