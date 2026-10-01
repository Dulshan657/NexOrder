-- =============================================================================
-- One invoice per order, and no invoice life after cancellation
-- Migration: 00127_invoice_one_per_order.sql
-- =============================================================================
--
-- ── THE BUGS ────────────────────────────────────────────────────────────────
--
-- 1. DUPLICATE INVOICES. `mutate-invoice-status` auto-creates an invoice by
--    reading "is there one for this order?" and then inserting. `order_id`
--    carried only a plain index (00001:370), so two concurrent "Mark Paid"
--    clicks could both see none and both insert.
--
-- 2. UN-CANCELLING. Nothing stopped `mutate-invoice-status` flipping a
--    `cancelled` invoice (00111 cancels the invoice with its order) back to
--    pending / paid / overdue.
--
-- 3. INVOICING A CANCELLED ORDER. The auto-create path never looked at the
--    order's status, and even a check in the Edge Function would race
--    `order_cancel_tx`, which holds the order row FOR UPDATE.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
--   * UNIQUE(order_id). It replaces idx_invoices_order_id, which it covers.
--   * A BEFORE INSERT trigger that reads the order FOR SHARE and refuses a
--     cancelled one. FOR SHARE conflicts with order_cancel_tx's FOR UPDATE, so
--     the insert either waits for the cancel and then refuses, or commits
--     first and is then cancelled by it. There is no third interleaving.
--   * A BEFORE UPDATE trigger: a cancelled invoice stays cancelled.
--
-- Errors carry ERRCODE check_violation (23514) and a stable message prefix so
-- the Edge Functions can turn them into a 409 rather than a 500.
--
-- ── PRE-EXISTING DUPLICATES ─────────────────────────────────────────────────
--
-- This migration does NOT pick a winner among duplicate invoices: which one is
-- real is a bookkeeping decision, not a schema one. If any exist it raises,
-- naming them, and nothing is applied. Dev had none on 2026-10-01.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_dupes TEXT;
BEGIN
    SELECT string_agg(order_id || ' (' || n || ')', ', ')
      INTO v_dupes
      FROM (SELECT order_id, count(*) AS n
              FROM public.invoices
             GROUP BY order_id
            HAVING count(*) > 1) d;

    IF v_dupes IS NOT NULL THEN
        RAISE EXCEPTION
            '00127: orders with more than one invoice must be resolved by hand first: %',
            v_dupes;
    END IF;
END;
$$;

ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_order_id_key UNIQUE (order_id);

DROP INDEX IF EXISTS public.idx_invoices_order_id;

-- ---------------------------------------------------------------------------
-- No invoice for a cancelled order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoices_reject_cancelled_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status
      FROM public.orders
     WHERE id = NEW.order_id
     FOR SHARE;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'ORDER_CANCELLED: order % is cancelled and cannot be invoiced',
            NEW.order_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_reject_cancelled_order
    BEFORE INSERT ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.invoices_reject_cancelled_order();

-- ---------------------------------------------------------------------------
-- A cancelled invoice stays cancelled
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoices_keep_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'INVOICE_CANCELLED: invoice % is cancelled and cannot change status',
            OLD.id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_keep_cancelled
    BEFORE UPDATE OF status ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.invoices_keep_cancelled();

COMMENT ON CONSTRAINT invoices_order_id_key ON public.invoices IS
    'One invoice per order (mig 00127). mutate-invoice-status and place-order '
    'rely on it to make the auto-create path race-free.';

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_order_id_key';
--     -- expect one row
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.invoices'::regclass AND NOT tgisinternal ORDER BY 1;
--     -- expect trg_invoices_keep_cancelled, trg_invoices_reject_cancelled_order,
--     --        trg_invoices_set_tenant
--
-- Rollback:
--   DROP TRIGGER trg_invoices_keep_cancelled ON public.invoices;
--   DROP TRIGGER trg_invoices_reject_cancelled_order ON public.invoices;
--   DROP FUNCTION public.invoices_keep_cancelled();
--   DROP FUNCTION public.invoices_reject_cancelled_order();
--   ALTER TABLE public.invoices DROP CONSTRAINT invoices_order_id_key;
--   CREATE INDEX idx_invoices_order_id ON public.invoices(order_id);
-- =============================================================================
