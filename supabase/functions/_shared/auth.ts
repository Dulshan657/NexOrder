// Shared auth + role-check helper for Edge Functions.
//
// Every privileged Edge Function starts with the same dance: read the
// `Authorization: Bearer <jwt>` header, resolve the auth user, look up the
// matching `profiles` row to get role + horeca_id, and reject on any failure.
// `requireAuth` collapses that into one call and throws structured
// `EdgeFunctionError`s that the caller can convert to a response envelope.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'

export type UserRole =
  | 'Admin'
  | 'Manager'
  | 'Field Sales Rep'
  | 'Office Sales Rep'
  | 'Restaurant/Hotel Customer'
  | 'Warehouse'
  // A hidden login minted per kitchen staff member behind a venue QR (mig 00129).
  // It is in this union so a function can NAME it in `allowedRoles`; no other
  // function does, so every existing allow-list refuses it by default.
  | 'QR Staff'

export interface AuthProfile {
  id: string
  role: UserRole
  horeca_id: number | null
  /** Warehouse-role staff are scoped to this site (mig 00036); null for others. */
  home_warehouse_id: number | null
}

/**
 * The live `qr_staff` row behind a QR Staff login. Present on the auth result
 * only for that role, and only when the unlock is current -- an expired or
 * revoked one never gets this far, `requireAuth` throws QR_SESSION_EXPIRED.
 */
export interface QrStaffInfo {
  /** qr_staff.id */
  id: string
  name: string
  horecaId: number
  /** ISO timestamp; always in the future at the moment `requireAuth` returns. */
  unlockedUntil: string
}

export interface AuthContext {
  userId: string
  role: UserRole
  profile: AuthProfile
  userClient: SupabaseClient
  /** Non-null exactly when `role === 'QR Staff'`. */
  qrStaff: QrStaffInfo | null
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
 *   - `QR_SESSION_EXPIRED` (401) — a QR Staff login with no live unlock (see
 *     `loadActiveQrStaff`). Only that role pays for the extra query.
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
    .select('id, role, horeca_id, home_warehouse_id')
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

  const qrStaff = profile.role === 'QR Staff' ? await loadActiveQrStaff(profile) : null

  return {
    userId,
    role: profile.role,
    profile,
    userClient,
    qrStaff,
  }
}

/**
 * A QR Staff login is only as good as its unlock. The JWT lasts an hour and the
 * refresh token far longer, so "unlocked for 2 hours" is not a token property --
 * it is `qr_staff.unlocked_until`, and the database enforces it in RLS through
 * `user_horeca_id()`. This is the same rule for the Edge Function side, where
 * the service role bypasses RLS and would otherwise never notice.
 *
 * The row must be unrevoked, unexpired, and agree with `profiles.horeca_id` --
 * the same three conditions `user_horeca_id()` insists on, so a request RLS
 * would call anonymous is never treated as a staff request here.
 *
 * It is read with the SERVICE ROLE, not the caller's client: `auth_user_id` is
 * deliberately not a granted column on `qr_staff`, so a client cannot filter on
 * it. Every miss -- no row, revoked, lapsed, venue mismatch -- is the same
 * QR_SESSION_EXPIRED, because to the phone they all mean "show the PIN pad".
 */
async function loadActiveQrStaff(profile: AuthProfile): Promise<QrStaffInfo> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    throw new EdgeFunctionError('INTERNAL', 'Supabase env vars not configured')
  }
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const { data, error } = await service
    .from('qr_staff')
    .select('id, name, horeca_id, unlocked_until')
    .eq('auth_user_id', profile.id)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) {
    // Not "expired": a database fault must not read as the user's problem and
    // bounce a working phone to the PIN pad.
    throw new EdgeFunctionError('INTERNAL', 'Could not verify the QR session')
  }

  const row = data as
    | { id: string; name: string; horeca_id: number; unlocked_until: string | null }
    | null
  if (
    !row ||
    row.horeca_id !== profile.horeca_id ||
    !row.unlocked_until ||
    new Date(row.unlocked_until).getTime() <= Date.now()
  ) {
    throw new EdgeFunctionError('QR_SESSION_EXPIRED', 'Your session has ended. Enter your PIN again.')
  }

  return {
    id: row.id,
    name: row.name,
    horecaId: row.horeca_id,
    unlockedUntil: row.unlocked_until,
  }
}
