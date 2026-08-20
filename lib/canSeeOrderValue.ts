// Who is shown what an order is worth.
//
// Warehouse staff pick, pack and dispatch: they need the product, the quantity
// and the bin, and none of the money. That is ordinary practice in
// distribution, and on a phone held in one hand at a rack it removes a column
// from every screen that had one.
//
// ── THIS IS A DISPLAY RULE, NOT A SECURITY CONTROL ─────────────────────────
//
// `orders.total` and `order_items.price` are readable by anyone RLS lets see
// the order, and a Warehouse login legitimately sees the orders it is picking.
// Hiding the figure keeps it off the screen; it does not keep it out of the
// response, and nothing here should be mistaken for a claim that it does. The
// security controls are roles and RLS, exactly as with the module gates.
//
// Deliberately a role test rather than a module test: money is not a surface a
// tenant does or does not buy, so this stays true whatever `invoicing` is set
// to and whoever else is added to the role list.

import { UserRole } from '../types'

export function canSeeOrderValue(role: UserRole | string | null | undefined): boolean {
  return role !== UserRole.WAREHOUSE
}
