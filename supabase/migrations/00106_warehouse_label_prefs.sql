-- =============================================================================
-- Which sticker stock a site prints on
-- Migration: 00106_warehouse_label_prefs.sql
-- =============================================================================
-- WHY THIS EXISTS. Label size stopped being a constant when locations moved
-- from QR to Code 128. A QR is square and shrinks gracefully; a linear barcode's
-- readability IS its width, so the right sheet depends on how long that site's
-- codes encode and how far away the operator scans. `AMD-B-12-7-L3` gets 0.31mm
-- bars on a 63x34mm sticker and 0.48mm on a 99x38mm one — the difference
-- between a label that fails once it is scuffed and one that does not.
--
-- A site buys one kind of sticker and keeps buying it, so the choice belongs to
-- the warehouse rather than to whoever happens to be at the printer. But it is
-- per SHEET GROUP, not per warehouse: slots, wayfinding signs and staging
-- genuinely come off three different die-cuts, and collapsing them to one
-- column would make choosing a bin sticker silently resize the aisle signs.
--
-- NO ROW MEANS THE BUILT-IN DEFAULT. SHEET_GROUPS in
-- _shared/labels/layoutLabelPlan.ts stays the fallback, so nothing needs
-- backfilling, a new warehouse works before anyone opens the sizing wizard, and
-- deleting a row is a clean revert rather than a broken state.
--
-- `preset` is TEXT and not an enum on purpose: preset names live in TypeScript
-- (SHEET_PRESETS), adding a stock should not need a migration, and the value is
-- validated by zod at the Edge Function boundary. The CHECK on `sheet_group`
-- is different — those three names are a closed vocabulary shared with
-- label_print_log.sheet_group, and freezing them here is what stops a typo
-- creating a preference no code will ever read.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouse_label_prefs (
    warehouse_id  INT         NOT NULL
                      REFERENCES public.locations(id) ON DELETE CASCADE,
    sheet_group   TEXT        NOT NULL
                      CHECK (sheet_group IN ('wayfinding', 'slots', 'staging')),
    preset        TEXT        NOT NULL CHECK (length(preset) BETWEEN 1 AND 32),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    PRIMARY KEY (warehouse_id, sheet_group)
);

COMMENT ON TABLE public.warehouse_label_prefs IS
    'The sticker stock each warehouse prints each sheet group on. Absent row = '
    'the built-in default in _shared/labels/layoutLabelPlan.ts SHEET_GROUPS. '
    'Written only by the mutate-warehouse Edge Function via service_role.';

COMMENT ON COLUMN public.warehouse_label_prefs.preset IS
    'A SHEET_PRESETS key (e.g. a4-14). Deliberately not an enum: preset names '
    'live in TypeScript and are validated by zod at the function boundary.';

-- RLS: ops roles read, service_role writes. Same shape as label_print_log
-- (00074) and every other Edge-Function-owned table.
ALTER TABLE public.warehouse_label_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_label_prefs_select_ops" ON public.warehouse_label_prefs;
CREATE POLICY "warehouse_label_prefs_select_ops"
    ON public.warehouse_label_prefs FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

-- No INSERT/UPDATE/DELETE policy for `authenticated` at all: with RLS enabled
-- and no permissive policy every such write is denied, while service_role
-- bypasses RLS so the Edge Function still writes.

GRANT SELECT ON public.warehouse_label_prefs TO authenticated;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT warehouse_id, sheet_group, preset FROM public.warehouse_label_prefs
--    ORDER BY warehouse_id, sheet_group;
--
--   -- Should be denied for `authenticated` (only service_role may write):
--   INSERT INTO public.warehouse_label_prefs (warehouse_id, sheet_group, preset)
--   VALUES (1, 'slots', 'a4-14');
--
-- Rollback:
--   DROP TABLE IF EXISTS public.warehouse_label_prefs;
-- =============================================================================
