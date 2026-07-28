// The origin this project's frontend is served from, e.g.
// https://nexorder.com.au (prod) or https://nexorder.vercel.app (dev/demo).
//
// This used to default to the demo origin in both `send-email` and `health`,
// which made an unset APP_URL fail silently AND successfully — the worst
// combination available:
//
//   * send-email would deliver a real customer a real order confirmation whose
//     every link pointed at the demo app, and still answer {sent: true}.
//   * health's cron would probe the DEMO's /version.json, so production could
//     be completely down while its own health check reported `ok` — the one
//     signal whose entire job is to notice that.
//
// There is no correct default, so there is no default. Callers either demand
// the value and fail, or handle its absence explicitly.

/** The configured app origin, trailing slash stripped, or null if unset. */
export function readAppUrl(): string | null {
  const raw = (Deno.env.get('APP_URL') ?? '').trim().replace(/\/+$/, '')
  return raw || null
}

/**
 * The configured app origin, or throw. Use where emitting a wrong URL is worse
 * than emitting nothing — anything that reaches a customer.
 */
export function requireAppUrl(): string {
  const url = readAppUrl()
  if (!url) {
    throw new Error(
      'APP_URL is not set on this project. Refusing to guess: a wrong origin sends ' +
        'customers to a different environment. Set it with ' +
        '`npx supabase secrets set APP_URL=https://…`.',
    )
  }
  return url
}
