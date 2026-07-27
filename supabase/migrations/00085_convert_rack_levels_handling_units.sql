-- =============================================================================
-- Rack conversion must carry the handling unit
-- Migration: 00085_convert_rack_levels_handling_units.sql
-- =============================================================================
--
-- wie_convert_rack_to_levels_tx (mig 00072) moves a flat BIN's stock onto L1
-- when the bin is first converted into a levelled rack. It was written BEFORE
-- handling units existed (mig 00075 made handling_unit_id a fourth dimension of
-- inventory_balances, folded into the unique slot index alongside batch_id) and
-- was never updated.
--
-- The loop reads the balance rows, which ARE per handling unit, but calls
-- inv_apply_leg without p_handling_unit_id. That parameter defaults to NULL, so
-- every delta lands on the loose/untracked slot instead of the plate's own:
--
--     read   (product, location, batch, hu=34)  on_hand 12
--     write  (product, location, batch, hu=NULL) on_hand -12   <-- wrong slot
--
-- The NULL slot holds nothing, so it goes negative and the
-- inventory_balances_alloc_bound CHECK (allocated <= on_hand) rejects the whole
-- transaction. That check is what has been saving us: without it the plate's
-- rows would have been left in place at the old bin while a phantom negative
-- balance appeared beside them — stock silently duplicated across two slots.
--
-- Effect today: converting ANY bin whose stock sits on a plate fails outright
-- with a bare constraint name. Since receive-stock creates a handling unit per
-- receipt, that is the normal case, not an edge case. Found by exercising the
-- replenishment loop on WIE-DEMO (bin 33, plate 34).
--
-- The fix is to thread handling_unit_id through both legs, using a NAMED
-- argument — p_handling_unit_id is the 12th parameter and p_supplier_id is the
-- 11th, so a positional call would silently bind the wrong one.
--
-- Signature UNCHANGED (integer, integer, jsonb, uuid), so CREATE OR REPLACE
-- genuinely replaces rather than creating a second overload. Do NOT add a DROP:
-- it would discard the GRANTs from 00072 and leave the function uncallable.
--
-- Verify:
--   1. Exactly one overload:
--      SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND proname = 'wie_convert_rack_to_levels_tx';
--   2. It now knows about plates:
--      SELECT prosrc LIKE '%handling_unit_id%' FROM pg_proc WHERE proname =
--        'wie_convert_rack_to_levels_tx';  -- expect true
--   3. Convert a bin holding plated stock and confirm the L1 balance keeps the
--      SAME handling_unit_id, and that the old bin nets to zero:
--      SELECT location_id, handling_unit_id, on_hand FROM inventory_balances
--       WHERE product_id = <p> ORDER BY location_id;
--
-- ROLLBACK: re-apply 00072's body (the same function with handling_unit_id
-- absent from the SELECT and from both inv_apply_leg calls). Note that doing so
-- restores the failure above; there is no reason to roll this back except to
-- bisect. Already-converted racks are unaffected either way.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_convert_rack_to_levels_tx(p_location_id integer, p_layout_id integer, p_levels jsonb, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_rack        public.locations%ROWTYPE;
    v_placement   public.layout_placements%ROWTYPE;
    v_level       JSONB;
    v_role        TEXT;
    v_idx         INT := 0;
    v_new_loc_id  INT;
    v_l1_id       INT;
    v_level_ids   INT[] := '{}';
    v_bal         RECORD;
    v_order       RECORD;
    v_units_moved NUMERIC := 0;
BEGIN
    IF p_levels IS NULL OR jsonb_typeof(p_levels) <> 'array' OR jsonb_array_length(p_levels) < 1 THEN
        RAISE EXCEPTION 'INVALID_LEVELS: p_levels must be a non-empty JSON array' USING ERRCODE = 'P0001';
    END IF;

    -- Row lock: serialises concurrent conversion attempts on the same rack.
    SELECT * INTO v_rack FROM public.locations WHERE id = p_location_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: location % not found', p_location_id USING ERRCODE = 'P0001';
    END IF;
    IF v_rack.kind <> 'BIN' THEN
        RAISE EXCEPTION 'ALREADY_CONVERTED: location % is kind % (expected BIN)', p_location_id, v_rack.kind
            USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.locations WHERE parent_id = p_location_id AND level_index IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'ALREADY_CONVERTED: location % already has level children', p_location_id
            USING ERRCODE = 'P0001';
    END IF;

    -- The rack must be placed in THIS layout — every level inherits its
    -- geometry and graph anchor. Lock it too: nothing else may move it mid-txn.
    SELECT * INTO v_placement
    FROM public.layout_placements
    WHERE layout_id = p_layout_id AND location_id = p_location_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_PLACED: location % has no placement in layout %', p_location_id, p_layout_id
            USING ERRCODE = 'P0001';
    END IF;

    -- ── 1. Insert the level locations + their co-located placements ─────────
    FOR v_level IN SELECT * FROM jsonb_array_elements(p_levels)
    LOOP
        v_idx := v_idx + 1;
        v_role := v_level->>'role';
        -- CHANGED in 00081: the role vocabulary is now a table, not a literal.
        IF v_role IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.level_roles r WHERE r.key = v_role AND r.is_active
        ) THEN
            RAISE EXCEPTION 'INVALID_LEVEL_ROLE: level % has role % (not an active level role)',
                v_idx, v_role USING ERRCODE = 'P0001';
        END IF;

        INSERT INTO public.locations (
            parent_id, kind, code, name, materialized_path, is_active,
            level_role, level_index, capacity_slots, slot_kind, weight_capacity_kg,
            storage_type_id, created_in_layout_id
        ) VALUES (
            p_location_id, 'SHELF',
            v_rack.code || '-L' || v_idx,
            v_rack.name || ' — Level ' || v_idx,
            v_rack.materialized_path || '/' || v_rack.code || '-L' || v_idx,
            true,
            v_role, v_idx,
            NULLIF(v_level->>'capacity_slots', '')::NUMERIC,
            v_rack.slot_kind,
            NULLIF(v_level->>'weight_capacity_kg', '')::NUMERIC,
            v_rack.storage_type_id, v_rack.created_in_layout_id
        )
        RETURNING id INTO v_new_loc_id;

        v_level_ids := array_append(v_level_ids, v_new_loc_id);
        IF v_idx = 1 THEN v_l1_id := v_new_loc_id; END IF;

        -- Vertical reach cost rides the existing access_offset_m column: L1 =
        -- the rack's own offset, each level above adds a small +0.5m penalty.
        -- 0.5 is the canonical step -- see _shared/wie/levelGeometry.ts, which
        -- 00081's Edge Function wave makes the single definition.
        INSERT INTO public.layout_placements (
            layout_id, location_id, floor, x, y, w, h, rotation,
            graph_node_id, access_offset_m, level_index
        ) VALUES (
            p_layout_id, v_new_loc_id, v_placement.floor, v_placement.x, v_placement.y,
            v_placement.w, v_placement.h, v_placement.rotation,
            v_placement.graph_node_id,
            COALESCE(v_placement.access_offset_m, 0) + (v_idx - 1) * 0.5,
            v_idx
        );
    END LOOP;

    -- ── 2. The rack becomes a non-placed container (mirrors the existing RACK
    --      semantic already live for 12 WIE-DEMO locations: no placement row,
    --      no capacity_slots — see header comment). SAME locations.id, so
    --      inventory_movements / pick_progress history and every FK survive.
    DELETE FROM public.layout_placements WHERE layout_id = p_layout_id AND location_id = p_location_id;

    UPDATE public.locations
    SET kind = 'RACK', capacity_slots = NULL, slot_kind = NULL, weight_capacity_kg = NULL
    WHERE id = p_location_id;

    -- ── 3. Move stock to L1. NOT inv_transfer_stock (available-only — would
    --      reject any batch carrying a live reservation). inv_apply_leg is
    --      called directly with BOTH on_hand and allocated deltas on the SAME
    --      transfer_out/transfer_in leg, so the physical balance is exactly,
    --      atomically right on both ends (its ledger row's qty_delta records
    --      only the on_hand portion per inv_apply_leg's own convention — see
    --      header comment for why that is an accepted gap here).
    FOR v_bal IN
        SELECT product_id, batch_id, handling_unit_id, on_hand, allocated
        FROM public.inventory_balances
        WHERE location_id = p_location_id AND (on_hand > 0 OR allocated > 0)
        FOR UPDATE
    LOOP
        PERFORM public.inv_apply_leg(
            v_bal.product_id, p_location_id, v_bal.batch_id, -v_bal.on_hand, -v_bal.allocated,
            'transfer_out', p_actor, 'rack_conversion', p_location_id::TEXT, 'rack converted to levels',
            p_handling_unit_id => v_bal.handling_unit_id);
        PERFORM public.inv_apply_leg(
            v_bal.product_id, v_l1_id, v_bal.batch_id, v_bal.on_hand, v_bal.allocated,
            'transfer_in', p_actor, 'rack_conversion', p_location_id::TEXT, 'rack converted to levels',
            p_handling_unit_id => v_bal.handling_unit_id);
        v_units_moved := v_units_moved + v_bal.on_hand;
    END LOOP;

    -- ── 4. Re-point open orders' allocation NETTING to L1 (ledger-only — does
    --      NOT re-touch inventory_balances, already moved in full above). There
    --      is no persisted "pick task" table: wie_order_alloc_bins (00064)
    --      computes tasks live from this exact (product, location) grouping
    --      over allocate/deallocate legs, so writing a matching pair here is
    --      what "re-points" it. Whatever that view already nets for the rack,
    --      it now nets identically for L1 — pick_progress itself is untouched
    --      (a completed pick is a correct historical fact either way).
    FOR v_order IN
        SELECT product_id, ref_id AS order_id, SUM(qty_delta) AS qty
        FROM public.inventory_movements
        WHERE location_id = p_location_id
          AND ref_type = 'order'
          AND movement_type IN ('allocate', 'deallocate')
        GROUP BY product_id, ref_id
        HAVING SUM(qty_delta) > 0
    LOOP
        INSERT INTO public.inventory_movements
            (product_id, location_id, batch_id, qty_delta, movement_type, ref_type, ref_id, actor_id, reason)
        VALUES
            (v_order.product_id, p_location_id, NULL, -v_order.qty, 'deallocate', 'order', v_order.order_id,
             p_actor, 'rack levels conversion — routing repoint'),
            (v_order.product_id, v_l1_id, NULL, v_order.qty, 'allocate', 'order', v_order.order_id,
             p_actor, 'rack levels conversion — routing repoint');
    END LOOP;

    -- ── 5. Defuse any still-open putaway recommendation that targets the bare
    --      rack — it is no longer a placeable location on its own.
    UPDATE public.wie_putaway_recommendations
    SET status = 'expired'
    WHERE status = 'suggested' AND recommended_location_id = p_location_id;

    RETURN jsonb_build_object(
        'rack_id',            p_location_id,
        'level_location_ids', to_jsonb(v_level_ids),
        'l1_location_id',     v_l1_id,
        'units_moved',        v_units_moved
    );
END;
$function$
;

COMMIT;
