-- =============================================================================
-- An order can be cancelled, and the record says who, when and why
-- Migration: 00111_order_cancellation.sql
-- =============================================================================
-- WHY THIS EXISTS. 00112 revokes the direct INSERT/UPDATE/DELETE grants that
-- `authenticated` has held on `orders` and `order_items` since 00001, and drops
-- the three 00001 write policies that were never dropped (`orders_delete_admin`,
-- `order_items_update_admin_manager`, `order_items_delete_admin_manager`).
-- Security-audit finding DB-1.
--
-- That closes a real hole -- an Admin could DELETE an order over PostgREST with
-- no audit event and no ledger correction, leaving its `allocate` legs in
-- inventory_movements pointing at a row that no longer exists. But it also
-- removes the only path anyone had to void a bad order. This migration is the
-- replacement: a TERMINAL STATUS, written by the `cancel-order` Edge Function,
-- which releases the reservation through the ledger and writes an audit row.
--
-- A STATUS, NOT A DELETE, AND THE SCHEMA ALREADY INSISTED ON THAT.
-- `invoices.order_id` (00001:179) carries NO `ON DELETE` clause, so deleting an
-- invoiced order fails on the foreign key anyway. Everything else cascades
-- (`order_items`, `pick_progress`, `order_fulfillments`, `order_documents`) or
-- SET NULLs (`pending_pos.approved_order_id`) -- i.e. a delete destroys the
-- picking history and the PO-Inbox provenance of an order that demonstrably
-- existed. `inventory_movements` has no FK at all (ref_type/ref_id are free
-- text), so its legs would survive as orphans naming a vanished order. A
-- cancelled order keeps every one of those relationships intact and readable.
--
-- BOTH A STATUS AND THREE COLUMNS, deliberately.
--   * The STATUS is what every queue, tab and filter already reads. Without it
--     a cancelled order still sits in the pick queue.
--   * The COLUMNS are the record. `status_history` is a JSONB array and
--     `audit_events` is Admin-only-SELECT; neither answers "which orders were
--     cancelled last month and why" without unnesting JSON or a privileged
--     read. `cancelled_by` is also a real FK, which the JSON actor field is not.
--
-- THE CHECK IS THE WEAK DIRECTION ON PURPOSE.
--   status = 'cancelled'  =>  cancelled_at AND cancel_reason are present
-- and NOT the converse. The reverse implication would forbid ever moving a row
-- out of `cancelled` without also clearing the columns, and the columns are the
-- history of what happened -- they should outlive a hypothetical un-cancel.
-- A reason is mandatory at the CHECK, not only in the function, because that is
-- the field an auditor asks for and a NULL here would be unrecoverable later.
--
-- INVOICES GAIN 'cancelled' TOO. An order cancelled before picking usually has
-- an invoice: `place-order` creates one, best-effort, at placement. Left at
-- 'pending' it ages into 'overdue' and chases a customer for an order that
-- never shipped. `cancel-order` refuses outright if the invoice is already
-- 'paid' -- money already taken is a refund or a credit note, a decision no
-- status flip should make silently.
--
-- WHAT THIS MIGRATION DOES NOT DO.
--   * `order_fulfillments.status` (00036:75) does NOT gain 'cancelled'. A
--     fulfilment is one warehouse's share of an order; a site cannot be
--     cancelled independently of the order it belongs to, and widening it would
--     hand `rollupOrderStatus` a value with no rung on its ladder. The order's
--     terminal state is instead protected in code -- `recomputeOrderStatus`
--     returns early on a cancelled order, or it would roll the status straight
--     back to a fulfilment rollup the next time anything touched a pick.
--   * No `movement_type` is added to `inventory_movements`. A cancellation
--     releases a reservation, and 'deallocate' is exactly what that is. The
--     cancellation is named by the audit event, not by a new ledger verb.
--   * No backfill. Every existing order is un-cancelled, which is true.
--
-- WHY THERE IS A TRANSACTION FUNCTION AND NOT THREE supabase-js CALLS.
-- `inv_release_reservation` is NOT idempotent and is NOT keyed by order: it
-- computes (ordered - picked) per line and lowers `inventory_balances.allocated`
-- by that much, and `allocated` is a bare per-slot counter shared by every open
-- order. Calling it twice for one order therefore deallocates twice and eats
-- SOMEBODY ELSE'S reservation, silently. Two clients pressing Cancel at once, or
-- one retrying a request that timed out after the write, is all it takes.
--
-- So the claim and the release must be one statement's worth of atomicity:
-- `order_cancel_tx` claims the row with a conditional UPDATE (which is what
-- serialises concurrent cancels -- the loser matches no row) and only then
-- releases. If the release raises, the claim rolls back with it and the order is
-- left exactly as it was. There is no ordering of two separate supabase-js calls
-- that has both properties: release-first can double-release, claim-first can
-- leave a cancelled order still holding stock.
--
-- Contents:
--   1. orders.status -- widen orders_status_check to 7 values
--   2. orders -- cancelled_at / cancelled_by / cancel_reason (+ CHECK)
--   3. invoices.status -- widen invoices_status_check to 4 values
--   4. order_cancel_tx -- claim + release + invoice, atomically
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. orders.status: the seventh value
-- ---------------------------------------------------------------------------
-- Same drop/re-add shape as 00025, which is the only other migration to touch
-- this constraint. The name `orders_status_check` is the auto-generated name
-- from 00001's inline CHECK, which 00025 re-declared explicitly; keep it.

ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_status_check
    CHECK (status IN (
        'processing','processed','picked','packed','dispatched','delivered',
        'cancelled'
    ));

