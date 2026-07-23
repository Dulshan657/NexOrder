-- =============================================================================
-- Putaway — partial putaway in one transaction
-- Migration: 00071_putaway_partial.sql
-- =============================================================================
-- The Putaway queue could only ever move a recommendation's FULL quantity: a
-- pallet that physically split across two bays had no way to be recorded. The
-- decide-putaway Edge Function also claimed the row and moved the stock in two
-- separate round trips, hand-rolling a compensating UPDATE when the move failed
-- (a window where a crash between the two leaves a decided row with no ledger
-- leg). Both problems collapse into one function that does the claim, the split
-- and the transfer inside a single transaction.
--
-- wie_decide_putaway_tx(rec, decision, chosen, qty, actor):
--   * SELECT … FOR UPDATE on the recommendation — the row lock replaces the
--     `.eq('status','suggested')` optimistic claim, so two operators accepting
--     the same row can never both transfer.
--   * Full quantity  → the row is decided in place (today's behaviour exactly).
--   * Partial        → the ORIGINAL row keeps `status='suggested'` with its
--     quantity reduced to the remainder (so it stays in the queue), and a COPY
--     carrying the decided quantity + chosen bin is inserted as the audit
--     record. The copy inherits `created_at` so the remainder keeps its place
--     in the newest-first queue ordering and its true age.
--   * inv_transfer_stock runs in the SAME transaction, so a failed move rolls
--     the split back rather than needing compensation.
--
-- Two standing traps this deliberately does NOT paper over:
--   * inv_transfer_stock moves AVAILABLE stock only (CLAUDE.md). A root balance
--     with reservations against it will raise INSUFFICIENT_STOCK and abort the
--     whole decision — correct, and better than a half-applied putaway.
--   * The remainder row keeps the ORIGINAL explanation, which may name a bin
--     that the decision just filled. That is intentional: the explanation is an
--     audit record of what the engine said at receipt time, not a live score.
--     Operators who want a fresh score use the queue's "Re-run" action
--     (recommend-putaway's replaces_recommendation_id).
--
-- Additive, service-role only. Idempotent (CREATE OR REPLACE).
-- Apply via the Management API (see CLAUDE.md); do not run interactively.
-- =============================================================================

BEGIN;

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
    v_moved := public.inv_transfer_stock(
        v_rec.product_id, v_rec.warehouse_id, p_chosen, v_qty, p_actor,
        'putaway:' || p_decision);

    RETURN jsonb_build_object(
        'decided_id',    v_decided_id,
        'remainder_id',  CASE WHEN v_remainder > 0 THEN p_rec_id ELSE NULL END,
        'remainder_qty', v_remainder,
        'moved',         v_moved);
END;
$$;

REVOKE ALL ON FUNCTION public.wie_decide_putaway_tx(BIGINT,TEXT,INT,NUMERIC,UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_decide_putaway_tx(BIGINT,TEXT,INT,NUMERIC,UUID)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify (rollback-isolated — the SELECTs return pre-ROLLBACK state):
--   BEGIN;
--     SELECT public.wie_decide_putaway_tx(<rec_id>, 'override', <bin_id>, 5, NULL);
--     -- expect the original row still 'suggested' with quantity reduced by 5,
--     -- plus one 'overridden' copy with quantity 5 and chosen_location_id set:
--     SELECT id, quantity, status, chosen_location_id
--     FROM public.wie_putaway_recommendations
--     WHERE id = <rec_id> OR (goods_receipt_id IS NOT DISTINCT FROM <gr_id>
--                             AND status = 'overridden')
--     ORDER BY id;
--     -- and two ledger legs (transfer_out at the root, transfer_in at the bin):
--     SELECT location_id, movement_type, quantity FROM public.inventory_movements
--     ORDER BY id DESC LIMIT 2;
--   ROLLBACK;
-- =============================================================================
