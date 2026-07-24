-- =============================================================================
-- Handling units (pallets & cartons) — Phase 2 of QR tracking
-- Migration: 00075_handling_units.sql
-- =============================================================================
-- Gives physical stock a container identity: a pallet or carton with its own
-- scannable license-plate code, so "where is this pallet?" and "what is on it?"
-- are answerable, and so a whole plate can be moved with one scan.
--
-- THE LOAD-BEARING DECISION -------------------------------------------------
-- A handling unit is an INVENTORY DIMENSION, not a sidecar table. There is no
-- hu_contents table. `handling_unit_id` becomes a nullable 4th column on
-- inventory_balances, folded into the unique slot index exactly as batch_id
-- already is (00027):
--
--     UNIQUE (product_id, location_id, COALESCE(batch_id,0), COALESCE(handling_unit_id,0))
--
-- Therefore a plate's contents ARE its balance rows. There is no second copy of
-- the quantity to drift from the ledger, mixed-SKU plates fall out for free (one
-- plate, N rows), and a partial pick is just the existing arithmetic on a
-- narrower slot. NULL = loose/untracked stock and stays valid forever, mirroring
-- `batch_id NULL = legacy stock`.
--
-- THE HAZARD THIS MIGRATION EXISTS TO AVOID ---------------------------------
-- inv_apply_leg's UPDATE matches on (product, location, batch). Five callers
-- (inv_reserve_order, inv_pick_order_line, inv_transfer_stock,
-- inv_release_reservation, wie_convert_rack_to_levels_tx) iterate balance rows
-- `FOR UPDATE` and then call inv_apply_leg with only those three keys. The
-- moment two plates hold the same product+batch in one location, that UPDATE
-- matches BOTH rows and applies the delta TWICE — silently doubling an
-- allocation or a pick. Every one of those callers is rewritten below to pass
-- the plate of the row it actually locked. This is the single highest-risk
-- change in the QR-tracking programme; it is why they are all in one migration
-- with inv_apply_leg rather than spread across several.
--
-- inv_apply_leg is REPLACED, never overloaded: mig 00037 added a trailing arg to
-- inv_receive_stock as a new overload and created an ambiguous-function error
-- that cost real debugging. The old 11-arg signature is dropped explicitly.
--
-- wie_order_alloc_bins (00064) needs NO change — it GROUPs BY (product_id,
-- location_id) over the movements ledger and ignores columns it does not
-- select, so it already nets correctly across plates in a bin. Verified against
-- the live definition before writing this.
--
-- Apply via the Management API /database/query (the direct DB host is
-- unreachable from this box — see supabase/apply-sql.mjs).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. handling_units
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.handling_unit_code_seq;

CREATE TABLE IF NOT EXISTS public.handling_units (
    id               BIGSERIAL     PRIMARY KEY,
    -- 'HU-000123'. The prefix is a reserved namespace: 00074 asserted that no
    -- locations.code and no products.sku already occupies it, which is what
    -- keeps the bare-text scan resolver unambiguous.
    code             TEXT          NOT NULL UNIQUE,
    hu_type          TEXT          NOT NULL CHECK (hu_type IN ('pallet', 'carton')),
    -- open      = being built at the dock, not yet received
    -- stored    = holds stock
    -- empty     = fully consumed; kept for history, code never reused
    -- cancelled = abandoned before receipt
    status           TEXT          NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'stored', 'empty', 'cancelled')),
    -- Root warehouse. Denormalised so a plate can be listed per site without
    -- walking the location tree on every query.
    warehouse_id     INT           REFERENCES public.locations(id) ON DELETE RESTRICT,
    -- Current whereabouts. Maintained by hu_recompute() from the balance rows —
    -- never set by hand, so it cannot disagree with the stock it describes.
    location_id      INT           REFERENCES public.locations(id) ON DELETE RESTRICT,
    goods_receipt_id BIGINT        REFERENCES public.goods_receipts(id) ON DELETE SET NULL,
    -- False until a physical sticker exists. The 00076 backfill mints plates for
    -- stock that has never been labelled; this is what makes that print backlog
    -- visible instead of pretending the warehouse is fully labelled.
    label_printed    BOOLEAN       NOT NULL DEFAULT false,
    created_by       UUID          REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handling_units_location  ON public.handling_units(location_id);
