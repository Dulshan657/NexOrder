-- =============================================================================
-- Stock adjustments — shrinkage / stocktake-variance write path
-- Migration: 00062_stock_adjustments.sql
-- =============================================================================
-- The ledger has defined the 'adjustment' and 'stocktake_variance' movement
-- types since 00027, but no RPC has ever written them — shrinkage, damage, and
-- stocktake corrections had no code path. This adds the single write
-- chokepoint for both:
--
--   inv_adjust_stock(product, location, qty_delta, reason, actor, batch?, type?)
--
-- It delegates to the existing inv_apply_leg (redefined by 00037 with a
-- trailing supplier arg, defaulted NULL here since adjustments have no
-- supplier) so the balance CHECK constraints (on_hand >= 0, allocated <=
-- on_hand), the append-only ledger, and inv_recompute_product_cache all ride
-- the same rails as every other inventory writer (receive/reserve/pick/
-- transfer). This RPC never touches inventory_balances / inventory_movements
-- directly.
--
-- A negative delta that would push on_hand below the already-allocated amount
-- trips inv_apply_leg's UPDATE against the inventory_balances_alloc_bound /
-- inventory_balances_nonneg CHECK constraints — a raw 23514 (check_violation)
-- that would otherwise surface to the client as an opaque Postgres error. We
-- catch it here and re-raise a clean, catchable ADJUSTMENT_BELOW_ALLOCATED
-- (ERRCODE P0001), matching the INSUFFICIENT_STOCK / INVALID_TRANSFER pattern
-- used by the sibling inv_* RPCs (00027 inv_reserve_order, 00036
-- inv_transfer_stock).
--
-- SECURITY DEFINER, service_role-EXECUTE only — mirrors every other inv_* RPC.
-- Apply via the Management API /database/query (the direct DB host is
-- unreachable from this box); this migration is written but NOT applied here.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inv_adjust_stock(
    p_product_id    INT,
    p_location_id   INT,
    p_qty_delta     NUMERIC,
    p_reason        TEXT,
    p_actor         UUID,
    p_batch_id      BIGINT DEFAULT NULL,
    p_movement_type TEXT DEFAULT 'adjustment'
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
BEGIN
    IF p_movement_type NOT IN ('adjustment', 'stocktake_variance') THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT: movement_type must be adjustment or stocktake_variance, got %', p_movement_type
            USING ERRCODE = 'P0001';
    END IF;

    IF p_qty_delta IS NULL OR p_qty_delta = 0 THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT: qty_delta must be non-zero' USING ERRCODE = 'P0001';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT: a reason is required' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
        RAISE EXCEPTION 'INVALID_ADJUSTMENT: product % not found', p_product_id USING ERRCODE = 'P0001';
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

    -- Snapshot the slot before the write (a missing row reads as a fresh 0/0
    -- slot — inv_apply_leg will INSERT it) so the caller gets a clean
    -- before/after pair for its audit-log entry.
    SELECT on_hand, allocated INTO v_before_on_hand, v_before_allocated
    FROM public.inventory_balances
    WHERE product_id = p_product_id
      AND location_id = p_location_id
      AND COALESCE(batch_id, 0) = COALESCE(v_batch_id, 0);
    v_before_on_hand := COALESCE(v_before_on_hand, 0);
    v_before_allocated := COALESCE(v_before_allocated, 0);

    BEGIN
        PERFORM public.inv_apply_leg(
            p_product_id, p_location_id, v_batch_id, p_qty_delta, 0,
            p_movement_type, p_actor, 'adjustment', NULL, p_reason);
    EXCEPTION
        WHEN check_violation THEN
            RAISE EXCEPTION 'ADJUSTMENT_BELOW_ALLOCATED: adjusting product % at location % by % would take on_hand below the allocated (reserved) amount',
                p_product_id, p_location_id, p_qty_delta
                USING ERRCODE = 'P0001';
    END;

    SELECT on_hand, allocated INTO v_after_on_hand, v_after_allocated
    FROM public.inventory_balances
    WHERE product_id = p_product_id
      AND location_id = p_location_id
      AND COALESCE(batch_id, 0) = COALESCE(v_batch_id, 0);

    RETURN jsonb_build_object(
        'product_id',       p_product_id,
        'location_id',      p_location_id,
        'batch_id',         v_batch_id,
        'movement_type',    p_movement_type,
        'qty_delta',        p_qty_delta,
        'before_on_hand',   v_before_on_hand,
        'before_allocated', v_before_allocated,
        'after_on_hand',    v_after_on_hand,
        'after_allocated',  v_after_allocated
    );
END;
$$;

REVOKE ALL ON FUNCTION public.inv_adjust_stock(INT,INT,NUMERIC,TEXT,UUID,BIGINT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_adjust_stock(INT,INT,NUMERIC,TEXT,UUID,BIGINT,TEXT) TO service_role;

COMMIT;

-- =============================================================================
-- Verify (Management API /database/query — service_role bypasses RLS):
--   -- shrinkage of 3 units at the default warehouse:
--   SELECT public.inv_adjust_stock(1, public.inv_default_location(), -3, 'Damaged in transit', NULL);
--   -- stocktake variance: counted total 47 when on_hand was 50 (delta -3):
--   SELECT public.inv_adjust_stock(1, public.inv_default_location(), -3, 'Stocktake 2026-07', NULL, NULL, 'stocktake_variance');
--   -- an over-large negative delta raises a clean, catchable error instead of
--   -- an opaque 23514:
--   --   ADJUSTMENT_BELOW_ALLOCATED: adjusting product 1 at location 2 by -999 ...
-- =============================================================================
