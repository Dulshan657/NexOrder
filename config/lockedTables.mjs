// Which tables must NOT be directly writable by a client JWT, and by which
// Edge Function they are written instead.
//
// WHY THIS FILE EXISTS. CLAUDE.md carries a "server-side lockdown" table that
// has stated since 00013 that `orders` and `order_items` were locked to the
// place-order / update-order-status Edge Functions. They were not: 00009 and
// 00010 dropped some policies and revoked nothing, so `authenticated` kept the
// INSERT/UPDATE/DELETE grants 00001:1084 handed out, and three write policies
// survived. Security-audit finding DB-1, closed by mig 00112.
//
// The defect was not that someone forgot a REVOKE. It is that a claim about the
// database lived only in prose, so the only way to check it was to read 118
// migrations and reason about what they left behind — which three audits did,
// and got wrong. This file is that claim written down in a form a script can
// test against the live database. `npm run check:grants -- --env=<target>` is
// the test.
//
// ADDING A ROW HERE IS PART OF SHIPPING A LOCKDOWN, not a follow-up. A table
// that routes its mutations through an Edge Function but is missing here is
// exactly the state `orders` was in.
//
// SELECT is deliberately not modelled. The read side is governed by RLS
// policies (00105 closed eight of the nine `USING (true)` ones), and a policy
// predicate is not something a grant listing can check. This file answers one
// question only: can a client JWT write to this table at all.

/**
 * Privileges no client-facing role may hold on a locked table.
 *
 * TRUNCATE is in the list and belongs there more than the other three do: it is
 * the one write RLS cannot constrain, because there is no row for a policy to
 * filter. Every "this table is locked down" claim in CLAUDE.md is a claim about
 * row-level access, so TRUNCATE was outside all of them -- and no migration in
 * the corpus has ever revoked it from anyone. PostgREST never emits a TRUNCATE,
 * so it is a latent privilege rather than a live exploit, which is why the
 * inherited ones sit in config/grantBaseline.mjs instead of failing the build.
 */
export const CLIENT_WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']

/** The roles a browser can ever authenticate as. `service_role` is absent on
 *  purpose — it bypasses both RLS and grants, and every Edge Function uses it. */
export const CLIENT_ROLES = ['anon', 'authenticated']

/**
 * Locked tables, in the order CLAUDE.md's lockdown table lists them.
 *
 * `except` names a column-level grant that is legitimately still held, for the
 * two tables locked at column granularity rather than table granularity. An
 * entry with no `except` must hold none of CLIENT_WRITE_PRIVILEGES at all.
 */
export const LOCKED_TABLES = [
  { table: 'orders', fn: 'place-order / update-order-status / cancel-order', migration: '00112' },
  { table: 'order_items', fn: 'place-order / approve-po', migration: '00112' },
  { table: 'app_settings', fn: 'mutate-app-settings', migration: '00013' },
  { table: 'promotions', fn: 'mutate-promotion', migration: '00013' },
  { table: 'horecas', fn: 'mutate-horeca', migration: '00013' },
  { table: 'horeca_pricing', fn: 'mutate-horeca', migration: '00013' },
  { table: 'horeca_payment_methods', fn: 'mutate-horeca', migration: '00013' },
  { table: 'suppliers', fn: 'mutate-supplier', migration: '00013' },
  { table: 'purchase_orders', fn: 'mutate-purchase-order', migration: '00013' },
  { table: 'purchase_order_items', fn: 'mutate-purchase-order', migration: '00013' },
  { table: 'sales_targets', fn: 'mutate-sales-target', migration: '00013' },
  { table: 'pantry_items', fn: 'mutate-pantry-item', migration: '00013' },
  { table: 'products', fn: 'mutate-product', migration: '00013' },
  { table: 'invoices', fn: 'place-order / mutate-invoice-status', migration: '00017' },
  { table: 'horeca_addresses', fn: 'mutate-horeca-address', migration: '00021' },
  { table: 'rate_limit_counters', fn: 'rate_limit_hit() RPC', migration: '00026' },
  {
    table: 'profiles',
    fn: 'invite-user',
    migration: '00011',
    // 00011 revoked INSERT outright but only the (role, horeca_id) COLUMNS of
    // UPDATE: a user may still edit their own name and phone directly. That is
    // the documented design, not a gap — recorded here so the check does not
    // report it every run and train people to ignore the output.
    except: ['UPDATE'],
  },
  { table: 'inventory_balances', fn: 'receive-stock / adjust-stock / transfer-stock / record-pick / count-bin', migration: '00027' },
  { table: 'inventory_movements', fn: 'the inv_* RPCs (service_role only)', migration: '00027' },
  { table: 'locations', fn: 'mutate-warehouse / mutate-warehouse-location', migration: '00036' },
  { table: 'warehouse_layouts', fn: 'mutate-layout / publish-layout', migration: '00045' },
  { table: 'layout_objects', fn: 'mutate-layout / mutate-warehouse-location', migration: '00045' },
  { table: 'layout_placements', fn: 'mutate-layout / publish-layout', migration: '00045' },
  { table: 'product_home_bins', fn: 'mutate-product-home-bin', migration: '00045' },
  { table: 'zone_profiles', fn: 'mutate-zone-profile', migration: '00045' },
  { table: 'storage_types', fn: 'mutate-storage-type', migration: '00045' },
  { table: 'wie_rules', fn: 'mutate-wie-rule', migration: '00045' },
  { table: 'handling_units', fn: 'generate-labels / receive-stock / complete-putaway', migration: '00074' },
  { table: 'label_print_log', fn: 'generate-labels / confirm-label-print', migration: '00074' },
  { table: 'level_roles', fn: 'mutate-level-role', migration: '00081' },
  { table: 'wie_replen_tasks', fn: 'the *-replenishment functions', migration: '00082' },
  { table: 'warehouse_setup_acknowledgements', fn: 'mutate-warehouse-setup-ack', migration: '00092' },
  { table: 'audit_events', fn: 'service_role only — written by _shared/audit.ts', migration: '00012' },
  { table: 'client_errors', fn: 'log-client-error', migration: '00014' },
  { table: 'warehouse_label_prefs', fn: 'mutate-warehouse set_label_prefs', migration: '00106' },
  { table: 'warehouse_print_calibration', fn: 'mutate-warehouse set_print_calibration', migration: '00110' },
  { table: 'warehouse_code_patterns', fn: 'mutate-warehouse set_code_pattern', migration: '00107' },
  { table: 'location_code_sweeps', fn: 'mutate-warehouse-location recode_locations', migration: '00108' },
  { table: 'slotting_blocks', fn: 'mutate-slotting-rule', migration: '00115' },
  { table: 'slotting_block_members', fn: 'mutate-slotting-rule', migration: '00115' },
  { table: 'slotting_rules', fn: 'mutate-slotting-rule', migration: '00115' },
  { table: 'slotting_rule_blocks', fn: 'mutate-slotting-rule', migration: '00115' },
  { table: 'wie_offhome_tasks', fn: 'mutate-offhome-task', migration: '00119' },
]
