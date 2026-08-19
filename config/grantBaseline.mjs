// The write grants that are wrong TODAY and are not fixed yet — audit finding
// DB-3, recorded so `check:grants` can fail on anything NEW without drowning in
// what it inherited.
//
// Same idea as `components/overlay-baseline.json`: the guard is absolute for new
// code, and the baseline is the list of things that predate it. The difference
// is that this one is not empty yet, and emptying it is the work DB-3 names.
//
// ── WHAT THIS RECORDS ────────────────────────────────────────────────────────
//
// Measured on dev 2026-08-19, after mig 00112, over the tables in
// config/lockedTables.mjs. Two distinct problems are folded in here, and they
// are NOT equally serious:
//
//  1. `anon` holds INSERT/UPDATE/DELETE on almost every table. Every REVOKE
//     written since 00009 names `authenticated` and only `authenticated`, while
//     this project carries ALTER DEFAULT PRIVILEGES for anon / authenticated /
//     service_role on new objects in `public` (00101, documented in 00102's
//     header). So anon was granted everything and taken back from nowhere.
//     Mitigated in practice: RLS is on for these tables and `anon` satisfies no
//     policy, so PostgREST answers a write with a row-level denial. The grant is
//     a second lock left unlocked, not an open door.
//
//  2. `TRUNCATE` is held by both roles on every table, and TRUNCATE is the one
//     write RLS cannot constrain — there is no row for a policy to filter. It is
//     not reachable through PostgREST, which maps its verbs to
//     SELECT/INSERT/UPDATE/DELETE and never emits a TRUNCATE, so this is a
//     latent privilege rather than a live exploit. It is still a privilege
//     nothing should hold, and it is the reason every "this table is locked
//     down" claim in CLAUDE.md is narrower than it sounds.
//
// `orders` and `order_items` are deliberately ABSENT. Mig 00112 fixed them, and
// their absence is what makes `npm run check:grants` a proof that DB-1 is shut
// rather than a list of everything that has ever been wrong.
//
// ── HOW TO USE IT ────────────────────────────────────────────────────────────
//
// * A NEW violation — a table not listed here, or a privilege not listed against
//   a table that is — FAILS the check. That is the whole point.
// * REMOVING entries is the goal. When DB-3 is closed, delete the ones it
//   covers; when the object is empty, delete the file and the branch in
//   grantExpectations.mjs that reads it.
// * NEVER add an entry to make a failing check pass. A new grant on a locked
//   table is a regression, and the migration that introduced it is the bug.
//   This file is a record of debt, not a suppression list.

/** @type {Record<string, Record<string, string[]>>} */
export const GRANT_BASELINE = {
  app_settings: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  audit_events: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  client_errors: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  handling_units: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  horeca_addresses: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  horeca_payment_methods: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  horeca_pricing: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  horecas: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  inventory_balances: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  inventory_movements: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  invoices: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  label_print_log: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  layout_objects: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  layout_placements: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  level_roles: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  location_code_sweeps: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  locations: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  pantry_items: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  product_home_bins: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  products: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  profiles: { anon: ['DELETE', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'TRUNCATE', 'UPDATE'] },
  promotions: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  purchase_order_items: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  purchase_orders: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  sales_targets: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  storage_types: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  suppliers: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['TRUNCATE'] },
  warehouse_code_patterns: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  warehouse_label_prefs: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  warehouse_layouts: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  warehouse_print_calibration: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  warehouse_setup_acknowledgements: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  wie_replen_tasks: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  wie_rules: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
  zone_profiles: { anon: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'], authenticated: ['DELETE', 'INSERT', 'TRUNCATE', 'UPDATE'] },
}
