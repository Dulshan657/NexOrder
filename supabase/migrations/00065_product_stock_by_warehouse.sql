-- =============================================================================
-- Warehouse scope — per-product stock rollup for a single warehouse subtree
-- Migration: 00065_product_stock_by_warehouse.sql
-- =============================================================================
-- Backs the Products/Stock "warehouse scope" picker (see the approved plan
-- `i-want-to-be-sharded-forest`). Returns one row per product with a balance
-- ANYWHERE in the given warehouse's subtree: SUM(on_hand)/SUM(allocated)/
-- SUM(available) across inventory_balances.
--
-- Root-union rule (load-bearing): the subtree is the warehouse's own location
-- id UNION every descendant whose materialized_path falls under it. A BULK
-- warehouse keeps ALL of its stock on the root location itself (there are no
-- bins under it), so omitting the root from the union would silently return
-- zero rows for every bulk warehouse. This mirrors inv_root_warehouse (mig
-- 00040) and getBalancesByWarehouse (services/supabase/inventoryService.ts).
--
-- LIKE-injection guard: the root's materialized_path is escaped (backslash
-- first, then % and _) before being used as a LIKE prefix, exactly like the
-- escapeLike() helper in inventoryService.ts. Without it, a warehouse code
-- containing `_` (a single-char LIKE wildcard) could match into a sibling
-- subtree, e.g. path `WH_1` matching locations under `WHX1`. Postgres's
-- default LIKE escape character is backslash, so no explicit ESCAPE clause
-- is needed as long as the pattern itself is escaped correctly.
--
-- Missing/bad input is handled by returning no rows, not raising: if
-- p_warehouse_id doesn't exist (or its materialized_path is NULL), the CTEs
-- resolve to empty sets and the final WHERE ... IN (empty) yields zero rows.
--
-- Absent-vs-zero is deliberate (see below the GROUP BY) — do not add an
-- `on_hand > 0` filter or a batch_id predicate. The Products tab tells "0 in
-- stock here" (a real balance row at zero) apart from "never stocked here"
-- (no row at all) using exactly that distinction.
--
-- STABLE + LANGUAGE sql (no SECURITY DEFINER) means this runs with the
-- CALLER's rights, so the existing staff-only SELECT policy on
-- inventory_balances (mig 00027: Admin/Manager/Warehouse/Field Sales
-- Rep/Office Sales Rep) applies automatically — reps/customers calling this
-- get nothing extra, no new RLS work required. Same pattern as
-- wie_warehouse_report (mig 00054).
--
-- The 'all' scope does NOT call this function — it keeps reading the
-- existing full-ledger balance query / products.inventory cache, unchanged.
-- This function only ever answers "stock under ONE specific warehouse".
-- Additive & idempotent.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inv_product_stock_by_warehouse(p_warehouse_id INT)
RETURNS TABLE(product_id INT, on_hand NUMERIC, allocated NUMERIC, available NUMERIC)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH v_root AS (
        SELECT l.id, l.materialized_path AS path
        FROM public.locations l
        WHERE l.id = p_warehouse_id
    ),
    -- Escape LIKE metacharacters in the root path before it becomes a prefix
    -- pattern. Backslash MUST be escaped first so the backslashes inserted by
    -- the later % / _ escaping aren't themselves re-escaped.
    v_escaped AS (
        SELECT v_root.id,
               replace(replace(replace(v_root.path, '\', '\\'), '%', '\%'), '_', '\_') AS esc_path
        FROM v_root
        WHERE v_root.path IS NOT NULL
    ),
    -- The subtree = the warehouse root itself UNION every descendant location.
    -- Root is included because bulk warehouses keep stock on the root row.
    v_subtree AS (
        SELECT v_escaped.id AS location_id
        FROM v_escaped
        UNION
        SELECT l.id
        FROM public.locations l
        JOIN v_escaped ON l.materialized_path LIKE v_escaped.esc_path || '/%'
    )
    -- No `on_hand > 0` filter and no batch_id predicate — see header comment.
    -- A product with a zero-quantity balance row in the subtree is RETURNED
    -- (on_hand = 0); a product with no balance row at all is ABSENT from the
    -- result set. That absence is the signal the frontend renders as
    -- "Not stocked here" rather than "0 in stock".
    SELECT b.product_id::INT AS product_id,
           SUM(b.on_hand)::NUMERIC   AS on_hand,
           SUM(b.allocated)::NUMERIC AS allocated,
           SUM(b.available)::NUMERIC AS available
    FROM public.inventory_balances b
    WHERE b.location_id IN (SELECT v_subtree.location_id FROM v_subtree)
    GROUP BY b.product_id;
$$;

REVOKE ALL ON FUNCTION public.inv_product_stock_by_warehouse(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_product_stock_by_warehouse(INT) TO authenticated, service_role;

COMMIT;

-- Verify (run against both a RACKED warehouse and a BULK warehouse — bulk
-- must return non-empty rows since its stock lives on the root):
--   SELECT * FROM public.inv_product_stock_by_warehouse(<warehouse_id>) ORDER BY product_id LIMIT 20;
--   -- non-existent id should return zero rows, not an error:
--   SELECT * FROM public.inv_product_stock_by_warehouse(999999);