CREATE INDEX IF NOT EXISTS idx_handling_units_warehouse ON public.handling_units(warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_handling_units_receipt   ON public.handling_units(goods_receipt_id);
CREATE INDEX IF NOT EXISTS idx_handling_units_unlabelled
    ON public.handling_units(warehouse_id) WHERE label_printed = false;

COMMENT ON TABLE public.handling_units IS
    'Pallets and cartons as tracked containers ("license plates"). Contents are '
    'NOT stored here — they are the inventory_balances rows carrying this id, so '
    'plate contents can never drift from the ledger.';

/** Next license-plate code. Zero-padded so codes sort lexically and print at a
 *  fixed width on a label. */
CREATE OR REPLACE FUNCTION public.hu_next_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
    SELECT 'HU-' || LPAD(nextval('public.handling_unit_code_seq')::TEXT, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- 2. The inventory dimension
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_balances
    ADD COLUMN IF NOT EXISTS handling_unit_id BIGINT
        REFERENCES public.handling_units(id) ON DELETE RESTRICT;

ALTER TABLE public.inventory_movements
    ADD COLUMN IF NOT EXISTS handling_unit_id BIGINT
        REFERENCES public.handling_units(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_balances.handling_unit_id IS
    'The pallet/carton this quantity sits on. NULL = loose stock not on any '
    'tracked container (all legacy stock, and any bulk-warehouse stock). Part of '
    'the unique slot key via COALESCE(...,0), exactly like batch_id.';

-- Rebuild the slot key. While every handling_unit_id is still NULL, COALESCE
-- makes this index behave identically to the one it replaces, so the swap
-- cannot introduce a duplicate.
DROP INDEX IF EXISTS public.uq_inventory_balances_slot;
CREATE UNIQUE INDEX uq_inventory_balances_slot
    ON public.inventory_balances
       (product_id, location_id, COALESCE(batch_id, 0), COALESCE(handling_unit_id, 0));

CREATE INDEX IF NOT EXISTS idx_inventory_balances_hu
    ON public.inventory_balances(handling_unit_id) WHERE handling_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_hu
    ON public.inventory_movements(handling_unit_id) WHERE handling_unit_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. hu_recompute — plate state derived from its balance rows
-- ---------------------------------------------------------------------------
-- Called by inv_apply_leg after every leg that names a plate. Keeps
-- location_id/status a pure function of the stock, so they cannot lie.
CREATE OR REPLACE FUNCTION public.hu_recompute(p_hu_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows     INT;
    v_locs     INT;
    v_location INT;
    v_status   TEXT;
BEGIN
    IF p_hu_id IS NULL THEN RETURN; END IF;

    SELECT COUNT(*), COUNT(DISTINCT location_id), MIN(location_id)
      INTO v_rows, v_locs, v_location
      FROM public.inventory_balances
     WHERE handling_unit_id = p_hu_id AND on_hand > 0;

    IF v_rows = 0 THEN
        -- Nothing left on the plate. Keep the row (history, and the code is
        -- never reused) but stop calling it stored. An 'open' plate that has
        -- not been received yet must NOT be flipped to 'empty'.
        UPDATE public.handling_units
           SET status = CASE WHEN status = 'open' THEN 'open' ELSE 'empty' END,
               updated_at = now()
         WHERE id = p_hu_id;
        RETURN;
    END IF;

    -- A plate is one physical object, so it is in exactly one place. More than
    -- one distinct location means something moved part of a plate without
    -- splitting it — leave location_id alone rather than pick a winner, and let
    -- the reconciliation view surface it.
    v_status := 'stored';
    IF v_locs > 1 THEN
        UPDATE public.handling_units
           SET status = v_status, updated_at = now()
         WHERE id = p_hu_id;
    ELSE
        UPDATE public.handling_units
           SET status = v_status, location_id = v_location, updated_at = now()
         WHERE id = p_hu_id;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. inv_apply_leg — REPLACED (not overloaded) with the plate dimension
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.inv_apply_leg(
    INTEGER, INTEGER, INTEGER, NUMERIC, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER
);

CREATE OR REPLACE FUNCTION public.inv_apply_leg(
    p_product_id       INT,
    p_location_id      INT,
    p_batch_id         INT,
    p_onhand_delta     NUMERIC,
    p_alloc_delta      NUMERIC,
    p_movement_type    TEXT,
    p_actor            UUID,
    p_ref_type         TEXT,
    p_ref_id           TEXT,
    p_reason           TEXT,
    p_supplier_id      INT DEFAULT NULL,
    p_handling_unit_id BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- UPDATE-first so CHECK constraints validate the FINAL row, not the bare
    -- delta. The handling-unit predicate is what stops a leg aimed at one plate
    -- from landing on every plate holding the same product+batch in this bin.
    UPDATE public.inventory_balances
        SET on_hand   = on_hand   + p_onhand_delta,
            allocated = allocated + p_alloc_delta,
            updated_at = now()
        WHERE product_id = p_product_id
          AND location_id = p_location_id
          AND COALESCE(batch_id, 0) = COALESCE(p_batch_id, 0)
          AND COALESCE(handling_unit_id, 0) = COALESCE(p_handling_unit_id, 0);

    IF NOT FOUND THEN
        INSERT INTO public.inventory_balances
            (product_id, location_id, batch_id, handling_unit_id, on_hand, allocated)
        VALUES
            (p_product_id, p_location_id, p_batch_id, p_handling_unit_id,
             p_onhand_delta, p_alloc_delta)
        ON CONFLICT (product_id, location_id, COALESCE(batch_id, 0), COALESCE(handling_unit_id, 0))
        DO UPDATE
            SET on_hand   = public.inventory_balances.on_hand   + EXCLUDED.on_hand,
                allocated = public.inventory_balances.allocated + EXCLUDED.allocated,
                updated_at = now();
    END IF;

    INSERT INTO public.inventory_movements
        (product_id, location_id, batch_id, qty_delta, movement_type,
         ref_type, ref_id, actor_id, reason, supplier_id, handling_unit_id)
    VALUES
        (p_product_id, p_location_id, p_batch_id,
         CASE WHEN p_movement_type IN ('allocate','deallocate') THEN p_alloc_delta ELSE p_onhand_delta END,
         p_movement_type, p_ref_type, p_ref_id, p_actor, p_reason, p_supplier_id, p_handling_unit_id);

    PERFORM public.inv_recompute_product_cache(p_product_id);
    PERFORM public.hu_recompute(p_handling_unit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.inv_apply_leg(
    INT, INT, INT, NUMERIC, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, INT, BIGINT
) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Row-iterating callers — each must pass the plate of the row it locked
-- ---------------------------------------------------------------------------

-- 5a. inv_reserve_order
CREATE OR REPLACE FUNCTION public.inv_reserve_order(
    p_order_id      TEXT,
    p_items         JSONB,
    p_location_pref INT[] DEFAULT NULL,
    p_actor         UUID DEFAULT NULL,
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
                SELECT b.id, b.location_id, b.batch_id, b.handling_unit_id, b.available
                FROM public.inventory_balances b
                LEFT JOIN public.batches bt ON bt.id = b.batch_id
                WHERE b.product_id = v_pid
                  AND b.location_id IN (SELECT location_id FROM public.inv_warehouse_draw_locations(v_loc))
                  AND b.available > 0
                ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
                FOR UPDATE OF b
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_take := LEAST(v_remaining, v_row.available);
                PERFORM public.inv_apply_leg(
                    v_pid, v_row.location_id, v_row.batch_id, 0, v_take,
                    'allocate', p_actor, 'order', p_order_id, NULL,
                    NULL, v_row.handling_unit_id);
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

-- 5b. inv_pick_order_line
CREATE OR REPLACE FUNCTION public.inv_pick_order_line(
    p_order_item_id INT,
    p_picked_qty    NUMERIC,
    p_location_id   INT DEFAULT NULL,
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
        SELECT b.id, b.batch_id, b.handling_unit_id, b.allocated, b.on_hand
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
            'pick', p_actor, 'order', v_item.order_id, NULL,
            NULL, v_row.handling_unit_id);
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

-- 5c. inv_transfer_stock — the plate TRAVELS with its stock
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
        SELECT b.id, b.batch_id, b.handling_unit_id, b.available
        FROM public.inventory_balances b
        LEFT JOIN public.batches bt ON bt.id = b.batch_id
        WHERE b.product_id = p_product_id AND b.location_id = p_from_loc AND b.available > 0
        ORDER BY bt.expiry_date NULLS LAST, bt.received_at NULLS FIRST, b.id
        FOR UPDATE OF b
    LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_row.available);
        CONTINUE WHEN v_take <= 0;
        -- Both legs carry the SAME plate: moving a pallet does not change which
        -- pallet it is. This is also exactly what whole-plate putaway needs —
        -- transferring the plate's stock relocates the plate, and hu_recompute
        -- then follows its balance rows to the destination.
        PERFORM public.inv_apply_leg(
            p_product_id, p_from_loc, v_row.batch_id, -v_take, 0,
            'transfer_out', p_actor, 'transfer', NULL, p_reason,
            NULL, v_row.handling_unit_id);
        PERFORM public.inv_apply_leg(
            p_product_id, p_to_loc, v_row.batch_id, v_take, 0,
            'transfer_in', p_actor, 'transfer', NULL, p_reason,
            NULL, v_row.handling_unit_id);
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

-- 5d. inv_release_reservation
CREATE OR REPLACE FUNCTION public.inv_release_reservation(
    p_order_id    TEXT,
    p_location_id INT DEFAULT NULL,
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
            SELECT id, location_id, batch_id, handling_unit_id, allocated
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
                'deallocate', p_actor, 'order', p_order_id, 'reservation released',
                NULL, v_row.handling_unit_id);
            v_remaining := v_remaining - v_take;
        END LOOP;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. inv_receive_stock — a line may name the plate it lands on
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_receive_stock(
    p_lines   JSONB,
    p_actor   UUID DEFAULT NULL,
    p_receipt JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc        INT := COALESCE(
        NULLIF(p_receipt->>'location_id', '')::INT,
        public.inv_default_location()
    );
    v_line       JSONB;
    v_pid        INT;
    v_qty        NUMERIC;
    v_lot        TEXT;
    v_batch_id   INT;
    v_count      INT := 0;
    v_header_sup INT;
    v_eff_sup    INT;
    v_receipt_id BIGINT;
    v_hu_id      BIGINT;
BEGIN
    IF v_loc IS NULL THEN
        RAISE EXCEPTION 'NO_WAREHOUSE: no active warehouse configured' USING ERRCODE = 'P0001';
    END IF;

    v_header_sup := NULLIF(p_receipt->>'supplier_id', '')::INT;

    INSERT INTO public.goods_receipts
        (location_id, supplier_id, reference, received_date, received_by, created_by)
    VALUES (
        v_loc,
        v_header_sup,
        NULLIF(p_receipt->>'reference', ''),
        COALESCE(NULLIF(p_receipt->>'received_date', '')::DATE, CURRENT_DATE),
        NULLIF(p_receipt->>'received_by', '')::UUID,
        p_actor
    )
    RETURNING id INTO v_receipt_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_pid := (v_line->>'product_id')::INT;
        v_qty := (v_line->>'quantity')::NUMERIC;
        v_lot := NULLIF(v_line->>'lot_code', '');
        v_eff_sup := COALESCE(NULLIF(v_line->>'supplier_id', '')::INT, v_header_sup);
        v_hu_id := NULLIF(v_line->>'handling_unit_id', '')::BIGINT;
        v_batch_id := NULL;

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_QTY: receive quantity must be positive' USING ERRCODE = 'P0001';
        END IF;

        -- A named plate must exist and must not already be closed. Receiving
        -- onto a cancelled plate would create stock nobody can find.
        IF v_hu_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.handling_units
                 WHERE id = v_hu_id AND status IN ('open', 'stored')
            ) THEN
                RAISE EXCEPTION 'INVALID_HANDLING_UNIT: plate % is unknown or closed', v_hu_id
                    USING ERRCODE = 'P0001';
            END IF;
        END IF;

        IF v_lot IS NOT NULL THEN
            INSERT INTO public.batches (product_id, lot_code, expiry_date, barcode, supplier_id)
            VALUES (
                v_pid, v_lot,
                NULLIF(v_line->>'expiry_date','')::DATE,
                NULLIF(v_line->>'barcode',''),
                v_eff_sup
            )
            ON CONFLICT (product_id, lot_code) DO UPDATE
                SET expiry_date = COALESCE(EXCLUDED.expiry_date, public.batches.expiry_date),
                    barcode     = COALESCE(EXCLUDED.barcode, public.batches.barcode),
                    supplier_id = COALESCE(public.batches.supplier_id, EXCLUDED.supplier_id)
            RETURNING id INTO v_batch_id;
        END IF;

        PERFORM public.inv_apply_leg(
            v_pid, v_loc, v_batch_id, v_qty, 0,
            'receipt', p_actor, 'goods_receipt', v_receipt_id::TEXT, NULL,
            v_eff_sup, v_hu_id);

        -- Bind the plate to this receipt and site the first time it is used.
        IF v_hu_id IS NOT NULL THEN
            UPDATE public.handling_units
               SET goods_receipt_id = COALESCE(goods_receipt_id, v_receipt_id),
                   warehouse_id     = COALESCE(warehouse_id, public.inv_root_warehouse(v_loc)),
                   updated_at       = now()
             WHERE id = v_hu_id;
        END IF;

        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('lines_received', v_count, 'receipt_id', v_receipt_id, 'location_id', v_loc);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. inv_adjust_stock — plate-aware, and correct once plates exist
-- ---------------------------------------------------------------------------
-- This one does NOT iterate: it targets a slot directly. Left unchanged it
-- would, after the 00076 backfill, aim at the COALESCE(hu,0)=0 slot — which no
-- longer exists — and INSERT a second, loose row beside the plate instead of
-- adjusting the stock the operator is looking at. Shrinkage would appear not to
-- apply.
--
-- New behaviour:
--   * explicit plate            -> that exact plate
--   * NULL + positive delta     -> the loose slot (found/unlabelled stock)
--   * NULL + negative delta     -> consume across the slot's plates, oldest
--                                  first, loose stock first
--
-- The old 7-arg signature is DROPPED first. Postgres identifies a function by
-- (name, argument types), so CREATE OR REPLACE with one extra parameter creates
-- a second overload rather than replacing — and a 7-argument call would then be
-- ambiguous. This is the identical trap mig 00037 fell into with
-- inv_receive_stock; a rollback-isolated dry run of this migration confirmed two
-- signatures existed until this DROP was added.
DROP FUNCTION IF EXISTS public.inv_adjust_stock(
    INTEGER, INTEGER, NUMERIC, TEXT, UUID, BIGINT, TEXT
);

CREATE OR REPLACE FUNCTION public.inv_adjust_stock(
    p_product_id       INT,
    p_location_id      INT,
    p_qty_delta        NUMERIC,
    p_reason           TEXT,
    p_actor            UUID,
    p_batch_id         BIGINT DEFAULT NULL,
    p_movement_type    TEXT DEFAULT 'adjustment',
    p_handling_unit_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id         INT := p_batch_id::INT;
    v_before_on_hand   NUMERIC;
    v_before_allocated NUMERIC;
    v_after_on_hand    NUMERIC;
    v_after_allocated  NUMERIC;
    v_remaining        NUMERIC;
    v_take             NUMERIC;
    v_row              RECORD;
BEGIN
    IF p_movement_type NOT IN ('adjustment', 'stocktake_variance') THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT: movement_type must be adjustment or stocktake_variance, got %', p_movement_type
            USING ERRCODE = 'P0001';
    END IF;

    IF p_qty_delta = 0 THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT: quantity delta must be non-zero' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = p_location_id AND is_active) THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT: location % not found or inactive', p_location_id USING ERRCODE = 'P0001';
    END IF;

    IF v_batch_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.batches WHERE id = v_batch_id AND product_id = p_product_id
    ) THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT: batch % does not belong to product %', v_batch_id, p_product_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Before-snapshot across the WHOLE slot (every plate), so the audit entry
    -- reports the stock the operator can see rather than one plate's share.
    SELECT COALESCE(SUM(on_hand), 0), COALESCE(SUM(allocated), 0)
      INTO v_before_on_hand, v_before_allocated
      FROM public.inventory_balances
     WHERE product_id = p_product_id
       AND location_id = p_location_id
       AND COALESCE(batch_id, 0) = COALESCE(v_batch_id, 0)
       AND (p_handling_unit_id IS NULL OR handling_unit_id = p_handling_unit_id);

    BEGIN
        IF p_handling_unit_id IS NOT NULL OR p_qty_delta > 0 THEN
            PERFORM public.inv_apply_leg(
                p_product_id, p_location_id, v_batch_id, p_qty_delta, 0,
                p_movement_type, p_actor, 'adjustment', NULL, p_reason,
                NULL, p_handling_unit_id);
        ELSE
            -- Negative, no plate named: spread the shrinkage over the plates
            -- actually holding this slot. Loose stock (NULL plate) is consumed
            -- first, then oldest plate first.
            v_remaining := -p_qty_delta;
            FOR v_row IN
                SELECT handling_unit_id, on_hand
                  FROM public.inventory_balances
                 WHERE product_id = p_product_id
                   AND location_id = p_location_id
                   AND COALESCE(batch_id, 0) = COALESCE(v_batch_id, 0)
                   AND on_hand > 0
                 ORDER BY handling_unit_id NULLS FIRST
                 FOR UPDATE
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_take := LEAST(v_remaining, v_row.on_hand);
                PERFORM public.inv_apply_leg(
                    p_product_id, p_location_id, v_batch_id, -v_take, 0,
                    p_movement_type, p_actor, 'adjustment', NULL, p_reason,
                    NULL, v_row.handling_unit_id);
                v_remaining := v_remaining - v_take;
            END LOOP;

            IF v_remaining > 0 THEN
                RAISE EXCEPTION 'ADJUSTMENT_BELOW_ALLOCATED: not enough stock at that location to reduce by %',
                    -p_qty_delta USING ERRCODE = 'P0001';
            END IF;
        END IF;
    EXCEPTION
        WHEN check_violation THEN
            RAISE EXCEPTION 'ADJUSTMENT_BELOW_ALLOCATED: adjustment would push on-hand below the reserved quantity'
                USING ERRCODE = 'P0001';
    END;

    SELECT COALESCE(SUM(on_hand), 0), COALESCE(SUM(allocated), 0)
      INTO v_after_on_hand, v_after_allocated
      FROM public.inventory_balances
     WHERE product_id = p_product_id
       AND location_id = p_location_id
       AND COALESCE(batch_id, 0) = COALESCE(v_batch_id, 0)
       AND (p_handling_unit_id IS NULL OR handling_unit_id = p_handling_unit_id);

    RETURN jsonb_build_object(
        'product_id',     p_product_id,
        'location_id',    p_location_id,
        'batch_id',       v_batch_id,
        'qty_delta',      p_qty_delta,
        'before_on_hand', v_before_on_hand,
        'after_on_hand',  v_after_on_hand,
        'before_allocated', v_before_allocated,
        'after_allocated',  v_after_allocated
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. wie_convert_rack_to_levels_tx — same iterate-and-apply hazard
-- ---------------------------------------------------------------------------
-- Only its stock-moving loop changes: each leg now names the plate of the row
-- it locked, so converting a rack that holds several pallets moves each one
-- once instead of applying every delta to all of them.
-- Patched in place rather than re-declared in full: 00072 owns this function's
-- 167 lines of level-creation logic, and copying them here would fork it. The
-- three edits below are anchored on single lines, and every one is ASSERTED —
-- replace() returning the string unchanged is a silent no-op, which on this
-- particular function would mean rack conversion doubles stock across plates
-- with no error at all.
DO $$
DECLARE
    v_def  TEXT;
    v_orig TEXT;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_orig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'wie_convert_rack_to_levels_tx';

    IF v_orig IS NULL THEN
        RAISE EXCEPTION 'MISSING_FUNCTION: wie_convert_rack_to_levels_tx not found (expected from 00072)'
            USING ERRCODE = 'P0001';
    END IF;

    -- Already patched (re-run of this migration)? Nothing to do.
    IF position('v_bal.handling_unit_id' IN v_orig) > 0 THEN
        RAISE NOTICE 'wie_convert_rack_to_levels_tx already plate-aware — skipping';
        RETURN;
    END IF;

    v_def := v_orig;

    -- (1) Widen the cursor so the plate is available in the loop.
    v_def := replace(v_def,
        'SELECT product_id, batch_id, on_hand, allocated',
        'SELECT product_id, batch_id, handling_unit_id, on_hand, allocated');

    -- (2)/(3) Name the plate on each transfer leg. 'transfer_out' / 'transfer_in'
    -- make these two lines individually unique.
    v_def := replace(v_def,
        '''transfer_out'', p_actor, ''rack_conversion'', p_location_id::TEXT, ''rack converted to levels'');',
        '''transfer_out'', p_actor, ''rack_conversion'', p_location_id::TEXT, ''rack converted to levels'', NULL, v_bal.handling_unit_id);');
    v_def := replace(v_def,
        '''transfer_in'', p_actor, ''rack_conversion'', p_location_id::TEXT, ''rack converted to levels'');',
        '''transfer_in'', p_actor, ''rack_conversion'', p_location_id::TEXT, ''rack converted to levels'', NULL, v_bal.handling_unit_id);');

    -- Assert all three landed, or refuse to ship a half-patched function.
    IF position('handling_unit_id, on_hand, allocated' IN v_def) = 0 THEN
        RAISE EXCEPTION 'PATCH_FAILED: could not widen the balance cursor in wie_convert_rack_to_levels_tx'
            USING ERRCODE = 'P0001';
    END IF;
    IF (length(v_def) - length(replace(v_def, 'NULL, v_bal.handling_unit_id', ''))) / 28 <> 2 THEN
        RAISE EXCEPTION 'PATCH_FAILED: expected exactly 2 patched transfer legs in wie_convert_rack_to_levels_tx'
            USING ERRCODE = 'P0001';
    END IF;

    EXECUTE v_def;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Reconciliation view — a plate should never be in two places
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.handling_unit_anomalies AS
    SELECT hu.id,
           hu.code,
           hu.status,
           COUNT(DISTINCT b.location_id) AS distinct_locations,
           SUM(b.on_hand)                AS total_on_hand
      FROM public.handling_units hu
      JOIN public.inventory_balances b ON b.handling_unit_id = hu.id
     WHERE b.on_hand > 0
     GROUP BY hu.id, hu.code, hu.status
    HAVING COUNT(DISTINCT b.location_id) > 1;

COMMENT ON VIEW public.handling_unit_anomalies IS
    'Plates whose stock sits in more than one location — physically impossible '
    'for a single container, so a non-empty result means a partial move escaped '
    'without splitting the plate. Expected to stay empty.';

-- ---------------------------------------------------------------------------
-- 10. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.handling_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "handling_units_select_ops" ON public.handling_units;
CREATE POLICY "handling_units_select_ops"
    ON public.handling_units FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

-- No write policy: writes go through the Edge Functions on the service_role,
-- matching every other inventory table (00027, 00032).
GRANT SELECT ON public.handling_units TO authenticated;
GRANT SELECT ON public.handling_unit_anomalies TO authenticated;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT public.hu_next_code();
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_inventory_balances_slot';
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
--    WHERE proname = 'inv_apply_leg' AND pronamespace = 'public'::regnamespace;
--     -- expect exactly ONE row, ending in "p_handling_unit_id bigint"
--   SELECT * FROM public.handling_unit_anomalies;   -- expect 0 rows
-- =============================================================================
