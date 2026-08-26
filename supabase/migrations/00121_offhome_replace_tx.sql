-- =============================================================================
-- wie_offhome_replace_tx — record a detection sweep atomically
-- Migration: 00121_offhome_replace_tx.sql
-- =============================================================================
-- 00119 gave wie_offhome_tasks a PARTIAL unique index
-- (`... WHERE status = 'suggested'`), which is right: a decided task must not
-- block a later re-detection of the same pallet.
--
-- The consequence only shows up one layer out. In SQL, an ON CONFLICT against a
-- partial index works as long as the arbiter RESTATES the predicate. Over
-- PostgREST it cannot: supabase-js `.upsert({onConflict})` sends column names
-- only, there is nowhere to put the WHERE, and Postgres answers
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification".
-- That is not a bug in either layer — a partial index genuinely does not match a
-- bare column list. It is the same shape as `uq_wie_replen_open`'s documented
-- arbiter trap, met from the client side.
--
-- So the write moves into a function, which also makes it atomic. Delete-then-
-- insert, scoped to the products the sweep ACTUALLY EXAMINED:
--
--   * not a bare upsert, because the predicate cannot travel;
--   * not "delete every suggested task at this site", because the sweep is
--     capped (MAX_SCANNED_PRODUCTS) and a truncated run would silently retire
--     tasks for the products it never got to;
--   * not two supabase-js statements, because those are not a transaction, and
--     the failure mode is a warehouse whose queue is empty because the delete
--     landed and the insert did not.
--
-- Dismissed and accepted rows are untouched. Re-raising a task somebody
-- deliberately left alone is exactly what the dismissal reason exists to prevent.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_offhome_replace_tx(
    p_warehouse_id INT,
    p_product_ids  INT[],
    p_rows         JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inserted INT := 0;
BEGIN
    -- Only the products this sweep looked at, and only rows nobody has decided.
    DELETE FROM public.wie_offhome_tasks
     WHERE warehouse_id = p_warehouse_id
       AND status = 'suggested'
       AND product_id = ANY(COALESCE(p_product_ids, ARRAY[]::INT[]));

    INSERT INTO public.wie_offhome_tasks
        (warehouse_id, layout_id, product_id, from_location_id, quantity,
         handling_unit_id, rule_id, explanation)
    SELECT
        (r->>'warehouse_id')::INT,
        (r->>'layout_id')::INT,
        (r->>'product_id')::INT,
        (r->>'from_location_id')::INT,
        (r->>'quantity')::NUMERIC,
        NULLIF(r->>'handling_unit_id', '')::BIGINT,
        NULLIF(r->>'rule_id', '')::INT,
        COALESCE(r->'explanation', '{}'::jsonb)
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) r
     WHERE (r->>'warehouse_id')::INT = p_warehouse_id;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.wie_offhome_replace_tx(INT,INT[],JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_offhome_replace_tx(INT,INT[],JSONB)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--   -- Idempotent: running the same sweep twice leaves the same row count.
--   SELECT public.wie_offhome_replace_tx(1, ARRAY[1], '[{"warehouse_id":1,
--     "layout_id":null,"product_id":1,"from_location_id":518,"quantity":1}]'::jsonb);
--   SELECT public.wie_offhome_replace_tx(1, ARRAY[1], '[{"warehouse_id":1,
--     "layout_id":null,"product_id":1,"from_location_id":518,"quantity":1}]'::jsonb);
--   SELECT count(*) FROM public.wie_offhome_tasks
--    WHERE product_id = 1 AND status = 'suggested';   -- expect 1, not 2
--
--   -- A dismissed row must SURVIVE a later sweep of the same product:
--   UPDATE public.wie_offhome_tasks SET status = 'dismissed' WHERE id = <id>;
--   SELECT public.wie_offhome_replace_tx(1, ARRAY[1], '[]'::jsonb);
--   SELECT status FROM public.wie_offhome_tasks WHERE id = <id>;  -- dismissed
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.wie_offhome_replace_tx(INT,INT[],JSONB);
-- =============================================================================
