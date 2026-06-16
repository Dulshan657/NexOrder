// Single-account demo personas that get a bespoke UI without a generalised
// per-user config layer. Currently just the "Tridon" PO-Inbox demo: an Admin
// login whose sidebar leads with PO Inbox → Order Import → Shop and wears
// Tridon's logo. Keyed on email so the special-case stays out of AppShell's
// render tree and is unit-testable in isolation.
//
// If more demo personas appear, promote this into a small email→persona map
// instead of adding more one-off predicates.

/** Email of the Tridon demo account (see docs / tridon-demo-seed.mjs). */
export const TRIDON_DEMO_EMAIL = 'tridon@nexorder.demo'

/** True when the signed-in user is the Tridon PO-Inbox demo account. */
export function isTridonDemoUser(user: { email?: string | null } | null | undefined): boolean {
  const email = user?.email
  if (!email) return false
  return email.trim().toLowerCase() === TRIDON_DEMO_EMAIL
}
