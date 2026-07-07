-- =============================================================================
-- Warehouse Intelligence Engine — lift/stairs objects (Phase 8 multi-floor)
-- Migration: 00055_wie_lift_objects.sql
-- =============================================================================
-- Allows a 'lift' layout object. The designer paints lifts on a cell that exists
-- on multiple floors; the graph builder connects lift cells vertically so pick /
-- putaway routes can cross floors. layout_graph_nodes.node_type already allows
-- 'lift' (mig 00045); this only widens the layout_objects.object_type CHECK.
-- Additive & idempotent.
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
    CHECK (object_type IN ('wall','dock','walkway','obstacle','label','lift'));

COMMIT;

-- Verify:
--   SELECT conname FROM pg_constraint WHERE conrelid='public.layout_objects'::regclass AND conname='layout_objects_object_type_check';
