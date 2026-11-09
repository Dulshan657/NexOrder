-- =============================================================================
-- The walk's overflow confirmation, tightened (NX-0033)
-- Migration: 00145_putaway_confirm_tightening.sql
-- =============================================================================
-- Two gaps in 00143's wie_confirm_overflow_tx / wie_putaway_stops, found in
-- review. Both functions are redefined here with their signatures unchanged;
-- 00143 and 00144 are left as they were (they are applied).
--
--   1. A single-product pallet is never "home full".
--      The planner tags every remainder 'overflow' when the product has a home,
--      a unit load included (a unit load is never held to the home, 00142
--      wie_home_block step 4), and writes the pallet straight onto the walk
--      'assigned'. If the walker then puts it back on the queue
--      (wie_unassign_putaway_tx) it returns as 'suggested', source still
--      'overflow', bin still set. That is exactly 00143's "awaiting
--      confirmation" predicate, so the pallet was double-listed (Assign queue
--      and Walk) and labelled "Home full", both untrue, and it cost a confirm
--      step the spec (C5) says a unit load never needs.
--      Fix: a unit_load row is not a confirm stop.
--        wie_putaway_stops          does not route a SUGGESTED unit_load row
--                                   (an ASSIGNED one is an ordinary stop).
--        wie_confirm_overflow_tx    refuses it with the existing words
--                                   'This line no longer waits for an overflow
--                                   confirmation.'
--      The pallet stays an ordinary Assign-queue line, and Assign / Place now /
--      a scan of its bin at complete-putaway (which also accepts 'suggested')
--      work on it as before.
--
--   2. The confirm did not repeat the desk's bin and layout guards.
--      decide-putaway refuses an Assign / Place now onto a bin that is no longer
--      active ('That bin is no longer active — re-run the recommendation') and
--      onto a recommendation made on an older layout ('The layout changed since
--      this recommendation — re-run it'). The walk's confirm checked neither, so
--      a stale card could confirm a suggested bin that had been deactivated or
--      had dropped off the active layout. Both checks are now made here, under
--      the row lock, with the desk's words, after the compare-and-set on the bin
--      and before the home rule, as the desk path orders them (active bin, home
--      rule, layout).
--
-- Service-role only, one overload each. Idempotent: re-running converges.
-- =============================================================================

BEGIN;

-- ── 1. The walk confirms an overflow line (from 00143 §1) ────────────────────
CREATE OR REPLACE FUNCTION public.wie_confirm_overflow_tx(
    p_rec_id   BIGINT,
    p_location INT,
    p_actor    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec       public.wie_putaway_recommendations%ROWTYPE;
    v_code      TEXT;
    v_msg       TEXT;
    v_active    BOOLEAN;
    v_layout_id INT;
BEGIN
    -- A NULL bin would slip past the compare below (NULL <> x is NULL).
    IF p_location IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: a chosen location is required'
            USING ERRCODE = 'P0001';
    END IF;

    -- The same row lock wie_assign_putaway_tx takes: desk and walk serialise.
    SELECT * INTO v_rec
    FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', p_rec_id
            USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status <> 'suggested' THEN
        RAISE EXCEPTION 'CONFLICT: This line was already dealt with (it is now %).', v_rec.status
            USING ERRCODE = 'P0001';
    END IF;
    -- 00145: a unit load (single-product pallet) never waits for confirmation.
    IF v_rec.suggestion_source IS DISTINCT FROM 'overflow'
       OR v_rec.recommended_location_id IS NULL
       OR v_rec.unit_load THEN
        RAISE EXCEPTION 'CONFLICT: This line no longer waits for an overflow confirmation.'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_location <> v_rec.recommended_location_id THEN
        SELECT code INTO v_code FROM public.locations WHERE id = v_rec.recommended_location_id;
        RAISE EXCEPTION 'CONFLICT: The suggested bin for this line is now %; scan that one.', v_code
            USING ERRCODE = 'P0001';
    END IF;

    -- 00145: the desk's guards (decide-putaway), made under the lock. The bin is
    -- the suggested one by now, so a bin that has been retired is refused here.
    SELECT is_active INTO v_active FROM public.locations WHERE id = p_location;
    IF NOT FOUND OR NOT COALESCE(v_active, false) THEN
        RAISE EXCEPTION 'CONFLICT: That bin is no longer active — re-run the recommendation'
            USING ERRCODE = 'P0001';
    END IF;

    -- 00142 (NX-0032): the home may have room again since the line was made.
    v_msg := public.wie_home_block(p_rec_id, p_location);
    IF v_msg IS NOT NULL THEN
        RAISE EXCEPTION 'CONFLICT: %', v_msg USING ERRCODE = 'P0001';
    END IF;

    -- 00145: a republish since the line was made leaves its bin off the layout
    -- the floor is routed on.
    SELECT active_layout_id INTO v_layout_id
    FROM public.locations WHERE id = v_rec.warehouse_id;
    IF v_layout_id IS DISTINCT FROM v_rec.layout_id THEN
        RAISE EXCEPTION 'CONFLICT: The layout changed since this recommendation — re-run it'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.wie_putaway_recommendations
    SET status               = 'assigned',
        assigned_location_id = p_location,
        assigned_at          = now(),
        assigned_by          = p_actor
    WHERE id = p_rec_id;

    RETURN jsonb_build_object('assigned_id', p_rec_id, 'location_id', p_location);
END;
$$;

-- ── 2. The walk, as routable stops (from 00143 §4) ──────────────────────────
-- Same columns. A line is a stop at the bin it is assigned to, or, for an
-- overflow line awaiting confirmation, at its suggested bin. 00145: a SUGGESTED
-- unit-load pallet is not an overflow line awaiting confirmation.
CREATE OR REPLACE FUNCTION public.wie_putaway_stops(p_warehouse_id INT)
RETURNS TABLE(
    rec_id          BIGINT,
    product_id      INT,
    location_id     INT,
    code            TEXT,
    graph_node_id   INT,
    access_offset_m NUMERIC,
    qty_base        NUMERIC,
    hu_code         TEXT,
    hu_type         TEXT,
    sku             TEXT,
    product_name    TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        r.id,
        r.product_id,
        COALESCE(r.assigned_location_id, r.recommended_location_id),
        l.code,
        pl.graph_node_id,
        COALESCE(pl.access_offset_m, 0),
        r.quantity,
        hu.code,
        hu.hu_type,
        p.sku,
        p.name
    FROM public.wie_putaway_recommendations r
    JOIN public.locations l
        ON l.id = COALESCE(r.assigned_location_id, r.recommended_location_id)
    JOIN public.locations wh ON wh.id = r.warehouse_id
    LEFT JOIN public.layout_placements pl
        ON pl.location_id = COALESCE(r.assigned_location_id, r.recommended_location_id)
       AND pl.layout_id = wh.active_layout_id
    LEFT JOIN public.handling_units hu ON hu.id = r.handling_unit_id
    LEFT JOIN public.products p ON p.id = r.product_id
    WHERE r.warehouse_id = p_warehouse_id
      AND (r.status = 'assigned'
           OR (r.status = 'suggested'
               AND r.suggestion_source = 'overflow'
               AND r.recommended_location_id IS NOT NULL
               AND NOT r.unit_load))
    ORDER BY r.created_at, r.id
$$;

-- ── 3. Grants: service_role only, restated so a re-run converges ─────────────
REVOKE ALL ON FUNCTION public.wie_confirm_overflow_tx(BIGINT,INT,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_confirm_overflow_tx(BIGINT,INT,UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_putaway_stops(INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_stops(INT)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. ONE overload each, service_role only:
--   SELECT p.oid::regprocedure, p.prosecdef, p.proacl FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('wie_confirm_overflow_tx', 'wie_putaway_stops')
--    ORDER BY 1::text;                                   -- TWO rows
--
--   -- b. The walk of a warehouse; a suggested unit-load pallet is not in it:
--   SELECT * FROM public.wie_putaway_stops(<warehouse>);
--
-- Rollback: re-apply 00143 sections 1 (wie_confirm_overflow_tx) and 4
--   (wie_putaway_stops), and restate their grants. A pallet that came back to
--   the queue then reads as an overflow line awaiting confirmation again.
-- =============================================================================
