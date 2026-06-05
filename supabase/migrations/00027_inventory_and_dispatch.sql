-- =============================================================================
-- Inventory & Dispatch — schema foundation, RPCs, backfill
-- Migration: 00027_inventory_and_dispatch.sql
-- =============================================================================
-- Replaces the single `products.inventory INT` model with a ledger-backed,
-- balance-as-source-of-truth inventory system, plus the scaffolding for the
-- warehouse pick -> dispatch fulfillment flow.
--
-- Design (see the approved plan):
--   * inventory_balances (product x location x batch) is the SOURCE OF TRUTH.
--   * products.inventory is demoted to a derived CACHE, written ONLY by the
--     inv_* RPCs as SUM(on_hand). Backward-compat: existing UI keeps reading
--     products.inventory until each surface migrates to balances.
--   * inventory_movements is an append-only ledger (no UPDATE/DELETE).
--   * Reservation model: reserve on placement (allocated++), decrement on pick
--     (on_hand-- and allocated--). available = on_hand - allocated.
--   * Anything touching balances + ledger + cache together is ONE SECURITY
--     DEFINER plpgsql RPC, service_role-EXECUTE only (copy of the 00026
--     rate_limit_hit pattern), because supabase-js has no client transactions.
--   * v1 assumes ONE warehouse (seeded below). The locations table is built for
--     hierarchy but only the default WAREHOUSE row is used in v1.
--
-- This migration changes NO runtime behavior on its own: place-order/approve-po
-- are rewired to the RPCs in later phases. It only adds tables, RPCs, the
-- Warehouse role, and backfills balances to mirror today's products.inventory.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Warehouse role
-- ---------------------------------------------------------------------------
-- profiles.role CHECK is the inline auto-named constraint from 00001. Widen it
-- to admit the new 'Warehouse' role (pickers/receivers; no pricing/admin).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN (
        'Admin',
        'Manager',
        'Field Sales Rep',
        'Office Sales Rep',
        'Restaurant/Hotel Customer',
        'Warehouse'
    ));

-- ---------------------------------------------------------------------------
-- 1. products — inventory/replenishment columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS reorder_point        INT,
    ADD COLUMN IF NOT EXISTS safety_stock         INT,
    ADD COLUMN IF NOT EXISTS lead_time_days       INT,
    ADD COLUMN IF NOT EXISTS preferred_supplier_id INT REFERENCES public.suppliers(id),
    ADD COLUMN IF NOT EXISTS is_active            BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS barcode              TEXT;

-- ---------------------------------------------------------------------------
-- 2. locations  (hierarchy WAREHOUSE -> ZONE -> BIN -> SHELF; v1 uses one WH)
-- ---------------------------------------------------------------------------
CREATE TABLE public.locations (
    id                  SERIAL          PRIMARY KEY,
    parent_id           INT             REFERENCES public.locations(id) ON DELETE RESTRICT,
    kind                TEXT            NOT NULL
                            CHECK (kind IN ('WAREHOUSE','ZONE','BIN','SHELF')),
    code                TEXT            NOT NULL UNIQUE,
    name                TEXT            NOT NULL,
    lat                 NUMERIC(10,6),
    lng                 NUMERIC(10,6),
    materialized_path   TEXT            NOT NULL,
    is_active           BOOLEAN         NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    -- Only a WAREHOUSE may sit at the root; every other kind needs a parent.
    CONSTRAINT locations_parent_required
        CHECK (kind = 'WAREHOUSE' OR parent_id IS NOT NULL)
);
CREATE INDEX idx_locations_parent_id ON public.locations(parent_id);
CREATE INDEX idx_locations_kind      ON public.locations(kind);

