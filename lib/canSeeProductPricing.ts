// Who is shown what a product is worth.
//
// The floor needs the goods, the quantity and the bin. It does not need the
// sell price and it certainly does not need the supplier's cost — and on a
// 360px handheld every line that does not help place a pallet is a line that
// pushes the one that does off the screen.
//
// ── THIS IS A DISPLAY RULE, NOT A SECURITY CONTROL ─────────────────────────
//
// Exactly as `canSeeOrderValue` is, and for the same reason: `products.price`
// is readable by anyone RLS lets read the catalogue, and a Warehouse login
// legitimately reads it. Hiding the figure keeps it off the screen; it does not
// keep it out of the response. The security controls are roles and RLS.
// `product_suppliers.cost_price` is separately staff-only at the RLS layer
// (mig 00105) — this rule narrows it further for display, it does not create it.
//
// ── WHY NOT JUST CALL canSeeOrderValue ─────────────────────────────────────
//
// The two happen to return the same answer today, and that is a coincidence of
// there being one role to withhold from rather than a shared rule. They answer
// different questions about different objects: one is "what is this ORDER
// worth", the other "what does this PRODUCT cost and sell for". Folding them
// into one predicate would mean the next role that should see one but not the
// other has nowhere to go.

import { UserRole } from '../types'

export function canSeeProductPricing(role: UserRole | string | null | undefined): boolean {
  return role !== UserRole.WAREHOUSE
}
