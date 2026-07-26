// Generic shared-secret bearer auth for cron-invoked Edge Functions.
//
// Lifted from _shared/poInbox/pollDispatch.ts so functions outside the
// PO-inbox module (e.g. `health`) can validate a pg_cron caller without
// importing the poInbox helpers. Pure logic — no DB, no fetch.

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
 * Validate an Authorization header against the secret held in `envName`.
 * Returns true on match; false on any error (missing header, wrong scheme,
 * wrong value, env not configured). Works under Deno and Node (vitest).
 */
export function isAuthorizedCronCall(authHeader: string | null, envName: string): boolean {
  if (!authHeader) return false
  const expected = readSecret(envName)
  if (!expected) {
    console.warn(`[cronToken] ${envName} not configured — refusing all calls`)
    return false
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  return constantTimeEquals(match[1].trim(), expected)
}

/**
 * Validate that a request carries the platform service-role key as its bearer
 * token — i.e. that the caller is another Edge Function (or a trusted backend),
 * not a browser holding the publishable key.
 *
 * For `verify_jwt = false` functions that are only ever invoked server-to-server
 * (`send-email`), this is the auth gate. Functions callable by real users should
 * use `requireAuth` from `_shared/auth.ts` instead.
 */
export function isServiceRoleCall(authHeader: string | null): boolean {
  return isAuthorizedCronCall(authHeader, 'SUPABASE_SERVICE_ROLE_KEY')
}

function readSecret(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const denoEnv = (globalThis as any).Deno?.env
  if (denoEnv && typeof denoEnv.get === 'function') {
    const v = denoEnv.get(name)
    return v == null || v === '' ? undefined : v
  }
  // deno-lint-ignore no-explicit-any
  const nodeProc = (globalThis as any).process
  if (nodeProc?.env) {
    const v = nodeProc.env[name]
    return v == null || v === '' ? undefined : v
  }
  return undefined
}
