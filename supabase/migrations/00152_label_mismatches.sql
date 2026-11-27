-- =============================================================================
-- "Not this product?": a mislabelled carton is recorded as what it really is,
-- and held (NX-0050)
-- Migration: 00152_label_mismatches.sql
-- =============================================================================
-- A carton whose label (barcode) says one product but holds another used to be
-- accepted as the label product. The worker can now say so, at the receive desk
-- or on a putaway Walk stop. The stock is recorded as the real product, held
-- (it goes to a hold location), and the desk is told to check the barcode.
--
-- 1. label_mismatches: one row per report. The scanned code, the label
--    product, the real product, the quantity of the real product, where and
--    who, and status 'open' -> 'resolved'.
--
--    RLS:
--      * Admin and Manager read every row.
--      * Warehouse reads the rows it reported.
--    Nobody writes from the client. receive-stock, report-wrong-product and
--    resolve-label-mismatch write it with the service role.
--
-- 2. wie_report_wrong_product_tx(rec, real product, qty, scanned code, actor):
--    the Walk side, in ONE transaction, under the task's row lock:
--      * the task must be open (suggested / assigned) and not a mixed plate;
--      * the real product must differ, and the quantity must be a positive
--        whole number;
--      * it takes the task's quantity of the label product off the warehouse
--        root and puts the counted quantity of the real product on, on the
--        same plate (inv_adjust_stock, as wie_resolve_short_putaway_tx does);
--      * it closes the task as written_off, with the reason 'label mismatch';
--      * it writes the label_mismatches row.
--    The held putaway task for the real product is planned afterwards by
--    report-wrong-product, through generatePutawayTasks (quarantine).
--
-- No BEGIN or COMMIT here: supabase/migrate.mjs wraps this file.
-- =============================================================================

-- ── 1. The record ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.label_mismatches (
    id                BIGSERIAL   PRIMARY KEY,
    scanned_code      TEXT        NOT NULL CHECK (length(btrim(scanned_code)) BETWEEN 1 AND 120),
    label_product_id  INT         NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    real_product_id   INT         NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity          NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    warehouse_id      INT         NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    goods_receipt_id  BIGINT,
    putaway_rec_id    BIGINT,
    reported_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolved_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT label_mismatches_two_products CHECK (label_product_id <> real_product_id)
);

CREATE INDEX IF NOT EXISTS idx_label_mismatches_open
    ON public.label_mismatches (status, created_at DESC);

ALTER TABLE public.label_mismatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS label_mismatches_select_desk ON public.label_mismatches;
CREATE POLICY label_mismatches_select_desk ON public.label_mismatches
    FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin', 'Manager'));

DROP POLICY IF EXISTS label_mismatches_select_own ON public.label_mismatches;
CREATE POLICY label_mismatches_select_own ON public.label_mismatches
    FOR SELECT TO authenticated
    USING (reported_by = (SELECT auth.uid()));

REVOKE ALL ON public.label_mismatches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.label_mismatches TO authenticated;
GRANT ALL ON public.label_mismatches TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.label_mismatches_id_seq TO service_role;

-- ── 2. The Walk side ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wie_report_wrong_product_tx(
    p_rec_id          BIGINT,
    p_real_product_id INT,
    p_quantity        NUMERIC,
    p_scanned_code    TEXT,
    p_actor           UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec      public.wie_putaway_recommendations%ROWTYPE;
    v_others   INT;
    v_code     TEXT;
    v_id       BIGINT;
BEGIN
    SELECT * INTO v_rec FROM public.wie_putaway_recommendations
    WHERE id = p_rec_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: putaway task % not found', p_rec_id USING ERRCODE = 'P0001';
    END IF;
    IF v_rec.status NOT IN ('suggested', 'assigned') THEN
        RAISE EXCEPTION 'CONFLICT: This stop is already done.' USING ERRCODE = 'P0001';
    END IF;
    IF p_real_product_id IS NULL OR p_real_product_id = v_rec.product_id THEN
        RAISE EXCEPTION 'INVALID_INPUT: That is the same product. Pick what is really in the carton.'
            USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_real_product_id) THEN
        RAISE EXCEPTION 'NOT_FOUND: product % not found', p_real_product_id USING ERRCODE = 'P0001';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> trunc(p_quantity) THEN
        RAISE EXCEPTION 'INVALID_INPUT: Enter how many there are, as a whole number.' USING ERRCODE = 'P0001';
    END IF;

    IF v_rec.handling_unit_id IS NOT NULL THEN
        SELECT count(DISTINCT b.product_id) INTO v_others
        FROM public.inventory_balances b
        WHERE b.handling_unit_id = v_rec.handling_unit_id
          AND b.on_hand > 0
          AND b.product_id <> v_rec.product_id;
        IF v_others > 0 THEN
            RAISE EXCEPTION 'CONFLICT: Break this pallet down first.' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    v_code := NULLIF(btrim(COALESCE(p_scanned_code, '')), '');
    IF v_code IS NULL THEN
        SELECT COALESCE(NULLIF(btrim(barcode), ''), sku) INTO v_code
        FROM public.products WHERE id = v_rec.product_id;
    END IF;

    PERFORM public.inv_adjust_stock(
        v_rec.product_id, v_rec.warehouse_id, -v_rec.quantity,
        'label mismatch: not this product', p_actor,
        NULL, 'adjustment', v_rec.handling_unit_id);
    PERFORM public.inv_adjust_stock(
        p_real_product_id, v_rec.warehouse_id, p_quantity,
        'label mismatch: recorded as the real product', p_actor,
        NULL, 'adjustment', v_rec.handling_unit_id);

    UPDATE public.wie_putaway_recommendations
    SET status = 'written_off', resolution_reason = 'label mismatch',
        decided_at = now(), actor_id = p_actor
    WHERE id = p_rec_id;

    INSERT INTO public.label_mismatches
        (scanned_code, label_product_id, real_product_id, quantity, warehouse_id,
         goods_receipt_id, putaway_rec_id, reported_by)
    VALUES
        (left(v_code, 120), v_rec.product_id, p_real_product_id, p_quantity, v_rec.warehouse_id,
         v_rec.goods_receipt_id, v_rec.id, p_actor)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'mismatch_id', v_id,
        'warehouse_id', v_rec.warehouse_id,
        'handling_unit_id', v_rec.handling_unit_id,
        'goods_receipt_id', v_rec.goods_receipt_id,
        'label_product_id', v_rec.product_id,
        'scanned_code', left(v_code, 120));
END;
$$;

REVOKE ALL ON FUNCTION public.wie_report_wrong_product_tx(BIGINT,INT,NUMERIC,TEXT,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_report_wrong_product_tx(BIGINT,INT,NUMERIC,TEXT,UUID)
    TO service_role;

-- =============================================================================
-- Verify with:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'label_mismatches';    -- true
--   SELECT oid::regprocedure, proacl FROM pg_proc WHERE proname = 'wie_report_wrong_product_tx';
--
-- Rollback: DROP FUNCTION public.wie_report_wrong_product_tx(BIGINT,INT,NUMERIC,TEXT,UUID);
--           DROP TABLE public.label_mismatches;
-- =============================================================================
