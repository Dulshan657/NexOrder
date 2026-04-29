// Shared auth + role-check helper for Edge Functions.
//
// Every privileged Edge Function starts with the same dance: read the
// `Authorization: Bearer <jwt>` header, resolve the auth user, look up the
// matching `profiles` row to get role + horeca_id, and reject on any failure.
// `requireAuth` collapses that into one call and throws structured
// `EdgeFunctionError`s that the caller can convert to a response envelope.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'

export type UserRole =
  | 'Admin'
  | 'Manager'
  | 'Field Sales Rep'
  | 'Office Sales Rep'
  | 'Restaurant/Hotel Customer'

export interface AuthProfile {
  id: string
  role: UserRole
  horeca_id: number | null
}

export interface AuthContext {
  userId: string
  role: UserRole
  profile: AuthProfile
  userClient: SupabaseClient
}

export interface RequireAuthOptions {
  /**
   * Restrict access to one or more roles. If the caller's role is not in this
   * list, `requireAuth` throws `EdgeFunctionError('FORBIDDEN', ...)`.
   * Omit to allow any authenticated user.
   */
  allowedRoles?: ReadonlyArray<UserRole>
}

/**
 * Validate the `Authorization` header on `req`, look up the caller's profile,
 * and optionally enforce a role allow-list.
 *
 * Throws `EdgeFunctionError`:
 *   - `UNAUTHORIZED` (401) — missing/invalid JWT or no auth user.
 *   - `FORBIDDEN`    (403) — profile not found, or role not in `allowedRoles`.
 */
export async function requireAuth(
  req: Request,
  options: RequireAuthOptions = {},
): Promise<AuthContext> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    throw new EdgeFunctionError('INTERNAL', 'Supabase env vars not configured')
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new EdgeFunctionError('UNAUTHORIZED', 'Missing Authorization header')
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: authUser, error: authError } = await userClient.auth.getUser()
  if (authError || !authUser?.user) {
    throw new EdgeFunctionError('UNAUTHORIZED', 'Invalid session')
  }

  const userId = authUser.user.id
  const { data: profileRow, error: profileError } = await userClient
    .from('profiles')
    .select('id, role, horeca_id')
    .eq('id', userId)
    .single()

  if (profileError || !profileRow) {
    throw new EdgeFunctionError('FORBIDDEN', 'Profile not found for user')
  }

  const profile = profileRow as AuthProfile

  if (options.allowedRoles && !options.allowedRoles.includes(profile.role)) {
    throw new EdgeFunctionError(
      'FORBIDDEN',
      `Role "${profile.role}" is not permitted for this action`,
    )
  }

  return {
    userId,
    role: profile.role,
    profile,
    userClient,
  }
}
