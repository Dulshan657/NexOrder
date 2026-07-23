-- =============================================================================
-- N-level units of measure per product
-- Migration: 00067_product_uoms.sql
-- =============================================================================
-- Today a product carries exactly two sellable levels: a base unit and one
-- carton factor (products.carton_size). This adds an arbitrary UOM list per
-- product (each / inner / carton / pallet / …), each a pure QUANTITY multiplier
-- with an EXPLICIT price. There is no license-plate tracking — inventory stays a
-- single base-unit number, and the ledger math (base = quantity × factor) is
-- unchanged because an order/receipt line still stores the chosen UOM's factor
-- in its INT pack_size (see mig 00035).
--
-- Additive & safe: nothing reads product_uoms until later deploys, and
-- products.carton_size is retained as a synced back-compat cache. The write RPC
-- keeps that cache in step. Idempotent.
-- =============================================================================

BEGIN;

-- ── 1. product_uoms — the per-product UOM list ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_uoms (
    id             BIGSERIAL PRIMARY KEY,
    product_id     INT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    code           TEXT NOT NULL,
    -- Base units per 1 of this UOM. Integer-valued: a fractional factor would
    -- truncate on the INT pack_size round-trip and silently mis-scale inventory.
    factor_to_base NUMERIC(12,0) NOT NULL CHECK (factor_to_base >= 1),
    is_base        BOOLEAN NOT NULL DEFAULT false,
    price          NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    is_orderable   BOOLEAN NOT NULL DEFAULT true,
    is_receivable  BOOLEAN NOT NULL DEFAULT true,
    sort_order     INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_uoms_code_unique UNIQUE (product_id, code),
    CONSTRAINT product_uoms_base_factor_one CHECK (NOT is_base OR factor_to_base = 1)
);

-- At most one base UOM per product (the "exactly one" is enforced by the edge
-- validator; this guards the invariant at the storage layer).
CREATE UNIQUE INDEX IF NOT EXISTS product_uoms_one_base
    ON public.product_uoms (product_id) WHERE is_base;
CREATE INDEX IF NOT EXISTS product_uoms_product_sort
    ON public.product_uoms (product_id, sort_order);

-- ── 2. set_product_uoms — atomic replace of a product's UOM list ─────────────
-- supabase-js has no client transaction, so replacing the child rows and syncing
-- the legacy carton_size cache must happen in one server-side call. service_role
-- only (invoked from mutate-product, which bypasses RLS).
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

    -- Upsert keyed on (product_id, code) so ids stay stable for retained codes —
    -- that keeps order_items.uom_id valid across ordinary product edits.
    INSERT INTO public.product_uoms
        (product_id, code, factor_to_base, is_base, price, is_orderable, is_receivable, sort_order, updated_at)
    SELECT
        p_product_id,
        u->>'code',
        (u->>'factor_to_base')::numeric,
        COALESCE((u->>'is_base')::boolean, false),
        (u->>'price')::numeric,
        COALESCE((u->>'is_orderable')::boolean, true),
        COALESCE((u->>'is_receivable')::boolean, true),
        COALESCE((u->>'sort_order')::int, 0),
        now()
    FROM jsonb_array_elements(p_uoms) AS u
    ON CONFLICT (product_id, code) DO UPDATE SET
        factor_to_base = EXCLUDED.factor_to_base,
        is_base        = EXCLUDED.is_base,
        price          = EXCLUDED.price,
        is_orderable   = EXCLUDED.is_orderable,
        is_receivable  = EXCLUDED.is_receivable,
        sort_order     = EXCLUDED.sort_order,
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
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_uoms(INT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_uoms(INT, JSONB) TO service_role;

-- ── 3. Backfill — one base row per product, plus a carton row where applicable ─
-- Carton is priced with today's derived formula so existing catalog is unchanged.
-- carton_discount_percent is read from app_settings (default 5) when present.
DO $$
DECLARE
    v_discount NUMERIC := 0;
BEGIN
    SELECT COALESCE(carton_discount_percent, 0) INTO v_discount
      FROM public.app_settings WHERE id = 1;
    v_discount := COALESCE(v_discount, 0);

    -- Base UOM for every product without one.
    INSERT INTO public.product_uoms
        (product_id, code, factor_to_base, is_base, price, is_orderable, is_receivable, sort_order)
    SELECT p.id, COALESCE(NULLIF(p.unit, ''), 'each'), 1, true, ROUND(p.price, 2), true, true, 0
    FROM public.products p
    WHERE NOT EXISTS (
        SELECT 1 FROM public.product_uoms u WHERE u.product_id = p.id AND u.is_base
    )
    ON CONFLICT (product_id, code) DO NOTHING;

    -- Carton UOM for products with carton_size > 1 and no non-base UOM yet. Rare
    -- products whose base unit is itself labelled 'carton' get the tier code
    -- 'case' so it never collides with the base row's code.
    INSERT INTO public.product_uoms
        (product_id, code, factor_to_base, is_base, price, is_orderable, is_receivable, sort_order)
    SELECT p.id,
           CASE WHEN lower(COALESCE(NULLIF(p.unit, ''), 'each')) = 'carton' THEN 'case' ELSE 'carton' END,
           p.carton_size, false,
           ROUND(p.price * p.carton_size * (1 - v_discount / 100), 2), true, true, 1
    FROM public.products p
    WHERE p.carton_size > 1
      AND NOT EXISTS (
        SELECT 1 FROM public.product_uoms u WHERE u.product_id = p.id AND NOT u.is_base
      )
    ON CONFLICT (product_id, code) DO NOTHING;
END $$;

-- ── 4. RLS — readable by the whole authenticated audience (shop needs it) ─────
-- Matches products_select_authenticated (USING true): customers must read UOMs
-- to see prices. No write policy → all writes go through service_role.
ALTER TABLE public.product_uoms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_uoms_select_authenticated" ON public.product_uoms;
CREATE POLICY "product_uoms_select_authenticated" ON public.product_uoms
    FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.product_uoms TO authenticated;

COMMIT;

-- Verify:
--   SELECT to_regclass('public.product_uoms');
--   SELECT product_id, code, factor_to_base, is_base, price FROM public.product_uoms ORDER BY product_id, sort_order LIMIT 20;
--   -- carton_size cache stays in step:
--   SELECT p.id, p.carton_size FROM public.products p LIMIT 5;
