-- =============================================================================
-- Backfill handling units for existing stock
-- Migration: 00076_backfill_handling_units.sql
-- =============================================================================
-- 00075 added the plate dimension; every existing balance row still carries
-- handling_unit_id NULL (= loose, untracked stock). This mints one plate per
-- row that actually holds stock, so the warehouse is container-tracked from day
-- one rather than running in two modes indefinitely.
--
-- THESE PLATES ARE FICTIONAL UNTIL SOMEONE PRINTS AND STICKS THE LABELS.
-- That is precisely what `label_printed = false` records. The Labels screen
-- surfaces the resulting print backlog; until a sticker exists on the physical
-- pallet, the plate is a database claim about the world, not a fact about it.
-- Making that visible was the explicit reason for choosing backfill over
-- leaving legacy stock loose.
--
-- Scope: rows with on_hand > 0 only (measured on prod: 210 of 460 rows across
-- 185 locations; the other 250 are zero-quantity slots, and the
-- allocated <= on_hand CHECK from 00027 means a zero row cannot hold a
-- reservation either, so there is nothing to track).
--
-- hu_type is inferred from locations.slot_kind ('pallet' / 'carton', already
-- populated on prod: 145 of the 210 rows sit in carton slots), defaulting to
-- 'pallet' where the location does not say. This matters beyond cosmetics —
-- 00075's putaway routing sends pallets to bulk/reserve levels and cartons to
-- pick levels.
--
-- Row counts do NOT change: this UPDATEs handling_unit_id on rows that already
-- exist. products.inventory / products.available are SUMs over those same rows,
-- so no cache is affected and inv_recompute_product_cache is deliberately not
-- called.
--
-- Idempotent: only rows with handling_unit_id IS NULL are touched, so a re-run
-- mints nothing.
--
-- Apply via the Management API /database/query.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_row     RECORD;
    v_hu_id   BIGINT;
    v_count   INT := 0;
BEGIN
    FOR v_row IN
        SELECT b.id            AS balance_id,
               b.location_id,
               COALESCE(l.slot_kind, 'pallet') AS hu_type,
               public.inv_root_warehouse(b.location_id) AS warehouse_id
          FROM public.inventory_balances b
          JOIN public.locations l ON l.id = b.location_id
         WHERE b.on_hand > 0
           AND b.handling_unit_id IS NULL
         ORDER BY b.id
         FOR UPDATE OF b
    LOOP
        -- slot_kind is free-ish text on locations; anything that is not exactly
        -- 'carton' becomes a pallet rather than tripping the CHECK constraint.
        INSERT INTO public.handling_units
            (code, hu_type, status, warehouse_id, location_id, label_printed)
        VALUES (
            public.hu_next_code(),
            CASE WHEN v_row.hu_type = 'carton' THEN 'carton' ELSE 'pallet' END,
            'stored',
            v_row.warehouse_id,
            v_row.location_id,
            false
        )
        RETURNING id INTO v_hu_id;

        UPDATE public.inventory_balances
           SET handling_unit_id = v_hu_id,
               updated_at = now()
         WHERE id = v_row.balance_id;

        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE 'backfilled % handling unit(s)', v_count;
END $$;

-- Guard: the backfill must leave exactly one plate per stocked row, each plate
-- in exactly one place. A failure here rolls the whole migration back.
DO $$
DECLARE
    v_unplated  INT;
    v_anomalies INT;
    v_orphans   INT;
BEGIN
    SELECT COUNT(*) INTO v_unplated
      FROM public.inventory_balances WHERE on_hand > 0 AND handling_unit_id IS NULL;
    IF v_unplated > 0 THEN
        RAISE EXCEPTION 'BACKFILL_INCOMPLETE: % stocked balance row(s) still have no plate', v_unplated
            USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*) INTO v_anomalies FROM public.handling_unit_anomalies;
    IF v_anomalies > 0 THEN
        RAISE EXCEPTION 'BACKFILL_ANOMALY: % plate(s) span more than one location', v_anomalies
            USING ERRCODE = 'P0001';
    END IF;

    -- Every minted plate must be attached to exactly one balance row.
    SELECT COUNT(*) INTO v_orphans
      FROM public.handling_units hu
      LEFT JOIN public.inventory_balances b ON b.handling_unit_id = hu.id
     WHERE b.id IS NULL;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'BACKFILL_ORPHAN: % plate(s) hold no stock', v_orphans
            USING ERRCODE = 'P0001';
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT status, hu_type, label_printed, count(*)
--     FROM public.handling_units GROUP BY 1,2,3 ORDER BY 1,2;
--   SELECT count(*) FROM public.inventory_balances WHERE on_hand > 0 AND handling_unit_id IS NULL;  -- 0
--   SELECT count(*) FROM public.handling_unit_anomalies;                                            -- 0
--   -- stock totals must be unchanged by this migration:
--   SELECT SUM(on_hand), SUM(allocated) FROM public.inventory_balances;
-- =============================================================================
