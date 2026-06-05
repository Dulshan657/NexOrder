-- =============================================================================
-- Fix: inv_apply_leg must UPDATE-first, not insert the bare delta
-- Migration: 00029_fix_inv_apply_leg_upsert.sql
-- =============================================================================
-- Postgres validates table CHECK constraints on the candidate INSERT row BEFORE
-- evaluating ON CONFLICT, so a pure 'allocate' leg — candidate (on_hand 0,
-- allocated +n) — trips `allocated <= on_hand` before the upsert can fold it
-- into the existing slot. Reserve/pick/deallocate always operate on an existing
-- slot; only receipt may create one (with valid on_hand>0, allocated 0). So:
-- UPDATE the slot with FINAL values first (CHECK validates the real row), and
-- INSERT only when no slot exists.
--
-- Idempotent CREATE OR REPLACE; EXECUTE grants are preserved across replace.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.inv_apply_leg(
    p_product_id    INT,
    p_location_id   INT,
    p_batch_id      INT,
    p_onhand_delta  NUMERIC,
    p_alloc_delta   NUMERIC,
    p_movement_type TEXT,
    p_actor         UUID,
    p_ref_type      TEXT,
    p_ref_id        TEXT,
    p_reason        TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
        (product_id, location_id, batch_id, qty_delta, movement_type, ref_type, ref_id, actor_id, reason)
    VALUES
        (p_product_id, p_location_id, p_batch_id,
         CASE WHEN p_movement_type IN ('allocate','deallocate') THEN p_alloc_delta ELSE p_onhand_delta END,
         p_movement_type, p_ref_type, p_ref_id, p_actor, p_reason);

    PERFORM public.inv_recompute_product_cache(p_product_id);
END;
$$;

COMMIT;
