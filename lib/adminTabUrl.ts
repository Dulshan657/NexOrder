// Pure, node-testable helpers for the `?tab=` admin-view deep link, in the same
// shape as lib/subtabUrl.ts (which owns `?subtab=`). No `window` access, so both
// live happily in vitest's node environment.
//
// WHY `?tab=` EXISTS. AppShell held `adminView` in useState and never wrote it
// to the URL, so every deep link in the app (?designer=, ?wh=, ?subtab=) worked
// on a click and broke on a refresh — and the orphaned params left behind would
// cross-fire into whichever tab read them next. Putting the tab in the URL is
// what makes a setup-checklist link survive being pasted, and it closes that
// orphan-param class of bug rather than adding to it.

import {
  MODULE_FIELD_OPS,
  MODULE_INVENTORY_DISPATCH,
  MODULE_INVOICING,
  MODULE_PO_INBOX,
  MODULE_PROMOTIONS,
  MODULE_SALES_ORDERS,
  MODULE_SHOP,
} from './modules'

/** The admin/staff view identifiers. Owned here so URL parsing can validate
 *  against them without importing a component; re-exported by AdminView.tsx so
 *  existing `import type { AdminTab } from './AdminView'` call sites still work. */
export type AdminTab =
  | 'Dashboard'
  | 'Shop'
  | 'Products'
  | 'HoReCa'
  | 'HoReCa Insights'
  | 'Order Import'
  | 'Promotions'
  | 'Accounts'
  | 'New Order'
  | 'Stock'
  | 'Receiving'
  | 'Putaway'
  | 'Replenishment'
  | 'Off-home'
  | 'Stocktake'
  | 'Pick Queue'
  | 'Dispatched'
  | 'Documents'
  | 'Warehouse'
  | 'Scheduled Visits'
  | 'Walk-in Review'
  | 'Users'
  | 'Suppliers'
  | 'PO Inbox'
  | 'Settings'
  | 'Audit Log'
  | 'System Health'

export const ADMIN_TABS: ReadonlyArray<AdminTab> = [
  'Dashboard',
  'Shop',
  'Products',
  'HoReCa',
  'HoReCa Insights',
  'New Order',
  'Order Import',
  'Promotions',
  'Accounts',
  'Stock',
  'Receiving',
  'Putaway',
  'Replenishment',
  'Off-home',
  'Stocktake',
  'Pick Queue',
  'Dispatched',
  'Documents',
  'Warehouse',
  'Scheduled Visits',
  'Walk-in Review',
  'Users',
  'Suppliers',
  'PO Inbox',
  'Settings',
  'Audit Log',
  'System Health',
]

/**
 * What each tab is CALLED, as opposed to what it is keyed by.
 *
 * Almost an identity map, and that is the trap: `'Receiving'` renders as
 * **"Receive Stock"** in the sidebar, so anything that shows `adminView`
 * directly is right 26 times out of 27 and wrong on the one screen a warehouse
 * operator is on most of the day.
 *
 * It lives here, beside the union it covers, because this module is deliberately
 * `window`-free and node-testable — `__tests__/adminTabUrl.test.ts` asserts the
 * map is exhaustive over `ADMIN_TABS`, which is what stops a newly added tab
 * from rendering a blank title in the mobile top bar.
 *
 * The sidebar still writes its labels inline in JSX (they carry icons and live
 * badge counts, so they are not a data structure). These two must agree; the
 * test pins the map, and `tests/e2e/mobile/top-bar.spec.ts` pins the agreement
 * by navigating via the sidebar's label and reading the top bar's title.
 */
export const ADMIN_TAB_LABELS: Record<AdminTab, string> = {
  Dashboard: 'Dashboard',
  Shop: 'Shop',
  Products: 'Products',
  HoReCa: 'HoReCa',
  'HoReCa Insights': 'HoReCa Insights',
  'Order Import': 'Order Import',
  Promotions: 'Promotions',
  Accounts: 'Accounts',
  'New Order': 'New Order',
  Stock: 'Stock',
  Receiving: 'Receive Stock',
  Putaway: 'Putaway',
  Replenishment: 'Replenishment',
  'Off-home': 'Off-home',
  Stocktake: 'Stocktake',
  'Pick Queue': 'Pick Queue',
  Dispatched: 'Dispatched',
  Documents: 'Documents',
  Warehouse: 'Warehouse',
  'Scheduled Visits': 'Scheduled Visits',
  'Walk-in Review': 'Walk-in Review',
  Users: 'Users',
  Suppliers: 'Suppliers',
  'PO Inbox': 'PO Inbox',
  Settings: 'Settings',
  'Audit Log': 'Audit Log',
  'System Health': 'System Health',
}

/**
 * Read `?tab=` from a search string, validating against the known set.
 *
 * Tab values contain spaces ('Pick Queue'), so callers must let URLSearchParams
 * do the encoding rather than concatenating — which is exactly why this reads
 * through URLSearchParams too.
 *
 * Returns `null` rather than a fallback: the caller has its own default (role
 * landing view, demo persona, Dashboard) and needs to tell "no tab requested"
 * apart from "Dashboard requested".
 */
export function parseAdminTab(search: string): AdminTab | null {
  const raw = new URLSearchParams(search).get('tab')
  if (raw && (ADMIN_TABS as ReadonlyArray<string>).includes(raw)) {
    return raw as AdminTab
  }
  return null
}

