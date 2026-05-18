// Fire-and-forget HTTP dispatch helper.
//
// Used by poll-inbox to kick off extract-po per new message and by
// extract-po to kick off approve-po on auto-approval. Wrapping the
// dispatch in one place prevents drift between the two call sites.
//
// On Supabase Edge Functions (Deno Deploy under the hood), an isolate
// may be terminated immediately after the parent function returns its
// response. A `fetch(...)` whose promise is not awaited can therefore
// be dropped before the request reaches the network. The platform
// exposes `EdgeRuntime.waitUntil(promise)` to register a promise that
// must complete before the isolate is shut down. We detect it at
// runtime and use it when present; otherwise we still `void` the
// promise so unhandled rejections are merely warned, not thrown.

import { sanitizeForLog } from './env.ts'

interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void
}

function edgeRuntime(): EdgeRuntimeLike | undefined {
  // deno-lint-ignore no-explicit-any
  const candidate = (globalThis as any).EdgeRuntime
  if (candidate && typeof candidate.waitUntil === 'function') {
    return candidate as EdgeRuntimeLike
  }
  return undefined
}

export interface FireAndForgetParams {
  url: string
  serviceKey: string
  body: Record<string, unknown>
  label: string
  timeoutMs?: number
}

/**
 * POST to an Edge Function URL with a service-role bearer. Logs
 * non-2xx responses and network errors but never throws to the caller.
 */
export function fireAndForget(params: FireAndForgetParams): void {
  const promise = fetch(params.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params.body),
    signal: AbortSignal.timeout(params.timeoutMs ?? 15_000),
  })
    .then(resp => {
      if (!resp.ok) {
        console.warn(`[${params.label}] dispatch returned`, resp.status)
      }
    })
    .catch(err => {
      console.warn(
        `[${params.label}] dispatch failed:`,
        sanitizeForLog(err instanceof Error ? err.message : String(err)),
      )
    })

  // Register with the runtime so the isolate stays alive long enough
  // for the request to drain. Falls back to plain void if waitUntil
  // isn't exposed (e.g., in local development).
  const er = edgeRuntime()
  if (er) {
    er.waitUntil(promise)
  } else {
    void promise
  }
}

/**
 * Constant-time string equality for verifying bearer tokens against
 * env-stored secrets. Exported here (also re-exported from
 * pollDispatch.ts) so the extract-po / approve-po service-role check
 * uses the same helper as poll-inbox.
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
 * Authenticate an inbound request as service-role using constant-time
 * comparison. Used by Edge Functions that are called only by other
 * Edge Functions (extract-po, approve-po auto mode).
 */
export function isServiceRoleBearer(
  authHeader: string | null,
  serviceKey: string,
): boolean {
  if (!authHeader) return false
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  return constantTimeEquals(match[1].trim(), serviceKey)
}
