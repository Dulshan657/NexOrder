-- =============================================================================
-- Warehouse Intelligence Engine — editable grid scale
-- Migration: 00091_layout_grid_scale.sql
-- =============================================================================
-- Makes `warehouse_layouts.cell_size_m` a value an operator can actually set,
-- and gives mutate-layout a transactional way to apply a change of it.
--
-- WHY THIS EXISTS. cell_size_m has existed since 00045 (NUMERIC(6,2) DEFAULT
-- 1.0) and has been 1.0 on every layout ever created, because mutate-layout
-- accepted it on create and no caller ever sent it. Two things follow. Every
-- metre the engine reports — pick-route totals, replenishment walks, simulation
-- KPIs, "4.0 m from receiving dock" — is a cell count wearing a metre suffix.
-- And a 1.2 m bay cannot be drawn true, because cells are integers and the only
-- available cell was 1 m. Bin RANKING was never affected (scoring.ts min/max-
-- normalises the travel factor across the candidate set), so this has produced
-- unreadable numbers rather than wrong decisions.
--
-- WHAT CHANGES HERE.
--   1. A positivity CHECK on cell_size_m. The column has never had one, and it
--      is about to gain a write path. A zero would make every derived distance
--      infinite; a negative one would invert the routing graph.
--   2. wie_update_layout_tx — a transactional applier for a header change that
--      moves geometry.
--
-- WHY THE RPC IS DELIBERATELY DUMB. Changing the resolution rescales every
-- placement and object so the drawing keeps its real-world size (a 2 m bay stays
-- 2 m). That arithmetic is exact rational maths and it lives in ONE place,
-- supabase/functions/_shared/wie/gridScale.ts, which both the edge function and
-- the designer's preview modal import. Restating it in PL/pgSQL would be the
-- classic two-definitions-one-behaviour bug: the modal would promise one thing
-- and the server would do another. So the caller sends fully-computed
-- coordinates and this function only APPLIES them — atomically, which is the
-- part supabase-js cannot do. A half-rescaled layout is a corrupt layout.
--
-- The structural asserts below are a backstop, not the validation. They catch a
-- caller bug (a row left outside the new grid, a row that didn't exist) and
-- abort, rather than trusting the client-side maths absolutely.
--
-- NO REPUBLISH FLAG COLUMN. A published layout's distances are frozen into
-- layout_graph_edges.weight_m / layout_travel_distances.distance_m /
-- layout_placements.access_offset_m at publish time, so a scale change is inert
-- until the layout is republished. "Needs republish" is already derivable —
-- updated_at > published_at — because nothing else can bump updated_at on a
-- published layout (save_geometry refuses a non-draft, archive_layout leaves the
-- row non-published). lib/adapters.ts derives it there; a column would be a
-- second copy of a fact the table already holds.
--
-- Idempotent. Apply via supabase/migrate.mjs (ledgered + checksummed).
-- =============================================================================

BEGIN;

-- ── 1. cell_size_m must be positive ──────────────────────────────────────────
-- Guarded so a re-run is a no-op, and NOT VALID is deliberately NOT used: every
-- existing row is 1.0, so the validation scan is free and a validated constraint
-- is what we actually want.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.warehouse_layouts'::regclass
           AND conname  = 'warehouse_layouts_cell_size_positive'
    ) THEN
        ALTER TABLE public.warehouse_layouts
            ADD CONSTRAINT warehouse_layouts_cell_size_positive
            CHECK (cell_size_m > 0);
    END IF;
END $$;

-- ── 2. wie_update_layout_tx ──────────────────────────────────────────────────
-- p_header     {"name":…, "cell_size_m":…, "grid_width":…, "grid_height":…,
--               "floor_count":…}  — every key optional; absent means "leave it".
-- p_placements [{"id":…,"x":…,"y":…,"w":…,"h":…}] — rescaled rows, or NULL/'null'
--               when the resolution did not change.
-- p_objects    same shape, for layout_objects.
--
-- Returns the updated warehouse_layouts row.
CREATE OR REPLACE FUNCTION public.wie_update_layout_tx(
    p_layout_id  INT,
    p_header     JSONB,
    p_placements JSONB DEFAULT NULL,
    p_objects    JSONB DEFAULT NULL
)
RETURNS public.warehouse_layouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_layout   public.warehouse_layouts;
    v_grid_w   INT;
    v_grid_h   INT;
    v_floors   INT;
    v_expected INT;
    v_updated  INT;
    v_bad      INT;
