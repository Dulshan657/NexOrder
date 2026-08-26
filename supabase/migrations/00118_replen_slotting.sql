-- =============================================================================
-- Replenishment learns about slotting blocks
-- Migration: 00118_replen_slotting.sql
-- =============================================================================
-- Two changes to wie_replen_detect, and one to wie_replen_config_rows:
--
--   SOURCE  — prefer pulling from somewhere this product is already homed.
--   DEST    — WARN when a product's pick face sits outside its blocks.
--   CONFIG  — surface that warning on the min/max grid, where it is fixable.
--
-- CREATE OR REPLACE, SIGNATURE UNCHANGED, AND DELIBERATELY NO `DROP`. This is
-- the exact inverse of 00116's trap and sits three migrations away from it: that
-- one HAD to drop because RETURNS TABLE cannot be replaced. Dropping this one
-- would open a window in which record-pick's advisory call 404s -- it fires on
-- every pick -- for no benefit at all, because nothing about the signature moved.
--
-- ── WHY NO LADDER IN SQL, AND WHY NONE IS NEEDED ────────────────────────────
--
-- The obvious design is a view that answers "which rule GOVERNS this product",
-- restating the specificity ladder that _shared/wie/slotting.ts already
-- implements. That is how plan-reslot ended up zone-blind for months (three
-- places answered one question, two were wrong) and how the recode sweep
-- produced -1-1 on the client and -3-3 on the server.
--
-- It turns out not to be needed. BOTH uses here are soft claims that ask a
-- weaker question:
--   * the source preference is a TIE-BREAK below FEFO — "is this bin somewhere
--     the product lives", not "which rule owns it";
--   * the destination check is a WARNING — and a union warns LESS than the
--     ladder would, which is the safe direction for advice.
-- Neither needs precedence, so v_slotting_product_bins does MATCHING ONLY. It
-- has no ORDER BY, no specificity, and no notion of a winner, and it must never
-- grow one. Anything that needs the governing rule calls resolveSlotting.
--
-- Matching is folded on both sides (`lower(btrim(...))`) to agree byte-for-byte
-- with slotting.ts `foldMatch`, which strips ASCII spaces only — exactly what
-- btrim does, and deliberately not what JS `.trim()` does.
-- =============================================================================

BEGIN;

-- ── 1. Which bins is a product homed in? MATCHING ONLY — see the header ──────

CREATE OR REPLACE VIEW public.v_slotting_product_bins AS
SELECT DISTINCT
       r.warehouse_id,
       p.id AS product_id,
       vb.location_id
  FROM public.slotting_rules r
  JOIN public.products p
    ON (r.match_product_id  IS NULL OR r.match_product_id = p.id)
   AND (r.match_brand       IS NULL
        OR lower(btrim(p.brand))    = lower(btrim(r.match_brand)))
   AND (r.match_category    IS NULL
        OR lower(btrim(p.category)) = lower(btrim(r.match_category)))
   AND (r.match_supplier_id IS NULL OR EXISTS (
         SELECT 1 FROM public.product_suppliers ps
          WHERE ps.product_id = p.id AND ps.supplier_id = r.match_supplier_id))
  JOIN public.slotting_rule_blocks rb ON rb.rule_id = r.id
  JOIN public.v_slotting_block_bins vb ON vb.block_id = rb.block_id
 WHERE r.is_active;

COMMENT ON VIEW public.v_slotting_product_bins IS
    'Bins a product is homed in by ANY matching slotting rule. A UNION, not the '
    'specificity ladder -- it answers "does this product live here", never '
    '"which rule owns it". The ladder has one implementation, in '
    '_shared/wie/slotting.ts resolveSlotting. Do not add precedence here.';

REVOKE ALL ON public.v_slotting_product_bins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_slotting_product_bins TO service_role;

-- ── 2. wie_replen_detect ─────────────────────────────────────────────────────
--
-- 00082's body with five marked additions and NOTHING ELSE changed. That is not
-- a claim, it is a checked property: retyping the body by hand first silently
-- altered the `skipped_all` return shape, renamed the skip reason's
-- `to_location_id` key to `bin_id`, and tightened the source_reserved probe --
-- three breaking changes to a contract the replenishment queue renders. The
-- body here was produced by PATCHING the original text, and diffed against it
-- comment-blind before applying.
--
-- Left exactly as it was, and load-bearing: the ON CONFLICT arbiter restates
-- the partial index's predicate (without `WHERE status = 'suggested'` Postgres
-- cannot match the index and errors at runtime), and the two early returns keep
-- `skipped_all` rather than folding into `skipped`.

