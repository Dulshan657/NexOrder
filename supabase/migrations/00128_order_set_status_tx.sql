-- =============================================================================
-- Order status transitions take the row lock, like cancellation does
-- Migration: 00128_order_set_status_tx.sql
-- =============================================================================
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
--
-- Every non-cancel status write was read-then-write from an Edge Function:
--
--   update-order-status   reads the order, runs its checks, then
--                         UPDATE orders SET status, status_history WHERE id = ?
--   recomputeOrderStatus  (_shared/fulfillment.ts) checks "cancelled?" in one
--                         query, then writes in another
--   record-pick           the legacy whole-order 'picked' advance, same shape
--
-- order_cancel_tx (00111) locks the row FOR UPDATE and re-checks, but the
-- writers above take no lock and restate nothing on the UPDATE. If a cancel
-- commits between their read and their write, the write lands on the
-- cancelled row and quietly un-cancels it (status back to processed / picked).
-- Two concurrent writers also lose history entries: each copies the JSONB
-- array it read, appends, and writes the whole array back.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- One function every status writer calls. It locks the row, refuses a
-- cancelled order, refuses a row whose status is no longer one the caller's
-- checks were made against, and appends the history entry in SQL so
-- concurrent appends both survive. Deliberately dumb, like order_cancel_tx:
-- the transition POLICY (who may, which ladder, forward-only) stays in the
-- Edge Functions, which pass the statuses they validated against as p_from.
--
-- Returns a JSONB verdict rather than raising, for the same reason 00111 does:
-- on a precondition failure nothing has been written, and the caller needs to
-- tell "someone moved it first" from "the database is broken".
--
--   {ok: true,  changed: true|false, order: {...row}}
--   {ok: false, code: 'NOT_FOUND'}
--   {ok: false, code: 'CANCELLED'}
--   {ok: false, code: 'CONFLICT', status: <current>}
--
-- p_to = 'cancelled' is refused: cancelling is order_cancel_tx's job, because
-- it also releases stock and cancels the invoice.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.order_set_status_tx(
    p_order_id TEXT,
    p_from     TEXT[],   -- statuses the caller validated against; NULL = any live status
    p_to       TEXT,
    p_entry    JSONB     -- the status_history entry to append
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_row    public.orders;
BEGIN
    IF p_to = 'cancelled' THEN
        RAISE EXCEPTION 'order_set_status_tx cannot cancel; use order_cancel_tx'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT status INTO v_status
      FROM public.orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    IF v_status = 'cancelled' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CANCELLED');
    END IF;

    IF v_status = p_to THEN
        SELECT * INTO v_row FROM public.orders WHERE id = p_order_id;
        RETURN jsonb_build_object('ok', true, 'changed', false, 'order', to_jsonb(v_row));
    END IF;

    IF p_from IS NOT NULL AND NOT (v_status = ANY (p_from)) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT', 'status', v_status);
    END IF;

    UPDATE public.orders
       SET status         = p_to,
           status_history = COALESCE(status_history, '[]'::jsonb) || p_entry
     WHERE id = p_order_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'changed', true, 'order', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.order_set_status_tx(TEXT, TEXT[], TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_set_status_tx(TEXT, TEXT[], TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.order_set_status_tx(TEXT, TEXT[], TEXT, JSONB) IS
    'Move an order to a new (non-cancelled) status under the row lock, '
    'refusing a cancelled order or one whose status left p_from since the '
    'caller checked it, and append to status_history in SQL. service_role '
    'only: update-order-status, record-pick and recomputeOrderStatus call it. '
    'Transition policy lives in those callers (mig 00128).';

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT proname FROM pg_proc WHERE proname = 'order_set_status_tx';  -- one row
--
--   -- Refuses a cancelled order without writing (run inside BEGIN … ROLLBACK):
--   SELECT public.order_set_status_tx(
--       (SELECT id FROM public.orders WHERE status = 'cancelled' LIMIT 1),
--       NULL, 'processed', '{"status":"processed"}'::jsonb);
--     -- expect {"ok": false, "code": "CANCELLED"}
--
-- Rollback:
--   DROP FUNCTION public.order_set_status_tx(TEXT, TEXT[], TEXT, JSONB);
--   (The Edge Functions calling it must be rolled back first.)
-- =============================================================================
