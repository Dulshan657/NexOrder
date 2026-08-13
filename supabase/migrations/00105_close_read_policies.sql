-- =============================================================================
-- Close the open read policies — a customer login stops being able to read
-- every other customer's contract rates, banking details and our cost prices
-- Migration: 00105_close_read_policies.sql
-- =============================================================================
-- PRODUCTION-READINESS-AUDIT.md rates read-path security RED and names nine
-- `USING (true)` SELECT policies as the reason. This closes eight of them. The
-- ninth is `app_settings`, and it is left alone ON PURPOSE — see the last
-- section, which is the part of this file worth reading if you read nothing
-- else.
--
-- Done now because Amadiya's database has no customers in it yet, so this is a
-- policy change rather than a migration against live traffic. It is also the
-- last moment it can be REHEARSED: the demo tenants and their customer logins
-- are about to be deleted, and after that there is no non-production
-- environment and nobody to test a customer predicate against.
--
-- ── WHAT WAS ACTUALLY EXPOSED, MEASURED ─────────────────────────────────────
--
-- Not theoretical. `services/supabase/productService.ts:23` fetches the
-- catalogue as
--
--   '*, suppliers!products_supplier_id_fkey(name), product_uoms(*),
--    product_suppliers(*, suppliers(name))'
--
-- and `App.tsx` runs it for EVERY role including Customer. `product_suppliers`
-- carries `cost_price`. So a HoReCa login shopping the catalogue was being sent
-- our purchase price for all 158 products, plus the full supplier list, in the
-- same response that draws the product grid. `horeca_pricing` is contract rates
-- and `horeca_payment_methods.details` is free-text banking detail; both were
-- readable across every customer.
--
-- ── THE SHAPE, AND WHY IT DEGRADES RATHER THAN BREAKS ───────────────────────
--
-- Every policy below is `staff OR <customer's own scope>`. PostgREST embeds
-- respect RLS as a FILTER, not an error: with `suppliers` and
-- `product_suppliers` closed, that same catalogue query keeps working for a
-- customer and simply returns `suppliers: null` and `product_suppliers: []`.
-- `lib/adapters.ts:108,172` already treats both as optional (`?? undefined`),
-- because a product can be read without the join. So the Shop is unchanged and
-- the cost prices are gone. That is the whole reason this can ship without a
-- coordinated frontend release.
--
-- `user_is_staff()` is new and exists so there is ONE list of which roles are
-- internal. Warehouse is in it — `ReceiveStockView` needs suppliers — and both
-- Sales Rep roles are in it, because a rep sells on behalf of the customer and
-- must see the contract rate they are quoting. A NULL or unrecognised role
-- resolves to false, and `user_horeca_id()` to NULL, so `horeca_id = NULL` is
-- NULL and the row is not returned. Unknown fails CLOSED, in both halves.
--
-- service_role bypasses RLS entirely, so every Edge Function is untouched.
--
-- ── WHY `app_settings` IS STILL `USING (true)` ──────────────────────────────
--
-- Because a row-level predicate cannot express the problem. `app_settings` is a
-- SINGLETON: id = 1, one row, and there is no predicate that hands a customer
-- `company_name`, `currency`, `minimum_order_value` and `carton_discount_percent`
-- — all of which the Shop needs to price and validate a cart — while withholding
-- `default_credit_limit` and the four `po_auto_approve_*` flags. RLS filters
-- rows; this needs columns.
--
-- Writing a policy that changes nothing, to make a count of nine go to zero,
-- would be worse than leaving it: it would retire the finding without fixing it.
-- The honest fix is to split the internal thresholds into their own
-- Admin/Manager-only table, which is a schema change plus `types.ts`,
-- `lib/adapters.ts` and `mutate-app-settings`. Tracked, not done here.
--
-- The residual exposure is stated plainly so nobody has to re-derive it: an
-- authenticated user can read the operator's own configuration. It is not
-- another customer's data, and it is not a cost or a rate.
--
-- ── VERIFY (as a Restaurant/Hotel Customer, against PostgREST directly) ─────
--
--   GET /rest/v1/suppliers              -> []
--   GET /rest/v1/product_suppliers      -> []
--   GET /rest/v1/horeca_pricing         -> only rows for their own horeca_id
--   GET /rest/v1/horeca_payment_methods -> only rows for their own horeca_id
--   GET /rest/v1/pantry_items           -> only rows for their own horeca_id
--   GET /rest/v1/products               -> only is_active rows
--   GET /rest/v1/promotions             -> only live, in-window rows
--   and the Shop still renders, prices and submits an order.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- One definition of "internal". STABLE so it is evaluated once per query, not
-- once per row; definer + pinned search_path to match `00104` and every other
-- definer function in this schema.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_is_staff()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        public.user_role() IN (
            'Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep', 'Warehouse'
        ),
        FALSE
    );
$$;

GRANT EXECUTE ON FUNCTION public.user_is_staff() TO authenticated;

