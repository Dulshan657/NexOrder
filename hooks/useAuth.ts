import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { recordAuthEvent } from '@/lib/auth/sessionBreadcrumbs'

type Profile = Database['public']['Tables']['profiles']['Row']
type UserRole = Profile['role']

interface AuthContextType {
  user: User | null
  profile: Profile | null
  isLoading: boolean
  /**
   * A session exists but its profile could not be LOADED (network, timeout) —
   * as opposed to there being no profile row at all. AuthGate shows a retry
   * for this instead of LoginPage, because the session is still valid.
   */
  profileError: boolean
  retryProfile: () => Promise<void>
  isAdmin: boolean
  isManager: boolean
  isAdminOrManager: boolean
  isFieldRep: boolean
  isOfficeRep: boolean
  isRep: boolean
  isCustomer: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

/** PostgREST's code for `.single()` matching no rows: the profile does not exist. */
const NO_ROWS = 'PGRST116'

type ProfileFetch = { ok: true; profile: Profile | null } | { ok: false }

async function fetchProfile(userId: string): Promise<ProfileFetch> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error) return { ok: true, profile: data }
    if (error.code === NO_ROWS) return { ok: true, profile: null }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}

/** Shallow equality over a flat profile row. */
function sameProfile(a: Profile, b: Profile): boolean {
  const keys = Object.keys(a) as Array<keyof Profile>
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

function deriveRoleBooleans(role: UserRole | undefined) {
  return {
    isAdmin: role === 'Admin',
    isManager: role === 'Manager',
    isAdminOrManager: role === 'Admin' || role === 'Manager',
    isFieldRep: role === 'Field Sales Rep',
    isOfficeRep: role === 'Office Sales Rep',
    isRep: role === 'Field Sales Rep' || role === 'Office Sales Rep',
    isCustomer: role === 'Restaurant/Hotel Customer',
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const aliveRef = useRef(true)
  // Who the session belongs to RIGHT NOW. A profile load resolving after a
  // sign-out or account switch is for someone else and must be dropped.
  const currentUserIdRef = useRef<string | null>(null)
  const profileRef = useRef<Profile | null>(null)
  const inFlightRef = useRef<{ userId: string; promise: Promise<void> } | null>(null)

  // Keep the previous object when a refetch returns the same row, so the
  // hourly TOKEN_REFRESHED does not hand every `profile` consumer (App's
  // currentUser memo, and through it the whole tree) a new reference.
  const applyProfile = useCallback((next: Profile | null) => {
    const prev = profileRef.current
    const stable = prev && next && sameProfile(prev, next) ? prev : next
    profileRef.current = stable
    setProfile(stable)
  }, [])

  // The profile is the one dependency the whole app is gated on, so a
  // TRANSIENT failure must never null it: AuthGate would swap the app for
  // LoginPage with a valid session still in hand, losing cart and pick state.
  // Concurrent loads for the same user share one request (getSession and
  // INITIAL_SESSION both ask at startup).
  const loadProfile = useCallback((userId: string): Promise<void> => {
    const pending = inFlightRef.current
    if (pending && pending.userId === userId) return pending.promise

    const promise: Promise<void> = (async () => {
      const result = await fetchProfile(userId)
      if (!aliveRef.current || currentUserIdRef.current !== userId) return
      if (result.ok) {
        applyProfile(result.profile)
        setProfileError(false)
        return
      }
      // Keep what we already have for this user. Only a user with no loaded
      // profile is left without one — and is flagged, not signed out.
      if (profileRef.current?.id === userId) return
      applyProfile(null)
      setProfileError(true)
    })().finally(() => {
      if (inFlightRef.current?.promise === promise) inFlightRef.current = null
    })
    inFlightRef.current = { userId, promise }
    return promise
  }, [applyProfile])

  useEffect(() => {
    aliveRef.current = true

    // Defense-in-depth: any error in getSession or fetchProfile must
    // still flip isLoading to false, otherwise AuthGate's spinner is
    // stuck forever. The previous .then-chain swallowed rejections.
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!aliveRef.current) return
        if (session?.user) {
          currentUserIdRef.current = session.user.id
          setUser(session.user)
          await loadProfile(session.user.id)
        }
      } catch {
        // Fall through — render LoginPage instead of hanging.
      } finally {
        if (aliveRef.current) setIsLoading(false)
      }
    })()

    // Subscribe to auth state changes for the lifetime of the provider.
    //
    // This callback MUST NOT await another supabase call. supabase-js
    // dispatches it while holding its internal auth lock, and fetchProfile
    // issues a PostgREST query, which needs getSession() — which waits for
    // that same lock. The result is a self-deadlock: whatever triggered the
    // event never resolves. It bites setSession() and getSession() (both take
    // the lock) but not signInWithPassword() (which doesn't), which is why
    // ordinary login always worked while the password-recovery screen sat on
    // "Verifying recovery link…" forever.
    //
    // So: synchronous state updates inline, every await deferred to a fresh
    // task that runs after the lock is released.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user ?? null
      currentUserIdRef.current = sessionUser?.id ?? null
      setUser(sessionUser)

      // Record that a refresh happened, for the shift-long soak test.
      //
      // The event name used to be discarded here (`_event`), which is why
      // TOKEN_REFRESHED appeared nowhere in the repo and the persistSession fix
      // could not be verified over a real shift. Nothing downstream branches on
      // it — this is diagnostic only, read by the System Health tab.
      //
      // Safe inside this callback, and the reason matters: the rule above is
      // "no AWAIT", not "no work". supabase-js dispatches this while holding
      // its auth lock; a localStorage write is synchronous and takes no lock,
      // so it cannot deadlock the way a PostgREST query would. Nothing is
      // awaited and no supabase call is added.
      recordAuthEvent(event, session?.expires_at ?? null)

      if (sessionUser === null) {
        inFlightRef.current = null
        applyProfile(null)
        setProfileError(false)
        setIsLoading(false)
        return
      }

      setTimeout(() => {
        // A sign-out can land between the event and this task.
        if (currentUserIdRef.current !== sessionUser.id) return
        void loadProfile(sessionUser.id).finally(() => {
          if (aliveRef.current) setIsLoading(false)
        })
      }, 0)
    })

    return () => {
      aliveRef.current = false
      subscription.unsubscribe()
    }
  }, [loadProfile, applyProfile])

  const userId = user?.id ?? null
  const retryProfile = useCallback(
    (): Promise<void> => (userId ? loadProfile(userId) : Promise.resolve()),
    [userId, loadProfile],
  )

  const signIn = useCallback(async (email: string, password: string): Promise<void> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async (): Promise<void> => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const role = profile?.role
  const value = useMemo<AuthContextType>(() => ({
    user,
    profile,
    isLoading,
    profileError,
    retryProfile,
    ...deriveRoleBooleans(role),
    signIn,
    signOut,
  }), [user, profile, isLoading, profileError, retryProfile, role, signIn, signOut])

  return React.createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
