-- =============================================================================
-- Warehouse-aware goods receipt
-- Migration: 00038_receive_stock_location.sql
-- =============================================================================
-- Make inv_receive_stock receive into a chosen warehouse instead of the single
-- inv_default_location(). The receipt HEADER (p_receipt) already carries supplier
-- + reference + date (mig 00037); we add an optional `location_id` to it so a
-- receipt lands in the selected DC. Falls back to inv_default_location() when the
-- header omits it (keeps every existing caller working).
--
-- Also drops the erroneous inv_receive_stock(jsonb,int,uuid) overload that
-- 00036 introduced before this author noticed 00037 had already redefined the
-- function as (jsonb,uuid,jsonb). With both present, a {p_lines,p_actor} call was
-- ambiguous; this migration restores a single canonical signature. Idempotent.
-- =============================================================================

BEGIN;

-- Remove the bad overload from 00036 (no-op on a fresh DB where 00036 no longer
-- creates it).
DROP FUNCTION IF EXISTS public.inv_receive_stock(JSONB, INT, UUID);

-- Recreate the canonical goods-receipt receiver (00037 body) with the location
-- resolved from the header payload.
CREATE OR REPLACE FUNCTION public.inv_receive_stock(
    p_lines   JSONB,
    p_actor   UUID DEFAULT NULL,
    p_receipt JSONB DEFAULT '{}'::jsonb   -- { location_id?, supplier_id?, reference?, received_date?, received_by? }
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

    RETURN jsonb_build_object('lines_received', v_count, 'receipt_id', v_receipt_id, 'location_id', v_loc);
END;
$$;

REVOKE ALL ON FUNCTION public.inv_receive_stock(JSONB,UUID,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_receive_stock(JSONB,UUID,JSONB) TO service_role;

COMMIT;

-- Verify: exactly one inv_receive_stock overload remains, taking the header.
--   SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname='inv_receive_stock';
