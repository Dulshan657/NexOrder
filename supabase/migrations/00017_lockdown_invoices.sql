-- Lock down direct UPDATE/DELETE on invoices and broaden SELECT visibility.
--
-- Background:
--   * 00001 created the original invoices RLS policies: SELECT for Admin/Manager,
--     SELECT for Customer (scoped to own horeca_id), INSERT/UPDATE/DELETE for
--     Admin/Manager.
--   * 00009 dropped the INSERT policy because invoice creation must come from
--     the place-order Edge Function. UPDATE/DELETE were left intact at the time.
--
-- This migration:
--   1. Lets Field/Office Sales Reps read invoices too — the orders tab now
--      shows a payment-status column for every role, so reps need read access.
--   2. Drops the direct UPDATE policy. Payment-status changes now flow through
--      the new mutate-invoice-status Edge Function (audit-logged, role-checked,
--      Manager reason required). Service role still bypasses RLS.
--   3. Drops the direct DELETE policy. No UI deletes invoices today; if that
--      ever becomes a feature it'll go through an Edge Function.
--   4. Adds invoices to the supabase_realtime publication so Mark Paid/Overdue
--      actions propagate live to other open browser tabs.
--
-- IMPORTANT: deploy mutate-invoice-status BEFORE applying this migration,
-- otherwise the Orders-tab Mark Paid/Overdue actions will fail.

-- ---------------------------------------------------------------------------
-- 1. SELECT policy: include reps alongside Admin/Manager
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "invoices_select_admin_manager" ON public.invoices;

CREATE POLICY "invoices_select_staff"
    ON public.invoices FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN (
            'Admin',
            'Manager',
            'Field Sales Rep',
            'Office Sales Rep'
        )
    );

-- invoices_select_customer (own-HoReCa scope) is left unchanged from 00001.

-- ---------------------------------------------------------------------------
-- 2. Drop direct UPDATE / DELETE access for authenticated
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "invoices_update_admin_manager" ON public.invoices;
DROP POLICY IF EXISTS "invoices_delete_admin"        ON public.invoices;

REVOKE INSERT, UPDATE, DELETE ON public.invoices FROM authenticated;

COMMENT ON TABLE public.invoices IS
  'Direct INSERT/UPDATE/DELETE denied to all roles. '
  'Created by the place-order Edge Function; status mutated by the '
  'mutate-invoice-status Edge Function. Both run as service_role.';

-- ---------------------------------------------------------------------------
-- 3. Realtime publication
-- ---------------------------------------------------------------------------

-- Idempotent: only add if not already a publication member.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_publication_tables
        WHERE  pubname  = 'supabase_realtime'
          AND  schemaname = 'public'
          AND  tablename  = 'invoices'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
    END IF;
END $$;
