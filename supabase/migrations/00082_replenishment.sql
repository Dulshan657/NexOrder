-- =============================================================================
-- Replenishment — keep the pick zone stocked from reserve and bulk
-- Migration: 00082_replenishment.sql
-- =============================================================================
-- Mig 00073 seeded the RACK storage form with roles running pick, pick, reserve,
-- bulk from the floor up, and described the reserve level as "a replenishment
-- buffer". Nothing ever implemented the movement. Stock landed in reserve/bulk
-- via putaway and stayed there; when a pick zone drained, the picker was simply
-- directed to a bulk level instead, which is slower and defeats the point of
-- having a pick zone at all.
--
-- This adds the missing loop, cloning 00080's two-stage putaway model:
--
--   [detect] -> suggested --assign--> assigned --complete--> accepted|overridden
--                          (no move)             (inv_transfer_stock fires HERE)
--
-- THE AUDIT TRIO SITS ON THE SOURCE, NOT THE DESTINATION. 00080 tracks
-- recommended/assigned/chosen LOCATION because for putaway the destination is
-- what gets re-decided on the floor. For replenishment the destination is the
-- task's identity -- it is the pick slot that is low, which is the entire reason
-- the task exists, and changing it would mean "this SKU's home bin moved", a
-- SLOTTING decision (wie_slotting_suggestions), not a replenishment one. What
-- actually varies is which reserve bin the walker pulls from when the assigned
-- one is found empty or blocked. So the trio is on `*_from_location_id`, plus a
-- single `to_location_id` and a nullable `chosen_to_location_id` for a misplace.
--
-- ONE STOP, NOT TWO. wie_convert_rack_to_levels_tx (00072) gives every level of
-- a rack its own layout_placements row co-located at the rack's exact (floor,
-- x, y) with the SAME graph_node_id, differing only in access_offset_m. So a
-- same-rack L3 -> L1 replenishment is one physical stop with zero travel.
-- wie_replen_stops therefore emits ONE row per task, anchored at the SOURCE bin,
-- carrying the destination geometry as columns. Emitting two rows and letting
-- sequencePickRoute order them would be a bug: it is a nearest-neighbour tour
-- over INDEPENDENT stops and would happily schedule "place" before "pull".
--
-- SIZED FROM AVAILABLE, NEVER on_hand. inv_transfer_stock moves available stock
-- only, so a task sized against on_hand could be raised and then fail at the
-- rack. A reserve pallet fully allocated to an open order shows on_hand > 0,
-- available = 0 and correctly produces NO task -- which operators will report as
-- a bug, so wie_replen_detect returns a machine-readable reason per skipped slot
-- and the UI must render it.
--
-- Contents:
--   1. product_home_bins gains min/max + replen_enabled + purpose, and a
--      pick-zone trigger
--   2. wie_replen_tasks + indexes + RLS
--   3. wie_replen_detect      -- min/max -> tasks
--   4. wie_assign_replen_tx   -- claim the source, move nothing
--   5. wie_complete_replen_tx -- the transfer
--   6. wie_unassign_replen_tx / wie_cancel_replen_tx
--   7. wie_replen_stops       -- assigned rows as routable walk stops
--
-- Depends on 00081 (level_roles.is_pick_zone / replen_source_rank).
-- INERT until an operator sets replen_enabled, so it is safe to apply well
-- before any UI exists. Must be applied BEFORE the redeployed record-pick /
-- complete-putaway, or their advisory wie_replen_detect call 404s.
-- Every function here is a NEW name, so no DROP is required anywhere -- do not
-- "helpfully" add one.
-- Apply via the Management API (see CLAUDE.md); do not run interactively.
-- =============================================================================

BEGIN;

