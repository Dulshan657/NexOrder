-- =============================================================================
-- Many suppliers per product
-- Migration: 00070_product_suppliers.sql
-- =============================================================================
-- Today a product has exactly one supplier: products.supplier_id (NOT NULL FK),
-- plus a nullable preferred_supplier_id. Real catalogues source the same item
-- from several suppliers, each with their OWN part number and cost — which is
-- what Receive Stock needs in order to narrow its product picker to the
-- delivering supplier and match what's printed on the docket.
--
-- This adds a product_suppliers join table. Exactly one link per product is the
-- PRIMARY one, and products.supplier_id is kept in step with it as a
-- back-compat cache — same trick mig 00067 uses for products.carton_size, so
-- every existing read site (the suppliers!products_supplier_id_fkey embed,
-- reports, PO Inbox) keeps working with no change.
--
-- Additive & safe: nothing reads product_suppliers until later deploys.
-- Idempotent.
-- =============================================================================

BEGIN;

-- ── 1. product_suppliers — the per-product supplier list ─────────────────────
CREATE TABLE IF NOT EXISTS public.product_suppliers (
    id           BIGSERIAL PRIMARY KEY,
    product_id   INT NOT NULL REFERENCES public.products(id)  ON DELETE CASCADE,
    supplier_id  INT NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    -- The supplier's own code for this item, as printed on their docket/invoice.
    supplier_sku TEXT,
    -- What THIS supplier charges per base unit (base = products.unit).
    cost_price   NUMERIC(12,2) CHECK (cost_price >= 0),
    is_primary   BOOLEAN NOT NULL DEFAULT false,
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_suppliers_unique UNIQUE (product_id, supplier_id)
);

-- At most one primary supplier per product (the "exactly one" is enforced by
-- the edge validator + the RPC below; this guards it at the storage layer).
CREATE UNIQUE INDEX IF NOT EXISTS product_suppliers_one_primary
    ON public.product_suppliers (product_id) WHERE is_primary;
-- "Which products does this supplier supply?" — the Receive Stock filter.
CREATE INDEX IF NOT EXISTS product_suppliers_by_supplier
    ON public.product_suppliers (supplier_id, product_id);
-- Case-folded supplier-part-number lookup.
CREATE INDEX IF NOT EXISTS product_suppliers_sku
    ON public.product_suppliers (supplier_id, lower(supplier_sku));

