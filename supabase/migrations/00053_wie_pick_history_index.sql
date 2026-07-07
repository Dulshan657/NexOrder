-- =============================================================================
-- Warehouse Intelligence Engine — pick-history scan index (Phase 6 follow-up)
-- Migration: 00053_wie_pick_history_index.sql
-- =============================================================================
-- wie_simulation_pick_history (00052) and the velocity/traffic refreshes (00049)
-- scan inventory_movements filtered to movement_type='pick' AND ref_type='order'
-- over a recent window. A partial index on created_at for exactly that predicate
-- keeps the window scan cheap as movement volume grows. Additive & idempotent.
-- =============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_pick_order_created
    ON public.inventory_movements (created_at)
    WHERE movement_type = 'pick' AND ref_type = 'order';

COMMIT;