-- ── 1. Replenishment config on product_home_bins ─────────────────────────────
-- The table has existed since 00039 (one row per product x warehouse, naming
-- the SKU's default bin) and has been nearly unused -- only the Transfer Stock
-- modal reads it. It is the right anchor for "where this SKU lives", so the
-- min/max lands here rather than in a second table that would disagree with it.
ALTER TABLE public.product_home_bins
    ADD COLUMN IF NOT EXISTS min_qty        NUMERIC(14,3),   -- BASE units
    ADD COLUMN IF NOT EXISTS max_qty        NUMERIC(14,3),   -- BASE units
    ADD COLUMN IF NOT EXISTS replen_enabled BOOLEAN NOT NULL DEFAULT false,
    -- Widening the slot key NOW, while this table has one writer and a handful
    -- of rows. UNIQUE(product_id, warehouse_id) means one pick slot per SKU per
    -- site forever -- no chilled + ambient face, no case-pick + each-pick face.
    -- Changing it later, once it is the live replenishment config, is a data
    -- migration; changing it today is one onConflict string.
    ADD COLUMN IF NOT EXISTS purpose        TEXT NOT NULL DEFAULT 'primary',
    ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_by     UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN public.product_home_bins.min_qty IS
    'Base units. When available at the pick slot falls to or below this, replenishment raises a task.';
COMMENT ON COLUMN public.product_home_bins.max_qty IS
    'Base units. Replenishment refills the slot up to this, never past physical capacity.';
COMMENT ON COLUMN public.product_home_bins.purpose IS
    'Distinguishes several slots for one SKU in one warehouse (primary, chilled, each-pick...).';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_home_bins_minmax_check') THEN
        ALTER TABLE public.product_home_bins
            ADD CONSTRAINT product_home_bins_minmax_check
            CHECK (min_qty IS NULL OR max_qty IS NULL OR max_qty > min_qty);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_home_bins_replen_config_check') THEN
        ALTER TABLE public.product_home_bins
            ADD CONSTRAINT product_home_bins_replen_config_check
            CHECK (NOT replen_enabled
                   OR (min_qty IS NOT NULL AND max_qty IS NOT NULL AND min_qty >= 0));
    END IF;
    -- Swap the unique key to include purpose.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_home_bins_product_id_warehouse_id_key') THEN
        ALTER TABLE public.product_home_bins
            DROP CONSTRAINT product_home_bins_product_id_warehouse_id_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_home_bins_slot_key') THEN
        ALTER TABLE public.product_home_bins
            ADD CONSTRAINT product_home_bins_slot_key UNIQUE (product_id, warehouse_id, purpose);
    END IF;
END $$;

-- A replenishment destination must be a pick zone. That is a CROSS-TABLE fact
-- (locations -> level_roles), so no table CHECK can express it. The trigger is
-- the real enforcement: service_role bypasses RLS but NOT triggers, so every
-- write path is covered including the Edge Function.
CREATE OR REPLACE FUNCTION public.product_home_bins_replen_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.replen_enabled AND NOT EXISTS (
        SELECT 1
        FROM public.locations l
        JOIN public.level_roles r ON r.key = l.level_role
        WHERE l.id = NEW.bin_id AND r.is_pick_zone AND r.is_active
    ) THEN
        RAISE EXCEPTION
            'INVALID_BIN: replenishment needs a pick-zone level; location % is not one', NEW.bin_id
            USING ERRCODE = 'P0001';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_home_bins_replen_guard ON public.product_home_bins;
CREATE TRIGGER trg_product_home_bins_replen_guard
    BEFORE INSERT OR UPDATE ON public.product_home_bins
    FOR EACH ROW EXECUTE FUNCTION public.product_home_bins_replen_guard();

-- ── 2. wie_replen_tasks ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wie_replen_tasks (
    id             BIGSERIAL PRIMARY KEY,
    warehouse_id   INT NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    layout_id      INT REFERENCES public.warehouse_layouts(id),
    product_id     INT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

    -- DESTINATION: the pick slot. The task's identity, never re-decided at the
    -- desk. chosen_to_location_id records a misplace, nothing more.
    to_location_id        INT NOT NULL REFERENCES public.locations(id),
    chosen_to_location_id INT REFERENCES public.locations(id),

    -- SOURCE: the axis that actually varies on the floor. 00080's trio, moved.
    recommended_from_location_id INT REFERENCES public.locations(id),  -- detector
    assigned_from_location_id    INT REFERENCES public.locations(id),  -- desk
    chosen_from_location_id      INT REFERENCES public.locations(id),  -- floor

    quantity                NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    -- Advisory: the plate the detector EXPECTED to move. The one that actually
    -- moves is whatever the walker scanned (a source override invalidates this),
    -- recorded in chosen_handling_unit_id. Same posture as 00078's
    -- wie_putaway_recommendations.handling_unit_id.
    handling_unit_id        BIGINT REFERENCES public.handling_units(id) ON DELETE SET NULL,
    chosen_handling_unit_id BIGINT REFERENCES public.handling_units(id) ON DELETE SET NULL,

    trigger_kind TEXT NOT NULL DEFAULT 'min_max'
                     CHECK (trigger_kind IN ('min_max','manual')),
    -- Config snapshot at detection time, so a task stays explainable after
    -- someone edits the min/max.
    min_qty      NUMERIC(14,3),
    max_qty      NUMERIC(14,3),
    slot_on_hand NUMERIC(14,3),
    explanation  JSONB NOT NULL DEFAULT '{}',
    engine_version TEXT,

    -- 'expired' = the system withdrew it (slot refilled, config turned off).
    -- 'cancelled' = a human declined it. 00080 conflates these; splitting them
    -- costs one CHECK value and makes "how often does the detector raise work
    -- nobody wants?" answerable.
    status TEXT NOT NULL DEFAULT 'suggested'
        CHECK (status IN ('suggested','assigned','accepted','overridden','expired','cancelled')),

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_at TIMESTAMPTZ,
    assigned_by UUID REFERENCES public.profiles(id),
    decided_at  TIMESTAMPTZ,
    actor_id    UUID REFERENCES public.profiles(id),

    CONSTRAINT wie_replen_no_self
        CHECK (to_location_id IS DISTINCT FROM recommended_from_location_id)
);

CREATE INDEX IF NOT EXISTS idx_wie_replen_open
    ON public.wie_replen_tasks(warehouse_id, status, created_at)
    WHERE status IN ('suggested','assigned');
CREATE INDEX IF NOT EXISTS idx_wie_replen_walk
    ON public.wie_replen_tasks(warehouse_id, assigned_from_location_id)
    WHERE status = 'assigned';

-- Dedupe: at most ONE open suggestion per pick slot. Precedent:
-- uq_wie_slotting_open (00049).
--
-- DO NOT widen this to status IN ('suggested','assigned'). That is the obvious
-- choice and it BREAKS the partial-assign split, which deliberately leaves the
-- original row 'suggested' holding the remainder while inserting an 'assigned'
-- copy -- same triple, two rows. The detector's own in-flight netting (§3) is
-- the brace for assigned work.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wie_replen_open
    ON public.wie_replen_tasks(warehouse_id, product_id, to_location_id)
    WHERE status = 'suggested';

ALTER TABLE public.wie_replen_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wie_replen_tasks_select_ops" ON public.wie_replen_tasks;
CREATE POLICY "wie_replen_tasks_select_ops" ON public.wie_replen_tasks FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));
GRANT SELECT ON public.wie_replen_tasks TO authenticated;
-- No write policy. The RPCs below are the only write path.

