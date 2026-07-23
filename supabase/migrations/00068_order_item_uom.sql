-- =============================================================================
-- Carry the chosen UOM identity on order and pantry lines
-- Migration: 00068_order_item_uom.sql
-- =============================================================================
-- A line's pack_size already carries the chosen UOM's factor (base = quantity ×
-- pack_size, mig 00035). But two UOMs can share a factor while having different
-- explicit prices, so the line also needs the UOM id — both to re-resolve the
-- authoritative price server-side and to keep distinct UOMs from being merged.
--
-- Both columns are nullable: legacy and base-unit lines stay NULL and resolve
-- through the per-unit fallback. Additive; order_items / pantry_items writes are
-- already locked to service_role, so no RLS change. Idempotent.
-- =============================================================================

BEGIN;

-- ON DELETE SET NULL: editing a product's UOM list may retire a code; a line
-- that referenced it falls back to NULL and resolves per-unit. Historical order
-- lines keep their persisted unit_price + pack_size, so nothing is lost.
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS uom_id BIGINT REFERENCES public.product_uoms(id) ON DELETE SET NULL;

ALTER TABLE public.pantry_items
    ADD COLUMN IF NOT EXISTS preferred_uom_id BIGINT REFERENCES public.product_uoms(id) ON DELETE SET NULL;

COMMIT;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name IN ('order_items','pantry_items')
--      AND column_name IN ('uom_id','preferred_uom_id');
