import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { inProcessLock } from './auth/inProcessLock'

// Trim to defeat trailing whitespace / newlines that creep in from
// Vercel's `.env.production.local` (values like "...Bg\n" inside double
// quotes get expanded by dotenv to a real LF, which then URL-encodes as
// %0A on the realtime WebSocket apikey and breaks every handshake).
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
}

// Session persistence was OFF for a long time: enabling it (with either
// localStorage or sessionStorage) caused the AuthProvider's getSession() to
// hang indefinitely on initial load, leaving the AuthGate spinner stuck
// forever. The cause was never the storage — it was the LOCK. supabase-js v2
// defaults to `navigatorLock`, which acquires a Web Locks (`navigator.locks`)
// lock during _initialize() when persistence is on, and that acquisition never
// resolved in our environment.
//
// So the fix is to keep persistence and replace the lock. `inProcessLock`
// (lib/auth/inProcessLock.ts) serialises auth operations on a promise chain
// inside this tab and never touches the Web Locks API, which is the only thing
// that hung. What we give up is cross-TAB serialisation: two tabs can now
// refresh concurrently. That is benign here — refresh tokens rotate and the
// loser simply retries — and it is a far smaller cost than the old setting:
//
//   - persistSession:false meant a refresh or a tab discard logged you out.
//   - autoRefreshToken:false meant the JWT was never renewed, so every session
//     died roughly an hour in, mid-task.
//
// On a desktop that is an irritation. For warehouse staff running scan-enforced
// picking and putaway on phones — where the browser discards backgrounded tabs
// and a shift runs for hours — it made the app unusable, which is what this
// change exists to fix.
//
// VERIFY IN A REAL BROWSER after changing anything here. The original hang did
// not reproduce in tests or in Node; it only appeared on a real Windows browser
// load. To revert, set persistSession/autoRefreshToken back to false — nothing
// else in the app depends on a persisted session.
//
// detectSessionInUrl stays off: the recovery/invite hash is parsed manually in
// index.tsx so we keep tight control over which auth events kick off a session
// restore.

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
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock: inProcessLock,
  },
})