-- ── 3. wie_replen_detect — min/max becomes tasks ─────────────────────────────
-- Returns { raised, expired, skipped: [{product_id, to_location_id, reason}] }.
--
-- The skipped reasons are not diagnostics-for-developers: an operator looking at
-- a slot below min with a full pallet sitting one level up WILL report this as
-- broken, and 'source_reserved' is the answer. The UI must render them.
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
        WHERE b.product_id = v_slot.product_id
          AND b.available > 0
          AND b.location_id <> v_slot.bin_id
          AND l.is_active
          AND r.replen_source_rank IS NOT NULL AND r.is_active
          AND public.inv_root_warehouse(b.location_id) = p_warehouse_id
        GROUP BY b.location_id, r.replen_source_rank, bt.expiry_date, bt.received_at,
                 fpl.graph_node_id, tpl.graph_node_id, td.distance_m
        ORDER BY r.replen_source_rank ASC,
                 bt.expiry_date NULLS LAST,
                 bt.received_at NULLS FIRST,
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
                 'source_available', v_src.avail),
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

-- ── 4. wie_assign_replen_tx — claim the source, move nothing ─────────────────
-- Mirrors wie_assign_putaway_tx (00080) exactly, on the source axis. A partial
-- assign leaves the ORIGINAL row 'suggested' holding the remainder.
CREATE OR REPLACE FUNCTION public.wie_assign_replen_tx(
    p_task_id       BIGINT,
    p_from_location INT,
    p_qty           NUMERIC DEFAULT NULL,   -- NULL = the whole remaining quantity
    p_actor         UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task        public.wie_replen_tasks%ROWTYPE;
    v_qty         NUMERIC;
    v_remainder   NUMERIC;
    v_assigned_id BIGINT;
BEGIN
    IF p_from_location IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: a source location is required' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_task FROM public.wie_replen_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: replenishment task % not found', p_task_id USING ERRCODE = 'P0001';
    END IF;
    IF v_task.status <> 'suggested' THEN
        RAISE EXCEPTION 'CONFLICT: replenishment task already %', v_task.status USING ERRCODE = 'P0001';
    END IF;
    IF p_from_location = v_task.to_location_id THEN
        RAISE EXCEPTION 'INVALID_INPUT: the source and the pick slot cannot be the same location'
            USING ERRCODE = 'P0001';
    END IF;

    v_qty := COALESCE(p_qty, v_task.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: assigned quantity must be positive' USING ERRCODE = 'P0001';
    END IF;
    IF v_qty > v_task.quantity THEN
        RAISE EXCEPTION 'INVALID_QTY: % exceeds the % left on this task', v_qty, v_task.quantity
            USING ERRCODE = 'P0001';
    END IF;

    v_remainder := v_task.quantity - v_qty;

    IF v_remainder = 0 THEN
        UPDATE public.wie_replen_tasks
        SET status = 'assigned', assigned_from_location_id = p_from_location,
            assigned_at = now(), assigned_by = p_actor
        WHERE id = p_task_id;
        v_assigned_id := p_task_id;
    ELSE
        UPDATE public.wie_replen_tasks SET quantity = v_remainder WHERE id = p_task_id;

        INSERT INTO public.wie_replen_tasks
            (warehouse_id, layout_id, product_id, to_location_id,
             recommended_from_location_id, assigned_from_location_id,
             quantity, handling_unit_id, trigger_kind, min_qty, max_qty, slot_on_hand,
             explanation, engine_version, status, assigned_at, assigned_by, created_at)
        VALUES
            (v_task.warehouse_id, v_task.layout_id, v_task.product_id, v_task.to_location_id,
             v_task.recommended_from_location_id, p_from_location,
             v_qty, v_task.handling_unit_id, v_task.trigger_kind,
             v_task.min_qty, v_task.max_qty, v_task.slot_on_hand,
             v_task.explanation, v_task.engine_version, 'assigned', now(), p_actor, v_task.created_at)
        RETURNING id INTO v_assigned_id;
    END IF;

    RETURN jsonb_build_object(
        'assigned_id',   v_assigned_id,
        'remainder_id',  CASE WHEN v_remainder > 0 THEN p_task_id ELSE NULL END,
        'remainder_qty', v_remainder);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_assign_replen_tx(BIGINT,INT,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_assign_replen_tx(BIGINT,INT,NUMERIC,UUID) TO service_role;

-- ── 5. wie_complete_replen_tx — the stock actually moves here ────────────────
CREATE OR REPLACE FUNCTION public.wie_complete_replen_tx(
    p_task_id          BIGINT,
    p_actual_from      INT,
    p_actual_to        INT,
    p_qty              NUMERIC DEFAULT NULL,   -- NULL = the whole assigned quantity
    p_handling_unit_id BIGINT  DEFAULT NULL,   -- the plate actually scanned
    p_actor            UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task        public.wie_replen_tasks%ROWTYPE;
    v_qty         NUMERIC;
    v_remainder   NUMERIC;
    v_status      TEXT;
    v_warn        BOOLEAN;
    v_completed   BIGINT;
    v_moved       JSONB;
BEGIN
    IF p_actual_from IS NULL OR p_actual_to IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: both the source and the destination bin are required'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_actual_from = p_actual_to THEN
        RAISE EXCEPTION 'INVALID_TRANSFER: the source and destination cannot be the same location'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_task FROM public.wie_replen_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: replenishment task % not found', p_task_id USING ERRCODE = 'P0001';
    END IF;
    -- Two walkers reaching for the same task: the loser lands here.
    IF v_task.status <> 'assigned' THEN
        RAISE EXCEPTION 'CONFLICT: replenishment task already %', v_task.status USING ERRCODE = 'P0001';
    END IF;

    -- HARD guard. The whole point of the task is to refill a pick zone; letting
    -- a mis-scan drop the stock into a bulk level would silently leave the slot
    -- it was meant to fix still empty. Do NOT soften this to allow a NULL role.
    IF NOT EXISTS (
        SELECT 1 FROM public.locations l
        JOIN public.level_roles r ON r.key = l.level_role
        WHERE l.id = p_actual_to AND r.is_pick_zone AND r.is_active
    ) THEN
        RAISE EXCEPTION 'INVALID_DESTINATION: location % is not a pick-zone level', p_actual_to
            USING ERRCODE = 'P0001';
    END IF;

    -- SOFT guard. A source outside the configured replen roles is RECORDED, not
    -- refused: pick-to-pick top-ups and root pulls are legitimate. Written as
    -- NOT EXISTS rather than a negated compound so a NULL level_role yields a
    -- warning rather than silently skipping the branch.
    v_warn := NOT EXISTS (
        SELECT 1 FROM public.locations l
        JOIN public.level_roles r ON r.key = l.level_role
        WHERE l.id = p_actual_from AND r.replen_source_rank IS NOT NULL AND r.is_active);

    v_qty := COALESCE(p_qty, v_task.quantity);
    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: moved quantity must be positive' USING ERRCODE = 'P0001';
    END IF;
    IF v_qty > v_task.quantity THEN
        RAISE EXCEPTION 'INVALID_QTY: % exceeds the % assigned on this task', v_qty, v_task.quantity
            USING ERRCODE = 'P0001';
    END IF;

    -- Status resolves across BOTH axes: the walker followed the desk only if the
    -- source AND the destination match.
    v_status := CASE
        WHEN p_actual_from = v_task.assigned_from_location_id
         AND p_actual_to   = v_task.to_location_id THEN 'accepted'
        ELSE 'overridden' END;
    v_remainder := v_task.quantity - v_qty;

    IF v_remainder = 0 THEN
        UPDATE public.wie_replen_tasks
        SET status = v_status,
            chosen_from_location_id = p_actual_from,
            chosen_to_location_id   = p_actual_to,
            chosen_handling_unit_id = p_handling_unit_id,
            decided_at = now(), actor_id = p_actor
        WHERE id = p_task_id;
        v_completed := p_task_id;
    ELSE
        UPDATE public.wie_replen_tasks SET quantity = v_remainder WHERE id = p_task_id;

        INSERT INTO public.wie_replen_tasks
            (warehouse_id, layout_id, product_id, to_location_id, chosen_to_location_id,
             recommended_from_location_id, assigned_from_location_id, chosen_from_location_id,
             quantity, handling_unit_id, chosen_handling_unit_id, trigger_kind,
             min_qty, max_qty, slot_on_hand, explanation, engine_version,
             status, assigned_at, assigned_by, actor_id, created_at, decided_at)
        VALUES
            (v_task.warehouse_id, v_task.layout_id, v_task.product_id, v_task.to_location_id, p_actual_to,
             v_task.recommended_from_location_id, v_task.assigned_from_location_id, p_actual_from,
             v_qty, v_task.handling_unit_id, p_handling_unit_id, v_task.trigger_kind,
             v_task.min_qty, v_task.max_qty, v_task.slot_on_hand, v_task.explanation, v_task.engine_version,
             v_status, v_task.assigned_at, v_task.assigned_by, p_actor, v_task.created_at, now())
        RETURNING id INTO v_completed;
    END IF;

    -- Same transaction: a failed move rolls the completion back with it, so a
    -- task can never read as done without a matching ledger leg.
    --
    -- inv_transfer_stock is AVAILABLE-only. That is the guarantee enforced at
    -- the last possible moment: a task sized from stale availability fails
    -- loudly (INSUFFICIENT_STOCK) rather than silently under-moving. Callers
    -- must map that to CONFLICT, not INTERNAL -- the walker is at the rack and
    -- can reduce the quantity or pick another source.
    v_moved := public.inv_transfer_stock(
        v_task.product_id, p_actual_from, p_actual_to, v_qty, p_actor,
        'replen:' || v_status, p_handling_unit_id);

    RETURN jsonb_build_object(
        'completed_id',  v_completed,
        'status',        v_status,
        'source_warning', v_warn,
        'remainder_id',  CASE WHEN v_remainder > 0 THEN p_task_id ELSE NULL END,
        'remainder_qty', v_remainder,
        'moved',         v_moved);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_complete_replen_tx(BIGINT,INT,INT,NUMERIC,BIGINT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_complete_replen_tx(BIGINT,INT,INT,NUMERIC,BIGINT,UUID) TO service_role;

-- ── 6. wie_unassign_replen_tx / wie_cancel_replen_tx ─────────────────────────
-- Unassign: for a run someone starts and abandons. No stock has moved, so this
-- is a pure state reversal.
CREATE OR REPLACE FUNCTION public.wie_unassign_replen_tx(
    p_task_id BIGINT,
    p_actor   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task public.wie_replen_tasks%ROWTYPE;
BEGIN
    SELECT * INTO v_task FROM public.wie_replen_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: replenishment task % not found', p_task_id USING ERRCODE = 'P0001';
    END IF;
    IF v_task.status <> 'assigned' THEN
        RAISE EXCEPTION 'CONFLICT: replenishment task is %, not assigned', v_task.status
            USING ERRCODE = 'P0001';
    END IF;

    -- Returning to 'suggested' can collide with a suggestion the detector raised
    -- for the same slot while this one was out on the floor. Fold into it rather
    -- than tripping uq_wie_replen_open.
    IF EXISTS (
        SELECT 1 FROM public.wie_replen_tasks o
        WHERE o.status = 'suggested'
          AND o.warehouse_id = v_task.warehouse_id
          AND o.product_id = v_task.product_id
          AND o.to_location_id = v_task.to_location_id
    ) THEN
        UPDATE public.wie_replen_tasks o
        SET quantity = GREATEST(o.quantity, v_task.quantity)
        WHERE o.status = 'suggested'
          AND o.warehouse_id = v_task.warehouse_id
          AND o.product_id = v_task.product_id
          AND o.to_location_id = v_task.to_location_id;

        UPDATE public.wie_replen_tasks
        SET status = 'cancelled', decided_at = now(), actor_id = p_actor
        WHERE id = p_task_id;

        RETURN jsonb_build_object('unassigned_id', p_task_id, 'folded_into_existing', true);
    END IF;

    UPDATE public.wie_replen_tasks
    SET status = 'suggested', assigned_from_location_id = NULL,
        assigned_at = NULL, assigned_by = NULL
    WHERE id = p_task_id;

    RETURN jsonb_build_object('unassigned_id', p_task_id, 'folded_into_existing', false);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_unassign_replen_tx(BIGINT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_unassign_replen_tx(BIGINT,UUID) TO service_role;

-- Cancel: a human declined the work outright.
CREATE OR REPLACE FUNCTION public.wie_cancel_replen_tx(
    p_task_id BIGINT,
    p_reason  TEXT DEFAULT NULL,
    p_actor   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task public.wie_replen_tasks%ROWTYPE;
BEGIN
    SELECT * INTO v_task FROM public.wie_replen_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: replenishment task % not found', p_task_id USING ERRCODE = 'P0001';
    END IF;
    IF v_task.status NOT IN ('suggested','assigned') THEN
        RAISE EXCEPTION 'CONFLICT: replenishment task already %', v_task.status USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.wie_replen_tasks
    SET status = 'cancelled', decided_at = now(), actor_id = p_actor,
        explanation = v_task.explanation || jsonb_build_object('cancel_reason', p_reason)
    WHERE id = p_task_id;

    RETURN jsonb_build_object('cancelled_id', p_task_id);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_cancel_replen_tx(BIGINT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_cancel_replen_tx(BIGINT,TEXT,UUID) TO service_role;

-- ── 7. wie_replen_stops — assigned rows as routable walk stops ───────────────
-- ONE row per task, anchored at the SOURCE bin. The first six columns mirror
-- wie_putaway_stops (00080) / wie_order_pick_stops (00064) in name and position
-- so _shared/wie/picking.ts sequencePickRoute needs no adapter; the destination
-- geometry rides along as extra columns for the card to render.
CREATE OR REPLACE FUNCTION public.wie_replen_stops(p_warehouse_id INT)
RETURNS TABLE(
    task_id            BIGINT,
    product_id         INT,
    location_id        INT,       -- the SOURCE bin: what the walker travels to
    code               TEXT,
    graph_node_id      INT,
    access_offset_m    NUMERIC,
    to_location_id     INT,
    to_code            TEXT,
    to_graph_node_id   INT,
    to_access_offset_m NUMERIC,
    same_node          BOOLEAN,   -- true => same-rack move, zero travel
    qty_base           NUMERIC,
    hu_code            TEXT,
    hu_type            TEXT,
    sku                TEXT,
    product_name       TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        t.id, t.product_id,
        t.assigned_from_location_id, fl.code, fpl.graph_node_id, COALESCE(fpl.access_offset_m, 0),
        t.to_location_id,            tl.code, tpl.graph_node_id, COALESCE(tpl.access_offset_m, 0),
        (fpl.graph_node_id IS NOT NULL AND fpl.graph_node_id = tpl.graph_node_id),
        t.quantity, hu.code, hu.hu_type, p.sku, p.name
    FROM public.wie_replen_tasks t
    JOIN public.locations wh ON wh.id = t.warehouse_id
    JOIN public.locations fl ON fl.id = t.assigned_from_location_id
    JOIN public.locations tl ON tl.id = t.to_location_id
    -- A bin missing from the active layout returns a NULL graph_node_id, which
    -- sequencePickRoute already treats as "unreachable, append with no leg".
    LEFT JOIN public.layout_placements fpl
           ON fpl.location_id = t.assigned_from_location_id AND fpl.layout_id = wh.active_layout_id
    LEFT JOIN public.layout_placements tpl
           ON tpl.location_id = t.to_location_id            AND tpl.layout_id = wh.active_layout_id
    LEFT JOIN public.handling_units hu ON hu.id = t.handling_unit_id
    LEFT JOIN public.products p ON p.id = t.product_id
    WHERE t.warehouse_id = p_warehouse_id AND t.status = 'assigned'
    ORDER BY t.created_at, t.id
$$;

REVOKE ALL ON FUNCTION public.wie_replen_stops(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_replen_stops(INT) TO service_role;

COMMIT;

-- =============================================================================
-- Verify:
--   -- Inert on arrival: no existing home bin opted in.
--   SELECT count(*) FROM public.product_home_bins WHERE replen_enabled;  -- 0
--
--   -- The slot key widened:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.product_home_bins'::regclass AND contype = 'u';
--     -- expect product_home_bins_slot_key UNIQUE (product_id, warehouse_id, purpose)
--
--   -- The pick-zone trigger refuses a non-pick-zone bin:
--   BEGIN;
--     UPDATE public.product_home_bins SET replen_enabled = true, min_qty = 1, max_qty = 2
--      WHERE bin_id = (SELECT id FROM public.locations WHERE level_role = 'bulk' LIMIT 1);
--     -- expect: INVALID_BIN
--   ROLLBACK;
--
--   -- The ON CONFLICT arbiter matches the partial index (this is the single
--   -- most likely implementation defect -- a missing WHERE clause errors here):
--   SELECT public.wie_replen_detect(<warehouse_id>, NULL, NULL, true);
--
--   -- No overloads were created:
--   SELECT proname, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname LIKE 'wie_%replen%' GROUP BY proname;
--     -- expect each = 1
-- =============================================================================