-- ── 2. set_product_suppliers — atomic replace of a product's supplier list ───
-- supabase-js has no client transaction, so replacing the child rows and
-- syncing the products.supplier_id cache must happen in one server-side call.
-- service_role only (invoked from mutate-product, which bypasses RLS).
CREATE OR REPLACE FUNCTION public.set_product_suppliers(p_product_id INT, p_links JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_primary INT;
BEGIN
    IF p_links IS NULL OR jsonb_array_length(p_links) = 0 THEN
        RAISE EXCEPTION 'A product needs at least one supplier';
    END IF;

    -- Drop links whose supplier is no longer in the incoming list.
    DELETE FROM public.product_suppliers
     WHERE product_id = p_product_id
       AND supplier_id NOT IN (
           SELECT (l->>'supplier_id')::int FROM jsonb_array_elements(p_links) AS l
       );

    -- Clear the primary flag before re-applying so the one-primary partial
    -- unique index can never see two primary rows mid-statement when the
    -- primary supplier changes.
    UPDATE public.product_suppliers
       SET is_primary = false
     WHERE product_id = p_product_id AND is_primary;

    -- Upsert keyed on (product_id, supplier_id) so ids stay stable for retained
    -- suppliers across ordinary product edits.
    INSERT INTO public.product_suppliers
        (product_id, supplier_id, supplier_sku, cost_price, is_primary, sort_order, updated_at)
    SELECT
        p_product_id,
        (l->>'supplier_id')::int,
        NULLIF(btrim(COALESCE(l->>'supplier_sku', '')), ''),
        (l->>'cost_price')::numeric,
        COALESCE((l->>'is_primary')::boolean, false),
        COALESCE((l->>'sort_order')::int, 0),
        now()
    FROM jsonb_array_elements(p_links) AS l
    ON CONFLICT (product_id, supplier_id) DO UPDATE SET
        supplier_sku = EXCLUDED.supplier_sku,
        cost_price   = EXCLUDED.cost_price,
        is_primary   = EXCLUDED.is_primary,
        sort_order   = EXCLUDED.sort_order,
        updated_at   = now();

    -- Resolve the primary. If the caller sent no is_primary flag, promote the
    -- lowest sort_order link so products.supplier_id can never end up pointing
    -- at a supplier this product isn't linked to (it is also NOT NULL, so it
    -- must always resolve to something).
    SELECT supplier_id INTO v_primary
      FROM public.product_suppliers
     WHERE product_id = p_product_id AND is_primary
     LIMIT 1;

    IF v_primary IS NULL THEN
        SELECT supplier_id INTO v_primary
          FROM public.product_suppliers
         WHERE product_id = p_product_id
         ORDER BY sort_order, id
         LIMIT 1;

        UPDATE public.product_suppliers
           SET is_primary = true, updated_at = now()
         WHERE product_id = p_product_id AND supplier_id = v_primary;
    END IF;

    -- Keep the legacy single-supplier column in step with the primary link.
    UPDATE public.products
       SET supplier_id = v_primary
     WHERE id = p_product_id AND supplier_id IS DISTINCT FROM v_primary;
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_suppliers(INT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_suppliers(INT, JSONB) TO service_role;

-- ── 3. Backfill — one primary link per product, plus preferred_supplier_id ───
-- Every product already has a NOT NULL supplier_id, so this gives the whole
-- catalogue exactly one primary link. A distinct preferred_supplier_id becomes
-- a second, non-primary link (it is genuine "we also buy this from them" data).
INSERT INTO public.product_suppliers (product_id, supplier_id, is_primary, sort_order)
SELECT p.id, p.supplier_id, true, 0
FROM public.products p
ON CONFLICT (product_id, supplier_id) DO NOTHING;

INSERT INTO public.product_suppliers (product_id, supplier_id, is_primary, sort_order)
SELECT p.id, p.preferred_supplier_id, false, 1
FROM public.products p
WHERE p.preferred_supplier_id IS NOT NULL
  AND p.preferred_supplier_id <> p.supplier_id
ON CONFLICT (product_id, supplier_id) DO NOTHING;

-- ── 4. RLS — readable by the whole authenticated audience ────────────────────
-- Matches product_uoms_select_authenticated (USING true): Receive Stock filters
-- the product picker client-side, so it must be able to read the links.
-- No write policy → all writes go through service_role (set_product_suppliers).
ALTER TABLE public.product_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_suppliers_select_authenticated" ON public.product_suppliers;
CREATE POLICY "product_suppliers_select_authenticated" ON public.product_suppliers
    FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.product_suppliers TO authenticated;

COMMIT;

-- Verify:
--   SELECT to_regclass('public.product_suppliers');
--   SELECT product_id, supplier_id, is_primary, supplier_sku, cost_price
--     FROM public.product_suppliers ORDER BY product_id, sort_order LIMIT 20;
--   -- every product has exactly one primary link (expect 0):
--   SELECT count(*) FROM public.products p
--    WHERE NOT EXISTS (SELECT 1 FROM public.product_suppliers ps
--                       WHERE ps.product_id = p.id AND ps.is_primary);
--   -- the cache agrees with the primary link (expect 0):
--   SELECT count(*) FROM public.products p
--     JOIN public.product_suppliers ps ON ps.product_id = p.id AND ps.is_primary
--    WHERE p.supplier_id <> ps.supplier_id;
