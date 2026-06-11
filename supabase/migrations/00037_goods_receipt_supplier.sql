-- 00037_goods_receipt_supplier.sql
-- =============================================================================
-- Capture supplier information on goods receipts.
--
-- Shiyan's operation needs to record WHICH supplier supplied received goods
-- (no DIFOT, no PO line-reconciliation). Two real receiving scenarios both end
-- in the same warehouse action:
--   1. Expected   — a PO raised in MYOB (external); goods arrive and are received.
--   2. Unexpected — a verbal order; a container arrives and is received & stored.
-- In both, the only data requirement is "these goods came from this supplier".
--
-- THE GAP THIS FIXES: inv_receive_stock only stored the supplier when a lot code
-- was entered (onto batches.supplier_id); an UNTRACKED receipt dropped it. There
-- was also nowhere to record an invoice/docket reference, an explicit received
-- date, or who received the delivery.
--
-- WHAT THIS ADDS:
--   * goods_receipts            — one delivery-header row per submitted receipt
--                                 (supplier default, reference, received date,
--                                 received-by, created-by).
--   * inventory_movements.supplier_id — per-line supplier attribution that works
--                                 for untracked stock too (tracked stock still
--                                 keeps batches.supplier_id as well).
--   * inv_apply_leg gains p_supplier_id (written onto the movement).
--   * inv_receive_stock gains a header payload (p_receipt) + per-line supplier_id,
--     resolves each line's supplier (line override -> header default), inserts the
--     header, and links every receipt movement to it (ref_type='goods_receipt').
--
-- BACKWARD COMPAT: the new p_receipt param defaults to '{}', so existing 2-arg
-- inv_receive_stock(p_lines, p_actor) callers (integration tests) keep working;
-- p_supplier_id on inv_apply_leg defaults to NULL so the reserve/release/pick
-- callers are untouched (supplier only matters on a receipt leg).
-- =============================================================================

BEGIN;

-- ── 1. goods_receipts — delivery header ──────────────────────────────────────
CREATE TABLE public.goods_receipts (
    id            BIGSERIAL     PRIMARY KEY,
    location_id   INT           NOT NULL REFERENCES public.locations(id),
    supplier_id   INT           REFERENCES public.suppliers(id),
    reference     TEXT,                                  -- invoice / docket / MYOB PO no.
    received_date DATE          NOT NULL DEFAULT CURRENT_DATE,
    received_by   UUID          REFERENCES public.profiles(id),
    created_by    UUID          REFERENCES public.profiles(id),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_goods_receipts_supplier ON public.goods_receipts(supplier_id);
CREATE INDEX idx_goods_receipts_received ON public.goods_receipts(received_date);

-- ── 2. inventory_movements.supplier_id — per-line attribution ────────────────
ALTER TABLE public.inventory_movements
    ADD COLUMN supplier_id INT REFERENCES public.suppliers(id);
CREATE INDEX idx_inventory_movements_supplier ON public.inventory_movements(supplier_id);

-- ── 3. inv_apply_leg(...) += p_supplier_id ───────────────────────────────────
-- Recreate with the supplier stamped onto the ledger row. The 11th arg defaults
-- to NULL, so allocate/deallocate/pick callers (which pass 10 args) are unchanged.
DROP FUNCTION IF EXISTS public.inv_apply_leg(INT,INT,INT,NUMERIC,NUMERIC,TEXT,UUID,TEXT,TEXT,TEXT);
CREATE FUNCTION public.inv_apply_leg(
    p_product_id    INT,
    p_location_id   INT,
    p_batch_id      INT,
    p_onhand_delta  NUMERIC,
    p_alloc_delta   NUMERIC,
    p_movement_type TEXT,
    p_actor         UUID,
    p_ref_type      TEXT,
    p_ref_id        TEXT,
    p_reason        TEXT,
    p_supplier_id   INT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- UPDATE-first so CHECK constraints validate the FINAL row, not the bare delta.
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
        (product_id, location_id, batch_id, qty_delta, movement_type, ref_type, ref_id, actor_id, reason, supplier_id)
    VALUES
        (p_product_id, p_location_id, p_batch_id,
         CASE WHEN p_movement_type IN ('allocate','deallocate') THEN p_alloc_delta ELSE p_onhand_delta END,
         p_movement_type, p_ref_type, p_ref_id, p_actor, p_reason, p_supplier_id);

    PERFORM public.inv_recompute_product_cache(p_product_id);
END;
$$;

REVOKE ALL ON FUNCTION public.inv_apply_leg(INT,INT,INT,NUMERIC,NUMERIC,TEXT,UUID,TEXT,TEXT,TEXT,INT)
    FROM PUBLIC, anon, authenticated;

-- ── 4. inv_receive_stock(...) += header payload + per-line supplier ──────────
-- p_receipt: jsonb { supplier_id?, reference?, received_date?, received_by? }.
-- Each line may carry its own supplier_id (override); otherwise the header
-- supplier applies. Inserts one goods_receipts header and links every receipt
-- movement to it via ref_type='goods_receipt', ref_id=<header id>.
DROP FUNCTION IF EXISTS public.inv_receive_stock(JSONB,UUID);
CREATE FUNCTION public.inv_receive_stock(
    p_lines   JSONB,
    p_actor   UUID DEFAULT NULL,
    p_receipt JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc        INT := public.inv_default_location();
    v_line       JSONB;
    v_pid        INT;
    v_qty        NUMERIC;
    v_lot        TEXT;
    v_batch_id   INT;
    v_count      INT := 0;
    v_header_sup INT;
    v_eff_sup    INT;
    v_receipt_id BIGINT;
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
            'receipt', p_actor, 'goods_receipt', v_receipt_id::TEXT, NULL, v_eff_sup);
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('lines_received', v_count, 'receipt_id', v_receipt_id);
END;
$$;

REVOKE ALL ON FUNCTION public.inv_receive_stock(JSONB,UUID,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_receive_stock(JSONB,UUID,JSONB) TO service_role;

-- ── 5. RLS — goods_receipts: ops read; service_role writes (bypasses RLS) ────
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goods_receipts_select_ops"
    ON public.goods_receipts FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

GRANT SELECT ON public.goods_receipts TO authenticated;

COMMIT;
