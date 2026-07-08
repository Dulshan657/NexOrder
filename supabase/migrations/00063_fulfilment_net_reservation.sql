-- =============================================================================
-- Fulfilment sites must reflect NET reservation (allocate − deallocate)
-- Migration: 00063_fulfilment_net_reservation.sql
-- =============================================================================
-- P1 fix: re-routing an order at the Process step ("Override primary warehouse")
-- released the origin reservation and re-reserved at the target, but
-- inv_order_fulfilment_warehouses (mig 00040) counted any warehouse with an
-- `allocate` leg WITHOUT subtracting the cancelling `deallocate`. So the origin
-- warehouse — now net-zero reserved — was still returned as a fulfilment site,
-- ensureFulfillments created a zero-stock 'processed' order_fulfillments row for
-- it, and because orders.status is the least-advanced fulfilment rollup, the
-- order froze at 'processed' forever (undispatchable, undeliverable).
--
-- The sibling inv_warehouse_pick_complete (mig 00040, §5) already nets
-- allocate−deallocate via SUM(qty_delta); this migration makes
-- inv_order_fulfilment_warehouses do the same, then heals any orders already
-- stalled by the old behaviour.
--
-- ADDITIVE & IDEMPOTENT: CREATE OR REPLACE (signature + grants unchanged). The
-- one-time repair only removes stockless 'processed' rows (never advanced work)
-- and never strips an order to zero fulfilments. Apply whole via the Management
-- API: node supabase/apply-sql.mjs supabase/migrations/00063_fulfilment_net_reservation.sql
-- =============================================================================

BEGIN;

-- ── 1. inv_order_fulfilment_warehouses(order) — NET-reserved root warehouses ──
-- Only warehouses whose SUM(allocate − deallocate) is positive count as
-- fulfilment sites. Mirrors inv_warehouse_pick_complete's netting logic.
CREATE OR REPLACE FUNCTION public.inv_order_fulfilment_warehouses(p_order_id TEXT)
RETURNS TABLE(warehouse_id INT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT s.wh
    FROM (
        SELECT public.inv_root_warehouse(m.location_id) AS wh, SUM(m.qty_delta) AS net
        FROM public.inventory_movements m
        WHERE m.ref_type = 'order' AND m.ref_id = p_order_id
          AND m.movement_type IN ('allocate', 'deallocate')
          AND public.inv_root_warehouse(m.location_id) IS NOT NULL
        GROUP BY public.inv_root_warehouse(m.location_id)
    ) s
    WHERE s.net > 0.000001;
$$;

-- Re-issue the grant (CREATE OR REPLACE preserves it; explicit for parity w/ 00040).
GRANT EXECUTE ON FUNCTION public.inv_order_fulfilment_warehouses(TEXT) TO service_role;

-- ── 2. One-time repair: delete orphaned stockless 'processed' fulfilments ─────
-- A fulfilment is orphaned when its warehouse holds no net reservation (per the
-- now-corrected function) and it is still at 'processed' (never picked → no real
-- work to lose). Guarded so an order keeps at least one real fulfilment: a
-- sibling that is either advanced past 'processed' OR still net-reserved. If
-- EVERY row is orphaned (order fully deallocated), keep them all rather than
-- strip the order to zero fulfilments.
DELETE FROM public.order_fulfillments f
WHERE f.status = 'processed'
  AND NOT EXISTS (
    SELECT 1 FROM public.inv_order_fulfilment_warehouses(f.order_id) w
    WHERE w.warehouse_id = f.location_id
  )
  AND EXISTS (
    SELECT 1 FROM public.order_fulfillments f2
    WHERE f2.order_id = f.order_id
      AND f2.id <> f.id
      AND (
        f2.status <> 'processed'
        OR EXISTS (
          SELECT 1 FROM public.inv_order_fulfilment_warehouses(f2.order_id) w2
          WHERE w2.warehouse_id = f2.location_id
        )
      )
  );

-- ── 3. Recompute orders.status for fulfilment-driven orders ───────────────────
-- Overall status = least-advanced remaining fulfilment (mirror of rollupOrderStatus).
-- Only touch orders whose status is in the fulfilment ladder and actually changed.
WITH ladder(status, rank) AS (
    VALUES ('processed', 1), ('picked', 2), ('packed', 3), ('dispatched', 4), ('delivered', 5)
),
rolled AS (
    SELECT f.order_id,
           (SELECT f2.status
            FROM public.order_fulfillments f2
            JOIN ladder l ON l.status = f2.status
            WHERE f2.order_id = f.order_id
            ORDER BY l.rank
            LIMIT 1) AS new_status
    FROM public.order_fulfillments f
    GROUP BY f.order_id
)
UPDATE public.orders o
SET status = r.new_status
FROM rolled r
WHERE o.id = r.order_id
  AND r.new_status IS NOT NULL
  AND o.status <> r.new_status
  AND o.status IN ('processed', 'picked', 'packed', 'dispatched', 'delivered');

COMMIT;

-- Verify (after apply):
--   -- No stockless 'processed' orphans remain:
--   SELECT COUNT(*) FROM public.order_fulfillments f
--   WHERE f.status = 'processed'
--     AND NOT EXISTS (SELECT 1 FROM public.inv_order_fulfilment_warehouses(f.order_id) w
--                     WHERE w.warehouse_id = f.location_id);
--   -- A re-routed order returns only its target warehouse:
--   SELECT * FROM public.inv_order_fulfilment_warehouses('<order-id>');
