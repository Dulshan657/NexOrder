// Single source of truth for env-var lookup across the poInbox helpers.
//
// In production the helpers run under Deno (Edge Function runtime) and use
// Deno.env.get. In vitest they run under Node and need process.env. This
// shim picks the right one and is shared so every helper behaves the
// same way.

export function readEnv(name: string): string | undefined {
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

/**
 * Truncate any string that might be embedded in error messages or audit
 * rows. Caps length and scrubs common OAuth bearer-token shapes so a
 * Google/Microsoft 400 echoing the refresh token in its body doesn't
 * leak via console.warn → Sentry.
 */
export function sanitizeForLog(raw: string, maxLen = 200): string {
  if (!raw) return ''
  const TOKEN_SHAPED = [
    /1\/\/[A-Za-z0-9_-]{16,}/g,           // Google refresh token
    /ya29\.[A-Za-z0-9_.-]{16,}/g,         // Google access token
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,  // JWT (Google, Microsoft, Supabase service-role)
    /M\.[A-Z]\.[A-Za-z0-9_-]{16,}/g,      // Microsoft refresh token
    /OAQABAA[A-Za-z0-9_-]{16,}/g,         // Microsoft access token
  ]
  let scrubbed = raw
  for (const re of TOKEN_SHAPED) scrubbed = scrubbed.replace(re, '[REDACTED]')
  return scrubbed.length > maxLen ? `${scrubbed.slice(0, maxLen)}…` : scrubbed
}
