import { supabase } from '@/lib/supabase'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

/**
 * Sign in with email and password using Supabase Auth.
 * Throws on authentication failure so callers can surface error state.
 */
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/**
 * Subscribe to authentication state changes.
 * Returns the subscription object — callers must call `.unsubscribe()` on
 * cleanup to avoid memory leaks (e.g., in a useEffect return function).
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
) {
  const { data } = supabase.auth.onAuthStateChange(callback)
  return data.subscription
}

/**
 * Retrieve the currently authenticated user's profile from the `profiles` table.
 * Returns null if no user is authenticated.
 */
export async function getCurrentProfile() {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!user) return null

  return getProfile(user.id)
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function listProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name, role')
  if (error) throw error
  return data
}
