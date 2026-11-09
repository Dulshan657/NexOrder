-- =============================================================================
-- Putaway goes to the home bin, or is refused while the home has room (NX-0032)
-- Migration: 00142_home_bin_enforced.sql
-- =============================================================================
-- NX-0006 made putaway SUGGEST a product's home bin first. Nothing stopped a
-- worker putting it somewhere else, and a wrong-bin putaway of a product with a
-- known home is hard to find again and breaks the picking and replenishment
-- that assume it is at home. This makes the rule a refusal, once, in SQL:
--
--   wie_home_block(rec, target) -> NULL (allowed) | the refusal text
--
-- decided in this order:
--   1. the target is this product's own primary home        -> allowed
--   2. the target is ANOTHER product's primary home          -> refused, also
--      for a product with no home and for a pallet:
--      '{code} is the home bin of {sku}; choose another bin.'
--   3. the product has no primary home in this warehouse     -> allowed
--   4. the task's plate is a single-product pallet           -> allowed (a unit
--      load never goes to a pick face; a mixed pallet's lines are not exempt)
--   5. the home is one putaway could not use: inactive, in a hold zone, or on a
--      level role outside the product's allowed_level_roles -> allowed
--   6. room at the home, in base units, rounded down:
--        by_cap = (capacity - v_bin_fill - v_bin_pending_putaway + own) / size_factor
--        by_max = max_qty - on hand at home - this product's OTHER open tasks to home
--      own = this task's own promise to the home (its quantity x size_factor)
--      when the task targets the home, so a task does not crowd itself out.
--      A blank capacity or max is unlimited (homeHeadroom's rule).
--      room > 0 -> refused:
--      'Put this in its home bin {code}; it still has room for {n}. If it is
--       full, ask a manager to set its maximum.'
--
-- There is no override. No role, reason or flag lifts it: every putaway
-- transaction below calls it before it moves or records anything and raises
-- 'CONFLICT: <text>', ahead of the "say why" reason backstop.
--
-- Rewired, bodies otherwise verbatim from their latest migration:
--   wie_complete_putaway_tx      (00137)
--   wie_decide_putaway_tx        (00137)
--   wie_complete_putaway_many_tx (00137)  -- checks every line first
--   wie_assign_putaway_tx        (00080)
--   wie_redirect_putaway_tx      (00135)
--   wie_putaway_candidates       (00135)  -- leaves out another product's
--                                            primary home unless this product
--                                            is homed there too
-- Every signature is unchanged, so CREATE OR REPLACE replaces in place and each
-- function keeps ONE overload (see Verify).
--
-- And one new READ, for the home-bin health check (panel and CLI):
--   wie_home_bin_facts(warehouse) -- per primary home, the facts that decide
--                                    whether putaway can use it at all; the
--                                    judging is _shared/wie/homeBinHealth.ts
--
-- Service-role only. Idempotent, the whole file: re-running it converges.
-- =============================================================================

BEGIN;

-- ── 1. The rule ──────────────────────────────────────────────────────────────
-- Not STABLE on purpose: the pooled completion calls it between writes of its
-- own, and it must read them.
CREATE OR REPLACE FUNCTION public.wie_home_block(
    p_rec_id         BIGINT,
    p_to_location_id INT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec        public.wie_putaway_recommendations%ROWTYPE;
    v_home       public.product_home_bins%ROWTYPE;
    v_home_loc   public.locations%ROWTYPE;
    v_other_sku  TEXT;
    v_to_code    TEXT;
    v_plate_type TEXT;
    v_is_hold    BOOLEAN;
    v_allowed    TEXT[];
    v_sf         NUMERIC;
    v_used       NUMERIC;
    v_pending    NUMERIC;
    v_own        NUMERIC;
    v_on_hand    NUMERIC;
    v_others     NUMERIC;
    v_by_cap     NUMERIC;   -- NULL = unlimited
    v_by_max     NUMERIC;   -- NULL = unlimited
    v_room       BIGINT;
BEGIN
    -- A missing task or bin is the caller's error to raise (NOT_FOUND /
    -- INVALID_INPUT); the rule has nothing to say about it.
    IF p_to_location_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_rec FROM public.wie_putaway_recommendations WHERE id = p_rec_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_home
    FROM public.product_home_bins
    WHERE product_id = v_rec.product_id
      AND warehouse_id = v_rec.warehouse_id
      AND purpose = 'primary';

    -- 1. Its own home.
    IF FOUND AND v_home.bin_id = p_to_location_id THEN
        RETURN NULL;
    END IF;

    -- 2. Another product's home. Two products may share one home, so a bin
    --    this product is also homed in is not "another product's". Lowest
    --    product id names it, so the text is stable.
    SELECT pr.sku INTO v_other_sku
    FROM public.product_home_bins h
    JOIN public.products pr ON pr.id = h.product_id
    WHERE h.bin_id = p_to_location_id
      AND h.purpose = 'primary'
      AND h.product_id <> v_rec.product_id
      AND NOT EXISTS (SELECT 1 FROM public.product_home_bins own
                       WHERE own.bin_id = p_to_location_id
                         AND own.purpose = 'primary'
                         AND own.product_id = v_rec.product_id)
    ORDER BY h.product_id
    LIMIT 1;
    IF FOUND THEN
        SELECT code INTO v_to_code FROM public.locations WHERE id = p_to_location_id;
        RETURN format('%s is the home bin of %s; choose another bin.', v_to_code, v_other_sku);
    END IF;

    -- 3. No home: not held to one.
    IF v_home.id IS NULL THEN
        RETURN NULL;
    END IF;

    -- 4. A single-product pallet is a unit load; it never goes to a pick face.
    IF v_rec.handling_unit_id IS NOT NULL THEN
        SELECT hu_type INTO v_plate_type
        FROM public.handling_units WHERE id = v_rec.handling_unit_id;
        IF v_plate_type = 'pallet' AND (
               SELECT count(DISTINCT b.product_id)
               FROM public.inventory_balances b
               WHERE b.handling_unit_id = v_rec.handling_unit_id
                 AND b.on_hand > 0) = 1 THEN
            RETURN NULL;
        END IF;
    END IF;

    -- 5. A home putaway could not use does not block. Same tests as
    --    wie_putaway_candidates: is_active, the nearest ZONE ancestor's
    --    is_hold, and a level role outside the product's allowed roles (a bin
    --    with no level role is legacy and allowed, as there).
    SELECT * INTO v_home_loc FROM public.locations WHERE id = v_home.bin_id;
    IF NOT FOUND OR NOT v_home_loc.is_active THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(zp.is_hold, false) INTO v_is_hold
    FROM public.locations z
    LEFT JOIN public.zone_profiles zp ON zp.id = z.zone_profile_id
    WHERE z.kind = 'ZONE'
      AND v_home_loc.materialized_path LIKE z.materialized_path || '/%'
    ORDER BY length(z.materialized_path) DESC
    LIMIT 1;
    IF COALESCE(v_is_hold, false) THEN
        RETURN NULL;
    END IF;

    SELECT allowed_level_roles INTO v_allowed
    FROM public.product_wms_attributes WHERE product_id = v_rec.product_id;
    IF COALESCE(cardinality(v_allowed), 0) > 0
       AND v_home_loc.level_role IS NOT NULL
       AND NOT (v_home_loc.level_role = ANY (v_allowed)) THEN
        RETURN NULL;
    END IF;

    -- 6. Room, in base units.
    SELECT size_factor INTO v_sf FROM public.products WHERE id = v_rec.product_id;
    IF v_sf IS NULL OR v_sf <= 0 THEN
        v_sf := 1;
    END IF;

    IF v_home_loc.capacity_slots IS NOT NULL THEN
        SELECT f.used_slots INTO v_used
        FROM public.v_bin_fill f WHERE f.location_id = v_home.bin_id;
        SELECT pp.pending_slots INTO v_pending
        FROM public.v_bin_pending_putaway pp WHERE pp.location_id = v_home.bin_id;
        -- This task's own promise to the home is in v_bin_pending_putaway;
        -- give it back so the task does not crowd itself out (A3).
        v_own := CASE
                    WHEN v_rec.status IN ('suggested', 'assigned')
                     AND COALESCE(v_rec.assigned_location_id, v_rec.recommended_location_id)
                         = v_home.bin_id
                    THEN v_rec.quantity * v_sf
                    ELSE 0
                 END;
        v_by_cap := (v_home_loc.capacity_slots - COALESCE(v_used, 0)
                     - COALESCE(v_pending, 0) + v_own) / v_sf;
    END IF;

    IF v_home.max_qty IS NOT NULL THEN
        SELECT COALESCE(SUM(b.on_hand), 0) INTO v_on_hand
        FROM public.inventory_balances b
        WHERE b.product_id = v_rec.product_id AND b.location_id = v_home.bin_id;
        SELECT COALESCE(SUM(r.quantity), 0) INTO v_others
        FROM public.wie_putaway_recommendations r
        WHERE r.product_id = v_rec.product_id
          AND r.id <> v_rec.id
          AND r.status IN ('suggested', 'assigned')
          AND COALESCE(r.assigned_location_id, r.recommended_location_id) = v_home.bin_id;
        v_by_max := v_home.max_qty - v_on_hand - v_others;
    END IF;

    IF v_by_cap IS NULL AND v_by_max IS NULL THEN
        -- Unlimited by both: the home takes the whole task. The copy needs a
        -- number, and this task's quantity is the true, actionable lower bound.
        v_room := GREATEST(floor(v_rec.quantity), 1)::BIGINT;
    ELSE
        -- LEAST ignores NULL, which is exactly "unlimited".
        v_room := floor(GREATEST(0, LEAST(v_by_cap, v_by_max)))::BIGINT;
    END IF;

    IF v_room <= 0 THEN
        RETURN NULL;
    END IF;
    RETURN format(
        'Put this in its home bin %s; it still has room for %s. If it is full, ask a manager to set its maximum.',
        v_home_loc.code, v_room);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_home_block(BIGINT,INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_home_block(BIGINT,INT)
    TO service_role;

-- ── 2. Complete (from 00137) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wie_complete_putaway_tx(
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
    v_msg         TEXT;
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

    -- 00142 (NX-0032): the home rule, before anything is recorded and ahead of
    -- the reason backstop. Nothing lifts it.
    v_msg := public.wie_home_block(p_rec_id, p_actual);
    IF v_msg IS NOT NULL THEN
        RAISE EXCEPTION 'CONFLICT: %', v_msg USING ERRCODE = 'P0001';
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
    -- inv_putaway_move (00137) takes the units OFF a plate that still carries
    -- other products, so a mixed pallet split across homes never leaves one
    -- plate in several bins; otherwise it is the plate-bound transfer it was.
    v_moved := public.inv_putaway_move(
        v_rec.product_id, v_rec.warehouse_id, p_actual, v_qty, p_actor,
        'putaway:' || v_status, v_rec.handling_unit_id, true);

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

-- ── 3. Place now / accept / override (from 00137) ────────────────────────────
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
    IF v_rec.status <> 'suggested' THEN
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
        -- The original row stays 'suggested' and holds the remainder, so the
        -- queue keeps showing what is still on the dock.
        UPDATE public.wie_putaway_recommendations
        SET quantity = v_remainder
        WHERE id = p_rec_id;

        INSERT INTO public.wie_putaway_recommendations
            (warehouse_id, layout_id, product_id, quantity, goods_receipt_id,
             recommended_location_id, alternatives, explanation, engine_version,
             status, chosen_location_id, actor_id, created_at, decided_at)
        VALUES
            (v_rec.warehouse_id, v_rec.layout_id, v_rec.product_id, v_qty,
             v_rec.goods_receipt_id, v_rec.recommended_location_id,
             v_rec.alternatives, v_rec.explanation, v_rec.engine_version,
             v_status, p_chosen, p_actor, v_rec.created_at, now())
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

-- ── 4. Pooled completion (from 00137) ───────────────────────────────────────
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
    v_msg        TEXT;
BEGIN
    IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
        RAISE EXCEPTION 'INVALID_INPUT: no tasks to complete' USING ERRCODE = 'P0001';
    END IF;

    -- 00142 (NX-0032): the home rule for every line that moves, before any
    -- line is recorded. (wie_complete_putaway_tx checks again per line; this
    -- pass is what keeps a refused pool from writing its shortages first.)
    -- Malformed lines are left to the loop below to reject.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
        IF (v_item->>'qty')::NUMERIC > 0 THEN
            v_msg := public.wie_home_block((v_item->>'id')::BIGINT, p_actual);
            IF v_msg IS NOT NULL THEN
                RAISE EXCEPTION 'CONFLICT: %', v_msg USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END LOOP;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
        v_id  := (v_item->>'id')::BIGINT;
        v_qty := (v_item->>'qty')::NUMERIC;
        -- 00137 backstop (complete-putaway's allocateAcrossTasks is the gate):
        -- a missing or negative quantity is a malformed call, never a skip.
        IF v_id IS NULL OR v_qty IS NULL OR v_qty < 0 THEN
            RAISE EXCEPTION 'INVALID_INPUT: every task needs an id and a quantity of 0 or more'
                USING ERRCODE = 'P0001';
        END IF;

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
        -- A plated task is one specific pallet; it is never pooled.
        IF jsonb_array_length(p_allocations) > 1 AND v_rec.handling_unit_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_INPUT: a pallet is put away on its own, not pooled with other tasks'
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
    -- set by someone else a moment ago wins. The home is the PRIMARY slot
    -- (mig 00082 keys homes by purpose); the arbiter must name all three
    -- columns of product_home_bins_slot_key or Postgres cannot infer it.
    IF p_make_home THEN
        INSERT INTO public.product_home_bins (product_id, warehouse_id, bin_id, purpose)
        VALUES (v_product, v_warehouse, p_actual, 'primary')
        ON CONFLICT (product_id, warehouse_id, purpose) DO NOTHING;
        v_home_set := FOUND;
    END IF;

    RETURN jsonb_build_object('results', v_results, 'home_set', v_home_set);
END;
$$;

-- ── 5. Assign (from 00080) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wie_assign_putaway_tx(
    p_rec_id   BIGINT,
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
    v_assigned_id BIGINT;
    v_msg         TEXT;
BEGIN
    IF p_chosen IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: a chosen location is required'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_rec
    FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: recommendation % not found', p_rec_id
            USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status <> 'suggested' THEN
        RAISE EXCEPTION 'CONFLICT: recommendation already %', v_rec.status
            USING ERRCODE = 'P0001';
    END IF;

    v_qty := COALESCE(p_qty, v_rec.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: assigned quantity must be positive'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_qty > v_rec.quantity THEN
        RAISE EXCEPTION 'INVALID_QTY: % exceeds the % left on this recommendation',
            v_qty, v_rec.quantity USING ERRCODE = 'P0001';
    END IF;

    -- 00142 (NX-0032): the desk cannot send it off-home while the home has
    -- room either.
    v_msg := public.wie_home_block(p_rec_id, p_chosen);
    IF v_msg IS NOT NULL THEN
        RAISE EXCEPTION 'CONFLICT: %', v_msg USING ERRCODE = 'P0001';
    END IF;

    v_remainder := v_rec.quantity - v_qty;

    IF v_remainder = 0 THEN
        UPDATE public.wie_putaway_recommendations
        SET status               = 'assigned',
            assigned_location_id = p_chosen,
            assigned_at          = now(),
            assigned_by          = p_actor
        WHERE id = p_rec_id;
        v_assigned_id := p_rec_id;
    ELSE
        UPDATE public.wie_putaway_recommendations
        SET quantity = v_remainder
        WHERE id = p_rec_id;

        INSERT INTO public.wie_putaway_recommendations
            (warehouse_id, layout_id, product_id, quantity, goods_receipt_id,
             recommended_location_id, alternatives, explanation, engine_version,
             status, assigned_location_id, assigned_at, assigned_by,
             handling_unit_id, created_at)
        VALUES
            (v_rec.warehouse_id, v_rec.layout_id, v_rec.product_id, v_qty,
             v_rec.goods_receipt_id, v_rec.recommended_location_id,
             v_rec.alternatives, v_rec.explanation, v_rec.engine_version,
             'assigned', p_chosen, now(), p_actor,
             v_rec.handling_unit_id, v_rec.created_at)
        RETURNING id INTO v_assigned_id;
    END IF;

    RETURN jsonb_build_object(
        'assigned_id',   v_assigned_id,
        'remainder_id',  CASE WHEN v_remainder > 0 THEN p_rec_id ELSE NULL END,
        'remainder_qty', v_remainder);
END;
$$;

-- ── 6. Desk redirect (from 00135) ───────────────────────────────────────────
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
    v_msg TEXT;
BEGIN
    SELECT * INTO v_rec FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', p_rec_id USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status <> 'suggested' THEN
        RAISE EXCEPTION 'CONFLICT: putaway task already %', v_rec.status USING ERRCODE = 'P0001';
    END IF;

    -- 00142 (NX-0032): a redirect off-home while the home has room is refused.
    v_msg := public.wie_home_block(p_rec_id, p_location);
    IF v_msg IS NOT NULL THEN
        RAISE EXCEPTION 'CONFLICT: %', v_msg USING ERRCODE = 'P0001';
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

-- ── 7. Candidates: another product's home is not one (from 00135) ──────────
CREATE OR REPLACE FUNCTION public.wie_putaway_candidates(
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
      -- 00142 (NX-0032): another product's primary home is not a candidate,
      -- unless this product is homed there too (two products may share one).
      AND (NOT EXISTS (SELECT 1 FROM public.product_home_bins oh
                        WHERE oh.bin_id = l.id
                          AND oh.purpose = 'primary'
                          AND oh.product_id <> p_product_id)
           OR EXISTS (SELECT 1 FROM public.product_home_bins mh
                       WHERE mh.bin_id = l.id
                         AND mh.purpose = 'primary'
                         AND mh.product_id = p_product_id))
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


-- ── 8. Home-bin health facts ─────────────────────────────────────────────────
-- One row per PRIMARY home in a warehouse, with every fact the health check
-- (_shared/wie/homeBinHealth.ts) needs to say whether putaway can use it. It
-- reports facts and judges nothing: the judging is TypeScript, so the room is
-- homeHeadroom's (the same maths as planHomeFirst) and not a second copy here
-- that could drift from wie_home_block. Each flag mirrors a test putaway makes:
--   is_active, is_hold, level_role / allowed_level_roles   wie_putaway_candidates
--   is_pick_zone, level_hu_types   the level_roles row (an INACTIVE role claims
--                                  nothing, as sortedRoles drops it)
--   in_active_layout   the bin has a placement on the warehouse's active layout
--   has_dock_route     scoring.ts rejects a bin with no distance from a dock;
--                      that distance is the one wie_putaway_candidates joins
--   zone_allowed_categories   the nearest ZONE ancestor's profile
--   bin_warehouse_id   the nearest WAREHOUSE ancestor of the bin
-- Room: used_slots is stock in the bin, pending_slots is space promised to open
-- tasks (v_bin_pending_putaway), pending_qty is base units of THIS product that
-- open tasks already send here (wie_home_block's "other tasks to home"; there is
-- no task of its own to give back here).
CREATE OR REPLACE FUNCTION public.wie_home_bin_facts(p_warehouse_id INT)
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
    pending_qty              NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        h.product_id,
        pr.sku::TEXT,
        h.bin_id,
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
                   AND pl.location_id = h.bin_id),
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
                   AND pl.location_id = h.bin_id),
        zp.allowed_categories,
        pr.category::TEXT,
        b.capacity_slots,
        COALESCE(bf.used_slots, 0),
        COALESCE(pend.pending_slots, 0),
        pr.size_factor,
        h.max_qty,
        COALESCE((SELECT SUM(ib.on_hand)
                    FROM public.inventory_balances ib
                   WHERE ib.product_id = h.product_id
                     AND ib.location_id = h.bin_id), 0),
        COALESCE((SELECT SUM(r.quantity)
                    FROM public.wie_putaway_recommendations r
                   WHERE r.product_id = h.product_id
                     AND r.status IN ('suggested', 'assigned')
                     AND COALESCE(r.assigned_location_id, r.recommended_location_id)
                         = h.bin_id), 0)
    FROM public.product_home_bins h
    JOIN public.products pr ON pr.id = h.product_id
    JOIN public.locations b ON b.id = h.bin_id
    LEFT JOIN public.locations w ON w.id = h.warehouse_id
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
    LEFT JOIN public.product_wms_attributes wa ON wa.product_id = h.product_id
    LEFT JOIN public.v_bin_fill bf ON bf.location_id = h.bin_id
    LEFT JOIN public.v_bin_pending_putaway pend ON pend.location_id = h.bin_id
    WHERE h.warehouse_id = p_warehouse_id
      AND h.purpose = 'primary'
    ORDER BY pr.sku, h.product_id;
$$;

-- ── 9. Grants: service_role only, restated so a re-run converges ─────────────
REVOKE ALL ON FUNCTION public.wie_home_bin_facts(INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_home_bin_facts(INT)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_complete_putaway_tx(BIGINT,INT,NUMERIC,UUID,TEXT,BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_complete_putaway_tx(BIGINT,INT,NUMERIC,UUID,TEXT,BOOLEAN)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_decide_putaway_tx(BIGINT,TEXT,INT,NUMERIC,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_decide_putaway_tx(BIGINT,TEXT,INT,NUMERIC,UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_complete_putaway_many_tx(JSONB,INT,UUID,TEXT,BOOLEAN,BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_complete_putaway_many_tx(JSONB,INT,UUID,TEXT,BOOLEAN,BOOLEAN)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_assign_putaway_tx(BIGINT,INT,NUMERIC,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_assign_putaway_tx(BIGINT,INT,NUMERIC,UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_redirect_putaway_tx(BIGINT,INT,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_redirect_putaway_tx(BIGINT,INT,UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[],BOOLEAN,INT[],INT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_putaway_candidates(INT,INT,INT,TEXT[],BOOLEAN,INT[],INT)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. ONE overload each, the same signatures as before, service_role only:
--   SELECT p.oid::regprocedure, p.prosecdef, p.proacl FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('wie_home_block','wie_complete_putaway_tx',
--                        'wie_complete_putaway_many_tx','wie_decide_putaway_tx',
--                        'wie_assign_putaway_tx','wie_redirect_putaway_tx',
--                        'wie_putaway_candidates','wie_home_bin_facts')
--    ORDER BY 1::text;                                   -- EIGHT rows
--
--   -- b. Open tasks that would now be refused where they are pointed (each
--   --    is still completable INTO its home):
--   SELECT r.id, r.product_id,
--          public.wie_home_block(r.id, COALESCE(r.assigned_location_id,
--                                               r.recommended_location_id)) AS block
--     FROM public.wie_putaway_recommendations r
--    WHERE r.status IN ('suggested','assigned')
--      AND public.wie_home_block(r.id, COALESCE(r.assigned_location_id,
--                                               r.recommended_location_id)) IS NOT NULL;
--
--   -- c. No bin is offered to a product while it is another's primary home:
--   SELECT count(*) FROM public.wie_putaway_candidates(<layout>, <product>) c
--     JOIN public.product_home_bins h ON h.bin_id = c.location_id
--    WHERE h.purpose = 'primary' AND h.product_id <> <product>
--      AND NOT EXISTS (SELECT 1 FROM public.product_home_bins m
--                       WHERE m.bin_id = c.location_id AND m.purpose = 'primary'
--                         AND m.product_id = <product>);       -- expect 0
--
--   -- d. The health check's facts, for a warehouse (one row per primary home):
--   SELECT * FROM public.wie_home_bin_facts(<warehouse>);
--
-- Rollback: re-apply 00137 sections 3-4, 00080 section 3 and 00135 sections
--   2 and 5 (the bodies here are theirs plus the wie_home_block call), then
--   DROP FUNCTION public.wie_home_block(BIGINT,INT) and
--   DROP FUNCTION public.wie_home_bin_facts(INT).
-- =============================================================================
