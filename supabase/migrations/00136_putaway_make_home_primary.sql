-- =============================================================================
-- Putaway — "make this the home bin" writes the PRIMARY slot (NX-0006)
-- Migration: 00136_putaway_make_home_primary.sql
-- =============================================================================
-- 00135's wie_complete_putaway_many_tx inserted into product_home_bins with
-- ON CONFLICT (product_id, warehouse_id). That key stopped existing in 00082,
-- which re-keyed homes as UNIQUE (product_id, warehouse_id, purpose) so one SKU
-- can hold several slots (primary, chilled, each-pick...). Postgres therefore
-- refused the statement outright ("no unique or exclusion constraint matching
-- the ON CONFLICT specification") -- found by the NX-0006 integration test
-- before any client called it.
--
-- The home putaway fills, and the one replenishment tops up (00093 / 00118),
-- is purpose = 'primary'. Same signature as 00135, so CREATE OR REPLACE
-- replaces in place; nothing else in 00135 changes.
--
-- Service-role only. Idempotent.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_complete_putaway_many_tx(
    p_allocations     JSONB,
    p_actual          INT,
    p_actor           UUID,
    p_override_reason TEXT    DEFAULT NULL,
    p_short           BOOLEAN DEFAULT false,
    p_make_home       BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item       JSONB;
    v_id         BIGINT;
    v_qty        NUMERIC;
    v_results    JSONB := '[]'::jsonb;
    v_rec        public.wie_putaway_recommendations%ROWTYPE;
    v_product    INT;
    v_warehouse  INT;
    v_home_set   BOOLEAN := false;
BEGIN
    IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
        RAISE EXCEPTION 'INVALID_INPUT: no tasks to complete' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
        v_id  := (v_item->>'id')::BIGINT;
        v_qty := (v_item->>'qty')::NUMERIC;

        SELECT * INTO v_rec FROM public.wie_putaway_recommendations
        WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', v_id USING ERRCODE = 'P0001';
        END IF;
        IF v_product IS NULL THEN
            v_product := v_rec.product_id;
            v_warehouse := v_rec.warehouse_id;
        ELSIF v_rec.product_id <> v_product OR v_rec.warehouse_id <> v_warehouse THEN
            RAISE EXCEPTION 'INVALID_INPUT: tasks for different products cannot be completed together'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_qty > 0 THEN
            v_results := v_results || public.wie_complete_putaway_tx(
                v_id, p_actual, v_qty, p_actor, p_override_reason, p_short);
        ELSIF p_short THEN
            IF v_rec.status NOT IN ('suggested', 'assigned') THEN
                RAISE EXCEPTION 'CONFLICT: putaway task already %', v_rec.status USING ERRCODE = 'P0001';
            END IF;
            UPDATE public.wie_putaway_recommendations SET status = 'short' WHERE id = v_id;
            v_results := v_results || jsonb_build_object(
                'placed_id', NULL, 'status', NULL, 'remainder_id', v_id,
                'remainder_qty', v_rec.quantity, 'remainder_status', 'short', 'moved', NULL);
        END IF;
    END LOOP;

    -- Fills a gap only: ON CONFLICT leaves an existing home alone, and a home
    -- set by someone else a moment ago wins. The home is the PRIMARY slot
    -- (mig 00082 keys homes by purpose); the arbiter must name all three
    -- columns of product_home_bins_slot_key or Postgres cannot infer it.
    IF p_make_home THEN
        INSERT INTO public.product_home_bins (product_id, warehouse_id, bin_id, purpose)
        VALUES (v_product, v_warehouse, p_actual, 'primary')
        ON CONFLICT (product_id, warehouse_id, purpose) DO NOTHING;
        v_home_set := FOUND;
    END IF;

    RETURN jsonb_build_object('results', v_results, 'home_set', v_home_set);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_complete_putaway_many_tx(JSONB,INT,UUID,TEXT,BOOLEAN,BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_complete_putaway_many_tx(JSONB,INT,UUID,TEXT,BOOLEAN,BOOLEAN)
    TO service_role;

COMMIT;

-- Verify with:
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'wie_complete_putaway_many_tx';
--   -- expect ONE row
