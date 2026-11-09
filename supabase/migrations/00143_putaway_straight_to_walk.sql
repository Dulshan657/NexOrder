-- =============================================================================
-- Putaway lines go straight onto the Walk (NX-0033)
-- Migration: 00143_putaway_straight_to_walk.sql
-- =============================================================================
-- Until now every received line waited in the Assign queue for a person to
-- send it to the floor, even when there was nothing to decide: the home had
-- room, or the product had no home. _shared/putawayTasks.ts now writes those
-- lines already 'assigned' to the engine's bin, with assigned_by NULL meaning
-- "the system did it". Only a loose overflow line (the home is full) still
-- waits, and either the desk or the walker may confirm it, first one wins.
-- This migration is the SQL half of that:
--
--   wie_confirm_overflow_tx(rec, location, actor)        NEW
--       The walk's confirmation of an overflow line. A compare-and-set on the
--       bin the worker scanned, under the same FOR UPDATE row lock the desk's
--       wie_assign_putaway_tx takes, so only one of them wins. In order:
--         lock the row (NOT_FOUND if none)
--         status <> 'suggested'      'CONFLICT: This line was already dealt
--                                     with (it is now <status>).'
--         not overflow, or no bin    'CONFLICT: This line no longer waits for
--                                     an overflow confirmation.'
--         scanned bin <> suggested   'CONFLICT: The suggested bin for this
--                                     line is now <code>; scan that one.'
--                                     (a desk redirect made after the walk
--                                     loaded cannot be confirmed by a stale
--                                     scan)
--         wie_home_block (00142)     'CONFLICT: <text>' (the home got room
--                                     again since the line was made)
--       then assigns the whole line to that bin, assigned_by the worker. No
--       split, no stock move.
--
--   wie_home_bin_candidate_facts(warehouse, product, bin)  NEW, read only
--       Every BIN in the warehouse (active or not) read as if it were the
--       product's home, in wie_home_bin_facts' columns (max_qty NULL), plus
--       bin_name and other_home_skus (other products whose primary home it
--       is). Feeds "Give it a home" (home-bin-choices, and complete-putaway's
--       fitness check); the judging stays in _shared/wie/homeBinHealth.ts.
--
--   wie_decide_putaway_tx (from 00142 §3)                 REDEFINED
--       Place now / accept / override also act on a line the system assigned
--       and nobody has touched since (status 'assigned', assigned_by NULL), so
--       the receive card and the opening-stock import keep working on lines
--       that now skip the queue. A line a person assigned still cannot be
--       placed this way ('recommendation already assigned'). A partial leaves
--       the original row's status as it was: an auto-assigned remainder stays
--       on the walk. Body otherwise verbatim, the home rule included.
--
--   wie_putaway_stops (from 00080)                        REDEFINED
--       The walk lists 'assigned' lines and overflow lines awaiting
--       confirmation (status 'suggested', suggestion_source 'overflow', a
--       suggested bin), each at COALESCE(assigned, suggested) bin. Same
--       columns. Pre-existing overflow lines show up as confirm stops too
--       (ruling R2); no other row changes lists.
--
-- Every signature of a redefined function is unchanged, so CREATE OR REPLACE
-- replaces in place and each keeps ONE overload (see Verify). Service-role
-- only. Idempotent, the whole file: re-running it converges.
-- =============================================================================

BEGIN;

