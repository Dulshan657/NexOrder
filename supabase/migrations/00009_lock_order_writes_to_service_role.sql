-- Lock down direct INSERT on orders / order_items / inventory updates.
-- After this migration, only the service role (used by the place-order
-- Edge Function) can create orders or decrement product stock. The
-- service role bypasses RLS by default, so dropping the authenticated
-- INSERT policies is sufficient to deny all client-side inserts.

-- ---------------------------------------------------------------------------
-- orders / order_items
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "orders_insert_authenticated" ON public.orders;
DROP POLICY IF EXISTS "order_items_insert_authenticated" ON public.order_items;

-- ---------------------------------------------------------------------------
-- products: stock decrements must come from the place-order function.
-- Admins can still update non-stock product fields (price, name, etc) — we
-- replace any blanket update policy with one that excludes inventory writes.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "products_update_admin_manager" ON public.products;
DROP POLICY IF EXISTS "products_update_admin" ON public.products;

-- Re-create an admin/manager update policy that explicitly forbids changing
-- the inventory column. The CHECK clause runs against the NEW row; we cannot
-- compare NEW vs OLD inside RLS, but Supabase's `.update()` only sends the
-- columns the caller specifies. To stop the inventory column from being
-- updated by anyone other than the service role, we revoke the column
-- privilege from the authenticated role.

REVOKE UPDATE (inventory) ON public.products FROM authenticated;

-- Recreate a general update policy for admin/manager covering everything
-- else. (The column-level grant above means inventory still cannot be
-- written even when this policy permits the row-level UPDATE.)
DROP POLICY IF EXISTS "products_update_admin_manager_no_stock" ON public.products;
CREATE POLICY "products_update_admin_manager_no_stock"
    ON public.products FOR UPDATE
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'))
    WITH CHECK ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- invoices: only the place-order function (service role) may INSERT.
-- Admin/manager UPDATE for paid/overdue marking stays as-is.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "invoices_insert_admin_manager" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert_authenticated" ON public.invoices;

COMMENT ON TABLE public.orders IS
  'Direct INSERT denied to all roles. Use the place-order Edge Function.';
COMMENT ON TABLE public.order_items IS
  'Direct INSERT denied to all roles. Use the place-order Edge Function.';
COMMENT ON COLUMN public.products.inventory IS
  'Updateable only by service role (place-order Edge Function).';
COMMENT ON TABLE public.invoices IS
  'Direct INSERT denied to all roles. Created by the place-order Edge Function.';
