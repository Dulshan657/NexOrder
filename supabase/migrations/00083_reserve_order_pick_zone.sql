-- =============================================================================
-- Order allocation prefers the pick zone
-- Migration: 00083_reserve_order_pick_zone.sql
-- =============================================================================
--
--   *** DO NOT APPLY THIS UNTIL REPLENISHMENT IS DEMONSTRABLY WORKING. ***
--
-- This is the only change in the level-roles/replenishment programme that
-- alters behaviour for EVERY order in the system, and it is only correct in the
-- presence of a working replenishment loop. Applied early, orders preferentially
-- drain the pick zone with nothing refilling it — a self-inflicted pick-face
-- stockout across the catalogue.
--
-- Gate: configure min/max on two or three SKUs, watch one replenishment task go
-- suggested → assigned → accepted with the stock actually moving, THEN apply.
--
-- ---------------------------------------------------------------------------
-- What it does
-- ---------------------------------------------------------------------------
-- inv_reserve_order picks which bins an order draws from. Its inner sweep has
-- been ordered strictly FEFO since 00040 and has no idea that some bins are
-- pick zones — so an order could be allocated against a bulk pallet while the
-- pick face two levels down held the same batch, and the picker would be sent
-- to the bulk level.
--
-- The fix is one ORDER BY term. Note WHERE it sits:
--
--     ORDER BY bt.expiry_date NULLS LAST,          -- FEFO FIRST, unchanged
--              (pick zone before anything else),   -- preference INSIDE the tier
--              bt.received_at NULLS FIRST, b.id
--
-- The obvious implementation puts the pick-zone preference ABOVE expiry and
-- then argues about how to mitigate the FEFO damage. There is no damage to
-- mitigate if the preference goes INSIDE the expiry tier:
--
--   * Strict FEFO is preserved exactly. A dated batch never jumps ahead of an
--     older dated batch because of where it happens to sit.
--   * The preference still wins in the common case: replenishment moves the
--     SAME batch from reserve down to pick, so the two tie on expiry and the
--     pick zone wins outright.
--   * It wins unconditionally for non-dated SKUs (expiry_date IS NULL ties every
--     row), which is most of the AYAM catalogue.
--   * It "loses" only where losing is correct — an older batch in bulk beats a
--     newer one in the pick zone. That is the answer you want.
--
-- The one real deviation is that a pick zone now outranks received_at WITHIN a
-- single expiry date. Same expiry means same shelf life, so that is desirable.
--
-- ---------------------------------------------------------------------------
-- Why this is safe for every warehouse that does not use levels
-- ---------------------------------------------------------------------------
-- Every bin in a BULK warehouse has level_role IS NULL, so the LEFT JOIN yields
-- NULL, COALESCE(..., false) makes the CASE constant, and every row ties on the
-- new term. The ordering is byte-identical to today. The same holds for any
-- racked warehouse whose bins are unlevelled. This change can only affect
-- warehouses that actually have levels — verify it (see below).
--
-- COALESCE is load-bearing: lr is NULL for every legacy bin, and a NULL in an
-- ordering expression is not FALSE.
--
-- ---------------------------------------------------------------------------
-- The consequence worth watching (it is route fan-out, not expiry)
-- ---------------------------------------------------------------------------
-- Preferring the pick zone changes which bin wie_order_alloc_bins (00064)
-- reports, hence where the picker is sent. A pick zone with a small `available`
-- will now SPLIT a line across pick + reserve where it previously took one bin,
-- giving the picker two stops instead of one. Structurally fine — the second
-- stop is the same rack at zero travel — but it must be visible in the Pick
-- Queue rather than looking like a bug.
--
-- Signature UNCHANGED (TEXT, JSONB, INT[], UUID, BOOLEAN), so CREATE OR REPLACE
-- genuinely replaces rather than creating an overload. Do NOT add a DROP.
-- The 00075 body is preserved verbatim in the trailing comment as the rollback.
-- Apply via the Management API (see CLAUDE.md); do not run interactively.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inv_reserve_order(
    p_order_id      TEXT,
    p_items         JSONB,
    p_location_pref INT[] DEFAULT NULL,
    p_actor         UUID DEFAULT NULL,
    p_allow_partial BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pref      INT[];
    v_item      JSONB;
    v_pid       INT;
    v_qty       NUMERIC;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_loc       INT;
    v_row       RECORD;
BEGIN
    v_pref := NULLIF(p_location_pref, '{}');
    IF v_pref IS NULL THEN
        v_pref := ARRAY[public.inv_default_location()];
    END IF;
    IF v_pref IS NULL OR array_length(v_pref, 1) IS NULL OR v_pref[1] IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::INT;
        v_qty := (v_item->>'quantity')::NUMERIC;
        v_remaining := v_qty;

        FOREACH v_loc IN ARRAY v_pref
        LOOP
            EXIT WHEN v_remaining <= 0;
            FOR v_row IN
                SELECT b.id, b.location_id, b.batch_id, b.handling_unit_id, b.available
                FROM public.inventory_balances b
                LEFT JOIN public.batches     bt ON bt.id  = b.batch_id
                -- CHANGED in 00083: the bin's level role, so a pick zone can be
                -- preferred. LEFT JOINs, both of them: a legacy bin has no
                -- level_role and must stay eligible.
                LEFT JOIN public.locations   l  ON l.id   = b.location_id
                LEFT JOIN public.level_roles lr ON lr.key = l.level_role
                WHERE b.product_id = v_pid
                  AND b.location_id IN (SELECT location_id FROM public.inv_warehouse_draw_locations(v_loc))
                  AND b.available > 0
                ORDER BY
                    -- FEFO FIRST, exactly as before.
                    bt.expiry_date NULLS LAST,
                    -- Pick zone as the TIEBREAK inside an expiry date. COALESCE,
                    -- not a bare boolean: lr is NULL for every legacy bin, and a
                    -- NULL here is not FALSE.
                    (CASE WHEN COALESCE(lr.is_pick_zone, false) THEN 0 ELSE 1 END),
                    bt.received_at NULLS FIRST,
                    b.id
                FOR UPDATE OF b
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_take := LEAST(v_remaining, v_row.available);
                PERFORM public.inv_apply_leg(
                    v_pid, v_row.location_id, v_row.batch_id, 0, v_take,
                    'allocate', p_actor, 'order', p_order_id, NULL,
                    NULL, v_row.handling_unit_id);
                v_remaining := v_remaining - v_take;
            END LOOP;
        END LOOP;

        IF v_remaining > 0 AND NOT p_allow_partial THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by %', v_pid, v_remaining
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
END;
$$;

COMMIT;

-- =============================================================================
-- Verify (run all four; 3 and 4 are the ones that matter):
--
--   1. No overload was created:
--      SELECT proname, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND proname = 'inv_reserve_order' GROUP BY proname;
--        -- expect exactly 1
--
--   2. The preference works: order a SKU held in BOTH a pick level and a bulk
--      level at the SAME expiry. The picker must now be directed to the pick
--      level (compare with a pre-00083 order for the same SKU).
--
--   3. FEFO STILL WINS (this is the whole argument for where the term sits):
--      give the bulk level a batch expiring EARLIER than the pick level's, then
--      order again. The picker must still be sent to the BULK bin.
--        SELECT location_id, qty_delta FROM inventory_movements
--         WHERE ref_id = '<order>' AND movement_type = 'allocate' ORDER BY id;
--
--   4. Bulk-warehouse regression: place an order at a NON-racked warehouse and
--      compare its allocate legs against an order placed before this migration.
--      They must be byte-identical — every bin there has level_role IS NULL, so
--      the new CASE is constant.
--
-- ROLLBACK: re-apply 00075's body, which is this same function with the two
-- LEFT JOINs and the CASE term removed:
--
--     ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
--
-- Nothing else needs reverting; existing allocations are untouched either way.
-- =============================================================================
