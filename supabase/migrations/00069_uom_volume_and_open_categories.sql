-- =============================================================================
-- Per-UOM volume + operator-created categories
-- Migration: 00069_uom_volume_and_open_categories.sql
-- =============================================================================
-- Two catalog-authoring changes that the product form needs:
--
--   1. Volume is product-level today (products.cubic_meters_unit / _carton),
--      which can't describe an N-level UOM list (mig 00067). Each UOM row gets
--      its own optional m³. Blank means "inherit factor × base volume", so
--      nothing regresses for products that only fill the per-unit field.
--
--   2. products.category is pinned by a CHECK listing 13 literal values, so
--      adding a category needs a migration + deploy. The form now lets an
--      operator type a new one, so the CHECK is relaxed to a sanity bound.
--
-- Additive and permissive: the currently-deployed code simply omits the new
-- column, and dropping a CHECK only widens what is accepted. Idempotent.
-- =============================================================================

BEGIN;

-- ── 1. Open categories ───────────────────────────────────────────────────────
-- The enum-style CHECK goes; a length bound stays so a stray empty string or a
-- pasted paragraph can't land in the column.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_category_check;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_category_length_check;
ALTER TABLE public.products ADD CONSTRAINT products_category_length_check
    CHECK (char_length(btrim(category)) BETWEEN 1 AND 60);

-- ── 2. Per-UOM volume ────────────────────────────────────────────────────────
-- m³ occupied by ONE of this UOM (not per base unit). NULL = inherit
-- factor_to_base × products.cubic_meters_unit at read time.
ALTER TABLE public.product_uoms
    ADD COLUMN IF NOT EXISTS cubic_meters NUMERIC(12,6);

ALTER TABLE public.product_uoms DROP CONSTRAINT IF EXISTS product_uoms_cubic_meters_check;
ALTER TABLE public.product_uoms ADD CONSTRAINT product_uoms_cubic_meters_check
    CHECK (cubic_meters IS NULL OR cubic_meters >= 0);

COMMENT ON COLUMN public.product_uoms.cubic_meters IS
    'm³ for ONE of this UOM. NULL = inherit factor_to_base × products.cubic_meters_unit.';

-- ── 3. set_product_uoms — carry cubic_meters through the upsert ──────────────
-- Same contract as mig 00067 (atomic replace, upsert keyed on (product_id, code)
-- so ids stay stable and order_items.uom_id survives an ordinary edit), plus the
-- new column and a matching legacy-cache sync for cubic_meters_carton.
CREATE OR REPLACE FUNCTION public.set_product_uoms(p_product_id INT, p_uoms JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Drop UOMs whose code is no longer in the incoming list. Rows still
    -- referenced by an order/pantry line fall back to NULL (ON DELETE SET NULL);
    -- historical lines keep their persisted unit_price + pack_size.
    DELETE FROM public.product_uoms
     WHERE product_id = p_product_id
       AND code NOT IN (SELECT u->>'code' FROM jsonb_array_elements(p_uoms) AS u);

    -- Clear the base flag before re-applying so the one-base partial unique index
    -- can never see two base rows mid-statement when the base code changes.
    UPDATE public.product_uoms
       SET is_base = false
     WHERE product_id = p_product_id AND is_base;

    INSERT INTO public.product_uoms
        (product_id, code, factor_to_base, is_base, price, is_orderable, is_receivable,
         sort_order, cubic_meters, updated_at)
    SELECT
        p_product_id,
        u->>'code',
        (u->>'factor_to_base')::numeric,
        COALESCE((u->>'is_base')::boolean, false),
        (u->>'price')::numeric,
        COALESCE((u->>'is_orderable')::boolean, true),
        COALESCE((u->>'is_receivable')::boolean, true),
        COALESCE((u->>'sort_order')::int, 0),
        NULLIF(u->>'cubic_meters', '')::numeric,
        now()
    FROM jsonb_array_elements(p_uoms) AS u
    ON CONFLICT (product_id, code) DO UPDATE SET
        factor_to_base = EXCLUDED.factor_to_base,
        is_base        = EXCLUDED.is_base,
        price          = EXCLUDED.price,
        is_orderable   = EXCLUDED.is_orderable,
        is_receivable  = EXCLUDED.is_receivable,
        sort_order     = EXCLUDED.sort_order,
        cubic_meters   = EXCLUDED.cubic_meters,
        updated_at     = now();

    -- Keep products.carton_size = smallest orderable non-base factor (or 1) so
    -- legacy read sites that still select carton_size keep working.
    UPDATE public.products
       SET carton_size = COALESCE((
               SELECT MIN(factor_to_base)::int
               FROM public.product_uoms
               WHERE product_id = p_product_id AND NOT is_base AND is_orderable
           ), 1)
     WHERE id = p_product_id;

    -- Same idea for the cubic_meters_carton cache — but ONLY when that UOM
    -- actually carries a volume. An edit that leaves the volume blank must not
    -- wipe a value the operator set through the legacy field.
    UPDATE public.products p
       SET cubic_meters_carton = v.cubic_meters
      FROM (
            SELECT cubic_meters
              FROM public.product_uoms
             WHERE product_id = p_product_id AND NOT is_base AND is_orderable
               AND cubic_meters IS NOT NULL
             ORDER BY factor_to_base
             LIMIT 1
           ) AS v
     WHERE p.id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_uoms(INT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_uoms(INT, JSONB) TO service_role;

-- ── 4. Backfill — today's carton volume becomes that UOM's volume ────────────
-- So the first edit of an existing product doesn't have to re-enter it.
UPDATE public.product_uoms u
   SET cubic_meters = p.cubic_meters_carton
  FROM public.products p
 WHERE u.product_id = p.id
   AND NOT u.is_base
   AND u.factor_to_base = p.carton_size
   AND p.cubic_meters_carton IS NOT NULL
   AND u.cubic_meters IS NULL;

COMMIT;

-- Verify:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.products'::regclass;
--     -- products_category_check gone, products_category_length_check present
--   SELECT product_id, code, factor_to_base, cubic_meters
--     FROM public.product_uoms WHERE cubic_meters IS NOT NULL ORDER BY product_id LIMIT 20;
