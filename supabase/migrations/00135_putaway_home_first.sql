-- =============================================================================
-- Putaway — home bin first, complete without Assign (NX-0006)
-- Migration: 00135_putaway_home_first.sql
-- =============================================================================
-- The owner gives every product a home bin (product_home_bins), and putaway
-- sends goods there. A task no longer needs a desk to assign it before the
-- floor can carry it, because the suggestion IS the plan:
--
--   suggested ──complete──> accepted | overridden          (NEW: no assign)
--   suggested ──assign──> assigned ──complete──> ...       (unchanged, kept
--                                                           for rows in flight)
--   suggested/assigned ──complete(short)──> remainder 'short'
--   short ──resolve found──> suggested
--   short ──resolve write_off──> written_off (+ inv_adjust_stock at the root)
--
-- Contents:
--   1. wie_putaway_recommendations: 'short' / 'written_off' statuses,
--      suggestion_source, override_reason, redirected_from_location_id
--   2. wie_putaway_candidates gains p_anchor_location_id → same_rack,
--      anchor_distance_m (closest-to-home ranking, as replen ranks sources)
--   3. wie_complete_putaway_tx accepts 'suggested', records a reason, and can
--      flag a short remainder (old 4-arg signature DROPPED first)
--   4. wie_complete_putaway_many_tx — several loose tasks of one product in one
--      transaction, plus "make this the home bin"
--   5. wie_redirect_putaway_tx — the desk changes a suggestion before anyone walks it
--   6. wie_resolve_short_putaway_tx — found it / write it off
--
-- The status CHECK widens; nothing that existed is reinterpreted. 'short' is
-- deliberately NOT in v_bin_pending_putaway (00123 counts suggested/assigned
-- only): a shortage is promised to no bin.
--
-- Service-role only. Idempotent.
-- =============================================================================

BEGIN;

-- ── 1. Columns and statuses ──────────────────────────────────────────────────
ALTER TABLE public.wie_putaway_recommendations
    DROP CONSTRAINT IF EXISTS wie_putaway_recommendations_status_check;
ALTER TABLE public.wie_putaway_recommendations
    ADD CONSTRAINT wie_putaway_recommendations_status_check
    CHECK (status IN ('suggested','assigned','accepted','overridden','expired',
                      'short','written_off'));

ALTER TABLE public.wie_putaway_recommendations
    ADD COLUMN IF NOT EXISTS suggestion_source TEXT,
    ADD COLUMN IF NOT EXISTS override_reason TEXT,
    ADD COLUMN IF NOT EXISTS redirected_from_location_id INT REFERENCES public.locations(id),
    ADD COLUMN IF NOT EXISTS resolution_reason TEXT;

ALTER TABLE public.wie_putaway_recommendations
    DROP CONSTRAINT IF EXISTS wie_putaway_recommendations_source_check;
ALTER TABLE public.wie_putaway_recommendations
    ADD CONSTRAINT wie_putaway_recommendations_source_check
    CHECK (suggestion_source IS NULL
           OR suggestion_source IN ('home','overflow','engine','desk'));

ALTER TABLE public.wie_putaway_recommendations
    DROP CONSTRAINT IF EXISTS wie_putaway_recommendations_override_reason_check;
ALTER TABLE public.wie_putaway_recommendations
    ADD CONSTRAINT wie_putaway_recommendations_override_reason_check
    CHECK (override_reason IS NULL
           OR override_reason IN ('blocked','damaged','full','closer','other'));

COMMENT ON COLUMN public.wie_putaway_recommendations.suggestion_source IS
    'Why this bin (mig 00135): home = the product''s home bin, overflow = near '
    'the home bin, engine = no home, desk = redirected by an Admin/Manager. '
    'NULL on rows written before 00135.';
COMMENT ON COLUMN public.wie_putaway_recommendations.redirected_from_location_id IS
    'The bin the engine suggested before the desk redirected it (mig 00135). '
    'recommended_location_id then names the desk''s bin; the engine''s winner '
    'is still in explanation.';

CREATE INDEX IF NOT EXISTS idx_wie_putaway_short
    ON public.wie_putaway_recommendations (warehouse_id)
    WHERE status = 'short';

