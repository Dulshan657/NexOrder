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

    // Subscribe to auth state changes for the lifetime of the provider
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        try {
          if (session?.user) {
            setUser(session.user)
            const profileData = await fetchProfile(session.user.id)
            setProfile(profileData)
          } else {
            setUser(null)
            setProfile(null)
          }
        } finally {
          setIsLoading(false)
        }
      }
    )

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
