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
  | 'Stock'
  | 'Receiving'
  | 'Putaway'
  | 'Replenishment'
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
  'Order Import',
  'Promotions',
  'Accounts',
  'Stock',
  'Receiving',
  'Putaway',
  'Replenishment',
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
    'Order Import',
    'Accounts',
    'Stock',
    'Receiving',
    'Putaway',
    'Replenishment',
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
    'Stock',
    'Documents',
    'Warehouse',
  ],
}

/** True when `role` can render `tab`. Unknown roles get nothing. */
export function roleCanOpenTab(role: string, tab: AdminTab): boolean {
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
