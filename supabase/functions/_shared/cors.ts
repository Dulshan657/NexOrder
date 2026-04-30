// CORS handling for the Edge Function fleet.
//
// We previously echoed `Access-Control-Allow-Origin: *`, which let any
// browser tab on any site invoke our endpoints (with whatever Authorization
// header the visitor's site could craft). Now we maintain an explicit
// allowlist:
//
//   - the production alias (https://nexorder.vercel.app)
//   - Vercel preview deployments for this project
//   - localhost during development
//
// `corsHeadersFor(req)` reads the inbound `Origin` header, matches it
// against the allowlist, and echoes that exact origin back. Unknown
// origins receive headers without `Access-Control-Allow-Origin`, which
// causes the browser to block the response.
//
// `corsHeaders` (no req) is kept for back-compat with code paths that
// can't access the request — it returns headers with the production
// origin only.

const PRODUCTION_ORIGIN = 'https://nexorder.vercel.app'

// Patterns are anchored with ^ and $ implicitly via the test below.
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/nexorder\.vercel\.app$/,
  // Vercel preview deployments for this project, with or without the
  // dulshan657s-projects team suffix.
  /^https:\/\/copy-of-curatif-order-system-v1[._-]?3-[a-z0-9-]+\.vercel\.app$/,
  // Local Vite dev server.
  /^http:\/\/localhost:3000$/,
]

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  return ALLOWED_ORIGIN_PATTERNS.some(p => p.test(origin))
}

/**
 * CORS headers for a specific incoming request. Echoes the inbound origin
 * back when allowlisted; omits the Allow-Origin header otherwise so the
 * browser blocks the response.
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  if (origin && isAllowedOrigin(origin)) {
    return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin }
  }
  return { ...BASE_HEADERS }
}

// Default headers, suitable for code paths that don't have a Request handy.
// Pinned to the production origin so they at least restrict to one domain.
export const corsHeaders: Record<string, string> = {
  ...BASE_HEADERS,
  'Access-Control-Allow-Origin': PRODUCTION_ORIGIN,
}
