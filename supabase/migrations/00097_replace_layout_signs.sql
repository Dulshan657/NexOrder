-- =============================================================================
-- Floor signs — the atomic sign replace
-- Migration: 00097_replace_layout_signs.sql
-- =============================================================================
-- A `label` object (00045) is the plain text annotation an operator reads on the
-- floor: MAIN carries five of them — "Inbound staging", "Outbound staging",
-- "Cold room", "Returns", "Quarantine" — written by warehouse-main/layout.mjs.
-- Until now they could only be authored on a DRAFT, because `mutate-layout`
-- `save_geometry` was their only writer and it calls requireDraft. That is
-- backwards for signage in exactly the way 00095 said it was for areas:
-- wayfinding vocabulary is discovered AFTER go-live, and the only remedies were
-- cloning and republishing a whole layout — rebuilding the routing graph and
-- refreezing every edge weight, to move a word — or living with it.
--
-- WHY THIS IS SAFE ON A LIVE LAYOUT. Same argument as 00095, and if anything
-- stronger. A `label` row is INERT in routing: buildWalkableCells
-- (_shared/wie/publishReadiness.ts) adds only walkway/dock/lift/staging and
-- subtracts only wall/conveyor; publish-layout reads object_type solely to
-- collect staging_location_id; resolveOverlaps exempts labels outright. A sign
-- contributes no graph node, no edge weight and no access_offset_m, so editing
-- one cannot invalidate anything wie_publish_layout_tx froze. That is also why
-- the caller must NOT bump warehouse_layouts.updated_at: `needsRepublish` is
-- derived from `updated_at > published_at`, and demanding a routing-graph
-- rebuild because somebody labelled a corner would be a lie.
--
-- A SIGN IS NOT AN AREA. Both are painted cells carrying meta.name and both are
-- inert, but an area is warehouse vocabulary with consequences — it renames the
-- bins standing on it (00094) and re-parents them under a ZONE (00096). A sign
-- is text. The caller of this function runs NO name cascade and NO zone binding,
-- and that asymmetry with paint_areas is the entire point of having two actions
-- rather than one. Do not "unify" them.
--
-- WHAT THIS FUNCTION IS FOR. Replacing a sign's cells is a DELETE plus an
-- INSERT, and two supabase-js statements are not a transaction. Delete-first
-- means a failed insert leaves a live warehouse with every sign gone; there is
-- no ordering of two separate statements that is actually correct. So it is one
-- pair inside one transaction — the same reasoning as wie_replace_layout_areas_tx
-- (00095) and wie_update_layout_tx (00091).
--
-- ROWS ARE 1x1 AND THAT IS ENFORCED HERE. The designer's paint_cell removes the
-- WHOLE object covering a cell, so a stored multi-cell run would vanish
-- wholesale the first time an operator repainted one cell of it. Run-length
-- packing exists on the wire only.
--
-- CONSEQUENCE WORTH STATING PLAINLY: the first sign save on a site rewrites its
-- seeded wide labels as 1x1 rows — MAIN's five become ~42. That round-trips
-- losslessly. areaSpecsFromObjects expands w/h defensively when folding, and
-- objectRegions merges same-name cells back into one region, so the text draws
-- exactly where it did. Do not add a w/h escape hatch to "preserve" them.
--
-- No new columns and no CHECK change: 'label' has been a legal object_type since
-- 00045 and layout_objects.meta already carries { name }.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wie_replace_layout_labels_tx(
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
        RAISE EXCEPTION 'wie_replace_layout_labels_tx expects an array of cells'
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
    -- 00095 and the rescale planner follow. A cell outside the grid is a caller
    -- bug, and silently moving it would put an operator's sign somewhere they
    -- did not put it.
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
            'Sign cell (floor %, %, %) is outside this layout''s % x % grid over % floor(s)',
            v_bad.floor, v_bad.x, v_bad.y, v_width, v_height, v_floors
            USING ERRCODE = 'check_violation';
    END IF;

    -- A sign with no text says nothing, and both canvases skip it — so storing
    -- one would be an invisible row that survives every later replace and can
    -- never be clicked to remove.
    PERFORM 1
       FROM jsonb_to_recordset(p_rows) AS r(meta JSONB)
      WHERE r.meta IS NULL
         OR btrim(COALESCE(r.meta->>'name', '')) = ''
      LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Every sign cell must carry a non-blank meta.name'
            USING ERRCODE = 'check_violation';
    END IF;

    -- The replace. Old rows go first INSIDE the transaction, which is the whole
    -- point of doing this here rather than as two client statements.
    DELETE FROM public.layout_objects
     WHERE layout_id = p_layout_id
       AND object_type = 'label';

    INSERT INTO public.layout_objects (layout_id, object_type, floor, x, y, w, h, meta)
    SELECT p_layout_id, 'label', r.floor, r.x, r.y, 1, 1, r.meta
      FROM jsonb_to_recordset(p_rows) AS r(floor INT, x INT, y INT, meta JSONB);

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;

-- A SECURITY DEFINER writer of layout geometry reachable from the browser is a
-- way around the Edge Function role gate. Service role only, exactly as
-- wie_replace_layout_areas_tx (00095) and wie_rename_locations_tx (00094).
REVOKE ALL ON FUNCTION public.wie_replace_layout_labels_tx(INT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_replace_layout_labels_tx(INT, JSONB)
    TO service_role;

COMMIT;

-- Verify:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'wie_replace_layout_labels_tx';
--
--   -- Grants: expect service_role only.
--   SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--    WHERE routine_name = 'wie_replace_layout_labels_tx';
--
--   -- Bounds backstop bites (expect check_violation), rollback-isolated:
--   BEGIN;
--     SELECT public.wie_replace_layout_labels_tx(
--       (SELECT active_layout_id FROM locations WHERE code = 'MAIN'),
--       '[{"floor":0,"x":99999,"y":0,"meta":{"name":"Nope"}}]'::jsonb);
--   ROLLBACK;
--
--   -- Blank text refused (expect check_violation):
--   BEGIN;
--     SELECT public.wie_replace_layout_labels_tx(
--       (SELECT active_layout_id FROM locations WHERE code = 'MAIN'),
--       '[{"floor":0,"x":0,"y":0,"meta":{"name":"  "}}]'::jsonb);
--   ROLLBACK;
--
--   -- Round trip leaves only 1x1 rows (expect non_unit = 0):
--   SELECT count(*) FILTER (WHERE w <> 1 OR h <> 1) AS non_unit, count(*) AS total
--     FROM layout_objects
--    WHERE layout_id = (SELECT active_layout_id FROM locations WHERE code = 'MAIN')
--      AND object_type = 'label';
--
--   -- Signs must never move a bin. Expect an identical count before and after:
--   SELECT count(*) FROM locations
--    WHERE materialized_path LIKE 'MAIN/%' AND parent_id IS NOT NULL;
