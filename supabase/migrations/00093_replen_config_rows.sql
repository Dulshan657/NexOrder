-- =============================================================================
-- Replenishment configuration — one read for a whole warehouse's min/max grid
-- Migration: 00093_replen_config_rows.sql
-- =============================================================================
-- Closes onboarding gap H3. Replenishment (mig 00082) is complete and silent:
-- wie_replen_detect bails on its first line unless some product_home_bins row
-- carries replen_enabled with a min and a max, and the only way to write one was
-- ProductHomeBinsSection -- inside a single product's form, one product and one
-- warehouse at a time. Setting up a 200-SKU site that way is not work anybody
-- does, so replenishment stays off and nothing says so.
--
-- This is the READ half of the bulk tool: everything the grid needs for one
-- warehouse in a single round trip. The WRITE half is mutate-product-home-bin's
-- new `bulkSet` action; no schema change is needed for it -- min_qty, max_qty,
-- replen_enabled and purpose have existed since 00082.
--
-- WHY A FUNCTION RATHER THAN QUERIES FROM THE CLIENT. The grid needs six things
-- joined per SKU (home bin, that bin's capacity, the bin the stock is actually
-- in, on-hand here, pack size, demand) plus a list of unclaimed pick bins with
-- their dock distance. As supabase-js reads that is a dozen round trips and a
-- pile of client-side joining; as SQL it is one STABLE function. Precedent and
-- calling convention: wie_warehouse_report (00054) -- granted to `authenticated`,
-- returning camelCase JSONB so no adapter is needed.
--
-- THE SUGGESTION MATHS IS NOT HERE, DELIBERATELY. This function reports facts.
-- Turning a bin's capacity into a suggested min/max is policy, and policy lives
-- in the pure _shared/wie/replenPolicy.ts that BOTH the grid and the edge
-- function import -- the same split as _shared/binCount.ts and
-- _shared/wie/levelRoles.ts. Restating it in PL/pgSQL would give the operator's
-- on-screen preview and the server's decision two definitions to drift apart.
--
-- THE FREE-BIN ASSIGNMENT IS NOT HERE EITHER. `freeBins` is a LIST, ordered by
-- dock distance; which SKU gets which bin is a greedy walk in demand order and
-- SQL would happily hand the same bin to five products. proposeHomeBins() in the
-- pure module does it once, testably, and cannot double-claim.
--
-- Read-only and additive: one new function, no table touched, no existing
-- function replaced. Apply via the Management API (see CLAUDE.md).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_replen_config_rows(p_warehouse_id INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role   TEXT;
    v_path   TEXT;
    v_layout INT;
    v_result JSONB;
BEGIN
    -- Replenishment CONFIG is Admin/Manager work, matching
    -- mutate-product-home-bin's allowed roles -- Warehouse staff walk the queue,
    -- they do not set the thresholds. A NULL role is the service_role path
    -- (auth.uid() is null there), which is trusted by definition.
    v_role := public.user_role();
    IF v_role IS NOT NULL AND v_role NOT IN ('Admin', 'Manager') THEN
        RAISE EXCEPTION 'FORBIDDEN: replenishment configuration is Admin/Manager only'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT materialized_path, active_layout_id INTO v_path, v_layout
    FROM public.locations
    WHERE id = p_warehouse_id AND kind = 'WAREHOUSE';

    IF v_path IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: warehouse % not found', p_warehouse_id USING ERRCODE = 'P0001';
    END IF;

    WITH site_locs AS (
        -- The root included: a bulk area's stock sits ON the root, and excluding
        -- it is the "map all grey" prefix bug from 6a253b2 in miniature.
        SELECT l.*
        FROM public.locations l
        WHERE l.id = p_warehouse_id
           OR l.materialized_path LIKE v_path || '/%'
    ),
    pick_bins AS (
        SELECT l.id, l.code, l.name, l.capacity_slots, l.slot_kind, l.level_role
        FROM site_locs l
        JOIN public.level_roles r ON r.key = l.level_role
        WHERE l.is_active AND r.is_pick_zone AND r.is_active
    ),
    site_bal AS (
        SELECT b.product_id, b.location_id, SUM(b.on_hand) AS on_hand
        FROM public.inventory_balances b
        JOIN site_locs l ON l.id = b.location_id
        GROUP BY b.product_id, b.location_id
    ),
    on_hand_here AS (
        SELECT product_id, SUM(on_hand) AS qty FROM site_bal GROUP BY product_id
    ),
    hb AS (
        SELECT * FROM public.product_home_bins
        WHERE warehouse_id = p_warehouse_id AND purpose = 'primary'
    ),
    -- Two figures off the same table, and they are not the same thing.
    --
    -- `factor` -- the pack an operator counts in: the SMALLEST UOM above base.
    -- On a each/carton/pallet product that is the carton, which is what a
    -- min/max is actually argued about in. NULL for a base-only product; the
    -- grid then types base units and says so.
    --
    -- `top` -- the LARGEST UOM, which is the only record anywhere of how many
    -- base units ride on a unit load. A bin whose slot_kind is 'pallet' counts
    -- POSITIONS, so its capacity_slots cannot be turned into base units without
    -- it (nothing else in the schema stores units-per-pallet -- see
    -- _shared/wie/capacity.ts). Without a pallet UOM such a bin gets no
    -- suggestion at all rather than an invented one.
    pack AS (
        SELECT product_id, MIN(factor_to_base) AS factor, MAX(factor_to_base) AS top
        FROM public.product_uoms
        WHERE factor_to_base > 1
        GROUP BY product_id
    ),
    -- RANKING ONLY. Never an input to a suggested figure -- a fresh site has no
    -- picks at all, and days-of-cover from three days of history is a fiction.
    -- Picks first (they are warehouse-scoped and are what a replenishment
    -- actually serves); order history as the fallback so a site that has never
    -- picked still opens with its fast movers at the top.
    vel AS (
        SELECT product_id, qty_30d
        FROM public.wie_product_velocity
        WHERE warehouse_id = p_warehouse_id
    ),
    ord AS (
        SELECT oi.product_id, SUM(oi.quantity * COALESCE(oi.pack_size, 1)) AS qty
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.created_at >= now() - INTERVAL '90 days'
        GROUP BY oi.product_id
    ),
    -- Where the stock for this SKU actually is, if it is in a pick zone: the
    -- honest home-bin proposal, because somebody already put it there.
    stock_bin AS (
        SELECT DISTINCT ON (sb.product_id)
               sb.product_id, pb.id AS bin_id, pb.code, pb.capacity_slots, pb.slot_kind, pb.level_role
        FROM site_bal sb
        JOIN pick_bins pb ON pb.id = sb.location_id
        WHERE sb.on_hand > 0
        ORDER BY sb.product_id, sb.on_hand DESC, pb.id
    ),
    -- EVERY active product, with a flag saying whether this site has ever seen
    -- it. The grid defaults to the flagged ones and can widen to the catalogue.
    --
    -- Filtering to "stocked here" in SQL was the first cut and it is wrong: on a
    -- site that is set up BEFORE its opening count -- which is the whole reason
    -- the free-bin proposal exists -- nothing is stocked anywhere and the grid
    -- would open empty on exactly the site that needs it most. Verified against
    -- dev's NEXG: 118 pick bins, no stock, and the first cut returned 0 rows.
    candidates AS (
        SELECT p.id, p.sku, p.name, p.category, p.size_factor,
               (EXISTS (SELECT 1 FROM on_hand_here o WHERE o.product_id = p.id)
             OR EXISTS (SELECT 1 FROM hb h WHERE h.product_id = p.id)) AS stocked_here
        FROM public.products p
        WHERE p.is_active
    ),
    rows_out AS (
        SELECT jsonb_build_object(
            'productId',      c.id,
            'sku',            c.sku,
            'name',           c.name,
            'category',       c.category,
            'sizeFactor',     COALESCE(c.size_factor, 1),
            'packFactor',     pk.factor,
            -- Only when it is genuinely a bigger unit than the pack; a product
            -- with one UOM above base has no pallet, it has a carton.
            'palletFactor',   CASE WHEN pk.top > pk.factor THEN pk.top END,
            'stockedHere',    c.stocked_here,
            'onHandHere',     COALESCE(oh.qty, 0),
            'demandQty',      GREATEST(COALESCE(v.qty_30d, 0), COALESCE(od.qty, 0)),
            'homeBinId',      hb.bin_id,
            'homeBinCode',    hbl.code,
            'homeBinLevelRole', hbl.level_role,
            'homeBinCapacitySlots', hbl.capacity_slots,
            'homeBinSlotKind',      hbl.slot_kind,
            'minQty',         hb.min_qty,
            'maxQty',         hb.max_qty,
            'replenEnabled',  COALESCE(hb.replen_enabled, false),
            'stockBinId',            sbin.bin_id,
            'stockBinCode',          sbin.code,
            'stockBinLevelRole',     sbin.level_role,
            'stockBinCapacitySlots', sbin.capacity_slots,
            'stockBinSlotKind',      sbin.slot_kind
        ) AS row
        FROM candidates c
        LEFT JOIN pack         pk   ON pk.product_id  = c.id
        LEFT JOIN on_hand_here oh   ON oh.product_id  = c.id
        LEFT JOIN vel          v    ON v.product_id   = c.id
        LEFT JOIN ord          od   ON od.product_id  = c.id
        LEFT JOIN hb                ON hb.product_id  = c.id
        LEFT JOIN public.locations hbl ON hbl.id      = hb.bin_id
        LEFT JOIN stock_bin    sbin ON sbin.product_id = c.id
        -- Known-here first, then demand: if the cap ever bites it must drop the
        -- least interesting tail, never a SKU this site actually holds.
        ORDER BY c.stocked_here DESC,
                 GREATEST(COALESCE(v.qty_30d, 0), COALESCE(od.qty, 0)) DESC,
                 c.sku
        LIMIT 2000
    ),
    -- Dock distance, same source as wie_putaway_candidates: shortest hop from
    -- any dock node. NULL (no layout, or a bin off the graph) sorts last.
    dock_dist AS (
        SELECT td.to_node_id AS node_id, MIN(td.distance_m) AS dist
        FROM public.layout_travel_distances td
        WHERE td.layout_id = v_layout
          AND td.from_node_id IN (
              SELECT id FROM public.layout_graph_nodes
              WHERE layout_id = v_layout AND node_type = 'dock')
        GROUP BY td.to_node_id
    ),
    free_bins AS (
        SELECT jsonb_build_object(
            'binId',         pb.id,
            'code',          pb.code,
            'name',          pb.name,
            'levelRole',     pb.level_role,
            'capacitySlots', pb.capacity_slots,
            'slotKind',      pb.slot_kind,
            'distanceM',     dd.dist
        ) AS bin, dd.dist AS dist, pb.id AS id
        FROM pick_bins pb
        LEFT JOIN public.layout_placements pl
               ON pl.location_id = pb.id AND pl.layout_id = v_layout
        LEFT JOIN dock_dist dd ON dd.node_id = pl.graph_node_id
        WHERE NOT EXISTS (SELECT 1 FROM site_bal sb WHERE sb.location_id = pb.id AND sb.on_hand > 0)
          AND NOT EXISTS (SELECT 1 FROM hb WHERE hb.bin_id = pb.id)
    )
    SELECT jsonb_build_object(
        'warehouseId', p_warehouse_id,
        'layoutId',    v_layout,
        -- A silent cap reads as "that is the whole catalogue". Say it instead,
        -- and let the grid tell the operator what it is not showing.
        'productCount', (SELECT count(*) FROM candidates),
        'rows',        COALESCE((SELECT jsonb_agg(row) FROM rows_out), '[]'::jsonb),
        'freeBins',    COALESCE((SELECT jsonb_agg(bin ORDER BY dist NULLS LAST, id) FROM free_bins), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.wie_replen_config_rows(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wie_replen_config_rows(INT) TO authenticated, service_role;

COMMENT ON FUNCTION public.wie_replen_config_rows(INT) IS
    'Everything the bulk replenishment min/max grid needs for one warehouse: one row per candidate SKU plus the unclaimed pick bins. Facts only — the suggestion policy lives in _shared/wie/replenPolicy.ts.';

COMMIT;

-- =============================================================================
-- Verify (rollback-isolated; see CLAUDE.md):
--   SELECT jsonb_array_length(r->'rows'), jsonb_array_length(r->'freeBins')
--     FROM (SELECT public.wie_replen_config_rows(<warehouse_id>) r) s;
--
--   -- No free bin is also somebody's home bin (the double-claim this splits out
--   -- of SQL precisely to avoid):
--   SELECT count(*) FROM jsonb_array_elements(
--            public.wie_replen_config_rows(<warehouse_id>)->'freeBins') fb
--    WHERE (fb->>'binId')::int IN (SELECT bin_id FROM public.product_home_bins);
--     -- expect 0
--
--   -- A bulk warehouse (no pick-zone levels) answers with rows and no free bins,
--   -- rather than erroring:
--   SELECT public.wie_replen_config_rows(<bulk_warehouse_id>);
--
--   -- Exactly one overload:
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'wie_replen_config_rows';  -- 1
-- =============================================================================
