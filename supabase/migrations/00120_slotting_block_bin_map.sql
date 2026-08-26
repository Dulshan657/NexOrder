-- =============================================================================
-- wie_slotting_block_bin_map — what the Blocks overlay draws from
-- Migration: 00120_slotting_block_bin_map.sql
-- =============================================================================
-- The map's Blocks overlay needs bin -> block ids for one warehouse. Three ways
-- to give it that, and two are wrong:
--
--   * GRANT SELECT on v_slotting_block_bins to `authenticated`. A view runs as
--     its OWNER unless it is security_invoker, so that would hand every logged-in
--     user — Customers included — the whole bin membership map, bypassing the
--     user_is_staff() policies on the tables underneath it. The view stays
--     service_role only.
--   * Read slotting_block_members and expand it client-side. That is a SECOND
--     implementation of the unit -> leaf-bin expansion, which 00115 says in
--     writing must have exactly one. A rack whose levels the client expanded
--     differently is precisely the plan-reslot failure.
--   * This: one STABLE SECURITY DEFINER function with the staff check in its
--     body, the wie_replen_config_rows / wie_slotting_rule_rows pattern.
--
-- Staff, not Admin/Manager: the overlay is something a Warehouse operator looks
-- at while standing in the aisle, and it reveals nothing they cannot already
-- read from `locations`.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_slotting_block_bin_map(p_warehouse_id INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    -- SECURITY DEFINER bypasses the policies on slotting_blocks, so the check
    -- the policies would have made has to happen here instead. A NULL role is
    -- the service_role path (auth.uid() is null there), trusted by definition.
    IF public.user_role() IS NOT NULL AND NOT public.user_is_staff() THEN
        RAISE EXCEPTION 'FORBIDDEN: slotting blocks are internal'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(jsonb_object_agg(location_id::TEXT, block_ids), '{}'::jsonb)
      INTO v_result
      FROM (
        SELECT vb.location_id, jsonb_agg(DISTINCT vb.block_id) AS block_ids
          FROM public.v_slotting_block_bins vb
          JOIN public.slotting_blocks b ON b.id = vb.block_id
         WHERE b.warehouse_id = p_warehouse_id
         GROUP BY vb.location_id
      ) t;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.wie_slotting_block_bin_map(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wie_slotting_block_bin_map(INT) TO authenticated, service_role;

COMMENT ON FUNCTION public.wie_slotting_block_bin_map(INT) IS
    'bin id -> slotting block ids, for one warehouse. Exists so the map overlay '
    'never re-derives the unit -> leaf-bin expansion, which has one definition '
    '(v_slotting_block_bins) and must keep having one.';

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT public.wie_slotting_block_bin_map(1);   -- {} on a site with no blocks
--
--   -- The view itself must stay unreachable by a client role:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'v_slotting_block_bins' AND grantee IN ('anon','authenticated');
--     -- expect: no rows
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.wie_slotting_block_bin_map(INT);
-- =============================================================================
