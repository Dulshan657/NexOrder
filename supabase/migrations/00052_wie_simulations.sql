-- =============================================================================
-- Warehouse Intelligence Engine — analytical what-if simulation (Phase 6)
-- Migration: 00052_wie_simulations.sql
-- =============================================================================
-- Stores the result of scoring a layout against historical demand, and provides
-- the demand loader: the distinct (order, bin) picks in a recent window at a
-- warehouse. The wie-simulate edge function replays those picks through a TARGET
-- layout (draft or active) via the engine's simulate.ts, computes KPIs (travel,
-- utilization, congestion), and diffs against the active layout — so an operator
-- can see whether a draft would cut picker travel before publishing it.
--
-- Additive, read-mostly; the loader is service-role only, simulations are
-- read-only to ops (written by the edge function). Idempotent.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.wie_simulations (
    id                 BIGSERIAL PRIMARY KEY,
    warehouse_id       INT  NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    layout_id          INT  NOT NULL REFERENCES public.warehouse_layouts(id) ON DELETE CASCADE,
    baseline_layout_id INT  REFERENCES public.warehouse_layouts(id) ON DELETE SET NULL,
    params             JSONB NOT NULL DEFAULT '{}',   -- { days, orderCount }
    kpis               JSONB NOT NULL,
    baseline_kpis      JSONB,
    diff               JSONB,
    created_by         UUID REFERENCES public.profiles(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wie_simulations_layout
    ON public.wie_simulations(layout_id, created_at DESC);

-- Demand loader: distinct (order, bin) picked in the last p_days at the warehouse.
-- The edge function maps each bin to the target layout's placement to build stops.
CREATE OR REPLACE FUNCTION public.wie_simulation_pick_history(
    p_warehouse_id INT,
    p_days         INT DEFAULT 30
)
RETURNS TABLE(order_id TEXT, location_id INT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT DISTINCT m.ref_id, m.location_id
    FROM public.inventory_movements m
    WHERE m.movement_type = 'pick'
      AND m.ref_type = 'order'
      AND m.created_at >= now() - make_interval(days => p_days)
      AND public.inv_root_warehouse(m.location_id) = p_warehouse_id
$$;

REVOKE ALL ON FUNCTION public.wie_simulation_pick_history(INT,INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_simulation_pick_history(INT,INT) TO service_role;

-- RLS: simulations readable by ops; written by the service-role edge function.
ALTER TABLE public.wie_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wie_simulations_select_ops" ON public.wie_simulations;
CREATE POLICY "wie_simulations_select_ops" ON public.wie_simulations FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));
GRANT SELECT ON public.wie_simulations TO authenticated;

COMMIT;

-- Verify:
--   SELECT to_regclass('public.wie_simulations');
--   SELECT count(*) FROM public.wie_simulation_pick_history(<warehouse_id>, 30);
