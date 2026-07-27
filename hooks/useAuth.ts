import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

type Profile = Database['public']['Tables']['profiles']['Row']
type UserRole = Profile['role']

interface AuthContextType {
  user: User | null
  profile: Profile | null
  isLoading: boolean
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

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) return null
  return data
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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    // Defense-in-depth: any error in getSession or fetchProfile must
    // still flip isLoading to false, otherwise AuthGate's spinner is
    // stuck forever. The previous .then-chain swallowed rejections.
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        if (session?.user) {
          setUser(session.user)
          const profileData = await fetchProfile(session.user.id)
          if (cancelled) return
          setProfile(profileData)
        }
      } catch {
        // Fall through — render LoginPage instead of hanging.
      } finally {
        if (!cancelled) setIsLoading(false)
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser)

      if (sessionUser === null) {
        setProfile(null)
        setIsLoading(false)
        return
      }

      setTimeout(() => {
        void (async () => {
          try {
            const profileData = await fetchProfile(sessionUser.id)
            if (!cancelled) setProfile(profileData)
          } finally {
            if (!cancelled) setIsLoading(false)
          }
        })()
      }, 0)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string): Promise<void> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signOut = async (): Promise<void> => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const roleBooleans = deriveRoleBooleans(profile?.role)

  const value: AuthContextType = {
    user,
    profile,
    isLoading,
    ...roleBooleans,
    signIn,
    signOut,
  }

  return React.createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
