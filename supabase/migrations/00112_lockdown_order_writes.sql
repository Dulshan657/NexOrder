-- =============================================================================
-- The order ledger stops being directly writable over PostgREST
-- Migration: 00112_lockdown_order_writes.sql
-- =============================================================================
-- Security-audit finding DB-1 (2026-08-19). CLAUDE.md has stated twice, since
-- 00013 was written, that `orders` and `order_items` are locked to the
-- place-order / update-order-status Edge Functions. They were not, and the
-- wrong text is why this survived three audits: everyone who checked read the
-- claim rather than the grants.
--
-- WHAT WAS ACTUALLY TRUE UNTIL NOW.
--   * 00001:1084 grants SELECT, INSERT, UPDATE, DELETE on both tables to
--     `authenticated`. No migration in the corpus ever revoked it.
--   * 00009 dropped only the two INSERT policies; 00010 dropped only
--     `orders_update_admin_manager`. Neither contains a REVOKE for these two
--     tables -- 00009's single REVOKE is the column-level one on
--     products.inventory.
--   * Three 00001 write policies were therefore still live, each with a
--     matching grant behind it:
--         orders_delete_admin              (00001:676) DELETE, Admin
--         order_items_update_admin_manager (00001:728) UPDATE, Admin/Manager
--         order_items_delete_admin_manager (00001:734) DELETE, Admin/Manager
--   * 00013:15-21 says in writing that orders/order_items were "already covered
--     by earlier lockdown migrations (do NOT repeat here)" and skipped them, so
--     the one migration that revoked eleven other tables passed over these two
--     on a false premise.
--
-- WHY IT MATTERED. A Manager could PATCH /rest/v1/order_items and rewrite a
-- delivered, invoiced line's quantity or unit_price; an Admin could DELETE an
-- order outright. Neither path reaches _shared/audit.ts, so no audit_events row
-- is written. Neither calls inv_release_reservation, so the allocation legs in
-- inventory_movements survive and inventory_balances.available disagrees with
-- the ledger permanently. Both tables are in the supabase_realtime publication
-- (00015:14-15), so the tampering propagates live to every subscribed client.
--
-- These were the only two "locked down" tables in the schema closed by
-- policy-deletion alone. 00017:48-51 is the pattern they needed: DROP the
-- policies AND REVOKE the grant. Absence of a policy denies the write only for
-- as long as nobody adds one back; the grant is what makes the denial
-- structural.
--
-- NOTHING LEGITIMATE BREAKS, verified before shipping. Every writer is
-- service_role, which bypasses both RLS and table grants: place-order,
-- approve-po, update-order-status, record-pick, _shared/fulfillment.ts, and the
-- seed/ops scripts via scripts/lib/devClient.mjs. The browser client touches
-- these tables SELECT-only (services/supabase/orderService.ts, pickService.ts);
-- there is no deleteOrder or cancelOrder helper in the frontend. requireAuth's
-- userClient (_shared/auth.ts:68) is used for auth.getUser() and the profiles
-- lookup and for nothing else.
--
-- THE CAPABILITY IS NOT MERELY REMOVED, IT IS REPLACED. 00111 added a terminal
-- `cancelled` status and the cancel-order Edge Function: Admin-only, reason
-- mandatory, reservation released through inv_release_reservation, one audit
-- event, and a refusal if the order has been picked or its invoice paid. That
-- is what an Admin should have had instead of DELETE all along.
--
-- THE DEFECT IS WIDER THAN DB-1 DESCRIBED, and the pre-flight is what showed it.
-- The audit checked `authenticated` only. On dev, before this migration, BOTH
-- `anon` and `authenticated` held INSERT, UPDATE, DELETE **and TRUNCATE** on
-- both tables -- and TRUNCATE on all 71 public tables. This project carries
-- ALTER DEFAULT PRIVILEGES for anon / authenticated / service_role on new
-- objects in `public` (discovered in 00101, documented in 00102's header, where
-- a view whose comment said "not granted to authenticated" had been created
-- with full CRUD for all three roles), and every REVOKE written since 00009 has
-- named `authenticated` and the three DML verbs. So `anon` was never taken back
-- from at all, and TRUNCATE never from anyone.
--
-- That matters most for TRUNCATE, because it is the one write RLS cannot touch:
-- there is no row for a policy to filter. Every claim in this repo that a table
-- is "locked down" is a claim about row-level access, and TRUNCATE was outside
-- all of them.
--
-- The same is true of ~40 other tables (audit finding DB-3) and is NOT fixed
-- here -- the audit sequences DB-3 after DB-1 and the storage findings so the
-- re-grant list is correct first. It is recorded instead in
-- config/grantBaseline.mjs, which `npm run check:grants` prints on every run and
-- fails on any addition to. orders and order_items are deliberately absent from
-- that baseline: they are fixed, and the check proves it.
--
-- SELECT IS UNTOUCHED. The read side of these tables was closed separately by
-- 00105's staff-or-own-scope policies, and realtime needs SELECT to deliver
-- postgres_changes at all.
--
-- Contents:
--   1. Drop the three orphaned 00001 write policies
--   2. Revoke the write grants from authenticated and anon
--   3. State the rule in the table comments
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The three write policies 00009 and 00010 left behind
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "orders_delete_admin"              ON public.orders;
DROP POLICY IF EXISTS "order_items_update_admin_manager" ON public.order_items;
DROP POLICY IF EXISTS "order_items_delete_admin_manager" ON public.order_items;

