-- =============================================================================
-- Warehouse Intelligence Engine — conveyor/staging objects (floor-plan import v2)
-- Migration: 00066_wie_conveyor_staging_objects.sql
-- =============================================================================
-- Allows 'conveyor' and 'staging' layout objects, needed for AI floor-plan
-- import v2 to represent full warehouse structure:
--   * conveyor — a fixed snake/belt run; blocks routing (walk graph treats it
--     like a wall/obstacle — nothing walks or picks through it).
--   * staging  — a walkable, non-storage area (e.g. Shipping & Receiving);
--     joins the routable walkway network and can be linked to a STAGING
--     `locations` row via `layout_objects.staging_location_id` (column already
--     exists) so docks can route received stock there ahead of putaway.
-- `meta jsonb` and `staging_location_id` columns already exist on
-- layout_objects; this migration only widens the object_type CHECK.
-- Additive & idempotent (drop-and-recreate pattern from 00055_wie_lift_objects.sql).
-- =============================================================================

BEGIN;

DO $$
DECLARE v_name TEXT;
BEGIN
    SELECT conname INTO v_name
    FROM pg_constraint
    WHERE conrelid = 'public.layout_objects'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%object_type%'
    LIMIT 1;
    IF v_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.layout_objects DROP CONSTRAINT %I', v_name);
    END IF;
END $$;

ALTER TABLE public.layout_objects
    ADD CONSTRAINT layout_objects_object_type_check
    CHECK (object_type IN ('wall','dock','walkway','obstacle','label','lift','conveyor','staging'));

COMMIT;

-- Verify:
--   SELECT conname FROM pg_constraint WHERE conrelid='public.layout_objects'::regclass AND conname='layout_objects_object_type_check';
