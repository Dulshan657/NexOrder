-- =============================================================================
-- Warehouse setup acknowledgements — the operator half of the setup checklist
-- Migration: 00092_warehouse_setup_acknowledgements.sql
-- =============================================================================
-- WHY THIS EXISTS. Standing a warehouse up is strictly order-dependent (see
-- WAREHOUSE-ONBOARDING-PLAN.md's dependency chain): storage forms and level
-- roles must be settled BEFORE racks are drawn, because a bin's capacity is
-- derived from its storage form's levels x positions; labels must be on the
-- racking BEFORE a count by bin, because otherwise the count cannot be
-- transcribed. Nothing in the UI hinted at any of it — gap M2.
--
-- The checklist that closes M2 derives most of its state from the database
-- (is a layout published? are labels confirmed? is there stock in a bin?).
-- Three kinds of step cannot be derived, and this table is where they live:
--
--   1. REVIEWED steps. storage_types, level_roles and zone_profiles all ship
--      SEEDED (migs 00056/00061/00073, 00081, 00047), and level_roles is
--      additionally backstopped by placeholderData client-side — so "a row
--      exists" is permanently true and proves nothing. What matters is whether
--      an operator has checked the seeded defaults against the real racking: a
--      seeded PALLET_RACK is 4 x 24 and this building's bays may not be.
--   2. PHYSICAL steps. Whether someone walked the aisles with a phone to test
--      wifi coverage (gap M5) leaves no trace in any table.
--   3. EXERCISE steps. Whether a receipt, an order and a replenishment have
--      each been driven end to end before go-live. Rows for these exist, but a
--      seeded or demo row would false-positive them, so they are stated, not
--      inferred.
--
-- Deliberately NOT a dismissal mechanism. There is no "hide this warehouse"
-- row: a site whose derivable steps all pass collapses its panel on its own,
-- so nothing here can ever conceal a genuinely missing step.
--
-- Additive. Idempotent. Apply via the Management API (see CLAUDE.md); do not
-- run interactively.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouse_setup_acknowledgements (
    id              BIGSERIAL PRIMARY KEY,
    -- Warehouses are locations (kind='WAREHOUSE') since mig 00036. ON DELETE
    -- CASCADE because an acknowledgement about a deleted site is meaningless.
    warehouse_id    INT  NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    step_key        TEXT NOT NULL,
    note            TEXT,
    acknowledged_by UUID REFERENCES public.profiles(id),
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT warehouse_setup_ack_step_key_check
        CHECK (step_key <> '' AND length(step_key) <= 64)
);

COMMENT ON TABLE public.warehouse_setup_acknowledgements IS
    'Operator sign-offs for warehouse setup steps that cannot be derived from data — reviewed config, physical checks, and pre-go-live exercises. One row per (warehouse, step); the row existing IS the acknowledgement.';
COMMENT ON COLUMN public.warehouse_setup_acknowledgements.step_key IS
    'Matches a key in lib/warehouseSetup/steps.ts. Validated in mutate-warehouse-setup-ack against that list, not by a CHECK — the step list is app vocabulary and must not require a migration to change.';
COMMENT ON COLUMN public.warehouse_setup_acknowledgements.note IS
    'Optional free text: what was checked, or what was deliberately accepted as-is.';

-- The row existing is the acknowledgement, so (warehouse, step) is the natural
-- key. Re-acknowledging is an upsert, and revoking is a delete.
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_setup_ack
    ON public.warehouse_setup_acknowledgements(warehouse_id, step_key);

-- RLS: read-only for ops; writes go through mutate-warehouse-setup-ack
-- (service_role). Mirrors level_roles (00081) and wie_replen_tasks (00082).
-- Warehouse-role staff can SELECT so the panel reads consistently for whoever
-- is standing on the floor, but only Admin/Manager can write (enforced in the
-- function — the roles that can actually perform the steps).
ALTER TABLE public.warehouse_setup_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "warehouse_setup_ack_select_ops" ON public.warehouse_setup_acknowledgements;
CREATE POLICY "warehouse_setup_ack_select_ops" ON public.warehouse_setup_acknowledgements
    FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));
GRANT SELECT ON public.warehouse_setup_acknowledgements TO authenticated;
-- No write policy. mutate-warehouse-setup-ack is the only write path.

COMMIT;

-- Verify:
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.warehouse_setup_acknowledgements'::regclass;   -- t
--   SELECT polname, polcmd FROM pg_policy
--    WHERE polrelid = 'public.warehouse_setup_acknowledgements'::regclass;
--   -- expect exactly one row: warehouse_setup_ack_select_ops / r
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'warehouse_setup_acknowledgements';
--   -- expect the pkey + uq_warehouse_setup_ack