-- ---------------------------------------------------------------------------
-- 2. The grants nothing ever revoked
-- ---------------------------------------------------------------------------

-- anon loses EVERYTHING. The app has no signed-out surface that reads an order,
-- and anon carries no RLS policy on either table, so it can already select
-- nothing -- the SELECT grant is a privilege with no reachable use. Taking the
-- lot is simpler to state and leaves nothing to re-audit.
REVOKE ALL PRIVILEGES ON public.orders      FROM anon;
REVOKE ALL PRIVILEGES ON public.order_items FROM anon;

-- authenticated keeps SELECT -- RLS narrows it to the caller's own scope
-- (00105), and realtime needs it to deliver postgres_changes at all.
--
-- TRUNCATE is in this list and is the reason it is not the audit's four-line
-- version. Verified on dev before writing this: `anon` and `authenticated` held
-- TRUNCATE on all 71 public tables, because no migration in the corpus has ever
-- revoked it from anyone. RLS does not constrain TRUNCATE -- there is no row for
-- a policy to filter -- so a row-level lockdown says nothing about it, and
-- TRUNCATE on `orders` empties the ledger. REFERENCES and TRIGGER go with it:
-- both let a caller attach machinery to a table they may not write.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.orders      FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.order_items FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. Say so on the tables
-- ---------------------------------------------------------------------------
-- 00009 already wrote a COMMENT here claiming direct INSERT was denied. It was
-- true of INSERT and of nothing else. Replace it with the whole rule.

COMMENT ON TABLE public.orders IS
    'Direct INSERT/UPDATE/DELETE denied to all roles (mig 00112 -- policies '
    'dropped AND grants revoked; 00009/00010 dropped policies only). Created by '
    'the place-order and approve-po Edge Functions; status mutated by '
    'update-order-status; cancelled by cancel-order. All run as service_role. '
    'Orders are never deleted -- cancel-order sets the terminal cancelled '
    'status so the ledger legs, picking history and PO-Inbox provenance survive.';

COMMENT ON TABLE public.order_items IS
    'Direct INSERT/UPDATE/DELETE denied to all roles (mig 00112 -- policies '
    'dropped AND grants revoked; 00009 dropped the INSERT policy only, leaving '
    'UPDATE and DELETE open to Admin/Manager over PostgREST). Written by the '
    'place-order and approve-po Edge Functions as service_role. A priced line '
    'on a placed order is ledger history: correct it by cancelling and '
    're-placing, not by rewriting it.';

COMMIT;

-- =============================================================================
-- Verify with (the security audit's own Appendix A step 2, inverted -- these
-- are the queries that reported the defect, so they are the ones that must now
-- come back clean):
--
--   SELECT tablename, policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('orders','order_items')
--    ORDER BY tablename, cmd;
--     -- expect SELECT policies only. No orders_delete_admin,
--     -- no order_items_update_admin_manager, no order_items_delete_admin_manager.
--
--   SELECT table_name, grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND grantee IN ('authenticated','anon')
--      AND table_name IN ('orders','order_items')
--    ORDER BY 1, 2, 3;
--     -- expect at most SELECT for authenticated, and nothing at all for anon.
--
--   -- And from a real Admin browser session, which is the only test that
--   -- matters -- both must fail rather than return { data: [], error: null }:
--   --   await supabase.from('orders').delete().eq('id', '<an order>')
--   --   await supabase.from('order_items').update({ unit_price: 0 }).eq('id', <n>)
--
-- `npm run check:grants -- --env=<target>` asserts all of the above, and every
-- other row of CLAUDE.md's lockdown table, from config/lockedTables.mjs.
--
-- Rollback (do not -- this reopens DB-1; recorded only so the change is legible):
--   GRANT INSERT, UPDATE, DELETE ON public.orders, public.order_items TO authenticated;
--   -- the three policies would also have to be recreated from 00001:676,728,734.
-- =============================================================================
