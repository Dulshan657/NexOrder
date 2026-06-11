-- =============================================================================
-- Multi-warehouse core — N warehouses, per-warehouse fulfilments, transfers
-- Migration: 00036_multi_warehouse_core.sql
-- =============================================================================
-- Generalises the single-warehouse model (everything pinned to
-- inv_default_location()) to N admin-configurable warehouses.
--
--   * locations.location_type ('bulk'|'racked') labels each WAREHOUSE row; v1
--     stock is all 'bulk'. (Racked/bin WMS lands in 00037+.)
--   * profiles.home_warehouse_id scopes warehouse staff to one site.
--   * order_fulfillments: one row per (order, warehouse) the order draws from,
--     each its own picked->packed->dispatched->delivered lifecycle. orders.status
--     becomes the derived rollup (written by the Edge Functions).
--   * The inv_* RPCs gain explicit location args (closest-first split,
--     per-location pick/release/receive) and a new inv_transfer_stock. They keep
--     inv_default_location() as the NULL fallback, so existing supabase-js
--     NAMED-ARG callers that omit the new params keep working unchanged.
--   * Pack-aware base-unit scaling (mig 00035) and LINE-unit *_fully_picked flags
--     are preserved exactly.
--
-- Idempotent (ADD COLUMN/CONSTRAINT IF NOT EXISTS, CREATE OR REPLACE, guarded
-- policy + publication adds). Apply via the Supabase Management API.
--
-- ROLLOUT: deploy the Edge Functions that pass the new args FIRST, then push the
-- frontend, then apply this migration. The NULL-fallback keeps old-shaped named
-- calls valid throughout.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. locations — storage type + admin-editable warehouse fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS location_type TEXT,
    ADD COLUMN IF NOT EXISTS address       TEXT,
    ADD COLUMN IF NOT EXISTS contact       TEXT,
    ADD COLUMN IF NOT EXISTS hours         TEXT,
    ADD COLUMN IF NOT EXISTS notes         TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_location_type_check') THEN
        ALTER TABLE public.locations
            ADD CONSTRAINT locations_location_type_check
            CHECK (location_type IS NULL OR location_type IN ('bulk', 'racked'));
    END IF;
END $$;

-- Every existing WAREHOUSE row is the legacy bulk model.
UPDATE public.locations
   SET location_type = 'bulk'
 WHERE kind = 'WAREHOUSE' AND location_type IS NULL;

-- ---------------------------------------------------------------------------
-- 2. profiles.home_warehouse_id — warehouse staff scoped to one site
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS home_warehouse_id INT REFERENCES public.locations(id);

-- ---------------------------------------------------------------------------
-- 3. order_documents.location_id — attribute a pick slip / dispatch advice
--    to the fulfilment's warehouse
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_documents
    ADD COLUMN IF NOT EXISTS location_id INT REFERENCES public.locations(id);

