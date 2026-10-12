// "Belongs to one venue" -- a Customer login OR a kitchen QR Staff login.
//
// Both are scoped to exactly one HoReCa (`profiles.horeca_id`), both shop for
// that venue only, and both see only its orders. The UI scoping (which orders to
// list, which HoReCa the cart is fixed to, which selector to hide) is therefore
// the same for the two, and `role === UserRole.CUSTOMER` checks that stood for
// "a venue login" must also admit QR Staff.
//
// This is UI SCOPING, NOT PERMISSION. A QR Staff login may not place an order
// directly (place-order rejects the role), see invoices, or manage anything.
// Where behaviour differs -- the submit path, the nav, the profile menu -- test
// `isQrStaffRole` explicitly. The server is the control; RLS and the role
// allow-lists decide, this only chooses which screen to draw.

import { UserRole } from '@/types'

type RoleLike = UserRole | string | null | undefined

/** The hidden per-person kitchen login (mig 00129). */
export function isQrStaffRole(role: RoleLike): boolean {
  return role === UserRole.QR_STAFF
}

/** A Customer login or a QR Staff login: someone who belongs to one venue. */
export function isVenueUser(role: RoleLike): boolean {
  return role === UserRole.CUSTOMER || role === UserRole.QR_STAFF
}