COMMENT ON COLUMN public.orders.status IS
    'Updateable only by service role (update-order-status Edge Function). '
    'Direct UPDATE is denied. cancelled is TERMINAL and is written only by the '
    'cancel-order Edge Function (mig 00111); update-order-status and '
    'recomputeOrderStatus both refuse to move a cancelled order.';

-- ---------------------------------------------------------------------------
-- 2. Who cancelled it, when, and why
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by   UUID REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;

ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS orders_cancelled_fields_check;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_cancelled_fields_check
    CHECK (
        status <> 'cancelled'
        OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
    );

COMMENT ON COLUMN public.orders.cancelled_at IS
    'When the order was cancelled. Written only by the cancel-order Edge '
    'Function. NOT NULL whenever status is cancelled '
    '(orders_cancelled_fields_check).';
COMMENT ON COLUMN public.orders.cancelled_by IS
    'The Admin who cancelled the order. Written only by the cancel-order Edge '
    'Function. A real FK to public.profiles, matching orders.submitted_by and '
    'pick_progress.picked_by, unlike the actor id inside '
    'status_history, which is untyped JSON.';
COMMENT ON COLUMN public.orders.cancel_reason IS
    'Why the order was cancelled. Mandatory -- enforced by '
    'orders_cancelled_fields_check as well as by the Edge Function, because a '
    'NULL here cannot be reconstructed after the fact.';

-- ---------------------------------------------------------------------------
-- 3. invoices.status: a cancelled order's invoice must not age into overdue
-- ---------------------------------------------------------------------------
-- 00001:185 declared this inline and nothing has altered it since, so the
-- constraint carries the auto-generated name.

ALTER TABLE public.invoices
    DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('pending','paid','overdue','cancelled'));

COMMENT ON COLUMN public.invoices.status IS
    'Direct UPDATE denied; mutated by the mutate-invoice-status Edge Function. '
    'cancelled is set only by cancel-order (mig 00111) and is NOT offered by '
    'mutate-invoice-status -- an invoice is cancelled because its order was, '
    'never on its own.';

-- ---------------------------------------------------------------------------
-- 4. order_cancel_tx -- claim, release, invoice; all or nothing
-- ---------------------------------------------------------------------------
-- Deliberately dumb, in the same sense as wie_update_layout_tx and
-- wie_replace_layout_areas_tx: the POLICY lives in
-- _shared/orderCancel.ts (who may cancel, what the operator is told and why),
-- and is evaluated identically by the browser and by the Edge Function. What is
-- restated here is only the set of PRECONDITIONS that can change underneath a
-- caller between the check and the write -- the status, and whether a pick has
-- landed. Those are race guards, not a second copy of the rules.
--
-- Returns a JSONB verdict rather than raising for a precondition failure: at
-- that point nothing has been written, so there is nothing to roll back, and a
-- verdict lets the function distinguish "someone else cancelled it first" from
-- "the database is broken". Genuine failures (a release that errors) raise and
-- take the claim with them.