COMMENT ON FUNCTION public.user_is_staff() IS
    'True for the five internal roles. The single definition of "not a customer" '
    'used by the read policies in 00105. Returns FALSE for a NULL or unknown '
    'role, so an unrecognised profile is treated as a customer, not as staff.';

-- -----------------------------------------------------------------------------
-- suppliers — internal only. Every consumer is an admin/staff surface
-- (SupplierAdmin, ProductForm, ReceiveStockView, ProductImportModal); no
-- customer view references a supplier.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "suppliers_select_authenticated" ON public.suppliers;

CREATE POLICY "suppliers_select_staff"
    ON public.suppliers FOR SELECT
    TO authenticated
    USING ((SELECT public.user_is_staff()));

-- -----------------------------------------------------------------------------
-- product_suppliers — carries `cost_price`. Internal only. This is the row that
-- made the catalogue query leak our margin.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "product_suppliers_select_authenticated" ON public.product_suppliers;

CREATE POLICY "product_suppliers_select_staff"
    ON public.product_suppliers FOR SELECT
    TO authenticated
    USING ((SELECT public.user_is_staff()));

-- -----------------------------------------------------------------------------
-- products — a customer must be able to shop, so this stays broad; what it
-- stops is enumerating DEACTIVATED lines. `is_active` is what the catalogue
-- already filters on client-side, so nothing visible changes.
--
-- Note this is row-level only: `supplier_id`, `reorder_point`, `safety_stock`
-- and `lead_time_days` remain readable by a customer, for the same reason
-- `app_settings` does. Splitting them needs columns, not rows.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "products_select_authenticated" ON public.products;

CREATE POLICY "products_select_staff_or_active"
    ON public.products FOR SELECT
    TO authenticated
    USING ((SELECT public.user_is_staff()) OR is_active);

-- -----------------------------------------------------------------------------
-- product_uoms — list prices, no cost. Scoped to match products so a customer
-- cannot read the UOM ladder of a line they cannot see.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "product_uoms_select_authenticated" ON public.product_uoms;

CREATE POLICY "product_uoms_select_staff_or_active"
    ON public.product_uoms FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_is_staff())
        OR EXISTS (
            SELECT 1 FROM public.products p
             WHERE p.id = product_uoms.product_id AND p.is_active
        )
    );

-- -----------------------------------------------------------------------------
-- horeca_pricing — contract rates. Own HoReCa only.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "horeca_pricing_select_authenticated" ON public.horeca_pricing;

CREATE POLICY "horeca_pricing_select_staff_or_own"
    ON public.horeca_pricing FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_is_staff())
        OR horeca_id = (SELECT public.user_horeca_id())
    );

-- -----------------------------------------------------------------------------
-- horeca_payment_methods — `details` is free-text banking detail. Own only.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "horeca_payment_methods_select_authenticated" ON public.horeca_payment_methods;

CREATE POLICY "horeca_payment_methods_select_staff_or_own"
    ON public.horeca_payment_methods FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_is_staff())
        OR horeca_id = (SELECT public.user_horeca_id())
    );

-- -----------------------------------------------------------------------------
-- pantry_items — a customer's own standing order list. Own only.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "pantry_items_select_authenticated" ON public.pantry_items;

CREATE POLICY "pantry_items_select_staff_or_own"
    ON public.pantry_items FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_is_staff())
        OR horeca_id = (SELECT public.user_horeca_id())
    );

-- -----------------------------------------------------------------------------
-- promotions — a customer sees what is live today, not the drafts and not the
-- expired ones. `start_date`/`end_date` are DATE, hence CURRENT_DATE and not
-- now(). `services/supabase/promotionDbService.ts:17` already applies exactly
-- this filter client-side for the customer path, so this makes the server agree
-- with what the client was already asking for.
--
-- Per-HoReCa `targeting` is NOT resolved here. It is a JSONB rule interpreted by
-- `pricing.ts`, and restating that interpreter in a policy is how the two
-- diverge. A customer can therefore still see a live promotion aimed at someone
-- else — a marketing fact, not a rate or a credential.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "promotions_select_authenticated" ON public.promotions;

CREATE POLICY "promotions_select_staff_or_live"
    ON public.promotions FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_is_staff())
        OR (
            is_active
            AND (start_date IS NULL OR start_date <= CURRENT_DATE)
            AND (end_date IS NULL OR end_date >= CURRENT_DATE)
        )
    );

-- -----------------------------------------------------------------------------
-- app_settings — deliberately unchanged. See the header.
-- -----------------------------------------------------------------------------
COMMENT ON POLICY "app_settings_select_authenticated" ON public.app_settings IS
    'Intentionally USING (true). app_settings is a singleton, so no row predicate '
    'can hand a customer the identity and pricing fields the Shop needs while '
    'withholding default_credit_limit and the po_auto_approve_* flags. Closing it '
    'requires splitting the internal thresholds into their own table. See 00105.';
