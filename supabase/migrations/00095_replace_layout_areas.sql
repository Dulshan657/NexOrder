-- =============================================================================
-- Live area painting — the atomic area replace
-- Migration: 00095_replace_layout_areas.sql
-- =============================================================================
-- Named areas (00090) could only ever be painted on a DRAFT layout, because
-- `mutate-layout` `save_geometry` is the only writer of `layout_objects` and it
-- calls requireDraft. That is backwards for what an area actually is: wayfinding
-- vocabulary is discovered AFTER go-live — the chiller corner gets a name when
-- someone walks it, "Bulk" turns out to cover two racks it shouldn't. Until now
-- the only remedies were cloning and republishing a whole layout (rebuilding the
-- routing graph and refreezing every edge weight, for a signage change) or
-- living with it.
--
-- WHY THIS IS SAFE ON A LIVE LAYOUT, precisely. An `area` row is INERT in
-- routing: buildWalkableCells (_shared/wie/publishReadiness.ts) adds only
-- walkway/dock/lift/staging and subtracts only wall/conveyor, and publish-layout
-- reads object_type solely to collect staging_location_id. An area contributes no
-- graph node, no edge weight and no access_offset_m, so editing one cannot
-- invalidate anything wie_publish_layout_tx froze. That is also why the caller
-- must NOT bump warehouse_layouts.updated_at: `needsRepublish` is derived from
-- `updated_at > published_at`, and demanding a routing-graph rebuild because
-- somebody labelled a corner would be a lie.
--
-- WHAT THIS FUNCTION IS FOR. Replacing an area's cells is a DELETE plus an
-- INSERT, and two supabase-js statements are not a transaction. Delete-first
-- means a failed insert leaves a live warehouse with every area gone; there is no
-- ordering of two separate statements that is actually correct. So it is one
-- statement pair inside one transaction — the same reasoning as wie_update_layout_tx
-- (00091): "a half-rescaled layout is a corrupt layout".
--
-- Deliberately dumb, like every other tx RPC here. The naming maths, the
-- majority-of-cells containment rule and the cascade all live in the ONE pure
-- module both runtimes import (_shared/wie/areaPaint.ts + locationNaming.ts).
-- This applies coordinates and validates bounds. Nothing else.
--
-- ROWS ARE 1x1 AND THAT IS ENFORCED HERE. The designer's paint_cell removes the
-- WHOLE object covering a cell, so a stored multi-cell run would vanish wholesale
-- the first time an operator repainted one cell of it. Run-length packing exists
-- on the wire only, and this refuses anything else so the invariant cannot rot
-- from a future caller.
--
-- No new columns: layout_objects.meta already carries { name, zoneProfileId }
-- from 00090, and locations' name provenance already exists from 00094.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_replace_layout_areas_tx(
    p_layout_id INT,
    p_rows      JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_width    INT;
    v_height   INT;
    v_floors   INT;
    v_bad      RECORD;
    v_inserted INT;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'wie_replace_layout_areas_tx expects an array of cells'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT grid_width, grid_height, floor_count
      INTO v_width, v_height, v_floors
      FROM public.warehouse_layouts
     WHERE id = p_layout_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Layout % not found', p_layout_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Bounds backstop. Named, never clamped and never relocated — the same rule
    -- the rescale planner follows. A cell outside the grid is a caller bug, and
    -- silently moving it would put an operator's label somewhere they did not
    -- put it.
    SELECT r.floor, r.x, r.y
      INTO v_bad
      FROM jsonb_to_recordset(p_rows) AS r(floor INT, x INT, y INT, meta JSONB)
     WHERE r.floor IS NULL OR r.x IS NULL OR r.y IS NULL
        OR r.floor < 0 OR r.floor >= v_floors
        OR r.x     < 0 OR r.x     >= v_width
        OR r.y     < 0 OR r.y     >= v_height
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Area cell (floor %, %, %) is outside this layout''s % x % grid over % floor(s)',
            v_bad.floor, v_bad.x, v_bad.y, v_width, v_height, v_floors
            USING ERRCODE = 'check_violation';
    END IF;

    -- An area with no name names nothing, and buildAreaIndex would skip it — so
    -- storing one would be an invisible row that survives every later replace.
    PERFORM 1
       FROM jsonb_to_recordset(p_rows) AS r(meta JSONB)
      WHERE r.meta IS NULL
         OR btrim(COALESCE(r.meta->>'name', '')) = ''
      LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Every area cell must carry a non-blank meta.name'
            USING ERRCODE = 'check_violation';
    END IF;

    -- The replace. Old rows go first INSIDE the transaction, which is the whole
    -- point of doing this here rather than as two client statements.
    DELETE FROM public.layout_objects
     WHERE layout_id = p_layout_id
       AND object_type = 'area';

    INSERT INTO public.layout_objects (layout_id, object_type, floor, x, y, w, h, meta)
    SELECT p_layout_id, 'area', r.floor, r.x, r.y, 1, 1, r.meta
      FROM jsonb_to_recordset(p_rows) AS r(floor INT, x INT, y INT, meta JSONB);

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;

-- A SECURITY DEFINER writer of layout geometry reachable from the browser is a
-- way around the Edge Function role gate. Service role only, exactly as
-- wie_rename_locations_tx (00094).
REVOKE ALL ON FUNCTION public.wie_replace_layout_areas_tx(INT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_replace_layout_areas_tx(INT, JSONB)
    TO service_role;

COMMIT;

-- Verify:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'wie_replace_layout_areas_tx';
--
--   -- Grants: expect service_role only.
--   SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--    WHERE routine_name = 'wie_replace_layout_areas_tx';
--
--   -- Bounds backstop bites (expect check_violation), rollback-isolated:
--   BEGIN;
--     SELECT public.wie_replace_layout_areas_tx(
--       (SELECT active_layout_id FROM locations WHERE code = 'WIEDEMO'),
--       '[{"floor":0,"x":99999,"y":0,"meta":{"name":"Nope"}}]'::jsonb);
--   ROLLBACK;
--
--   -- Blank name refused (expect check_violation):
--   BEGIN;
--     SELECT public.wie_replace_layout_areas_tx(
--       (SELECT active_layout_id FROM locations WHERE code = 'WIEDEMO'),
--       '[{"floor":0,"x":0,"y":0,"meta":{"name":"  "}}]'::jsonb);
--   ROLLBACK;
--
--   -- Round trip leaves only 1x1 rows (expect non_unit = 0):
--   SELECT count(*) FILTER (WHERE w <> 1 OR h <> 1) AS non_unit, count(*) AS total
--     FROM layout_objects
--    WHERE layout_id = (SELECT active_layout_id FROM locations WHERE code = 'WIEDEMO')
--      AND object_type = 'area';
