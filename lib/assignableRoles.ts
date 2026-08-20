import { UserRole } from '../types'

import { MODULE_INVENTORY_DISPATCH, MODULE_SHOP } from './modules'

/**
 * The roles an admin may actually assign in THIS build.
 *
 * A role whose every surface belongs to a disabled module has no nav, no
 * landing view and nothing to render — `AppShell` returns an empty sidebar and
 * `AdminView` renders nothing. Offering it in the invite form would let an
 * admin create an account that logs in successfully to a blank page, which is
 * the worst of both failure modes: the login works, so nothing looks broken,
 * and there is no error message anywhere to explain it.
 *
 * WAREHOUSE is the clear case — `AppShell`'s entire `isWarehouse` branch is
 * Inventory & Dispatch surfaces, so with that module off the role is empty.
 *
 * CUSTOMER is the second clear case, added when `shop` was split out of
 * `sales_orders` on 2026-08-20. A customer login has exactly two surfaces, the
 * Shop and their own order history, and both are self-service ordering. With
 * `shop` off there is no catalogue for them to browse and no way for them to
 * place anything — a tenant whose orders are keyed in by their own office staff
 * has no customer logins by definition.
 *
 * FIELD_SALES_REP is NOT withheld with Field Ops off, and the difference is
 * worth stating: a field rep still has the Shop, Order Import, Accounts and the
 * customer list. Losing Scheduled Visits and Walk-in Review costs them the
 * *field* half of the job, not the job. The same reasoning survives the split —
 * with `shop` off a rep keeps Order Import, the customer list and Stock. Only
 * remove a role when the modules take away everything it could do.
 *
 * This is a build-time constant list, folded like every other module check, so
 * a disabled role's option is not in the shipped markup rather than hidden by
 * CSS. It is a UI affordance and not a security control: the server decides
 * what a role may do, and `invite-user` validates the role it is handed.
 */
export const assignableRoles: ReadonlyArray<UserRole> = Object.values(UserRole).filter((role) => {
  if (role === UserRole.WAREHOUSE) return MODULE_INVENTORY_DISPATCH
  if (role === UserRole.CUSTOMER) return MODULE_SHOP
  return true
})
