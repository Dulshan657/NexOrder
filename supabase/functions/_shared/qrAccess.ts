// Who may manage a venue's QR access, and who may approve its held orders.
//
// One rule, used twice. The people who can add and remove a venue's kitchen PINs
// are the same people who decide its QR orders: they are the venue's own
// Customer logins, the reps ASSIGNED to it, and Admin/Manager. Keeping the rule
// in one function means "who can print the poster" and "who can approve the
// order" cannot drift apart.
//
//   Admin, Manager              every venue
//   Field / Office Sales Rep    only a venue with a `horeca_reps` row for them
//   Restaurant/Hotel Customer   only the venue on their own profile
//   anyone else                 no -- Warehouse, and QR Staff in particular (a
//                               kitchen login must never manage its own PINs)
//
// This is the SERVER-side check. It reads `horeca_reps` through a service-role
// client because the caller is deciding about a venue that may not be theirs,
// and it fails CLOSED on every ambiguous input. RLS on `qr_staff` /
// `qr_order_requests` (mig 00130) is the second, independent statement of the
// same rule for reads.
//
// The caller is typed structurally rather than as `AuthContext`: importing
// `auth.ts` here would drag `Deno.env` into the unit tests' type-check (see the
// note at the top of `cors.ts`), and the three fields used are all it needs.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'

export interface QrAccessCaller {
  userId: string
  role: string
  profile: { horeca_id: number | null }
}

const ALL_VENUES_ROLES: ReadonlySet<string> = new Set(['Admin', 'Manager'])
const ASSIGNED_REP_ROLES: ReadonlySet<string> = new Set(['Field Sales Rep', 'Office Sales Rep'])

/**
 * May this caller manage QR access for, and decide held orders of, this venue?
 *
 * Throws INTERNAL if the assignment lookup itself fails -- a database fault is
 * neither "yes" nor "no", and answering "no" would tell a rep they were not
 * assigned when they were.
 */
export async function canManageHoreca(
  service: SupabaseClient,
  auth: QrAccessCaller,
  horecaId: number,
): Promise<boolean> {
  if (!Number.isInteger(horecaId) || horecaId <= 0) return false

  if (ALL_VENUES_ROLES.has(auth.role)) return true

  if (auth.role === 'Restaurant/Hotel Customer') {
    return auth.profile.horeca_id !== null && auth.profile.horeca_id === horecaId
  }

  if (ASSIGNED_REP_ROLES.has(auth.role)) {
    const { data, error } = await service
      .from('horeca_reps')
      .select('rep_id')
      .eq('horeca_id', horecaId)
      .eq('rep_id', auth.userId)
      .maybeSingle()
    if (error) {
      throw new EdgeFunctionError('INTERNAL', 'Could not check venue assignment')
    }
    return data !== null && data !== undefined
  }

  return false
}

/** Deciding a held order is allowed to exactly the people who manage the venue. */
export const canApproveHoreca = canManageHoreca

/** `canManageHoreca`, as a guard: FORBIDDEN unless it passes. */
export async function requireManageHoreca(
  service: SupabaseClient,
  auth: QrAccessCaller,
  horecaId: number,
): Promise<void> {
  if (!(await canManageHoreca(service, auth, horecaId))) {
    throw new EdgeFunctionError('FORBIDDEN', 'You do not have access to this venue')
  }
}
