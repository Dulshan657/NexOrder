// Best-effort client IP for the rate limiter's per-IP buckets.
//
// PURE and import-free on purpose: `rateLimit.ts` pulls supabase-js from a URL,
// which vitest cannot resolve, so the part worth testing lives here and
// `rateLimit.ts` re-exports it. Every caller keeps importing `clientIp` from
// `rateLimit.ts`.
//
// ── WHICH HEADER, AND WHY THAT ORDER ────────────────────────────────────────
//
// The limiter is only as good as the key. Any header a CLIENT can set freely is
// a key the client chooses, so an attacker rotating `X-Forwarded-For: <random>`
// gets a fresh bucket per request and the per-IP cap does nothing. This used to
// read the LEFT-most `x-forwarded-for` entry, which is exactly that header: a
// proxy APPENDS the address it saw to whatever the client sent, so the left-most
// value is the client's claim and the right-most is the proxy's observation.
//
//   1. cf-connecting-ip   set by Cloudflare, which overwrites a client-sent copy
//   2. x-real-ip          set by the platform proxy, same reason
//   3. x-forwarded-for    the RIGHT-most entry: what Supabase's edge appended
//
// None of this makes a spoofed key impossible -- if the platform ever stops
// overwriting the first two, they become client-controlled too -- which is why
// the one function whose abuse is expensive (`qr-unlock`) also carries a bucket
// that no header can influence (keyed on the venue token, not the caller).
//
// The result is length-capped: it becomes part of a database key and a log line,
// and an unbounded header must not be able to bloat either.

/** Longest key an address may produce. An IPv6 literal is at most 45 characters. */
export const MAX_CLIENT_IP_LENGTH = 64

/** Anything the caller gets when no proxy header says who they are. */
export const UNKNOWN_CLIENT_IP = 'unknown'

function usable(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.slice(0, MAX_CLIENT_IP_LENGTH) : null
}

/** The right-most non-empty entry of an `x-forwarded-for` list, or null. */
function rightMost(forwardedFor: string | null): string | null {
  if (!forwardedFor) return null
  const entries = forwardedFor.split(',')
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = usable(entries[i])
    if (entry) return entry
  }
  return null
}

/**
 * Best-effort client IP. Falls back to "unknown" when no proxy header is set; in
 * that case every such caller shares one bucket, which is the safe default (it
 * errs on the side of throttling).
 */
export function clientIp(req: { headers: Pick<Headers, 'get'> }): string {
  return (
    usable(req.headers.get('cf-connecting-ip')) ??
    usable(req.headers.get('x-real-ip')) ??
    rightMost(req.headers.get('x-forwarded-for')) ??
    UNKNOWN_CLIENT_IP
  )
}