BEGIN
    -- Claim the header first: two concurrent scale changes on one layout would
    -- otherwise interleave a rescale computed against a resolution that is no
    -- longer current.
    SELECT * INTO v_layout
      FROM public.warehouse_layouts
     WHERE id = p_layout_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Layout % not found', p_layout_id USING ERRCODE = 'no_data_found';
    END IF;

    -- An archived layout is a historical record. Drafts and PUBLISHED layouts are
    -- both editable here: a published layout's geometry rows are safe to move
    -- (they carry no stock — `locations` does), and the frozen graph is what the
    -- republish prompt exists to reconcile.
    IF v_layout.status = 'archived' THEN
        RAISE EXCEPTION 'Layout % is archived and cannot be edited', p_layout_id
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    v_grid_w := COALESCE((p_header ->> 'grid_width')::INT,  v_layout.grid_width);
    v_grid_h := COALESCE((p_header ->> 'grid_height')::INT, v_layout.grid_height);
    v_floors := COALESCE((p_header ->> 'floor_count')::INT, v_layout.floor_count);

    UPDATE public.warehouse_layouts
       SET name        = COALESCE(p_header ->> 'name', name),
           cell_size_m = COALESCE((p_header ->> 'cell_size_m')::NUMERIC, cell_size_m),
           grid_width  = v_grid_w,
           grid_height = v_grid_h,
           floor_count = v_floors,
           updated_at  = now()
     WHERE id = p_layout_id
    RETURNING * INTO v_layout;

    -- ── Apply rescaled geometry ──────────────────────────────────────────────
    IF p_placements IS NOT NULL AND jsonb_typeof(p_placements) = 'array' THEN
        WITH src AS (
            SELECT * FROM jsonb_to_recordset(p_placements) AS t(id INT, x INT, y INT, w INT, h INT)
        ), upd AS (
            UPDATE public.layout_placements lp
               SET x = src.x, y = src.y, w = src.w, h = src.h
              FROM src
             WHERE lp.id = src.id
               AND lp.layout_id = p_layout_id   -- never let a caller's id reach another layout
            RETURNING lp.id
        )
        SELECT count(*)::INT INTO v_updated FROM upd;

        v_expected := jsonb_array_length(p_placements);
        IF v_updated <> v_expected THEN
            RAISE EXCEPTION
                'Rescale touched % of % placements for layout % — the caller''s view of the layout is stale',
                v_updated, v_expected, p_layout_id
                USING ERRCODE = 'serialization_failure';
        END IF;
    END IF;

    IF p_objects IS NOT NULL AND jsonb_typeof(p_objects) = 'array' THEN
        WITH src AS (
            SELECT * FROM jsonb_to_recordset(p_objects) AS t(id INT, x INT, y INT, w INT, h INT)
        ), upd AS (
            UPDATE public.layout_objects lo
               SET x = src.x, y = src.y, w = src.w, h = src.h
              FROM src
             WHERE lo.id = src.id
               AND lo.layout_id = p_layout_id
            RETURNING lo.id
        )
        SELECT count(*)::INT INTO v_updated FROM upd;

        v_expected := jsonb_array_length(p_objects);
        IF v_updated <> v_expected THEN
            RAISE EXCEPTION
                'Rescale touched % of % objects for layout % — the caller''s view of the layout is stale',
                v_updated, v_expected, p_layout_id
                USING ERRCODE = 'serialization_failure';
        END IF;
    END IF;

    -- ── Structural backstop ──────────────────────────────────────────────────
    -- The caller (gridScale.planRescale) already refuses an out-of-bounds result
    -- with the offenders named, which is the diagnosis an operator can act on.
    -- This is the seatbelt: if a bug ever got past it, abort rather than persist
    -- a layout whose racks sit outside its own floor.
    SELECT count(*)::INT INTO v_bad
      FROM public.layout_placements
     WHERE layout_id = p_layout_id
       AND (x + w > v_grid_w OR y + h > v_grid_h OR floor >= v_floors);
    IF v_bad > 0 THEN
        RAISE EXCEPTION '% placement(s) would fall outside a % x % grid with % floor(s)',
            v_bad, v_grid_w, v_grid_h, v_floors
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)::INT INTO v_bad
      FROM public.layout_objects
     WHERE layout_id = p_layout_id
       AND (x + w > v_grid_w OR y + h > v_grid_h OR floor >= v_floors);
    IF v_bad > 0 THEN
        RAISE EXCEPTION '% object(s) would fall outside a % x % grid with % floor(s)',
            v_bad, v_grid_w, v_grid_h, v_floors
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN v_layout;
END;
$$;

REVOKE ALL ON FUNCTION public.wie_update_layout_tx(INT, JSONB, JSONB, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_update_layout_tx(INT, JSONB, JSONB, JSONB)
    TO service_role;

COMMIT;

-- Verify:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.warehouse_layouts'::regclass
--      AND conname='warehouse_layouts_cell_size_positive';
--   -- expect CHECK ((cell_size_m > (0)::numeric))
--
--   -- Rescale WIE-DEMO's draft 1.0 -> 0.5 inside a rolled-back transaction:
--   BEGIN;
--     SELECT (public.wie_update_layout_tx(
--       <layout_id>,
--       '{"cell_size_m":0.5,"grid_width":48,"grid_height":32}'::jsonb,
--       '[]'::jsonb, '[]'::jsonb)).cell_size_m;
--   ROLLBACK;
