// CORS handling for the Edge Function fleet.
//
// We once echoed `Access-Control-Allow-Origin: *`, which let any browser tab on
// any site invoke our endpoints with whatever Authorization header the
// visitor's page could craft. That became a hardcoded regex allowlist, which
// had two problems of its own:
//
//   1. One of the patterns matched `copy-of-curatif-order-system-v1.3-<anything>
//      .vercel.app` — a name ANYONE can claim on Vercel, because a deleted or
//      never-registered project name is first-come-first-served. That is a
//      squattable grant against our own API.
//   2. It named a single production origin in source, so the same code could
//      not serve two environments. Deployed to the client's project it would
//      have carried on trusting the demo's origin.
//
// The allowlist now comes from the `ALLOWED_ORIGINS` Edge Function secret:
// comma-separated EXACT origins, no patterns, per project. Its value is
// generated from config/environments.mjs (`corsOrigins`).
//
// It FAILS CLOSED. If the secret is unset or empty, nothing is allowed. Set
// ALLOWED_ORIGINS on a project BEFORE deploying this file to it, or every
// browser call starts failing — the ordering matters and is easy to get wrong.

// `supabase/functions` is excluded from tsconfig, but this module is reachable
// from the unit tests via _shared/errors.ts, so it is type-checked under Node
// where `Deno` does not exist. Same accessor idiom as _shared/cronToken.ts.
function readEnv(name: string): string | undefined {
  const denoEnv = (globalThis as any).Deno?.env
  if (denoEnv?.get) return denoEnv.get(name)
  return (globalThis as any).process?.env?.[name]
}

function readAllowedOrigins(): string[] {
  const raw = readEnv('ALLOWED_ORIGINS') ?? ''
  const origins = raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)

  if (origins.length === 0) {
    // Loud, once per isolate. A silent empty allowlist looks identical to a
    // CORS bug in the browser and costs an afternoon to trace back to here.
    console.error(
      '[cors] ALLOWED_ORIGINS is unset or empty — every cross-origin request will be refused. ' +
        'Set it with: npx supabase secrets set ALLOWED_ORIGINS="https://…,https://…"',
    )
  }
  return origins
}

// Read once per isolate: Edge Function secrets cannot change mid-isolate, and
// re-reading per request would re-log the warning on every call.
const ALLOWED_ORIGINS: readonly string[] = readAllowedOrigins()

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  return ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ''))
}

/**
 * CORS headers for a specific incoming request. Echoes the inbound origin back
 * when allowlisted; omits the Allow-Origin header otherwise so the browser
 * blocks the response.
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  if (origin && isAllowedOrigin(origin)) {
    return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin }
  }
  return { ...BASE_HEADERS }
}

/**
 * Default headers for the few code paths that have no Request to inspect
 * (see `_shared/errors.ts`). Pinned to this project's own app origin — the
 * first entry of ALLOWED_ORIGINS — so it grants exactly one domain, and none
 * at all when the secret is unset.
 */
export const corsHeaders: Record<string, string> = ALLOWED_ORIGINS[0]
  ? { ...BASE_HEADERS, 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] }
  : { ...BASE_HEADERS }