-- ---------------------------------------------------------------------------
-- 3. batches  (lot + expiry; barcode for scanning during receipt/stocktake)
-- ---------------------------------------------------------------------------
CREATE TABLE public.batches (
    id              SERIAL          PRIMARY KEY,
    product_id      INT             NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    lot_code        TEXT            NOT NULL,
    expiry_date     DATE,
    barcode         TEXT,
    supplier_id     INT             REFERENCES public.suppliers(id),
    received_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (product_id, lot_code)
);
CREATE INDEX idx_batches_product_id  ON public.batches(product_id);
CREATE INDEX idx_batches_expiry_date ON public.batches(expiry_date);

-- ---------------------------------------------------------------------------
-- 4. inventory_balances  (product x location x batch — SOURCE OF TRUTH)
-- ---------------------------------------------------------------------------
-- batch_id NULL = untracked/legacy stock (the backfilled rows live here).
-- available is a stored generated column so reads never recompute it.
CREATE TABLE public.inventory_balances (
    id          SERIAL          PRIMARY KEY,
    product_id  INT             NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    location_id INT             NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    batch_id    INT             REFERENCES public.batches(id) ON DELETE RESTRICT,
    on_hand     NUMERIC(14,3)   NOT NULL DEFAULT 0,
    allocated   NUMERIC(14,3)   NOT NULL DEFAULT 0,
    available   NUMERIC(14,3)   GENERATED ALWAYS AS (on_hand - allocated) STORED,
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT inventory_balances_nonneg      CHECK (on_hand >= 0 AND allocated >= 0),
    CONSTRAINT inventory_balances_alloc_bound CHECK (allocated <= on_hand)
);
-- Unique "slot" per product/location/batch. COALESCE folds the NULL batch into
-- a single addressable row so ON CONFLICT upserts work for untracked stock.
CREATE UNIQUE INDEX uq_inventory_balances_slot
    ON public.inventory_balances (product_id, location_id, COALESCE(batch_id, 0));
CREATE INDEX idx_inventory_balances_product  ON public.inventory_balances(product_id);
CREATE INDEX idx_inventory_balances_location ON public.inventory_balances(location_id);