CREATE OR REPLACE FUNCTION public.order_cancel_tx(
    p_order_id TEXT,
    p_actor     UUID,
    p_reason    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status        TEXT;
    v_picked        NUMERIC;
    v_invoice_id    TEXT;
    v_invoice_stat  TEXT;
    v_now           TIMESTAMPTZ := now();
    v_claimed       TEXT;
BEGIN
    -- Lock the order row for the life of the transaction. Without FOR UPDATE
    -- the pick check below could pass while a concurrent record-pick commits.
    SELECT status INTO v_status
      FROM public.orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;

    IF v_status = 'cancelled' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CANCELLED');
    END IF;

    IF v_status NOT IN ('processing', 'processed') THEN
        RETURN jsonb_build_object(
            'ok', false, 'code', 'NOT_CANCELLABLE', 'status', v_status);
    END IF;

    -- pick_progress carries order_id directly (00027:167) and indexes it, so
    -- this needs no join through order_items.
    SELECT COALESCE(SUM(pp.picked_qty), 0) INTO v_picked
      FROM public.pick_progress pp
     WHERE pp.order_id = p_order_id;

    IF v_picked > 0 THEN
        RETURN jsonb_build_object(
            'ok', false, 'code', 'PICKING_STARTED', 'pickedUnits', v_picked);
    END IF;

    SELECT id, status INTO v_invoice_id, v_invoice_stat
      FROM public.invoices
     WHERE order_id = p_order_id
     LIMIT 1;

    IF v_invoice_stat = 'paid' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVOICE_PAID');
    END IF;

    -- Claim. The status predicate is restated on the UPDATE as well as checked
    -- above: the SELECT ... FOR UPDATE makes that redundant today, and it stays
    -- because it is what makes the claim correct on its own terms.
    UPDATE public.orders
       SET status         = 'cancelled',
           cancelled_at   = v_now,
           cancelled_by   = p_actor,
           cancel_reason  = p_reason,
           status_history = COALESCE(status_history, '[]'::jsonb)
                            || jsonb_build_object(
                                   'status',    'cancelled',
                                   'timestamp', to_char(v_now AT TIME ZONE 'UTC',
                                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                   'actor',     p_actor,
                                   'note',      p_reason)
     WHERE id = p_order_id
       AND status IN ('processing', 'processed')
    RETURNING status INTO v_claimed;

    IF v_claimed IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT');
    END IF;

    -- Release every remaining reservation this order holds, at every location.
    -- p_location_id => NULL is "everywhere", which is right here and only here:
    -- releaseResidualOnDispatch scopes to one warehouse because the other sites
    -- are still working. A cancelled order has no site still working.
    PERFORM public.inv_release_reservation(p_order_id, NULL, p_actor);

    IF v_invoice_id IS NOT NULL THEN
        UPDATE public.invoices
           SET status = 'cancelled'
         WHERE id = v_invoice_id
           AND status <> 'paid';
    END IF;

    RETURN jsonb_build_object(
        'ok',            true,
        'orderId',       p_order_id,
        'previousStatus', v_status,
        'cancelledAt',   v_now,
        'invoiceId',     v_invoice_id,
        'invoiceWas',    v_invoice_stat);
END;
$$;

REVOKE ALL ON FUNCTION public.order_cancel_tx(TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_cancel_tx(TEXT, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.order_cancel_tx(TEXT, UUID, TEXT) IS
    'Cancel an order atomically: claim the row, release its reservations via '
    'inv_release_reservation, cancel its unpaid invoice. service_role only, so '
    'the cancel-order Edge Function is the only caller. The preconditions '
    'restated here are race guards; the operator-facing rules live in '
    '_shared/orderCancel.ts and are shared with the browser.';

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.orders'::regclass
--      AND conname IN ('orders_status_check','orders_cancelled_fields_check');
--     -- expect 7 status values, and the weak cancelled-fields implication.
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_status_check';
--     -- expect ('pending','paid','overdue','cancelled')
--
--   -- The CHECK must refuse a cancelled order with no reason:
--   UPDATE public.orders SET status = 'cancelled' WHERE id = (SELECT id FROM public.orders LIMIT 1);
--     -- expect: violates check constraint "orders_cancelled_fields_check"
--
--   -- Nothing is cancelled yet:
--   SELECT count(*) FROM public.orders WHERE status = 'cancelled';   -- expect 0
--
-- Rollback:
--   ALTER TABLE public.orders DROP CONSTRAINT orders_cancelled_fields_check;
--   ALTER TABLE public.orders DROP COLUMN cancel_reason, DROP COLUMN cancelled_by,
--                             DROP COLUMN cancelled_at;
--   ALTER TABLE public.orders DROP CONSTRAINT orders_status_check;
--   ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
--       CHECK (status IN ('processing','processed','picked','packed','dispatched','delivered'));
--   ALTER TABLE public.invoices DROP CONSTRAINT invoices_status_check;
--   ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
--       CHECK (status IN ('pending','paid','overdue'));
--   -- (Rollback fails if any order is already cancelled. That is intended.)
-- =============================================================================
