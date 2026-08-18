-- =============================================================================
-- Ink-spread compensation, per site
-- Migration: 00110_warehouse_print_calibration.sql
-- =============================================================================
-- WHY THIS EXISTS. `generate-labels` has carried BAR_WIDTH_REDUCTION_PT = 0
-- since Code 128 labels shipped: wired into the renderer, documented, and never
-- calibrated, because guessing at bar-width reduction is how you make a good
-- symbol worse. Registered as O12. The blocker was never the number, it was
-- that setting one meant editing a constant and deploying an Edge Function --
-- so the evidence could only be collected by someone who could also deploy.
--
-- A laser prints bars slightly wider than nominal. That narrows the spaces and
-- shifts the ratios a decoder measures, which is why a printer can silently
-- ruin a symbol that passes every check in this repo. Compensation is the
-- correction, and it is a property of the PRINTER.
--
-- HENCE A SEPARATE TABLE, NOT A COLUMN ON warehouse_label_prefs. That table is
-- keyed (warehouse_id, sheet_group) because slots, wayfinding and staging
-- genuinely come off three different die-cuts. A printer is not three things.
-- Hanging this off that key would let one site hold three disagreeing answers
-- about one physical device, and there is no reading of that which is correct.
--
-- Everything else follows 00106 deliberately, so the two read as siblings:
--   * NO ROW MEANS THE BUILT-IN DEFAULT (0). Nothing needs backfilling, a new
--     warehouse prints correctly before anyone opens the wizard, and clearing
--     the setting is a DELETE rather than a sentinel -- "uncalibrated" has
--     exactly one representation.
--   * RLS: ops roles read, service_role writes, no `authenticated` write policy
--     at all.
--   * Written only through mutate-warehouse (`set_print_calibration`), beside
--     `set_label_prefs` and `set_code_pattern`.
--
-- THE CHECK IS A BOUND ON TYPING, NOT THE SAFETY PROPERTY. 0.5pt is already far
-- past what any printer spreads (a point is 0.353mm; real reduction is
-- 0.02-0.08mm). What actually protects the symbol is the clamp in
-- _shared/labels/sizing.ts: the narrowest bar in a Code 128 symbol is ONE
-- module, so the reduction is capped at a fraction of the module width at
-- render time. A constraint here cannot know the module width -- that depends
-- on the code and the sticker -- which is precisely why the real guard lives in
-- the pure module both runtimes share.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouse_print_calibration (
    warehouse_id             INT           PRIMARY KEY
                                 REFERENCES public.locations(id) ON DELETE CASCADE,
    bar_width_reduction_pt   NUMERIC(4,3)  NOT NULL
                                 CHECK (bar_width_reduction_pt >= 0
                                    AND bar_width_reduction_pt <= 0.5),
    -- Free text, and worth having: a calibration is the outcome of a physical
    -- exercise, and six months later "0.06" says nothing about which printer or
    -- which gun produced it.
    note                     TEXT          CHECK (note IS NULL OR length(note) <= 300),
    updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_by               UUID          REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.warehouse_print_calibration IS
    'Ink-spread compensation for the printer at each warehouse. Absent row = no '
    'compensation, which is the built-in default and what every site did before '
    'mig 00110. Written only by the mutate-warehouse Edge Function via '
    'service_role. See docs/runbooks/calibrate-label-bar-width.md.';

COMMENT ON COLUMN public.warehouse_print_calibration.bar_width_reduction_pt IS
    'Points subtracted from every dark bar at render time. Bounded here at 0.5 '
    'as a limit on what may be typed; the load-bearing guard is the per-module '
    'clamp in _shared/labels/sizing.ts, which this constraint cannot express.';

ALTER TABLE public.warehouse_print_calibration ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_print_calibration_select_ops" ON public.warehouse_print_calibration;
CREATE POLICY "warehouse_print_calibration_select_ops"
    ON public.warehouse_print_calibration FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

-- No INSERT/UPDATE/DELETE policy for `authenticated`: with RLS on and no
-- permissive policy every such write is denied, while service_role bypasses RLS
-- so the Edge Function still writes.

GRANT SELECT ON public.warehouse_print_calibration TO authenticated;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT warehouse_id, bar_width_reduction_pt, note
--     FROM public.warehouse_print_calibration ORDER BY warehouse_id;
--
--   -- Should be denied for `authenticated` (only service_role may write):
--   INSERT INTO public.warehouse_print_calibration (warehouse_id, bar_width_reduction_pt)
--   VALUES (1, 0.06);
--
--   -- The CHECK must refuse an out-of-range value outright:
--   INSERT INTO public.warehouse_print_calibration (warehouse_id, bar_width_reduction_pt)
--   VALUES (1, 5);   -- expect: violates check constraint
--
-- Rollback:
--   DROP TABLE IF EXISTS public.warehouse_print_calibration;
-- =============================================================================
