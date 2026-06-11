-- =============================================================================
-- Racked-warehouse WMS — bins, capacity, per-product home bins
-- Migration: 00039_wms_racked.sql
-- =============================================================================
-- Additive structure for 'racked' warehouses (mig 00036). Bulk warehouses are
-- completely unaffected. The bin TREE itself reuses the existing locations table
-- (kind ZONE/BIN/SHELF, parent_id, materialized_path) — admins build whatever
-- depth they want under a WAREHOUSE. This migration adds:
--   * locations.capacity_slots / slot_kind — soft-capacity metadata per node.
--   * products.size_factor — slots a single base unit consumes (for fill calc).
--   * product_home_bins — a product's default bin per racked warehouse (the
--     put-away suggestion).
--
-- Put-away and bin-to-bin re-slotting REUSE inv_transfer_stock (location ->
-- location), so no new receiving RPC is needed. Idempotent; apply via the
-- Management API. (00037/00038 are taken — this is the racked migration.)
-- =============================================================================

BEGIN;

-- ── 1. locations — soft capacity ─────────────────────────────────────────────
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS capacity_slots NUMERIC(14,3),
    ADD COLUMN IF NOT EXISTS slot_kind      TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_slot_kind_check') THEN
        ALTER TABLE public.locations
            ADD CONSTRAINT locations_slot_kind_check
            CHECK (slot_kind IS NULL OR slot_kind IN ('pallet', 'carton'));
    END IF;
END $$;

-- ── 2. products — size factor (slots per base unit) ──────────────────────────
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS size_factor NUMERIC(14,4) NOT NULL DEFAULT 1;

-- ── 3. product_home_bins — default put-away bin per (product, warehouse) ──────
CREATE TABLE IF NOT EXISTS public.product_home_bins (
    id           SERIAL      PRIMARY KEY,
    product_id   INT         NOT NULL REFERENCES public.products(id)  ON DELETE CASCADE,
    warehouse_id INT         NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    bin_id       INT         NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_product_home_bins_warehouse ON public.product_home_bins(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_home_bins_bin       ON public.product_home_bins(bin_id);

ALTER TABLE public.product_home_bins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_home_bins_select_ops" ON public.product_home_bins;
CREATE POLICY "product_home_bins_select_ops"
    ON public.product_home_bins FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

GRANT SELECT ON public.product_home_bins TO authenticated;

COMMIT;

-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='locations' AND column_name IN ('capacity_slots','slot_kind');
--   SELECT to_regclass('public.product_home_bins');