CREATE OR REPLACE FUNCTION public.wie_replen_detect(
    p_warehouse_id INT,
    p_product_id   INT     DEFAULT NULL,   -- NULL = sweep the whole warehouse
    p_actor        UUID    DEFAULT NULL,
    p_dry_run      BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slot        RECORD;
    v_src         RECORD;
    v_layout_id   INT;
    v_avail       NUMERIC;
    v_on_hand     NUMERIC;
    v_in_flight   NUMERIC;
    v_deficit     NUMERIC;
    v_qty         NUMERIC;
    v_raised      INT := 0;
    v_expired     INT := 0;
    v_skipped     JSONB := '[]'::JSONB;
    v_task_id     BIGINT;
    -- 00118
    v_off_block   BOOLEAN;
    v_homed       BOOLEAN;
BEGIN
    -- Cheap bail. record-pick is the most-called warehouse endpoint and calls
    -- this on every pick; with p_product_id set this is a couple of index hits.
    IF NOT EXISTS (
        SELECT 1 FROM public.product_home_bins
        WHERE warehouse_id = p_warehouse_id AND replen_enabled
          AND (p_product_id IS NULL OR product_id = p_product_id)
    ) THEN
        RETURN jsonb_build_object('skipped_all', 'no_replen_config',
                                  'raised', 0, 'expired', 0, 'skipped', '[]'::JSONB);
    END IF;

    -- Defensive: 00081's mutate-level-role enforces "at least one active pick
    -- zone", but a direct DB edit could still clear it. Return, never raise --
    -- this runs inside an advisory try/catch on a pick.
    IF NOT EXISTS (SELECT 1 FROM public.level_roles WHERE is_pick_zone AND is_active) THEN
        RETURN jsonb_build_object('skipped_all', 'no_pick_zone',
                                  'raised', 0, 'expired', 0, 'skipped', '[]'::JSONB);
    END IF;

    SELECT active_layout_id INTO v_layout_id FROM public.locations WHERE id = p_warehouse_id;

    -- Withdraw suggestions whose config has gone away, so the dedupe index is
    -- free for a fresh one and the queue does not show stale work.
    IF NOT p_dry_run THEN
        UPDATE public.wie_replen_tasks t
        SET status = 'expired', decided_at = now()
        WHERE t.status = 'suggested'
          AND t.warehouse_id = p_warehouse_id
          AND (p_product_id IS NULL OR t.product_id = p_product_id)
          AND NOT EXISTS (
              SELECT 1 FROM public.product_home_bins hb
              WHERE hb.product_id = t.product_id
                AND hb.warehouse_id = t.warehouse_id
                AND hb.bin_id = t.to_location_id
                AND hb.replen_enabled);
        GET DIAGNOSTICS v_expired = ROW_COUNT;
    END IF;

    FOR v_slot IN
        SELECT hb.product_id, hb.bin_id, hb.min_qty, hb.max_qty
        FROM public.product_home_bins hb
        JOIN public.locations   l ON l.id = hb.bin_id
        JOIN public.level_roles r ON r.key = l.level_role
        WHERE hb.warehouse_id = p_warehouse_id
          AND hb.replen_enabled
          AND (p_product_id IS NULL OR hb.product_id = p_product_id)
          AND l.is_active
          AND r.is_pick_zone AND r.is_active
    LOOP
        SELECT COALESCE(SUM(b.available), 0), COALESCE(SUM(b.on_hand), 0)
        INTO v_avail, v_on_hand
        FROM public.inventory_balances b
        WHERE b.location_id = v_slot.bin_id AND b.product_id = v_slot.product_id;

        SELECT COALESCE(SUM(t.quantity), 0) INTO v_in_flight
        FROM public.wie_replen_tasks t
        WHERE t.warehouse_id = p_warehouse_id
          AND t.product_id = v_slot.product_id
          AND t.to_location_id = v_slot.bin_id
          AND t.status IN ('suggested','assigned');

        -- Trigger on AVAILABLE so allocated-but-unpicked stock cannot hide
        -- behind the min line: you replenish for demand you already know about.
        IF (v_avail + v_in_flight) > v_slot.min_qty THEN
            CONTINUE;
        END IF;

        -- Size against ON_HAND so you never try to put in more than physically
        -- fits, regardless of who owns what is already there.
        v_deficit := v_slot.max_qty - v_on_hand - v_in_flight;
        IF v_deficit <= 0 THEN
            v_skipped := v_skipped || jsonb_build_object(
                'product_id', v_slot.product_id, 'to_location_id', v_slot.bin_id,
                'reason', 'slot_full');
            CONTINUE;
        END IF;

        -- 00118. Is this product homed anywhere at this site, and is its PICK
        -- FACE one of those bins? Advisory only. WARN, NEVER SKIP -- the
        -- allowed_categories doctrine: refusing would not move the pallets, it
        -- would only stop the pick face being refilled, which is strictly worse
        -- than refilling a slot somebody put in the wrong aisle.
        SELECT EXISTS (
            SELECT 1 FROM public.v_slotting_product_bins vp
             WHERE vp.warehouse_id = p_warehouse_id
               AND vp.product_id = v_slot.product_id
        ) INTO v_homed;

        v_off_block := v_homed AND NOT EXISTS (
            SELECT 1 FROM public.v_slotting_product_bins vp
             WHERE vp.warehouse_id = p_warehouse_id
               AND vp.product_id = v_slot.product_id
               AND vp.location_id = v_slot.bin_id
        );

        -- Best source. Ordered by role rank first (reserve before bulk), then
        -- FEFO, and only then by travel.
        --
        -- FEFO SITS ABOVE TRAVEL DELIBERATELY. Same-rack moves are free (levels
        -- share a graph node), which makes distance-first tempting -- but for a
        -- food business, walking the newest pallet down to the pick face while
        -- an older one ages in bulk is a real write-off. In practice same-rack
        -- still wins most of the time, because a rack's own reserve levels
        -- usually hold the same batch.
        SELECT b.location_id, COALESCE(SUM(b.available), 0) AS avail,
               MIN(b.handling_unit_id) AS hu_id
        INTO v_src
        FROM public.inventory_balances b
        JOIN public.locations   l  ON l.id  = b.location_id
        JOIN public.level_roles r  ON r.key = l.level_role
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        LEFT JOIN public.layout_placements fpl
               ON fpl.location_id = b.location_id AND fpl.layout_id = v_layout_id
        LEFT JOIN public.layout_placements tpl
               ON tpl.location_id = v_slot.bin_id AND tpl.layout_id = v_layout_id
        LEFT JOIN public.layout_travel_distances td
               ON td.layout_id = v_layout_id
              AND td.from_node_id = fpl.graph_node_id
              AND td.to_node_id   = tpl.graph_node_id
        -- 00118. Is this candidate source somewhere the product is homed?
        LEFT JOIN public.v_slotting_product_bins vps
               ON vps.warehouse_id = p_warehouse_id
              AND vps.product_id   = v_slot.product_id
              AND vps.location_id  = b.location_id
        WHERE b.product_id = v_slot.product_id
          AND b.available > 0
          AND b.location_id <> v_slot.bin_id
          AND l.is_active
          AND r.replen_source_rank IS NOT NULL AND r.is_active
          AND public.inv_root_warehouse(b.location_id) = p_warehouse_id
        GROUP BY b.location_id, r.replen_source_rank, bt.expiry_date, bt.received_at,
                 fpl.graph_node_id, tpl.graph_node_id, td.distance_m,
                 (vps.location_id IS NOT NULL)
        ORDER BY r.replen_source_rank ASC,
                 bt.expiry_date NULLS LAST,
                 bt.received_at NULLS FIRST,
                 -- 00118. BELOW FEFO, because a slotting rule is a weaker claim
                 -- than an expiry date. ABOVE the same-node test, because below
                 -- it this term could never fire -- a rack's levels share one
                 -- graph node, so that test would always decide first.
                 (vps.location_id IS NOT NULL) DESC,
                 (fpl.graph_node_id IS NOT NULL AND fpl.graph_node_id = tpl.graph_node_id) DESC,
                 td.distance_m ASC NULLS LAST,
                 b.location_id
        LIMIT 1;

        IF NOT FOUND THEN
            -- Distinguish "no stock anywhere" from "stock exists but every unit
            -- is spoken for" -- the second is the #1 predicted support ticket.
            v_skipped := v_skipped || jsonb_build_object(
                'product_id', v_slot.product_id, 'to_location_id', v_slot.bin_id,
                'reason', CASE WHEN EXISTS (
                        SELECT 1 FROM public.inventory_balances b2
                        JOIN public.locations   l2 ON l2.id  = b2.location_id
                        JOIN public.level_roles r2 ON r2.key = l2.level_role
                        WHERE b2.product_id = v_slot.product_id
                          AND b2.on_hand > 0
                          AND b2.location_id <> v_slot.bin_id
                          AND r2.replen_source_rank IS NOT NULL
                          AND public.inv_root_warehouse(b2.location_id) = p_warehouse_id)
                    THEN 'source_reserved' ELSE 'no_source' END);
            CONTINUE;
        END IF;

        -- Never raise a task that cannot complete: inv_transfer_stock is
        -- available-only, so the source's available IS the ceiling.
        v_qty := LEAST(v_deficit, v_src.avail);
        IF v_qty <= 0 THEN
            v_skipped := v_skipped || jsonb_build_object(
                'product_id', v_slot.product_id, 'to_location_id', v_slot.bin_id,
                'reason', 'no_source');
            CONTINUE;
        END IF;

        IF p_dry_run THEN
            v_raised := v_raised + 1;
            CONTINUE;
        END IF;

        -- The ON CONFLICT arbiter MUST restate the partial index's predicate --
        -- without `WHERE status = 'suggested'` Postgres cannot match the index
        -- and errors at runtime.
        INSERT INTO public.wie_replen_tasks
            (warehouse_id, layout_id, product_id, to_location_id,
             recommended_from_location_id, quantity, handling_unit_id,
             trigger_kind, min_qty, max_qty, slot_on_hand, explanation, actor_id)
        VALUES
            (p_warehouse_id, v_layout_id, v_slot.product_id, v_slot.bin_id,
             v_src.location_id, v_qty, v_src.hu_id,
             'min_max', v_slot.min_qty, v_slot.max_qty, v_on_hand,
             jsonb_build_object(
                 'slot_available', v_avail,
                 'slot_on_hand',   v_on_hand,
                 'in_flight',      v_in_flight,
                 'deficit',        v_deficit,
                 'source_available', v_src.avail,
                 -- 00118. Advisory, and rendered by the queue: a pick face
                 -- outside the product's own blocks is a misconfiguration
                 -- nobody would otherwise see.
                 'home_bin_off_block', v_off_block),
             p_actor)
        ON CONFLICT (warehouse_id, product_id, to_location_id) WHERE status = 'suggested'
        DO UPDATE SET
            quantity                     = EXCLUDED.quantity,
            recommended_from_location_id = EXCLUDED.recommended_from_location_id,
            handling_unit_id             = EXCLUDED.handling_unit_id,
            slot_on_hand                 = EXCLUDED.slot_on_hand,
            min_qty                      = EXCLUDED.min_qty,
            max_qty                      = EXCLUDED.max_qty,
            explanation                  = EXCLUDED.explanation
        RETURNING id INTO v_task_id;

        v_raised := v_raised + 1;
    END LOOP;

    RETURN jsonb_build_object('raised', v_raised, 'expired', v_expired, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_replen_detect(INT,INT,UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_replen_detect(INT,INT,UUID,BOOLEAN) TO service_role;

-- ── 3. wie_replen_config_rows ────────────────────────────────────────
--
-- Same treatment: 00093's body, PATCHED not retyped, signature untouched, no
-- DROP. The min/max grid is where a home bin outside its product's blocks is
-- actually FIXABLE, so that is where the warning belongs -- not only on a task
-- a cron raised at 6am.

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
            'stockBinSlotKind',      sbin.slot_kind,
            -- 00118. Where this product is homed by any slotting rule, and
            -- whether its PICK FACE is one of those bins. Facts only, like every
            -- other field here -- the grid decides what to say about them.
            -- Advisory: a home bin outside the block is a misconfiguration to
            -- fix here, never something to refuse a replenishment over.
            'assignedBlockNames', COALESCE((
                SELECT jsonb_agg(DISTINCT sb.name)
                  FROM public.v_slotting_product_bins vp
                  JOIN public.v_slotting_block_bins vbb ON vbb.location_id = vp.location_id
                  JOIN public.slotting_blocks sb ON sb.id = vbb.block_id
                 WHERE vp.warehouse_id = p_warehouse_id AND vp.product_id = c.id
            ), '[]'::jsonb),
            'homeBinOffBlock', (
                hb.bin_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM public.v_slotting_product_bins vp
                             WHERE vp.warehouse_id = p_warehouse_id AND vp.product_id = c.id)
                AND NOT EXISTS (SELECT 1 FROM public.v_slotting_product_bins vp
                                 WHERE vp.warehouse_id = p_warehouse_id
                                   AND vp.product_id = c.id
                                   AND vp.location_id = hb.bin_id)
            )
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

COMMIT;

-- =============================================================================
-- Verify with:
--   -- The view is a MATCH, not a ladder: a product matched by two rules must
--   -- appear in the bins of BOTH, with no winner.
--   SELECT product_id, count(DISTINCT location_id) AS bins
--     FROM public.v_slotting_product_bins WHERE warehouse_id = 1
--    GROUP BY product_id ORDER BY bins DESC LIMIT 5;
--
--   -- Still exactly one overload, still service_role only:
--   SELECT oid::regprocedure::text, proacl::text
--     FROM pg_proc WHERE proname = 'wie_replen_detect';
--
--   -- Inert while no rule exists — the source order and the flag must both be
--   -- unchanged on a site with no slotting:
--   SELECT public.wie_replen_detect(1, NULL, NULL, true);
--
-- Rollback: re-apply 00082's section for wie_replen_detect verbatim, then
--   DROP VIEW IF EXISTS public.v_slotting_product_bins;
-- =============================================================================
