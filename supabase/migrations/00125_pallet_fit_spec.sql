-- =============================================================================
-- How many units ride on a pallet, worked out instead of remembered
-- Migration: 00125_pallet_fit_spec.sql
-- =============================================================================
-- Seven columns, no backfill, no data change. Everything derived from them is
-- computed in the browser and only ever written when an admin presses a button.
--
-- ── WHAT THIS UNBLOCKS ──────────────────────────────────────────────────────
--
-- Receive Stock lets an operator count in any of a product's UOMs, but nothing
-- in the catalogue ever said how many units are on a pallet — so a full pallet
-- had to be counted in cartons. `lib/palletFit.ts` derives that figure from the
-- carton and the pallet, and the product form offers it as a receivable-only
-- "Pallet" row on the unit ladder. The admin confirms the number; nothing here
-- writes one.
--
-- ── WHY GLOBAL AND NOT PER WAREHOUSE ────────────────────────────────────────
--
-- Operator's decision, taken knowingly: one pallet standard for the business.
-- If a tenant ever runs two sites on different standards this needs its own
-- table keyed by warehouse, NOT four more columns on `locations` — the figures
-- belong together as a spec.
--
-- ── mm FOR THE PALLET, cm FOR THE PRODUCT ───────────────────────────────────
--
-- Deliberate, and not an oversight. The pallet spec is an engineering figure an
-- operator reads off a standard: 1165 is exact in mm and 116.5 in cm. The
-- product columns mirror the `length_cm` / `width_cm` / `height_cm` that have
-- been on `products` since 00024, so the two boxes are typed in the same unit on
-- the same screen. `lib/palletFit.ts` converts once, at the boundary, with
-- `Math.round(cm * 10)` — the fit is a stack of floor()s and a value one part in
-- a million short loses an entire carton off a layer.
--
-- ── `pallet_base_height_mm` IS NOT AN INPUT TO THE LAYER COUNT ──────────────
--
-- Read this before "fixing" the formula. `pallet_max_load_height_mm` is already
-- LOAD-only — how tall the goods may stack, excluding the deck. Subtracting the
-- base from it would count the deck twice and silently lose a layer. The base
-- height is stored so the UI can report the overall height (1650 + 150 = 1800)
-- and for a future racked clear-height check. It is otherwise write-only today,
-- which is intentional.
--
-- ── NOT NULL DEFAULTS ARE THE SEED ──────────────────────────────────────────
--
-- `app_settings` is a singleton, so a DEFAULT on the column IS the seeded value
-- and there is no UPDATE to write. AU standard: 1165 x 1165 deck, 150 mm high,
-- 1650 mm of load.
--
-- The product columns are NULLABLE on purpose: NULL means "not measured", which
-- is the signal that makes the carton get ESTIMATED from the unit box and the
-- units-per-carton. It is not an absence to be backfilled — it is a state the
-- UI labels, everywhere the figure is used.
-- =============================================================================

BEGIN;

-- ── The global pallet spec ───────────────────────────────────────────────────
ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS pallet_footprint_length_mm INT NOT NULL DEFAULT 1165,
    ADD COLUMN IF NOT EXISTS pallet_footprint_width_mm  INT NOT NULL DEFAULT 1165,
    ADD COLUMN IF NOT EXISTS pallet_base_height_mm      INT NOT NULL DEFAULT 150,
    ADD COLUMN IF NOT EXISTS pallet_max_load_height_mm  INT NOT NULL DEFAULT 1650;

COMMENT ON COLUMN public.app_settings.pallet_max_load_height_mm IS
  'How tall the GOODS may stack, excluding the pallet deck. Already load-only: '
  'do not subtract pallet_base_height_mm from it.';

-- ── Carton (outer) dimensions. NULL = estimate it from the unit. ─────────────
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS carton_length_cm NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS carton_width_cm  NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS carton_height_cm NUMERIC(8,2);

COMMENT ON COLUMN public.products.carton_length_cm IS
  'Outer dimensions of the shipping carton. Distinct from length_cm/width_cm/'
  'height_cm, which are the UNIT. NULL means not measured, and the pallet fit '
  'estimates the box from the unit instead — labelled as estimated wherever the '
  'resulting figure is shown.';

-- ADD CONSTRAINT has no IF NOT EXISTS, so both are guarded to stay re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_pallet_spec_sane') THEN
    ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_pallet_spec_sane CHECK (
      pallet_footprint_length_mm BETWEEN 1 AND 10000 AND
      pallet_footprint_width_mm  BETWEEN 1 AND 10000 AND
      pallet_base_height_mm      BETWEEN 0 AND 2000  AND
      pallet_max_load_height_mm  BETWEEN 1 AND 10000
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_carton_dims_positive') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_carton_dims_positive CHECK (
      (carton_length_cm IS NULL OR carton_length_cm > 0) AND
      (carton_width_cm  IS NULL OR carton_width_cm  > 0) AND
      (carton_height_cm IS NULL OR carton_height_cm > 0)
    );
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- Verify:
--   SELECT pallet_footprint_length_mm, pallet_footprint_width_mm,
--          pallet_base_height_mm, pallet_max_load_height_mm
--     FROM public.app_settings;
--   -- expect 1165 | 1165 | 150 | 1650
--
--   SELECT count(*) FILTER (WHERE carton_length_cm IS NOT NULL) AS measured,
--          count(*) AS products
--     FROM public.products;
--   -- expect 0 measured; carton dimensions are filled in as products are edited
--
-- Rollback:
--   ALTER TABLE public.app_settings
--     DROP CONSTRAINT IF EXISTS app_settings_pallet_spec_sane,
--     DROP COLUMN IF EXISTS pallet_footprint_length_mm,
--     DROP COLUMN IF EXISTS pallet_footprint_width_mm,
--     DROP COLUMN IF EXISTS pallet_base_height_mm,
--     DROP COLUMN IF EXISTS pallet_max_load_height_mm;
--   ALTER TABLE public.products
--     DROP CONSTRAINT IF EXISTS products_carton_dims_positive,
--     DROP COLUMN IF EXISTS carton_length_cm,
--     DROP COLUMN IF EXISTS carton_width_cm,
--     DROP COLUMN IF EXISTS carton_height_cm;
-- =============================================================================
