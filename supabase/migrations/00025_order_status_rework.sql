-- 00025_order_status_rework.sql
--
-- Reworks the order-fulfillment status model from 5 statuses to 6, grouped
-- into three Order Import tabs:
--
--   Received    -> processing, processed
--   In Progress -> picked, packed
--   Completed   -> dispatched, delivered
--
-- New linear sequence: processing -> processed -> picked -> packed ->
-- dispatched -> delivered.
--
-- Two existing statuses are renamed and one is new:
--   confirmed -> processed   (rename)
--   shipped   -> dispatched  (rename)
--   picked                   (new, no existing rows)
--
-- The orders.status CHECK constraint is defined inline in 00001 (auto-named
-- orders_status_check) and has never been altered. We drop it first so rows
-- can hold the renamed values, remap both the live status column and the
-- status_history JSON (so timelines stay coherent), then add the widened
-- CHECK. DEFAULT 'processing' is unchanged and stays valid.

BEGIN;

-- =============================================================================
-- 1. Drop the old CHECK so rows can hold the renamed values
-- =============================================================================

ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS orders_status_check;

-- =============================================================================
-- 2. Remap the live status column
-- =============================================================================

UPDATE public.orders SET status = 'processed'  WHERE status = 'confirmed';
UPDATE public.orders SET status = 'dispatched' WHERE status = 'shipped';

-- =============================================================================
-- 3. Remap values inside the status_history JSONB array
-- =============================================================================
-- Rebuild each affected array, rewriting only the renamed status values and
-- leaving every other field (timestamp, actor, note) untouched. Rows whose
-- history contains neither 'confirmed' nor 'shipped' are skipped by the WHERE
-- clause; matched rows always have >= 1 element so jsonb_agg is never NULL.

UPDATE public.orders
SET status_history = (
    SELECT jsonb_agg(
        CASE
            WHEN elem->>'status' = 'confirmed' THEN jsonb_set(elem, '{status}', '"processed"')
            WHEN elem->>'status' = 'shipped'   THEN jsonb_set(elem, '{status}', '"dispatched"')
            ELSE elem
        END
    )
    FROM jsonb_array_elements(status_history) AS elem
)
WHERE status_history @> '[{"status":"confirmed"}]'
   OR status_history @> '[{"status":"shipped"}]';

-- =============================================================================
-- 4. Add the widened CHECK (6 valid values)
-- =============================================================================

ALTER TABLE public.orders
    ADD CONSTRAINT orders_status_check
    CHECK (status IN ('processing','processed','picked','packed','dispatched','delivered'));

COMMIT;
