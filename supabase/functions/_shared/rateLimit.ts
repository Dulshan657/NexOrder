// Lightweight in-memory rate limiter for Edge Functions.
//
// Maintains a Map<key, timestamp[]> of recent hits. On each call we drop
// timestamps older than `windowMs`, reject if remaining length >= max,
// otherwise append `now` and accept.
//
// Limitations (acceptable for v1):
//   - Per Deno isolate, not global. A user landing on a freshly cold-
//     started isolate gets a fresh budget. In practice Supabase keeps
//     warm isolates and the same client tends to hit the same isolate,
//     so this is a meaningful cap on abuse rather than a hard global.
//   - In-memory only. Process restart drops counters. That's fine — the
//     limiter exists to slow down bursts, not to enforce monthly quotas.
//
// To upgrade to a global limiter (Upstash, Postgres, etc.) keep this
// signature and swap the storage layer.

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
  /** Milliseconds until the oldest hit in the current window expires. */
  resetMs: number
}

const buckets = new Map<string, number[]>()

// Cap the map size to avoid unbounded growth from one-off keys.
const MAX_BUCKETS = 10_000

export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
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