/**
 * Which module owns each tab. Tabs absent from this map are CORE and always
 * available: Dashboard, Products, HoReCa, Users, Suppliers, Settings, Audit
 * Log, System Health. You cannot sell a catalogue-less ordering system, and a
 * tenant with one module still needs a customer list and a way to add staff.
 *
 * Note the two that look like they belong to a module and do not:
 *
 *   - `HoReCa` is core while `HoReCa Insights` is Field Ops. The customer list
 *     is how orders get placed at all; the analytics on top of it is the thing
 *     being sold.
 *   - `Products` is core although the sidebar draws it under "Inventory &
 *     Dispatch". The heading is where an operator looks for it; the catalogue
 *     itself is what Sales & Orders reads prices from. Grouping is a UI fact,
 *     licensing is a commercial one, and this is the seam where they differ.
 */
const TAB_MODULES: Partial<Record<AdminTab, ModuleName>> = {
  // The four that used to be 'sales_orders' with these two. A tenant can key
  // orders in and run a warehouse while buying none of them.
  Shop: 'shop',
  'PO Inbox': 'po_inbox',
  Accounts: 'invoicing',
  Promotions: 'promotions',

  'New Order': 'sales_orders',
  'Order Import': 'sales_orders',

  'HoReCa Insights': 'field_ops',
  'Scheduled Visits': 'field_ops',
  'Walk-in Review': 'field_ops',

  Stock: 'inventory_dispatch',
  Receiving: 'inventory_dispatch',
  Putaway: 'inventory_dispatch',
  Replenishment: 'inventory_dispatch',
  'Off-home': 'inventory_dispatch',
  Stocktake: 'inventory_dispatch',
  'Pick Queue': 'inventory_dispatch',
  Dispatched: 'inventory_dispatch',
  Documents: 'inventory_dispatch',
  Warehouse: 'inventory_dispatch',
}

export type ModuleName =
  | 'sales_orders'
  | 'shop'
  | 'po_inbox'
  | 'promotions'
  | 'invoicing'
  | 'field_ops'
  | 'inventory_dispatch'

/** The module a tab needs, or `null` when the tab is core. */
export function moduleForTab(tab: AdminTab): ModuleName | null {
  return TAB_MODULES[tab] ?? null
}

/**
 * Is this tab's module enabled in this build?
 *
 * Reads the folded constants rather than an array, so a disabled module's
 * branch is removed at build time — see lib/modules.ts for why that distinction
 * is the whole mechanism.
 */
export function tabModuleEnabled(tab: AdminTab): boolean {
  const module = moduleForTab(tab)
  if (module === null) return true
  if (module === 'sales_orders') return MODULE_SALES_ORDERS
  if (module === 'shop') return MODULE_SHOP
  if (module === 'po_inbox') return MODULE_PO_INBOX
  if (module === 'promotions') return MODULE_PROMOTIONS
  if (module === 'invoicing') return MODULE_INVOICING
  if (module === 'field_ops') return MODULE_FIELD_OPS
  return MODULE_INVENTORY_DISPATCH
}

/**
 * Which tabs a role may actually render. AdminView role-gates each branch and
 * silently renders NOTHING when a gate fails, so an unvalidated `?tab=` is a
 * blank page rather than an error. Every deep link is therefore checked against
 * this before it is honoured.
 *
 * Mirrors the gates in components/AdminView.tsx and the sidebar in AppShell.
 * Roles arrive as the plain strings from the UserRole enum to keep this module
 * free of a types.ts import cycle.
 */
const TABS_BY_ROLE: Record<string, ReadonlyArray<AdminTab>> = {
  Admin: ADMIN_TABS,
  Manager: [
    'Dashboard',
    'Products',
    'HoReCa',
    'HoReCa Insights',
    'New Order',
    'Order Import',
    'Accounts',
    'Stock',
    'Receiving',
    'Putaway',
    'Replenishment',
    'Off-home',
    'Stocktake',
    'Pick Queue',
    'Dispatched',
    'Documents',
    'Warehouse',
    'Scheduled Visits',
    'Walk-in Review',
    'PO Inbox',
  ],
  Warehouse: [
    'Pick Queue',
    'Dispatched',
    'Receiving',
    'Putaway',
    'Replenishment',
    'Off-home',
    'Stocktake',
    'Stock',
    'Documents',
    'Warehouse',
  ],
}

/**
 * True when `role` can render `tab` in THIS build. Unknown roles get nothing.
 *
 * The module check is not optional decoration. `AdminView` renders nothing when
 * a gate fails, so an un-checked `?tab=Warehouse` on a build without Inventory
 * & Dispatch is a blank page — the exact failure `?tab=` was added to stop,
 * arriving by a new route. A link to a module the tenant does not have degrades
 * to their normal landing view, the same as a link to a tab their role cannot
 * open.
 */
export function roleCanOpenTab(role: string, tab: AdminTab): boolean {
  if (!tabModuleEnabled(tab)) return false
  return (TABS_BY_ROLE[role] ?? []).includes(tab)
}

/**
 * The tab a fresh load should open, or `null` to leave the caller's default
 * alone. Combines parsing with the role check so a link a role cannot render
 * degrades to that role's normal landing view instead of a blank screen.
 */
export function adminTabFromSearch(search: string, role: string): AdminTab | null {
  const tab = parseAdminTab(search)
  if (!tab) return null
  return roleCanOpenTab(role, tab) ? tab : null
}
