// Cross-isolate rate limiter for Edge Functions.
//
// Backed by Postgres (the rate_limit_hit() RPC + rate_limit_counters table, see
// migration 00026) so the cap holds across every Deno isolate — a caller landing
// on a freshly cold-started isolate no longer gets a fresh budget.
//
// The DB path is a FIXED window (one atomic INSERT ... ON CONFLICT per call). If
// the RPC ever errors — missing env, transient DB issue — we FAIL OPEN to the
// legacy in-memory sliding-window counter below, so a DB hiccup degrades the cap
// to per-isolate rather than hard-failing the API.
//
// The public surface (checkRateLimit, clientIp, RateLimitResult) is unchanged
// except that checkRateLimit is now async — callers must `await` it.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'

interface RateLimitConfig {
  /** Window length in milliseconds. */
  windowMs: number
  /** Maximum hits allowed within the window. */
  max: number
}

interface RateLimitResult {
  ok: boolean
  /** Hits already counted (including this one if accepted). */
  hits: number
  /** Milliseconds until the current window expires. */
  resetMs: number
}

// ---------------------------------------------------------------------------
// Service-role client — one memoized instance per isolate.
// ---------------------------------------------------------------------------
let serviceClient: SupabaseClient | null = null
let clientResolved = false

function getServiceClient(): SupabaseClient | null {
  if (clientResolved) return serviceClient
  clientResolved = true
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (url && key) {
    serviceClient = createClient(url, key, { auth: { persistSession: false } })
  }
  return serviceClient
}

// ---------------------------------------------------------------------------
// Primary path: Postgres-backed global counter.
// ---------------------------------------------------------------------------
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const client = getServiceClient()
  if (!client) return checkInMemory(key, config)

  try {
    const { data, error } = await client.rpc('rate_limit_hit', {
      p_key: key,
      p_max: config.max,
      p_window_ms: config.windowMs,
    })
    if (error || !data) {
      console.warn('[rateLimit] rate_limit_hit RPC failed, falling back to in-memory:', error?.message)
      return checkInMemory(key, config)
    }
    const row = data as { allowed: boolean; hits: number; reset_ms: number }
    return { ok: row.allowed, hits: row.hits, resetMs: row.reset_ms }
  } catch (e) {
    console.warn('[rateLimit] rate_limit_hit RPC threw, falling back to in-memory:', e)
    return checkInMemory(key, config)
  }
}

// ---------------------------------------------------------------------------
// Fail-open fallback: in-memory sliding-window log (per isolate).
//
// Maintains a Map<key, timestamp[]> of recent hits. On each call we drop
// timestamps older than `windowMs`, reject if remaining length >= max,
// otherwise append `now` and accept. Used only when the DB path is unavailable.
// ---------------------------------------------------------------------------
const buckets = new Map<string, number[]>()

// Cap the map size to avoid unbounded growth from one-off keys.
const MAX_BUCKETS = 10_000

function checkInMemory(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()
  const cutoff = now - config.windowMs
  const stamps = buckets.get(key) ?? []
  const recent = stamps.filter(t => t > cutoff)

  if (recent.length >= config.max) {
    buckets.set(key, recent)
    const oldestMs = recent[0]
    return {
      ok: false,
      hits: recent.length,
      resetMs: Math.max(0, oldestMs + config.windowMs - now),
    }
  }

  recent.push(now)
  if (buckets.size > MAX_BUCKETS) {
    // Evict the first (oldest insertion) entry to keep memory bounded.
    const firstKey = buckets.keys().next().value
    if (firstKey !== undefined) buckets.delete(firstKey)
  }
  buckets.set(key, recent)
  return { ok: true, hits: recent.length, resetMs: 0 }
}

/**
 * Best-effort client IP extraction for unauthenticated functions.
 * Falls back to "unknown" if no proxy headers are set; in that case
 * every unauthenticated caller shares one bucket, which is the safe
 * default (errs on the side of throttling).
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0].trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  if (real) return real
  return 'unknown'
}
