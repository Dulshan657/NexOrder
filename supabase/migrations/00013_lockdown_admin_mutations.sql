-- Lock down direct INSERT/UPDATE/DELETE on the eight tables whose mutations
-- are now gated by admin Edge Functions (mutate-app-settings, mutate-promotions,
-- mutate-horeca, mutate-products, mutate-suppliers, mutate-purchase-orders,
-- mutate-sales-targets, mutate-pantry-items).
--
-- Service role bypasses RLS by default, so Edge Functions continue to write
-- without restriction.  Authenticated clients (Admin, Manager, etc.) lose
-- direct write access after this migration is applied.
--
-- IMPORTANT: Apply this migration ONLY AFTER all eight mutate-* Edge Functions
-- have been deployed to production.  If the functions are not yet live when
-- this migration runs, every admin write in the UI will immediately fail with
-- a permission-denied error and leave users unable to manage the application.
--
-- Tables already covered by earlier lockdown migrations (do NOT repeat here):
--   orders / order_items / invoices   -- 00009
--   orders.status                     -- 00010
--   profiles                          -- 00011
--   audit_events                      -- 00012 (no write policies defined)
--   notifications                     -- left intact; trigger (SECURITY DEFINER)
--                                        inserts on behalf of service role

-- ---------------------------------------------------------------------------
-- 1. app_settings
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.app_settings FROM authenticated;

COMMENT ON TABLE public.app_settings IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Mutations must go through the mutate-app-settings Edge Function.';

-- ---------------------------------------------------------------------------
-- 2. promotions
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.promotions FROM authenticated;

COMMENT ON TABLE public.promotions IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Mutations must go through the mutate-promotions Edge Function.';

-- ---------------------------------------------------------------------------
-- 3. horecas  +  horeca_pricing  +  horeca_payment_methods
--    (all three are managed atomically by the mutate-horeca Edge Function)
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.horecas FROM authenticated;

COMMENT ON TABLE public.horecas IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Mutations must go through the mutate-horeca Edge Function.';

REVOKE INSERT, UPDATE, DELETE ON public.horeca_pricing FROM authenticated;

COMMENT ON TABLE public.horeca_pricing IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Managed atomically alongside horecas by the mutate-horeca Edge Function.';

REVOKE INSERT, UPDATE, DELETE ON public.horeca_payment_methods FROM authenticated;

COMMENT ON TABLE public.horeca_payment_methods IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Managed atomically alongside horecas by the mutate-horeca Edge Function.';

-- ---------------------------------------------------------------------------
-- 4. products  (non-inventory columns)
--    inventory column is already column-revoked in 00009; this extends the
--    lockdown to INSERT, UPDATE of remaining columns, and DELETE.
-- ---------------------------------------------------------------------------

REVOKE INSERT, DELETE ON public.products FROM authenticated;

-- UPDATE on non-inventory columns was left open in 00009 via the
-- "products_update_admin_manager_no_stock" policy; drop that policy and
-- revoke UPDATE entirely now that a full-fledged Edge Function owns mutations.

DROP POLICY IF EXISTS "products_update_admin_manager_no_stock" ON public.products;

REVOKE UPDATE ON public.products FROM authenticated;

COMMENT ON TABLE public.products IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'inventory column has a separate column-level revoke from 00009. '
  'All mutations must go through the mutate-products Edge Function.';

-- ---------------------------------------------------------------------------
-- 5. suppliers
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.suppliers FROM authenticated;

COMMENT ON TABLE public.suppliers IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Mutations must go through the mutate-suppliers Edge Function.';

-- ---------------------------------------------------------------------------
-- 6. purchase_orders  +  purchase_order_items
--    (child rows are always written together with the parent PO)
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.purchase_orders FROM authenticated;

COMMENT ON TABLE public.purchase_orders IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Mutations must go through the mutate-purchase-orders Edge Function.';

REVOKE INSERT, UPDATE, DELETE ON public.purchase_order_items FROM authenticated;

COMMENT ON TABLE public.purchase_order_items IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Managed atomically alongside purchase_orders by the mutate-purchase-orders Edge Function.';

-- ---------------------------------------------------------------------------
-- 7. sales_targets
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.sales_targets FROM authenticated;

COMMENT ON TABLE public.sales_targets IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Mutations must go through the mutate-sales-targets Edge Function.';

-- ---------------------------------------------------------------------------
-- 8. pantry_items
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON public.pantry_items FROM authenticated;

COMMENT ON TABLE public.pantry_items IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Mutations must go through the mutate-pantry-items Edge Function.';