-- ---------------------------------------------------------------------------
-- 5. inventory_movements  (append-only ledger; no UPDATE/DELETE ever)
-- ---------------------------------------------------------------------------
-- qty_delta sign convention: positive = added to that dimension, negative =
-- removed. receipt/adjustment/transfer_in/+pick effects on on_hand; allocate/
-- deallocate on the reservation. Interpretation is by movement_type.
CREATE TABLE public.inventory_movements (
    id              BIGSERIAL       PRIMARY KEY,
    product_id      INT             NOT NULL REFERENCES public.products(id),
    location_id     INT             NOT NULL REFERENCES public.locations(id),
    batch_id        INT             REFERENCES public.batches(id),
    qty_delta       NUMERIC(14,3)   NOT NULL,
    movement_type   TEXT            NOT NULL
                        CHECK (movement_type IN (
                            'receipt','allocate','deallocate','pick',
                            'adjustment','stocktake_variance',
                            'transfer_out','transfer_in'
                        )),
    ref_type        TEXT,           -- e.g. 'order','purchase_order','adjustment','stocktake'
    ref_id          TEXT,
    actor_id        UUID            REFERENCES public.profiles(id),
    reason          TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_movements_product ON public.inventory_movements(product_id);
CREATE INDEX idx_inventory_movements_ref     ON public.inventory_movements(ref_type, ref_id);
CREATE INDEX idx_inventory_movements_created ON public.inventory_movements(created_at);

-- ---------------------------------------------------------------------------
-- 6. order_documents  (pick slips / dispatch advices — link orders to PDFs)
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_documents (
    id              SERIAL          PRIMARY KEY,
    order_id        TEXT            NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    doc_type        TEXT            NOT NULL CHECK (doc_type IN ('pick_slip','dispatch_advice')),
    storage_path    TEXT            NOT NULL,    -- object path in the private order-documents bucket
    generated_by    UUID            REFERENCES public.profiles(id),
    generated_at    TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_documents_order ON public.order_documents(order_id);

-- ---------------------------------------------------------------------------
-- 7. pick_progress  (per-line picking record by warehouse staff)
-- ---------------------------------------------------------------------------
CREATE TABLE public.pick_progress (
    id              SERIAL          PRIMARY KEY,
    order_id        TEXT            NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    order_item_id   INT             NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
    location_id     INT             NOT NULL REFERENCES public.locations(id),
    batch_id        INT             REFERENCES public.batches(id),
    picked_qty      INT             NOT NULL CHECK (picked_qty > 0),
    picked_by       UUID            REFERENCES public.profiles(id),
    picked_at       TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_pick_progress_order      ON public.pick_progress(order_id);
CREATE INDEX idx_pick_progress_order_item ON public.pick_progress(order_item_id);

-- =============================================================================
-- 8. Seed the single default warehouse + backfill balances from products
-- =============================================================================
-- One statement: create the warehouse and mirror each product's current
-- inventory into a NULL-batch balance row at that warehouse.
WITH wh AS (
    INSERT INTO public.locations (parent_id, kind, code, name, materialized_path)
    VALUES (NULL, 'WAREHOUSE', 'MAIN', 'Main Warehouse', 'MAIN')
    RETURNING id
)
INSERT INTO public.inventory_balances (product_id, location_id, batch_id, on_hand, allocated)
SELECT p.id, wh.id, NULL, GREATEST(p.inventory, 0), 0
FROM public.products p, wh;

-- =============================================================================
-- 9. RPCs  (SECURITY DEFINER, service_role-EXECUTE only)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 9a. inv_default_location() — the single v1 warehouse
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_default_location()
RETURNS INT
LANGUAGE sql
STABLE
AS $$
    SELECT id FROM public.locations
    WHERE kind = 'WAREHOUSE' AND is_active
    ORDER BY id
    LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 9b. inv_recompute_product_cache(product_id) — products.inventory = SUM(on_hand)
-- ---------------------------------------------------------------------------
-- Internal helper; only the inv_* RPCs call it (inside their own txn).
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
    ), 0)
    WHERE p.id = p_product_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9c. inv_apply_leg(...) — apply ONE balance change + ledger row atomically
-- ---------------------------------------------------------------------------
-- Internal helper. Upserts the slot with the given on_hand/allocated deltas
-- (CHECK constraints are the oversell/over-allocate backstop), writes the
-- ledger row, and refreshes the product cache. Not granted to anyone; called
-- only by the higher-level RPCs below.
CREATE OR REPLACE FUNCTION public.inv_apply_leg(
    p_product_id    INT,
    p_location_id   INT,
    p_batch_id      INT,
    p_onhand_delta  NUMERIC,
    p_alloc_delta   NUMERIC,
    p_movement_type TEXT,
    p_actor         UUID,
    p_ref_type      TEXT,
    p_ref_id        TEXT,
    p_reason        TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- UPDATE-first so CHECK constraints validate the FINAL row, not the bare
    -- delta. (A pure 'allocate' leg is (on_hand 0, allocated +n) which would
    -- trip allocated<=on_hand if inserted as a candidate row before ON CONFLICT
    -- could fold it into the existing slot.) Reserve/pick/deallocate always
    -- target an existing slot; only receipt may create one, with valid values.
    UPDATE public.inventory_balances
        SET on_hand   = on_hand   + p_onhand_delta,
            allocated = allocated + p_alloc_delta,
            updated_at = now()
        WHERE product_id = p_product_id
          AND location_id = p_location_id
          AND COALESCE(batch_id, 0) = COALESCE(p_batch_id, 0);

    IF NOT FOUND THEN
        INSERT INTO public.inventory_balances (product_id, location_id, batch_id, on_hand, allocated)
        VALUES (p_product_id, p_location_id, p_batch_id, p_onhand_delta, p_alloc_delta)
        ON CONFLICT (product_id, location_id, COALESCE(batch_id, 0)) DO UPDATE
            SET on_hand   = public.inventory_balances.on_hand   + EXCLUDED.on_hand,
                allocated = public.inventory_balances.allocated + EXCLUDED.allocated,
                updated_at = now();
    END IF;

    INSERT INTO public.inventory_movements
        (product_id, location_id, batch_id, qty_delta, movement_type, ref_type, ref_id, actor_id, reason)
    VALUES
        (p_product_id, p_location_id, p_batch_id,
         CASE WHEN p_movement_type IN ('allocate','deallocate') THEN p_alloc_delta ELSE p_onhand_delta END,
         p_movement_type, p_ref_type, p_ref_id, p_actor, p_reason);

    PERFORM public.inv_recompute_product_cache(p_product_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9d. inv_reserve_order(order_id, items) — reserve on placement
-- ---------------------------------------------------------------------------
-- items: jsonb array of { "product_id": int, "quantity": number }.
-- Greedily raises `allocated` across the product's FIFO balance rows at the
-- default warehouse. Raises INSUFFICIENT_STOCK (ERRCODE P0001) if availability
-- can't cover a line — the whole txn rolls back.
-- p_allow_partial: when false (default, e.g. web orders) any line that can't be
-- fully reserved raises INSUFFICIENT_STOCK and rolls the whole txn back. When
-- true (inbound-PO approval, which may knowingly proceed on short stock) it
-- reserves whatever is available per line and silently backorders the rest.
CREATE OR REPLACE FUNCTION public.inv_reserve_order(
    p_order_id      TEXT,
    p_items         JSONB,
    p_actor         UUID DEFAULT NULL,
    p_allow_partial BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc       INT := public.inv_default_location();
    v_item      JSONB;
    v_pid       INT;
    v_qty       NUMERIC;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_row       RECORD;
BEGIN
    IF v_loc IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_pid := (v_item->>'product_id')::INT;
        v_qty := (v_item->>'quantity')::NUMERIC;
        v_remaining := v_qty;

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

        IF v_remaining > 0 AND NOT p_allow_partial THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % short by %', v_pid, v_remaining
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9e. inv_release_reservation(order_id) — cancel before/after partial pick
-- ---------------------------------------------------------------------------
-- Releases the still-reserved remainder for each order line (ordered qty minus
-- already-picked) by lowering `allocated` FIFO across the product's rows.
CREATE OR REPLACE FUNCTION public.inv_release_reservation(
    p_order_id  TEXT,
    p_actor     UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc       INT := public.inv_default_location();
    v_line      RECORD;
    v_remaining NUMERIC;
    v_take      NUMERIC;
    v_row       RECORD;
BEGIN
    FOR v_line IN
        SELECT oi.product_id,
               oi.quantity
                 - COALESCE((SELECT SUM(pp.picked_qty) FROM public.pick_progress pp
                             WHERE pp.order_item_id = oi.id), 0) AS reserved_remaining
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
    LOOP
        v_remaining := GREATEST(v_line.reserved_remaining, 0);
        CONTINUE WHEN v_remaining <= 0;

        FOR v_row IN
            SELECT id, batch_id, allocated
            FROM public.inventory_balances
            WHERE product_id = v_line.product_id AND location_id = v_loc AND allocated > 0
            ORDER BY id
            FOR UPDATE
        LOOP
            EXIT WHEN v_remaining <= 0;
            v_take := LEAST(v_remaining, v_row.allocated);
            PERFORM public.inv_apply_leg(
                v_line.product_id, v_loc, v_row.batch_id, 0, -v_take,
                'deallocate', p_actor, 'order', p_order_id, 'reservation released');
            v_remaining := v_remaining - v_take;
        END LOOP;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9f. inv_pick_order_line(order_item_id, picked_qty) — decrement on pick
-- ---------------------------------------------------------------------------
-- Lowers on_hand AND allocated by picked_qty across the product's FIFO rows
-- that still carry a reservation, records pick_progress, and reports whether
-- the line and the whole order are now fully picked (so the caller can advance
-- the order status to 'picked').
CREATE OR REPLACE FUNCTION public.inv_pick_order_line(
    p_order_item_id INT,
    p_picked_qty    NUMERIC,
    p_actor         UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc           INT := public.inv_default_location();
    v_item          RECORD;
    v_already       NUMERIC;
    v_remaining     NUMERIC;
    v_take          NUMERIC;
    v_row           RECORD;
    v_last_batch    INT;
    v_order_done    BOOLEAN;
BEGIN
    IF p_picked_qty <= 0 THEN
        RAISE EXCEPTION 'INVALID_QTY: picked_qty must be positive' USING ERRCODE = 'P0001';
    END IF;

    SELECT oi.id, oi.order_id, oi.product_id, oi.quantity
    INTO v_item
    FROM public.order_items oi
    WHERE oi.id = p_order_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_ITEM_NOT_FOUND: %', p_order_item_id USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(SUM(picked_qty), 0) INTO v_already
    FROM public.pick_progress WHERE order_item_id = p_order_item_id;

    IF v_already + p_picked_qty > v_item.quantity THEN
        RAISE EXCEPTION 'OVER_PICK: line % would exceed ordered qty', p_order_item_id
            USING ERRCODE = 'P0001';
    END IF;

    v_remaining := p_picked_qty;
    FOR v_row IN
        SELECT b.id, b.batch_id, b.allocated, b.on_hand
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = v_item.product_id AND b.location_id = v_loc AND b.allocated > 0
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.allocated, v_row.on_hand);
        CONTINUE WHEN v_take <= 0;
        PERFORM public.inv_apply_leg(
            v_item.product_id, v_loc, v_row.batch_id, -v_take, -v_take,
            'pick', p_actor, 'order', v_item.order_id, NULL);
        v_last_batch := v_row.batch_id;
        v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_ALLOCATED: product % short by % at pick',
            v_item.product_id, v_remaining USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.pick_progress
        (order_id, order_item_id, location_id, batch_id, picked_qty, picked_by)
    VALUES
        (v_item.order_id, p_order_item_id, v_loc, v_last_batch, p_picked_qty::INT, p_actor);

    -- Is every line of the order now fully picked?
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

-- ---------------------------------------------------------------------------
-- 9g. inv_receive_stock(lines) — goods receipt (stock IN)
-- ---------------------------------------------------------------------------
-- lines: jsonb array of {
--   product_id, quantity, lot_code?, expiry_date?, barcode?, supplier_id?, po_id?
-- }. lot_code present => upsert a tracked batch and receive into it; otherwise
-- receive into the untracked (NULL-batch) slot.
CREATE OR REPLACE FUNCTION public.inv_receive_stock(
    p_lines JSONB,
    p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc       INT := public.inv_default_location();
    v_line      JSONB;
    v_pid       INT;
    v_qty       NUMERIC;
    v_lot       TEXT;
    v_batch_id  INT;
    v_count     INT := 0;
BEGIN
    IF v_loc IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_pid := (v_line->>'product_id')::INT;
        v_qty := (v_line->>'quantity')::NUMERIC;
        v_lot := NULLIF(v_line->>'lot_code', '');
        v_batch_id := NULL;

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_QTY: receive quantity must be positive' USING ERRCODE = 'P0001';
        END IF;

        IF v_lot IS NOT NULL THEN
            INSERT INTO public.batches (product_id, lot_code, expiry_date, barcode, supplier_id)
            VALUES (
                v_pid, v_lot,
                NULLIF(v_line->>'expiry_date','')::DATE,
                NULLIF(v_line->>'barcode',''),
                NULLIF(v_line->>'supplier_id','')::INT
            )
            ON CONFLICT (product_id, lot_code) DO UPDATE
                SET expiry_date = COALESCE(EXCLUDED.expiry_date, public.batches.expiry_date),
                    barcode     = COALESCE(EXCLUDED.barcode, public.batches.barcode)
            RETURNING id INTO v_batch_id;
        END IF;

        PERFORM public.inv_apply_leg(
            v_pid, v_loc, v_batch_id, v_qty, 0,
            'receipt', p_actor, 'purchase_order', NULLIF(v_line->>'po_id',''), NULL);
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('lines_received', v_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9h. Lock down EXECUTE — service_role only (Edge Functions)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.inv_recompute_product_cache(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_apply_leg(INT,INT,INT,NUMERIC,NUMERIC,TEXT,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_reserve_order(TEXT,JSONB,UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_release_reservation(TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_pick_order_line(INT,NUMERIC,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inv_receive_stock(JSONB,UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inv_reserve_order(TEXT,JSONB,UUID,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_release_reservation(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_pick_order_line(INT,NUMERIC,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.inv_receive_stock(JSONB,UUID) TO service_role;
-- inv_default_location is read-only/harmless; leave it callable by service_role too.
GRANT EXECUTE ON FUNCTION public.inv_default_location() TO service_role;

-- =============================================================================
-- 10. Row Level Security
-- =============================================================================
-- Writes for all six tables go exclusively through the service_role (Edge
-- Functions / RPCs), which bypasses RLS. authenticated gets SELECT only, gated
-- by role. Customers never read inventory tables directly — they see aggregate
-- availability through products.inventory (the cache) on the existing surface.

ALTER TABLE public.locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pick_progress        ENABLE ROW LEVEL SECURITY;

-- locations / batches / inventory_balances: staff (incl. Warehouse + reps) read.
CREATE POLICY "locations_select_staff"
    ON public.locations FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN
        ('Admin','Manager','Warehouse','Field Sales Rep','Office Sales Rep'));

CREATE POLICY "batches_select_staff"
    ON public.batches FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN
        ('Admin','Manager','Warehouse','Field Sales Rep','Office Sales Rep'));

CREATE POLICY "inventory_balances_select_staff"
    ON public.inventory_balances FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN
        ('Admin','Manager','Warehouse','Field Sales Rep','Office Sales Rep'));

-- movements / order_documents / pick_progress: operations-only (no reps).
CREATE POLICY "inventory_movements_select_ops"
    ON public.inventory_movements FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

CREATE POLICY "order_documents_select_ops"
    ON public.order_documents FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

CREATE POLICY "pick_progress_select_ops"
    ON public.pick_progress FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

-- Table grants: SELECT only for authenticated (RLS narrows rows). No write
-- grants — service_role bypasses RLS for all mutations.
GRANT SELECT ON
    public.locations,
    public.batches,
    public.inventory_balances,
    public.inventory_movements,
    public.order_documents,
    public.pick_progress
TO authenticated;

-- =============================================================================
-- 11. Realtime — balances + pick progress + documents drive live UI
-- =============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_balances;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pick_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_documents;

-- =============================================================================
-- 12. Nightly reconciliation — heal any cache drift (safety net)
-- =============================================================================
-- The inv_* RPCs keep products.inventory == SUM(on_hand) in-txn; this is a
-- belt-and-suspenders recompute in case anything ever writes balances out of
-- band. Guarded by pg_cron existence + idempotent (unschedule then schedule),
-- mirroring the 00026 cleanup job.
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
                ), 0)
                WHERE p.inventory <> COALESCE((
                    SELECT SUM(b.on_hand) FROM public.inventory_balances b
                    WHERE b.product_id = p.id
                ), 0)
            $cron$
        );
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT * FROM public.locations;                          -- 1 MAIN warehouse
--   SELECT product_id, on_hand, allocated, available
--     FROM public.inventory_balances ORDER BY product_id LIMIT 5;
--   -- reserve 3 of product 1, then check available dropped but on_hand same:
--   SELECT public.inv_reserve_order('ORD-TEST', '[{"product_id":1,"quantity":3}]');
-- =============================================================================
