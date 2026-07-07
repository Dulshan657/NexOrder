-- =============================================================================
-- Warehouse Intelligence Engine — RLS (deploy LAST)
-- Migration: 00046_wie_rls.sql
-- =============================================================================
-- Locks the WIE tables to read-only for ops roles; ALL writes go through the
-- service-role edge functions (mutate-layout / publish-layout / recommend-putaway
-- / decide-putaway), which bypass RLS. No INSERT/UPDATE/DELETE policies are
-- defined for `authenticated`, so direct client writes are blocked — mirroring
-- the lockdown pattern used for product_home_bins (00039) and the inventory
-- tables. Apply this AFTER 00045 and after the edge functions are deployed.
-- Idempotent; apply via the Management API.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_table TEXT;
    v_policy TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'warehouse_layouts',
        'layout_placements',
        'layout_objects',
        'layout_graph_nodes',
        'layout_graph_edges',
        'layout_travel_distances',
        'wie_rules',
        'wie_putaway_recommendations'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

        v_policy := v_table || '_select_ops';
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, v_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
            || 'USING ((SELECT public.user_role()) IN (''Admin'',''Manager'',''Warehouse''))',
            v_policy, v_table
        );

        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    END LOOP;
END $$;

COMMIT;

-- Verify:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'layout_%' OR tablename LIKE 'wie_%';
--   SELECT polname FROM pg_policy WHERE polname LIKE '%_select_ops' AND polname LIKE '%layout%';
