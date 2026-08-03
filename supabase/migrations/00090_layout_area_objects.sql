-- =============================================================================
-- Warehouse Intelligence Engine — named 'area' layout objects
-- Migration: 00090_layout_area_objects.sql
-- =============================================================================
-- Allows 'area' layout objects: an operator-named, tinted region drawn over the
-- floor ("Cold Storage", "Bulk", "Returns").
--
-- WHY THIS EXISTS. Until now a warehouse's areas had no representation at all.
-- The designer's storage tool paints individual BINS, and a zone could only be
-- attached to one bin at a time through the placement inspector — so a floor
-- plan drawn as "cold storage in the bottom-right corner" came back as a
-- scattering of individually-coloured cells with no region and no name. NEXG is
-- the worked example: 193 placements, and zero zones, labels or obstacles.
--
-- SHAPE. An area is a plain layout_objects row like every other structural
-- object, and is painted cell-by-cell exactly as walls and walkways are: the
-- data model stays 1x1 and only the PICTURE merges (see objectRegions.ts). Its
-- `meta` carries the operator's name and, optionally, a zone_profiles id:
--     meta = { "name": "Cold Storage", "zoneProfileId": 4 }
-- Contiguous cells sharing a name knit into one named region, so two different
-- areas that happen to touch stay distinct.
--
-- NOTE ON ZONE SEMANTICS. `meta.zoneProfileId` records the operator's INTENT.
-- It does not by itself make the putaway engine treat those bins as zoned: a bin
-- inherits its zone by materialized-path ancestry to a kind='ZONE' location
-- (see 00047's header and wie_putaway_candidates' LATERAL join), not from any
-- column on the bin. Binding an area's bins to that ZONE is a separate change —
-- it is a subtree move, and `locations` carries no trigger to maintain
-- materialized_path, so it must be done deliberately rather than as a side
-- effect of a geometry save.
--
-- Additive & idempotent (drop-and-recreate pattern from 00066/00055).
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
    CHECK (object_type IN ('wall','dock','walkway','obstacle','label','lift','conveyor','staging','area'));

COMMIT;

-- Verify:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.layout_objects'::regclass
--      AND conname='layout_objects_object_type_check';
--   -- expect the list to include 'area'