-- ── 1. The walk confirms an overflow line ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wie_confirm_overflow_tx(
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
    v_rec  public.wie_putaway_recommendations%ROWTYPE;
    v_code TEXT;
    v_msg  TEXT;
BEGIN
    -- A NULL bin would slip past the compare below (NULL <> x is NULL).
    IF p_location IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: a chosen location is required'
            USING ERRCODE = 'P0001';
    END IF;

    -- The same row lock wie_assign_putaway_tx takes: desk and walk serialise.
    SELECT * INTO v_rec
    FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', p_rec_id
            USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status <> 'suggested' THEN
        RAISE EXCEPTION 'CONFLICT: This line was already dealt with (it is now %).', v_rec.status
            USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.suggestion_source IS DISTINCT FROM 'overflow'
       OR v_rec.recommended_location_id IS NULL THEN
        RAISE EXCEPTION 'CONFLICT: This line no longer waits for an overflow confirmation.'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_location <> v_rec.recommended_location_id THEN
        SELECT code INTO v_code FROM public.locations WHERE id = v_rec.recommended_location_id;
        RAISE EXCEPTION 'CONFLICT: The suggested bin for this line is now %; scan that one.', v_code
            USING ERRCODE = 'P0001';
    END IF;

    -- 00142 (NX-0032): the home may have room again since the line was made.
    v_msg := public.wie_home_block(p_rec_id, p_location);
    IF v_msg IS NOT NULL THEN
        RAISE EXCEPTION 'CONFLICT: %', v_msg USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.wie_putaway_recommendations
    SET status               = 'assigned',
        assigned_location_id = p_location,
        assigned_at          = now(),
        assigned_by          = p_actor
    WHERE id = p_rec_id;

    RETURN jsonb_build_object('assigned_id', p_rec_id, 'location_id', p_location);
END;
$$;

-- ── 2. Every bin read as the product's home (from 00142 §8) ──────────────────
-- wie_home_bin_facts' body with `product_home_bins h` replaced by the product x
-- the warehouse's bins. Each row reads the bin as if it were the product's
-- home: max_qty NULL (no home row, so no maximum), on_hand_at_home and
-- pending_qty for that product and bin. other_home_skus names the OTHER
-- products whose primary home the bin is, lowest product id first, like
-- wie_home_block step 2 (and, like it, whatever warehouse the home row is
-- filed under). The parity test in putawayStraightToWalk.integration.test.ts
-- pins the shared columns to wie_home_bin_facts.
CREATE OR REPLACE FUNCTION public.wie_home_bin_candidate_facts(
    p_warehouse_id INT,
    p_product_id   INT,
    p_bin_id       INT DEFAULT NULL
)
RETURNS TABLE(
    product_id               INT,
    sku                      TEXT,
    bin_id                   INT,
    bin_code                 TEXT,
    bin_warehouse_id         INT,
    is_active                BOOLEAN,
    is_hold                  BOOLEAN,
    level_role               TEXT,
    is_pick_zone             BOOLEAN,
    level_hu_types           TEXT[],
    allowed_level_roles      TEXT[],
    in_active_layout         BOOLEAN,
    has_dock_route           BOOLEAN,
    zone_allowed_categories  JSONB,
    category                 TEXT,
    capacity_slots           NUMERIC,
    used_slots               NUMERIC,
    pending_slots            NUMERIC,
    size_factor              NUMERIC,
    max_qty                  NUMERIC,
    on_hand_at_home          NUMERIC,
    pending_qty              NUMERIC,
    bin_name                 TEXT,
    other_home_skus          TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pr.id,
        pr.sku::TEXT,
        b.id,
        b.code::TEXT,
        bw.id,
        b.is_active,
        COALESCE(zp.is_hold, false),
        b.level_role::TEXT,
        COALESCE(lr.is_active AND lr.is_pick_zone, false),
        CASE WHEN lr.is_active THEN lr.hu_types ELSE ARRAY[]::TEXT[] END,
        COALESCE(wa.allowed_level_roles, ARRAY[]::TEXT[]),
        EXISTS (SELECT 1
                  FROM public.layout_placements pl
                 WHERE pl.layout_id = w.active_layout_id
                   AND pl.location_id = b.id),
        EXISTS (SELECT 1
                  FROM public.layout_placements pl
                  JOIN public.layout_travel_distances d
                    ON d.layout_id = pl.layout_id
                   AND d.to_node_id = pl.graph_node_id
                  JOIN public.layout_graph_nodes dn
                    ON dn.id = d.from_node_id
                   AND dn.layout_id = pl.layout_id
                   AND dn.node_type = 'dock'
                 WHERE pl.layout_id = w.active_layout_id
                   AND pl.location_id = b.id),
        zp.allowed_categories,
        pr.category::TEXT,
        b.capacity_slots,
        COALESCE(bf.used_slots, 0),
        COALESCE(pend.pending_slots, 0),
        pr.size_factor,
        NULL::NUMERIC,
        COALESCE((SELECT SUM(ib.on_hand)
                    FROM public.inventory_balances ib
                   WHERE ib.product_id = pr.id
                     AND ib.location_id = b.id), 0),
        COALESCE((SELECT SUM(r.quantity)
                    FROM public.wie_putaway_recommendations r
                   WHERE r.product_id = pr.id
                     AND r.status IN ('suggested', 'assigned')
                     AND COALESCE(r.assigned_location_id, r.recommended_location_id)
                         = b.id), 0),
        b.name::TEXT,
        ARRAY(SELECT op.sku::TEXT
                FROM public.product_home_bins oh
                JOIN public.products op ON op.id = oh.product_id
               WHERE oh.bin_id = b.id
                 AND oh.purpose = 'primary'
                 AND oh.product_id <> pr.id
               ORDER BY oh.product_id)
    FROM public.locations w
    JOIN public.products pr ON pr.id = p_product_id
    JOIN public.locations b
      ON b.kind = 'BIN'
     AND b.materialized_path LIKE w.materialized_path || '/%'
    LEFT JOIN LATERAL (
        SELECT wh.id FROM public.locations wh
         WHERE wh.kind = 'WAREHOUSE'
           AND b.materialized_path LIKE wh.materialized_path || '/%'
         ORDER BY length(wh.materialized_path) DESC
         LIMIT 1
    ) bw ON true
    LEFT JOIN LATERAL (
        SELECT z.zone_profile_id FROM public.locations z
         WHERE z.kind = 'ZONE'
           AND b.materialized_path LIKE z.materialized_path || '/%'
         ORDER BY length(z.materialized_path) DESC
         LIMIT 1
    ) zone ON true
    LEFT JOIN public.zone_profiles zp ON zp.id = zone.zone_profile_id
    LEFT JOIN public.level_roles lr ON lr.key = b.level_role
    LEFT JOIN public.product_wms_attributes wa ON wa.product_id = pr.id
    LEFT JOIN public.v_bin_fill bf ON bf.location_id = b.id
    LEFT JOIN public.v_bin_pending_putaway pend ON pend.location_id = b.id
    WHERE w.id = p_warehouse_id
      AND w.materialized_path IS NOT NULL
      AND (p_bin_id IS NULL OR b.id = p_bin_id)
    ORDER BY b.code, b.id;
$$;

-- ── 3. Place now / accept / override (from 00142 §3) ────────────────────────
CREATE OR REPLACE FUNCTION public.wie_decide_putaway_tx(
    p_rec_id   BIGINT,
    p_decision TEXT,
    p_chosen   INT,
    p_qty      NUMERIC DEFAULT NULL,   -- NULL = the whole remaining quantity
    p_actor    UUID    DEFAULT NULL
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
    v_decided_id  BIGINT;
    v_moved       JSONB;
    v_msg         TEXT;
BEGIN
    IF p_decision NOT IN ('accept', 'override') THEN
        RAISE EXCEPTION 'INVALID_DECISION: decision must be accept or override'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_chosen IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: a chosen location is required'
            USING ERRCODE = 'P0001';
    END IF;

    -- Row lock: serialises concurrent decisions on the same recommendation.
    SELECT * INTO v_rec
    FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: recommendation % not found', p_rec_id
            USING ERRCODE = 'P0001';
    END IF;
    -- 00143 (NX-0033): a line the system assigned (assigned_by NULL) and
    -- nobody has touched since is still placeable here; one a person
    -- assigned is not.
    IF NOT (v_rec.status = 'suggested'
            OR (v_rec.status = 'assigned' AND v_rec.assigned_by IS NULL)) THEN
        RAISE EXCEPTION 'CONFLICT: recommendation already %', v_rec.status
            USING ERRCODE = 'P0001';
    END IF;

    v_qty := COALESCE(p_qty, v_rec.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: putaway quantity must be positive'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_qty > v_rec.quantity THEN
        RAISE EXCEPTION 'INVALID_QTY: % exceeds the % left on this recommendation',
            v_qty, v_rec.quantity USING ERRCODE = 'P0001';
    END IF;

    -- 00142 (NX-0032): the home rule, before anything is recorded. An
    -- 'override' decision does not lift it.
    v_msg := public.wie_home_block(p_rec_id, p_chosen);
    IF v_msg IS NOT NULL THEN
        RAISE EXCEPTION 'CONFLICT: %', v_msg USING ERRCODE = 'P0001';
    END IF;

    v_status    := CASE WHEN p_decision = 'accept' THEN 'accepted' ELSE 'overridden' END;
    v_remainder := v_rec.quantity - v_qty;

    IF v_remainder = 0 THEN
        UPDATE public.wie_putaway_recommendations
        SET status             = v_status,
            chosen_location_id = p_chosen,
            decided_at         = now(),
            actor_id           = p_actor
        WHERE id = p_rec_id;
        v_decided_id := p_rec_id;
    ELSE
        -- The original row keeps its status ('suggested', or 00143's
        -- system-'assigned') and holds the remainder, so the queue or the
        -- walk keeps showing what is still on the dock.
        UPDATE public.wie_putaway_recommendations
        SET quantity = v_remainder
        WHERE id = p_rec_id;

        INSERT INTO public.wie_putaway_recommendations
            (warehouse_id, layout_id, product_id, quantity, goods_receipt_id,
             recommended_location_id, alternatives, explanation, engine_version,
             status, chosen_location_id, actor_id, created_at, decided_at,
             unit_load)
        VALUES
            (v_rec.warehouse_id, v_rec.layout_id, v_rec.product_id, v_qty,
             v_rec.goods_receipt_id, v_rec.recommended_location_id,
             v_rec.alternatives, v_rec.explanation, v_rec.engine_version,
             v_status, p_chosen, p_actor, v_rec.created_at, now(),
             v_rec.unit_load)
        RETURNING id INTO v_decided_id;
    END IF;

    -- Same transaction: a failed move rolls the claim/split back with it.
    -- 00137: through inv_putaway_move, so "Place now" on a line of a mixed
    -- pallet takes its units off the plate too. A plate that carries only this
    -- product keeps the pre-00137 behaviour exactly: plate-agnostic (FALSE).
    v_moved := public.inv_putaway_move(
        v_rec.product_id, v_rec.warehouse_id, p_chosen, v_qty, p_actor,
        'putaway:' || p_decision, v_rec.handling_unit_id, false);

    RETURN jsonb_build_object(
        'decided_id',    v_decided_id,
        'remainder_id',  CASE WHEN v_remainder > 0 THEN p_rec_id ELSE NULL END,
        'remainder_qty', v_remainder,
        'moved',         v_moved);
END;
$$;

-- ── 4. The walk, as routable stops (from 00080 §6) ──────────────────────────
-- Same columns. A line is a stop at the bin it is assigned to, or, for an
-- overflow line awaiting confirmation, at its suggested bin.
CREATE OR REPLACE FUNCTION public.wie_putaway_stops(p_warehouse_id INT)
RETURNS TABLE(
    rec_id          BIGINT,
    product_id      INT,
    location_id     INT,
    code            TEXT,
    graph_node_id   INT,
    access_offset_m NUMERIC,
    qty_base        NUMERIC,
    hu_code         TEXT,
    hu_type         TEXT,
    sku             TEXT,
    product_name    TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        r.id,
        r.product_id,
        COALESCE(r.assigned_location_id, r.recommended_location_id),
        l.code,
        pl.graph_node_id,
        COALESCE(pl.access_offset_m, 0),
        r.quantity,
        hu.code,
        hu.hu_type,
        p.sku,
        p.name
    FROM public.wie_putaway_recommendations r
    JOIN public.locations l
        ON l.id = COALESCE(r.assigned_location_id, r.recommended_location_id)
    JOIN public.locations wh ON wh.id = r.warehouse_id
    LEFT JOIN public.layout_placements pl
        ON pl.location_id = COALESCE(r.assigned_location_id, r.recommended_location_id)
       AND pl.layout_id = wh.active_layout_id
    LEFT JOIN public.handling_units hu ON hu.id = r.handling_unit_id
    LEFT JOIN public.products p ON p.id = r.product_id
    WHERE r.warehouse_id = p_warehouse_id
      AND (r.status = 'assigned'
           OR (r.status = 'suggested'
               AND r.suggestion_source = 'overflow'
               AND r.recommended_location_id IS NOT NULL))
    ORDER BY r.created_at, r.id
$$;

-- ── 5. Grants: service_role only, restated so a re-run converges ─────────────
REVOKE ALL ON FUNCTION public.wie_confirm_overflow_tx(BIGINT,INT,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_confirm_overflow_tx(BIGINT,INT,UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_home_bin_candidate_facts(INT,INT,INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_home_bin_candidate_facts(INT,INT,INT)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_decide_putaway_tx(BIGINT,TEXT,INT,NUMERIC,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_decide_putaway_tx(BIGINT,TEXT,INT,NUMERIC,UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_putaway_stops(INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_stops(INT)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. ONE overload each, service_role only:
--   SELECT p.oid::regprocedure, p.prosecdef, p.proacl FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('wie_confirm_overflow_tx','wie_home_bin_candidate_facts',
--                        'wie_decide_putaway_tx','wie_putaway_stops')
--    ORDER BY 1::text;                                   -- FOUR rows
--
--   -- b. The walk of a warehouse, confirm stops included:
--   SELECT * FROM public.wie_putaway_stops(<warehouse>);
--
--   -- c. Every bin of a warehouse read as a product's home:
--   SELECT * FROM public.wie_home_bin_candidate_facts(<warehouse>, <product>);
--
-- Rollback: re-apply 00142 section 3 (wie_decide_putaway_tx) and 00080
--   section 6 (wie_putaway_stops), then
--   DROP FUNCTION public.wie_confirm_overflow_tx(BIGINT,INT,UUID) and
--   DROP FUNCTION public.wie_home_bin_candidate_facts(INT,INT,INT).
--   Lines the new putawayTasks.ts wrote 'assigned' stay on the walk under the
--   old wie_putaway_stops; overflow lines awaiting confirmation go back to
--   the Assign queue only.
-- =============================================================================
