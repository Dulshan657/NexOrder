import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables')
}

// Session storage choice (Phase 6 auth polish):
//
// Originally `persistSession: false` because localStorage caused a
// reproducible UI hang on Windows. sessionStorage doesn't share that
// pattern (it's per-tab and doesn't trigger the same storage-event
// loop), so we get refresh-survival within a tab without reintroducing
// the hang. Across tab close the user is required to sign in again —
// that's "session lifetime" semantics, the conservative choice for B2B.
//
// `detectSessionInUrl` stays false: the password-recovery hash is
// parsed manually in index.tsx so we keep tight control over which
// auth events kick off a session restore.
const sessionStorageAdapter =
  typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
    ? window.sessionStorage
    : undefined

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init) => fetch(input, init),
  },
  auth: {
    storage: sessionStorageAdapter,
    persistSession: !!sessionStorageAdapter,
    autoRefreshToken: !!sessionStorageAdapter,
    detectSessionInUrl: false,
  },
})