-- ── 2. Candidates ranked by closeness to the home bin ────────────────────────
DROP FUNCTION IF EXISTS public.wie_putaway_candidates(INT, INT, INT, TEXT[], BOOLEAN, INT[]);

CREATE FUNCTION public.wie_putaway_candidates(
    p_layout_id           INT,
    p_product_id          INT,
    p_limit               INT     DEFAULT 2000,
    p_roles               TEXT[]  DEFAULT NULL,
    p_hold_only           BOOLEAN DEFAULT false,
    p_priority_locations  INT[]   DEFAULT NULL,
    p_anchor_location_id  INT     DEFAULT NULL
)
RETURNS TABLE(
    location_id              INT,
    code                     TEXT,
    zone_id                  INT,
    zone_tag                 TEXT,
    capacity_slots           NUMERIC,
    used_slots               NUMERIC,
    graph_node_id            INT,
    access_offset_m          NUMERIC,
    has_same_product         BOOLEAN,
    distance_from_dock_m     NUMERIC,
    zone_type                TEXT,
    zone_priority_weight     NUMERIC,
    zone_allowed_categories  JSONB,
    zone_max_utilization_pct NUMERIC,
    bin_categories           JSONB,
    weight_capacity_kg       NUMERIC,
    used_weight_kg           NUMERIC,
    level_role               TEXT,
    level_index              INT,
    slot_kind                TEXT,
    block_ids                INT[],
    is_hold                  BOOLEAN,
    pending_slots            NUMERIC,
    pending_weight_kg        NUMERIC,
    -- NEW in 00135. Appended last, same convention as 00116 / 00123.
    same_rack                BOOLEAN,
    anchor_distance_m        NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH dock_nodes AS (
        SELECT id FROM public.layout_graph_nodes
        WHERE layout_id = p_layout_id AND node_type = 'dock'
    ),
    node_dock_dist AS (
        SELECT to_node_id AS node_id, MIN(distance_m) AS dist
        FROM public.layout_travel_distances
        WHERE layout_id = p_layout_id AND from_node_id IN (SELECT id FROM dock_nodes)
        GROUP BY to_node_id
    ),
    bin_weight AS (
        SELECT b.location_id, SUM(b.on_hand * COALESCE(pw.weight_kg, 0)) AS used_weight
        FROM public.inventory_balances b
        LEFT JOIN public.product_wms_attributes pw ON pw.product_id = b.product_id
        WHERE b.on_hand > 0
        GROUP BY b.location_id
    ),
    bin_cats AS (
        SELECT b.location_id, jsonb_agg(DISTINCT pr.category) AS cats
        FROM public.inventory_balances b
        JOIN public.products pr ON pr.id = b.product_id
        WHERE b.on_hand > 0
        GROUP BY b.location_id
    ),
    same_prod AS (
        SELECT DISTINCT location_id FROM public.inventory_balances
        WHERE product_id = p_product_id AND on_hand > 0
    ),
    bin_blocks AS (
        SELECT vb.location_id, array_agg(DISTINCT vb.block_id) AS ids
        FROM public.v_slotting_block_bins vb
        GROUP BY vb.location_id
    ),
    -- The home bin: its placement (graph node, grid cell, floor) and its rack
    -- (the nearest RACK ancestor by materialized path, as replen's same-rack
    -- rule reads it in 00118). Empty when no anchor was asked for.
    anchor AS (
        SELECT al.id, ap.graph_node_id, ap.floor,
               ap.x + ap.w / 2.0 AS cx, ap.y + ap.h / 2.0 AS cy,
               (SELECT wl.cell_size_m FROM public.warehouse_layouts wl
                 WHERE wl.id = p_layout_id) AS cell_m,
               (SELECT r.id FROM public.locations r
                 WHERE r.kind = 'RACK'
                   AND al.materialized_path LIKE r.materialized_path || '/%'
                 ORDER BY length(r.materialized_path) DESC LIMIT 1) AS rack_id
        FROM public.locations al
        LEFT JOIN public.layout_placements ap
               ON ap.location_id = al.id AND ap.layout_id = p_layout_id
        WHERE al.id = p_anchor_location_id
    )
    SELECT
        p.location_id,
        l.code,
        zone.id,
        lower(zone.name),
        l.capacity_slots,
        COALESCE(bf.used_slots, 0),
        p.graph_node_id,
        COALESCE(p.access_offset_m, 0),
        (sp.location_id IS NOT NULL),
        ndd.dist,
        zp.zone_type,
        zp.priority_weight,
        zp.allowed_categories,
        zp.max_utilization_pct,
        COALESCE(bc.cats, '[]'::jsonb),
        l.weight_capacity_kg,
        COALESCE(bw.used_weight, 0),
        l.level_role,
        l.level_index,
        l.slot_kind,
        bb.ids,
        COALESCE(zp.is_hold, false),
        COALESCE(pend.pending_slots, 0),
        COALESCE(pend.pending_weight_kg, 0),
        (an.rack_id IS NOT NULL AND rk.id = an.rack_id),
        ad.dist
    FROM public.layout_placements p
    JOIN public.locations l ON l.id = p.location_id
    LEFT JOIN LATERAL (
        SELECT z.id, z.name, z.zone_profile_id FROM public.locations z
        WHERE z.kind = 'ZONE' AND l.materialized_path LIKE z.materialized_path || '/%'
        ORDER BY length(z.materialized_path) DESC
        LIMIT 1
    ) zone ON true
    LEFT JOIN LATERAL (
        SELECT r.id FROM public.locations r
        WHERE p_anchor_location_id IS NOT NULL
          AND r.kind = 'RACK' AND l.materialized_path LIKE r.materialized_path || '/%'
        ORDER BY length(r.materialized_path) DESC
        LIMIT 1
    ) rk ON true
    LEFT JOIN anchor an ON true
    LEFT JOIN public.layout_travel_distances td
           ON td.layout_id = p_layout_id
          AND td.from_node_id = an.graph_node_id
          AND td.to_node_id = p.graph_node_id
    -- Distance from home. layout_travel_distances is NOT a bin-to-bin matrix
    -- (publish stores distances from the docks and a few junctions only), so a
    -- graph distance from an arbitrary home bin is usually missing. The grid
    -- distance between the two placements, along the axes and in metres, is
    -- the fallback: it is what an aisle walk approximates. Another floor ranks
    -- last (NULL).
    LEFT JOIN LATERAL (
        SELECT CASE
            WHEN an.id IS NULL THEN NULL
            WHEN p.graph_node_id IS NOT NULL AND p.graph_node_id = an.graph_node_id THEN 0
            WHEN td.distance_m IS NOT NULL THEN td.distance_m
            WHEN an.cx IS NULL OR p.floor IS DISTINCT FROM an.floor THEN NULL
            ELSE (abs(p.x + p.w / 2.0 - an.cx) + abs(p.y + p.h / 2.0 - an.cy))
                 * COALESCE(an.cell_m, 1)
        END AS dist
    ) ad ON true
    LEFT JOIN public.zone_profiles zp ON zp.id = zone.zone_profile_id
    LEFT JOIN node_dock_dist ndd ON ndd.node_id = p.graph_node_id
    LEFT JOIN public.v_bin_fill bf ON bf.location_id = p.location_id
    LEFT JOIN public.v_bin_pending_putaway pend ON pend.location_id = p.location_id
    LEFT JOIN bin_weight     bw  ON bw.location_id = p.location_id
    LEFT JOIN bin_cats       bc  ON bc.location_id = p.location_id
    LEFT JOIN same_prod      sp  ON sp.location_id = p.location_id
    LEFT JOIN bin_blocks     bb  ON bb.location_id = p.location_id
    WHERE p.layout_id = p_layout_id
      AND l.is_active
      AND l.kind <> 'RACK'
      AND (p_roles IS NULL OR l.level_role IS NULL OR l.level_role = ANY(p_roles))
      AND COALESCE(zp.is_hold, false) = p_hold_only
    -- Priority bins (the product's slotting homes and its home bin) can never
    -- be cut by the LIMIT. Then, with an anchor, bins near home come before the
    -- dock order, so a big site cannot hide the overflow next to the home bin.
    ORDER BY (p_priority_locations IS NOT NULL
              AND p.location_id = ANY(p_priority_locations)) DESC,
             (an.rack_id IS NOT NULL AND rk.id = an.rack_id) DESC,
             ad.dist NULLS LAST,
             ndd.dist NULLS LAST,
             p.location_id
    LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[],BOOLEAN,INT[],INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[],BOOLEAN,INT[],INT)
    TO service_role;

-- ── 3. Complete: suggested OR assigned, reason, short ────────────────────────
-- A changed signature would create a second overload, not replace (the 00037 /
-- 00080 trap), so the 4-arg version is dropped first.
DROP FUNCTION IF EXISTS public.wie_complete_putaway_tx(BIGINT, INT, NUMERIC, UUID);

CREATE FUNCTION public.wie_complete_putaway_tx(
    p_rec_id          BIGINT,
    p_actual          INT,
    p_qty             NUMERIC DEFAULT NULL,   -- NULL = the whole task
    p_actor           UUID    DEFAULT NULL,
    p_override_reason TEXT    DEFAULT NULL,
    p_short           BOOLEAN DEFAULT false   -- the remainder is a shortage, not still on the dock
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec         public.wie_putaway_recommendations%ROWTYPE;
    v_qty         NUMERIC;
    v_remainder   NUMERIC;
    v_status      TEXT;
    v_target      INT;
    v_placed_id   BIGINT;
    v_moved       JSONB;
BEGIN
    IF p_actual IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: the bin it was placed in is required'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_rec
    FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', p_rec_id
            USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status NOT IN ('suggested', 'assigned') THEN
        RAISE EXCEPTION 'CONFLICT: putaway task already %', v_rec.status
            USING ERRCODE = 'P0001';
    END IF;

    v_qty := COALESCE(p_qty, v_rec.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: placed quantity must be positive'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_qty > v_rec.quantity THEN
        RAISE EXCEPTION 'INVALID_QTY: % exceeds the % on this task',
            v_qty, v_rec.quantity USING ERRCODE = 'P0001';
    END IF;

    -- What the operator was sent to: the desk's bin on the two-stage path,
    -- otherwise the suggestion itself.
    v_target := CASE WHEN v_rec.status = 'assigned'
                     THEN v_rec.assigned_location_id
                     ELSE v_rec.recommended_location_id END;
    v_status := CASE WHEN p_actual = v_target THEN 'accepted' ELSE 'overridden' END;

    -- complete-putaway enforces "a suggested task placed elsewhere needs a
    -- reason" (_shared/putawayCompletion.ts); this is the backstop.
    IF v_status = 'overridden' AND v_rec.status = 'suggested' AND p_override_reason IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: a reason is required when it goes to a different bin'
            USING ERRCODE = 'P0001';
    END IF;

    v_remainder := v_rec.quantity - v_qty;

    IF v_remainder = 0 THEN
        UPDATE public.wie_putaway_recommendations
        SET status             = v_status,
            chosen_location_id = p_actual,
            override_reason    = CASE WHEN v_status = 'overridden' THEN p_override_reason END,
            decided_at         = now(),
            actor_id           = p_actor
        WHERE id = p_rec_id;
        v_placed_id := p_rec_id;
    ELSE
        -- The ORIGINAL row keeps the remainder: still the floor's task, or the
        -- manager's shortage when the count came up short.
        UPDATE public.wie_putaway_recommendations
        SET quantity = v_remainder,
            status   = CASE WHEN p_short THEN 'short' ELSE status END
        WHERE id = p_rec_id;

        INSERT INTO public.wie_putaway_recommendations
            (warehouse_id, layout_id, product_id, quantity, goods_receipt_id,
             recommended_location_id, alternatives, explanation, engine_version,
             status, assigned_location_id, assigned_at, assigned_by,
             chosen_location_id, handling_unit_id, actor_id, created_at, decided_at,
             off_home, slotting_rule_id, suggestion_source, override_reason,
             redirected_from_location_id)
        VALUES
            (v_rec.warehouse_id, v_rec.layout_id, v_rec.product_id, v_qty,
             v_rec.goods_receipt_id, v_rec.recommended_location_id,
             v_rec.alternatives, v_rec.explanation, v_rec.engine_version,
             v_status, v_rec.assigned_location_id, v_rec.assigned_at, v_rec.assigned_by,
             p_actual, v_rec.handling_unit_id, p_actor, v_rec.created_at, now(),
             v_rec.off_home, v_rec.slotting_rule_id, v_rec.suggestion_source,
             CASE WHEN v_status = 'overridden' THEN p_override_reason END,
             v_rec.redirected_from_location_id)
        RETURNING id INTO v_placed_id;
    END IF;

    -- Same transaction: a failed move rolls the completion back with it.
    v_moved := public.inv_transfer_stock(
        v_rec.product_id, v_rec.warehouse_id, p_actual, v_qty, p_actor,
        'putaway:' || v_status, v_rec.handling_unit_id);

    RETURN jsonb_build_object(
        'placed_id',        v_placed_id,
        'status',           v_status,
        'remainder_id',     CASE WHEN v_remainder > 0 THEN p_rec_id ELSE NULL END,
        'remainder_qty',    v_remainder,
        'remainder_status', CASE WHEN v_remainder > 0
                                 THEN CASE WHEN p_short THEN 'short' ELSE v_rec.status END
                            END,
        'moved',            v_moved);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_complete_putaway_tx(BIGINT,INT,NUMERIC,UUID,TEXT,BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_complete_putaway_tx(BIGINT,INT,NUMERIC,UUID,TEXT,BOOLEAN)
    TO service_role;

-- ── 4. Several loose tasks of one product, and "make this the home bin" ──────
-- p_allocations: [{"id": <task>, "qty": <placed, may be 0>}, ...], already
-- allocated oldest-first by complete-putaway (_shared/putawayCompletion.ts).
-- A 0 entry is a task the count did not reach; with p_short it becomes a
-- shortage too, otherwise it is left exactly as it was.
CREATE OR REPLACE FUNCTION public.wie_complete_putaway_many_tx(
    p_allocations     JSONB,
    p_actual          INT,
    p_actor           UUID,
    p_override_reason TEXT    DEFAULT NULL,
    p_short           BOOLEAN DEFAULT false,
    p_make_home       BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item       JSONB;
    v_id         BIGINT;
    v_qty        NUMERIC;
    v_results    JSONB := '[]'::jsonb;
    v_rec        public.wie_putaway_recommendations%ROWTYPE;
    v_product    INT;
    v_warehouse  INT;
    v_home_set   BOOLEAN := false;
BEGIN
    IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
        RAISE EXCEPTION 'INVALID_INPUT: no tasks to complete' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
        v_id  := (v_item->>'id')::BIGINT;
        v_qty := (v_item->>'qty')::NUMERIC;

        SELECT * INTO v_rec FROM public.wie_putaway_recommendations
        WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', v_id USING ERRCODE = 'P0001';
        END IF;
        IF v_product IS NULL THEN
            v_product := v_rec.product_id;
            v_warehouse := v_rec.warehouse_id;
        ELSIF v_rec.product_id <> v_product OR v_rec.warehouse_id <> v_warehouse THEN
            RAISE EXCEPTION 'INVALID_INPUT: tasks for different products cannot be completed together'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_qty > 0 THEN
            v_results := v_results || public.wie_complete_putaway_tx(
                v_id, p_actual, v_qty, p_actor, p_override_reason, p_short);
        ELSIF p_short THEN
            IF v_rec.status NOT IN ('suggested', 'assigned') THEN
                RAISE EXCEPTION 'CONFLICT: putaway task already %', v_rec.status USING ERRCODE = 'P0001';
            END IF;
            UPDATE public.wie_putaway_recommendations SET status = 'short' WHERE id = v_id;
            v_results := v_results || jsonb_build_object(
                'placed_id', NULL, 'status', NULL, 'remainder_id', v_id,
                'remainder_qty', v_rec.quantity, 'remainder_status', 'short', 'moved', NULL);
        END IF;
    END LOOP;

    -- Fills a gap only: ON CONFLICT leaves an existing home alone, and a home
    -- set by someone else a moment ago wins.
    IF p_make_home THEN
        INSERT INTO public.product_home_bins (product_id, warehouse_id, bin_id)
        VALUES (v_product, v_warehouse, p_actual)
        ON CONFLICT (product_id, warehouse_id) DO NOTHING;
        v_home_set := FOUND;
    END IF;

    RETURN jsonb_build_object('results', v_results, 'home_set', v_home_set);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_complete_putaway_many_tx(JSONB,INT,UUID,TEXT,BOOLEAN,BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_complete_putaway_many_tx(JSONB,INT,UUID,TEXT,BOOLEAN,BOOLEAN)
    TO service_role;

-- ── 5. Desk redirect ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wie_redirect_putaway_tx(
    p_rec_id   BIGINT,
    p_location INT,
    p_actor    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec public.wie_putaway_recommendations%ROWTYPE;
BEGIN
    SELECT * INTO v_rec FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', p_rec_id USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status <> 'suggested' THEN
        RAISE EXCEPTION 'CONFLICT: putaway task already %', v_rec.status USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.wie_putaway_recommendations
    SET redirected_from_location_id = COALESCE(redirected_from_location_id, recommended_location_id),
        recommended_location_id     = p_location,
        suggestion_source           = 'desk',
        actor_id                    = p_actor
    WHERE id = p_rec_id;

    RETURN jsonb_build_object('id', p_rec_id, 'from', v_rec.recommended_location_id, 'to', p_location);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_redirect_putaway_tx(BIGINT,INT,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_redirect_putaway_tx(BIGINT,INT,UUID)
    TO service_role;

-- ── 6. Resolve a shortage ────────────────────────────────────────────────────
-- found:     the goods turned up; the task goes back on the floor's list.
-- write_off: they did not. The units still on record at the warehouse root are
--            adjusted off in the same transaction, so the books stop promising
--            stock that is not there.
CREATE OR REPLACE FUNCTION public.wie_resolve_short_putaway_tx(
    p_rec_id     BIGINT,
    p_resolution TEXT,
    p_reason     TEXT,
    p_actor      UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec      public.wie_putaway_recommendations%ROWTYPE;
    v_adjusted JSONB;
BEGIN
    IF p_resolution NOT IN ('found', 'write_off') THEN
        RAISE EXCEPTION 'INVALID_INPUT: resolution must be found or write_off' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_rec FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', p_rec_id USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status <> 'short' THEN
        RAISE EXCEPTION 'CONFLICT: putaway task is %, not short', v_rec.status USING ERRCODE = 'P0001';
    END IF;

    IF p_resolution = 'found' THEN
        UPDATE public.wie_putaway_recommendations
        SET status = 'suggested', resolution_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
            actor_id = p_actor
        WHERE id = p_rec_id;
        RETURN jsonb_build_object('id', p_rec_id, 'status', 'suggested');
    END IF;

    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: a write-off needs a reason' USING ERRCODE = 'P0001';
    END IF;

    v_adjusted := public.inv_adjust_stock(
        v_rec.product_id, v_rec.warehouse_id, -v_rec.quantity,
        'putaway shortage: ' || btrim(p_reason), p_actor,
        NULL, 'adjustment', v_rec.handling_unit_id);

    UPDATE public.wie_putaway_recommendations
    SET status = 'written_off', resolution_reason = btrim(p_reason),
        decided_at = now(), actor_id = p_actor
    WHERE id = p_rec_id;

    RETURN jsonb_build_object('id', p_rec_id, 'status', 'written_off', 'adjusted', v_adjusted);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_resolve_short_putaway_tx(BIGINT,TEXT,TEXT,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_resolve_short_putaway_tx(BIGINT,TEXT,TEXT,UUID)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. ONE overload each, service_role only:
--   SELECT oid::regprocedure, proacl FROM pg_proc
--    WHERE proname IN ('wie_putaway_candidates','wie_complete_putaway_tx',
--                      'wie_complete_putaway_many_tx','wie_redirect_putaway_tx',
--                      'wie_resolve_short_putaway_tx');
--
--   -- b. Same candidate rows with and without an anchor (ranking only):
--   SELECT count(*) FROM public.wie_putaway_candidates(<layout>, <product>);
--   SELECT count(*) FROM public.wie_putaway_candidates(<layout>, <product>,
--          2000, NULL, false, NULL, <home bin id>);
--
-- Rollback: re-apply 00123's candidates function and 00080's 4-arg
--   wie_complete_putaway_tx after DROPping the 7-arg / 6-arg versions; drop the
--   three new functions; the columns and wider CHECK are harmless to leave.
-- =============================================================================
