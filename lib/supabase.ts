import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Trim to defeat trailing whitespace / newlines that creep in from
// Vercel's `.env.production.local` (values like "...Bg\n" inside double
// quotes get expanded by dotenv to a real LF, which then URL-encodes as
// %0A on the realtime WebSocket apikey and breaks every handshake).
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
}

// persistSession is OFF: enabling it (with either localStorage or
// sessionStorage) caused the AuthProvider's getSession() to hang
// indefinitely on initial load — supabase-js v2 acquires a
// navigator.locks lock during _initialize() when persistence is on,
// and that step never resolved in our environment, leaving the
// AuthGate spinner stuck forever. Users re-login on tab refresh.
//
// detectSessionInUrl is also off: the password-recovery hash is
// parsed manually in index.tsx so we keep tight control over which
// auth events kick off a session restore.
// A hung request (stale JWT, dropped connection, the supabase-js pre-request
// session step not resolving) used to spin forever — there was no ceiling on
// the fetch, so TanStack Query's isFetching/isLoading never cleared and the UI
// (e.g. the PO Inbox refresh icon + queue skeleton) stayed stuck. Bound every
// REST request to a hard timeout so it rejects instead of hanging; the query
// layer can then surface an error and offer a retry. A caller-supplied
// AbortSignal (TanStack Query cancellation) takes precedence. The realtime
// WebSocket does not route through this fetch, so it is unaffected.
const REQUEST_TIMEOUT_MS = 20_000

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init) => {
      if (init?.signal) return fetch(input, init)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      return fetch(input, { ...init, signal: controller.signal }).finally(() =>
        clearTimeout(timer),
      )
    },
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
