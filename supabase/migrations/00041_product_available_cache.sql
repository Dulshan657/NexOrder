-- =============================================================================
-- 00041_product_available_cache.sql
-- =============================================================================
-- Adds a maintained `products.available` cache (reservable stock) alongside the
-- existing `products.inventory` (on-hand) cache.
--
-- Why: customer/rep shopping surfaces read `products` (which every role can
-- SELECT), but the only reservable-stock figure lives in `inventory_balances`
-- (generated `available = on_hand - allocated`), whose RLS is staff-only.
-- The shop was therefore showing on-hand and letting customers add items that
-- are fully allocated to open orders (e.g. Abalone Sauce: 3 on-hand, 0
-- available), which placement then correctly rejects.
--
-- How: `available` is recomputed by the same chokepoint that already maintains
-- `inventory` — inv_recompute_product_cache(), which inv_apply_leg() calls at
-- the end of every leg (allocate / release / pick / receive / transfer). So no
-- reserve/pick function changes; the new column stays in-sync automatically.
-- FLOOR() so a fractional sum never over-reports a reservable whole unit.
-- =============================================================================

BEGIN;

-- 1. Column (match inventory's INT type; default 0 so existing rows are valid).
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS available INT NOT NULL DEFAULT 0;

-- 2. Extend the cache recompute to also maintain `available`.
CREATE OR REPLACE FUNCTION public.inv_recompute_product_cache(p_product_id INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.products p
    SET inventory = COALESCE((
            SELECT SUM(b.on_hand)
            FROM public.inventory_balances b
            WHERE b.product_id = p_product_id
        ), 0),
        available = FLOOR(COALESCE((
            SELECT SUM(b.available)
            FROM public.inventory_balances b
            WHERE b.product_id = p_product_id
        ), 0))
    WHERE p.id = p_product_id;
END;
$$;

-- 3. One-time backfill for all existing products.
UPDATE public.products p
SET available = FLOOR(COALESCE((
        SELECT SUM(b.available)
        FROM public.inventory_balances b
        WHERE b.product_id = p.id
    ), 0));

-- 4. Nightly reconcile (safety net) — heal `available` drift alongside
--    `inventory`. Unschedule + reschedule, mirroring 00027's idempotent guard.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inventory-cache-reconcile') THEN
            PERFORM cron.unschedule('inventory-cache-reconcile');
        END IF;
        PERFORM cron.schedule(
            'inventory-cache-reconcile',
            '23 3 * * *',                              -- daily at 03:23
            $cron$
                UPDATE public.products p
                SET inventory = COALESCE((
                        SELECT SUM(b.on_hand) FROM public.inventory_balances b
                        WHERE b.product_id = p.id
                    ), 0),
                    available = FLOOR(COALESCE((
                        SELECT SUM(b.available) FROM public.inventory_balances b
                        WHERE b.product_id = p.id
                    ), 0))
                WHERE p.inventory <> COALESCE((
                        SELECT SUM(b.on_hand) FROM public.inventory_balances b
                        WHERE b.product_id = p.id
                    ), 0)
                   OR p.available <> FLOOR(COALESCE((
                        SELECT SUM(b.available) FROM public.inventory_balances b
                        WHERE b.product_id = p.id
                    ), 0))
            $cron$
        );
    END IF;
END $$;

COMMIT;

-- Verify with:
--   SELECT id, name, inventory, available FROM public.products
--   WHERE id IN (3, 56) ORDER BY id;