-- ---------------------------------------------------------------------------
-- 4. order_fulfillments — per-warehouse slice of an order
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_fulfillments (
    id              SERIAL          PRIMARY KEY,
    order_id        TEXT            NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    location_id     INT             NOT NULL REFERENCES public.locations(id),
    status          TEXT            NOT NULL DEFAULT 'processed'
                        CHECK (status IN ('processed','picked','packed','dispatched','delivered')),
    status_history  JSONB           NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (order_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_order_fulfillments_order    ON public.order_fulfillments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_fulfillments_location ON public.order_fulfillments(location_id);

ALTER TABLE public.order_fulfillments ENABLE ROW LEVEL SECURITY;

-- Operations roles read fulfilments; writes go through Edge Functions (service_role).
DROP POLICY IF EXISTS "order_fulfillments_select_ops" ON public.order_fulfillments;
CREATE POLICY "order_fulfillments_select_ops"
    ON public.order_fulfillments FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

GRANT SELECT ON public.order_fulfillments TO authenticated;

-- Realtime — fulfilment status drives the live order/pick UI.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'order_fulfillments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.order_fulfillments;
    END IF;
END $$;

-- =============================================================================
-- 5. RPCs — generalise to explicit locations (keep inv_default_location fallback)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 5a. inv_reserve_order — closest-first per-line split across preferred locations
-- ---------------------------------------------------------------------------
-- p_location_pref: ordered warehouse ids (closest-first). NULL/empty falls back
-- to [inv_default_location()]. Per line, walk the preference list; within each
-- location FIFO across batches; spill the remainder to the next location.
-- p_items quantities are BASE units (the caller scales by pack_size).
DROP FUNCTION IF EXISTS public.inv_reserve_order(TEXT, JSONB, UUID, BOOLEAN);
CREATE OR REPLACE FUNCTION public.inv_reserve_order(
    p_order_id      TEXT,
    p_items         JSONB,
    p_location_pref INT[]   DEFAULT NULL,
    p_actor         UUID    DEFAULT NULL,
    p_allow_partial BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pref      INT[];
    v_item      JSONB;
    v_pid       INT;
    v_qty       NUMERIC;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_loc       INT;
    v_row       RECORD;
BEGIN
    v_pref := NULLIF(p_location_pref, '{}');
    IF v_pref IS NULL THEN
        v_pref := ARRAY[public.inv_default_location()];
    END IF;
    IF v_pref IS NULL OR array_length(v_pref, 1) IS NULL OR v_pref[1] IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::INT;
        v_qty := (v_item->>'quantity')::NUMERIC;
        v_remaining := v_qty;

        FOREACH v_loc IN ARRAY v_pref
        LOOP
            EXIT WHEN v_remaining <= 0;
            FOR v_row IN
                SELECT b.id, b.batch_id, b.available
                FROM public.inventory_balances b
                LEFT JOIN public.batches bt ON bt.id = b.batch_id
                WHERE b.product_id = v_pid AND b.location_id = v_loc AND b.available > 0
                ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
                FOR UPDATE OF b
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_take := LEAST(v_remaining, v_row.available);
                PERFORM public.inv_apply_leg(
                    v_pid, v_loc, v_row.batch_id, 0, v_take,
                    'allocate', p_actor, 'order', p_order_id, NULL);
                v_remaining := v_remaining - v_take;
            END LOOP;
        END LOOP;

        IF v_remaining > 0 AND NOT p_allow_partial THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by %', v_pid, v_remaining
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5b. inv_release_reservation — release remainder, optionally for one location
-- ---------------------------------------------------------------------------
-- p_location_id NULL = release across ALL locations (original behaviour); set =
-- only that location. Reserved remainder is pack-aware (base units), per 00035.
DROP FUNCTION IF EXISTS public.inv_release_reservation(TEXT, UUID);
CREATE OR REPLACE FUNCTION public.inv_release_reservation(
    p_order_id    TEXT,
    p_location_id INT  DEFAULT NULL,
    p_actor       UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_line      RECORD;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_row       RECORD;
BEGIN
    FOR v_line IN
        SELECT oi.product_id,
               (oi.quantity
                  - COALESCE((SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
                              WHERE pp.order_item_id = oi.id), 0))
                 * COALESCE(oi.pack_size, 1) AS reserved_remaining
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
    LOOP
        v_remaining := GREATEST(v_line.reserved_remaining, 0);
        CONTINUE WHEN v_remaining <= 0;

        FOR v_row IN
            SELECT id, location_id, batch_id, allocated
            FROM public.inventory_balances
            WHERE product_id = v_line.product_id
              AND allocated > 0
              AND (p_location_id IS NULL OR location_id = p_location_id)
            ORDER BY id
            FOR UPDATE
        LOOP
            EXIT WHEN v_remaining <= 0;
            v_take := LEAST(v_remaining, v_row.allocated);
            PERFORM public.inv_apply_leg(
                v_line.product_id, v_row.location_id, v_row.batch_id, 0, -v_take,
                'deallocate', p_actor, 'order', p_order_id, 'reservation released');
            v_remaining := v_remaining - v_take;
        END LOOP;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5c. inv_pick_order_line — decrement on pick at a specific location
-- ---------------------------------------------------------------------------
-- p_location_id NULL = inv_default_location(). Physical draw-down is pack-aware
-- (base units); OVER_PICK guard, pick_progress and *_fully_picked stay LINE units
-- and *_fully_picked spans ALL of the line's picks across every location.
DROP FUNCTION IF EXISTS public.inv_pick_order_line(INT, NUMERIC, UUID);
CREATE OR REPLACE FUNCTION public.inv_pick_order_line(
    p_order_item_id INT,
    p_picked_qty    NUMERIC,   -- LINE units (cartons for a carton line)
    p_location_id   INT  DEFAULT NULL,
    p_actor         UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc           INT := COALESCE(p_location_id, public.inv_default_location());
    v_item          RECORD;
    v_factor        NUMERIC;
    v_already       NUMERIC;
    v_remaining     NUMERIC;
    v_take          NUMERIC;
    v_dealloc       NUMERIC;
    v_row           RECORD;
    v_last_batch    INT;
    v_order_done    BOOLEAN;
BEGIN
    IF p_picked_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: picked_qty must be positive' USING ERRCODE = 'P0001';
    END IF;
    IF v_loc IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.pack_size
    INTO v_item
    FROM public.order_items oi
    WHERE oi.id = p_order_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_ITEM_NOT_FOUND: %', p_order_item_id USING ERRCODE = 'P0001';
    END IF;

    v_factor := COALESCE(v_item.pack_size, 1);

    SELECT COALESCE(SUM(picked_qty), 0) INTO v_already
    FROM public.pick_progress WHERE order_item_id = p_order_item_id;

    IF v_already + p_picked_qty > v_item.quantity THEN
        RAISE EXCEPTION 'OVER_PICK: line % would exceed ordered qty', p_order_item_id
            USING ERRCODE = 'P0001';
    END IF;

    v_remaining := p_picked_qty * v_factor;
    FOR v_row IN
        SELECT b.id, b.batch_id, b.allocated, b.on_hand
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = v_item.product_id AND b.location_id = v_loc AND b.on_hand > 0
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.on_hand);
        CONTINUE WHEN v_take <= 0;
        v_dealloc := LEAST(v_take, v_row.allocated);
        PERFORM public.inv_apply_leg(
            v_item.product_id, v_loc, v_row.batch_id, -v_take, -v_dealloc,
            'pick', p_actor, 'order', v_item.order_id, NULL);
        v_last_batch := v_row.batch_id;
        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by % at pick',
            v_item.product_id, v_remaining USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.pick_progress
        (order_id, order_item_id, location_id, batch_id, picked_qty, picked_by)
    VALUES
        (v_item.order_id, p_order_item_id, v_loc, v_last_batch, p_picked_qty::INT, p_actor);

    SELECT NOT EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = v_item.order_id
          AND oi.quantity > COALESCE((
              SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
              WHERE pp.order_item_id = oi.id), 0)
    ) INTO v_order_done;

    RETURN jsonb_build_object(
        'line_fully_picked',  (v_already + p_picked_qty) >= v_item.quantity,
        'order_fully_picked', v_order_done
    );
END;
$$;

-- NOTE: receiving (inv_receive_stock) is made warehouse-aware in migration
-- 00038_receive_stock_location.sql, which generalises the goods-receipt version
-- from 00037 (it reads location_id from the p_receipt header). It is NOT touched
-- here to avoid creating a competing overload with 00037's (jsonb,uuid,jsonb).

-- ---------------------------------------------------------------------------
-- 5e. inv_transfer_stock — move available stock location -> location
-- ---------------------------------------------------------------------------
-- Covers inter-warehouse (DC->DC) transfers AND within-warehouse bin re-slotting
-- (it is purely location->location). Moves only AVAILABLE (unreserved) stock,
-- FIFO across batches, preserving lot/expiry on the destination side. One txn.
CREATE OR REPLACE FUNCTION public.inv_transfer_stock(
    p_product_id INT,
    p_from_loc   INT,
    p_to_loc     INT,
    p_qty        NUMERIC,
    p_actor      UUID DEFAULT NULL,
    p_reason     TEXT DEFAULT NULL
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
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: transfer quantity must be positive' USING ERRCODE = 'P0001';
    END IF;
    IF p_from_loc = p_to_loc THEN
        RAISE EXCEPTION 'INVALID_TRANSFER: source and destination are the same' USING ERRCODE = 'P0001';
    END IF;

    FOR v_row IN
        SELECT b.id, b.batch_id, b.available
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = p_product_id AND b.location_id = p_from_loc AND b.available > 0
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.available);
        CONTINUE WHEN v_take <= 0;
        -- out of source, in to destination (same batch so lot/expiry survive)
        PERFORM public.inv_apply_leg(
            p_product_id, p_from_loc, v_row.batch_id, -v_take, 0,
            'transfer_out', p_actor, 'transfer', NULL, p_reason);
        PERFORM public.inv_apply_leg(
            p_product_id, p_to_loc, v_row.batch_id, v_take, 0,
            'transfer_in', p_actor, 'transfer', NULL, p_reason);
        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by % for transfer',
            p_product_id, v_remaining USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object('product_id', p_product_id, 'qty', p_qty,
                              'from_location_id', p_from_loc, 'to_location_id', p_to_loc);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5f. Lock down EXECUTE — service_role only (Edge Functions)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.inv_reserve_order(TEXT,JSONB,INT[],UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_release_reservation(TEXT,INT,UUID)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_pick_order_line(INT,NUMERIC,INT,UUID)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_transfer_stock(INT,INT,INT,NUMERIC,UUID,TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inv_reserve_order(TEXT,JSONB,INT[],UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_release_reservation(TEXT,INT,UUID)           TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_pick_order_line(INT,NUMERIC,INT,UUID)        TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_transfer_stock(INT,INT,INT,NUMERIC,UUID,TEXT) TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT id, code, name, kind, location_type FROM public.locations ORDER BY id;
--   -- closest-first split across two warehouses (2 then 1):
--   SELECT public.inv_reserve_order('ORD-T', '[{"product_id":1,"quantity":5}]', ARRAY[2,1]);
--   -- transfer 3 of product 1 from loc 1 to loc 2:
--   SELECT public.inv_transfer_stock(1, 1, 2, 3);
-- =============================================================================
