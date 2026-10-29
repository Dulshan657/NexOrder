-- =============================================================================
-- Putaway — a mixed pallet split across homes is taken OFF its plate (NX-0006)
-- Migration: 00137_putaway_off_plate.sql
-- =============================================================================
-- NX-0006 plans each product of a MIXED pallet to its own home bin. Every task
-- still names the plate, and inv_transfer_stock copies the plate id onto both
-- legs (00080 section 2) -- so completing them as written leaves ONE plate with
-- stock in several bins: the exact defect 00126 describes ("a plate that lies
-- about where it is"). hu_recompute declines to pick a location and v_bin_fill
-- charges a pallet position in every pallet bay the goods reach. Found by the
-- NX-0006 gate before this merged.
--
-- The floor does what the owner described: scan the plate, then each product,
-- and carry those cartons to that product's home. Physically the cartons LEAVE
-- the pallet. So does the ledger now:
--
--   inv_transfer_off_plate  -- the plate's units at the source, FEFO and
--                              available-only like inv_transfer_stock, landing
--                              LOOSE (handling_unit_id NULL) at the destination.
--   inv_putaway_move        -- the one rule both putaway moves use:
--       this move takes EVERYTHING still on the plate -> the plate moves with it
--                                                        (the ordinary transfer,
--                                                        plate-bound or not, as
--                                                        the caller always was);
--       anything would be left on the plate           -> the units come OFF it.
--     One rule covers the mixed pallet, a single line split between its home
--     and an overflow bin (every receipt line is plated since NX-0005), and a
--     short or partial count. The plate drains where it stands, and the move
--     that empties it carries it: a plate is only ever in one place.
--
-- Rewired through it, bodies otherwise verbatim:
--   wie_complete_putaway_tx (from 00135), wie_decide_putaway_tx (from 00071).
-- Also:
--   wie_complete_putaway_many_tx (from 00136) -- server backstop: a missing or
--     negative qty is refused, and a plated task is never pooled.
--   v_bin_pending_putaway (from 00123) -- a task that will come off its plate
--     is promised as LOOSE quantity, the way the planner sized it, not as a
--     whole pallet position.
--
-- Service-role only. Idempotent.
-- =============================================================================

BEGIN;

-- ── 1. Off the plate ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inv_transfer_off_plate(
    p_product_id       INT,
    p_from_loc         INT,
    p_to_loc           INT,
    p_qty              NUMERIC,
    p_actor            UUID,
    p_reason           TEXT,
    p_handling_unit_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_remaining NUMERIC := p_qty;
    v_take      NUMERIC;
    v_row       RECORD;
BEGIN
    IF p_handling_unit_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_TRANSFER: no plate to take the units off' USING ERRCODE = 'P0001';
    END IF;
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: transfer quantity must be positive' USING ERRCODE = 'P0001';
    END IF;
    IF p_from_loc = p_to_loc THEN
        RAISE EXCEPTION 'INVALID_TRANSFER: source and destination are the same' USING ERRCODE = 'P0001';
    END IF;

    -- Same ORDER BY and the same available-only rule as inv_transfer_stock, so
    -- FEFO means one thing in this codebase and reserved units never move.
    FOR v_row IN
        SELECT b.id, b.batch_id, b.available
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = p_product_id
          AND b.location_id = p_from_loc
          AND b.handling_unit_id = p_handling_unit_id
          AND b.available > 0
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.available);
        CONTINUE WHEN v_take <= 0;
        PERFORM public.inv_apply_leg(
            p_product_id, p_from_loc, v_row.batch_id, -v_take, 0,
            'transfer_out', p_actor, 'transfer', NULL, p_reason,
            NULL, p_handling_unit_id);
        -- Lands loose: these cartons are no longer on that pallet.
        PERFORM public.inv_apply_leg(
            p_product_id, p_to_loc, v_row.batch_id, v_take, 0,
            'transfer_in', p_actor, 'transfer', NULL, p_reason,
            NULL, NULL);
        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION
            'INSUFFICIENT_STOCK: plate % is short by % of product % at the source',
            p_handling_unit_id, v_remaining, p_product_id USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object('product_id', p_product_id, 'qty', p_qty,
                              'from_location_id', p_from_loc, 'to_location_id', p_to_loc,
                              'off_plate', p_handling_unit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.inv_transfer_off_plate(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_transfer_off_plate(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT)
    TO service_role;

-- ── 2. The one rule ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inv_putaway_move(
    p_product_id  INT,
    p_from_loc    INT,
    p_to_loc      INT,
    p_qty         NUMERIC,
    p_actor       UUID,
    p_reason      TEXT,
    p_plate       BIGINT,
    p_plate_bound BOOLEAN   -- otherwise: draw from any plate, as Place now always has
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_on_plate NUMERIC;
BEGIN
    -- Everything on the plate, every product, every location.
    SELECT COALESCE(SUM(b.on_hand), 0) INTO v_on_plate
    FROM public.inventory_balances b
    WHERE b.handling_unit_id = p_plate AND b.on_hand > 0;

    IF p_plate IS NOT NULL AND v_on_plate > p_qty THEN
        RETURN public.inv_transfer_off_plate(
            p_product_id, p_from_loc, p_to_loc, p_qty, p_actor, p_reason, p_plate);
    END IF;
    RETURN public.inv_transfer_stock(
        p_product_id, p_from_loc, p_to_loc, p_qty, p_actor, p_reason,
        CASE WHEN p_plate_bound THEN p_plate END);
END;
$$;

REVOKE ALL ON FUNCTION public.inv_putaway_move(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT,BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_putaway_move(INT,INT,INT,NUMERIC,UUID,TEXT,BIGINT,BOOLEAN)
    TO service_role;

-- ── 3. Both putaway moves use it ─────────────────────────────────────────────
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


-- ── 4. Pooled completion backstop ────────────────────────────────────────────
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


-- ── 5. Pending space: a task that will come off its plate is loose quantity ──
-- Same columns as 00123, so CREATE OR REPLACE keeps wie_putaway_candidates'
-- dependency intact. Only the arm conditions change.
CREATE OR REPLACE VIEW public.v_bin_pending_putaway
WITH (security_invoker = true) AS
    WITH open_tasks AS (
        SELECT r.*,
               COALESCE(r.assigned_location_id, r.recommended_location_id) AS dest,
               -- The plate holds more than this task: its units will come off
               -- the plate (inv_putaway_move's rule), so they are loose.
               (r.handling_unit_id IS NOT NULL AND r.quantity < (
                    SELECT COALESCE(SUM(b.on_hand), 0) FROM public.inventory_balances b
                    WHERE b.handling_unit_id = r.handling_unit_id
                      AND b.on_hand > 0)) AS off_plate
        FROM public.wie_putaway_recommendations r
        WHERE r.status IN ('suggested', 'assigned')
    )
    SELECT location_id,
           SUM(slots)  AS pending_slots,
           SUM(weight) AS pending_weight_kg
    FROM (
        SELECT t.dest                                                    AS location_id,
               COUNT(DISTINCT t.handling_unit_id)::NUMERIC              AS slots,
               COALESCE(SUM(t.quantity * COALESCE(pw.weight_kg, 0)), 0) AS weight
        FROM open_tasks t
        JOIN public.handling_units h ON h.id = t.handling_unit_id
        JOIN public.locations l      ON l.id = t.dest
        LEFT JOIN public.product_wms_attributes pw ON pw.product_id = t.product_id
        WHERE l.slot_kind = 'pallet' AND NOT t.off_plate
        GROUP BY 1

        UNION ALL

        SELECT t.dest                                                    AS location_id,
               SUM(t.quantity * COALESCE(pr.size_factor, 1))            AS slots,
               COALESCE(SUM(t.quantity * COALESCE(pw.weight_kg, 0)), 0) AS weight
        FROM open_tasks t
        JOIN public.products  pr ON pr.id = t.product_id
        JOIN public.locations l  ON l.id = t.dest
        LEFT JOIN public.handling_units h ON h.id = t.handling_unit_id
        LEFT JOIN public.product_wms_attributes pw ON pw.product_id = t.product_id
        WHERE NOT (h.id IS NOT NULL AND COALESCE(l.slot_kind, '') = 'pallet' AND NOT t.off_plate)
        GROUP BY 1
    ) x
    GROUP BY location_id;

GRANT SELECT ON public.v_bin_pending_putaway TO authenticated;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT oid::regprocedure FROM pg_proc WHERE proname IN
--     ('inv_transfer_off_plate','inv_putaway_move','wie_complete_putaway_tx',
--      'wie_decide_putaway_tx','wie_complete_putaway_many_tx');   -- ONE row each
--   -- No plate may hold stock in two places after a putaway:
--   SELECT handling_unit_id, count(DISTINCT location_id) FROM inventory_balances
--    WHERE handling_unit_id IS NOT NULL AND on_hand > 0
--    GROUP BY 1 HAVING count(DISTINCT location_id) > 1;
-- =============================================================================
