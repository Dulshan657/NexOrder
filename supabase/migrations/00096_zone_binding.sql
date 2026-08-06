-- =============================================================================
-- Bind a named area's bins to its ZONE — the re-parent writer
-- Migration: 00096_zone_binding.sql
-- =============================================================================
-- 00090 gave an area a `meta.zoneProfileId` and nothing has ever read it. That
-- was deliberate — the visual layer shipped on its own — but it left the tag
-- inert, and this is the migration that makes it real.
--
-- A bin's zone is not a column. It is DERIVED, at read time, by prefix-matching
-- the bin's materialized_path against kind='ZONE' rows — the LATERAL join inside
-- wie_putaway_candidates (live at 00078):
--
--     LEFT JOIN LATERAL (
--         SELECT z.id, z.name, z.zone_profile_id FROM public.locations z
--         WHERE z.kind = 'ZONE' AND l.materialized_path LIKE z.materialized_path || '/%'
--         ORDER BY length(z.materialized_path) DESC LIMIT 1
--     ) zone ON true
--
-- Every drawn bin is parented at the WAREHOUSE ROOT, so that LATERAL has
-- returned NULL for every bin on every racked site since the day it was written.
-- zone_id, zone_tag, zone_type, priority_weight, allowed_categories and
-- max_utilization_pct are NULL everywhere. The engine carries a complete zone
-- subsystem that has never once fired.
--
-- Making the tag real therefore means RE-PARENTING: a new parent_id AND a new
-- materialized_path, plus a rewritten path on every SHELF child of a levelled
-- rack. locations carries NO TRIGGER (pg_trigger is empty for it) — the path is
-- maintained entirely by hand, by four writers, and parent_id and
-- materialized_path are two independent copies of one edge with nothing in the
-- database enforcing that they agree.
--
-- WHY AN RPC AND NOT N SUPABASE-JS UPDATES. Identical reasoning to
-- wie_rename_locations_tx (00094): a 189-bay warehouse is 1134 rows (189 racks +
-- 945 shelves), which as round trips does not fit inside the 20s fetch ceiling.
-- More importantly a half-rewritten path set is a CORRUPT TREE — bins whose path
-- no longer starts with the warehouse's fall out of getWarehouseLocations'
-- LIKE '<wh>/%' and render as an all-grey map over an empty Locations tree,
-- while simultaneously vanishing from wie_putaway_candidates. That failure has a
-- precedent in this repo (6a253b2) and it must be one statement or none.
--
-- Deliberately dumb, exactly like wie_rename_locations_tx and wie_update_layout_tx
-- (00091): the containment rule that decides WHICH area a rack is in — the
-- majority-of-cells vote with its tie-break — is not restated in PL/pgSQL. It
-- lives in the one pure module both runtimes import
-- (_shared/wie/locationNaming.ts's areaForRect, reused by _shared/wie/zoneBinding.ts).
-- This applies coordinates the caller computed, and validates scope. Nothing else.
--
-- NO BACKFILL, for the reason 00094 gave for defaulting name_is_auto to false: a
-- migration that silently re-parents 945 live rows is a backfill wearing a
-- disguise. Binding happens on the next paint/save, or through the `bind_zones`
-- action, which previews the exact count first.
--
-- No new columns. locations.parent_id and locations.materialized_path have both
-- existed since 00027; layout_objects.meta has carried { name, zoneProfileId }
-- since 00090. Nothing here is new state — this is the writer that was missing.
-- =============================================================================

BEGIN;

-- ── 1. wie_reparent_locations_tx — the batched re-parent writer ─────────────
-- Rows are { id, parent_id, materialized_path }.
--
-- A SHELF row of a re-parented rack rides along with its parent_id UNCHANGED and
-- only its path rewritten: a level's path is composed from string parts at
-- creation (mutate-layout builds `${parentPath}/${rackCode}/${levelCode}`), never
-- read back from its rack, so moving a rack silently invalidates every child path
-- unless the children are in the same batch.
--
-- THREE scope guards, all inside the one UPDATE, because two of them are new
-- questions that wie_rename_locations_tx never had to ask. A rename cannot move a
-- row out of its warehouse; a re-parent is exactly the operation that can.
--
--   1. the row's CURRENT path is under this warehouse  (same guard as 00094)
--   2. the row's NEW path is under this warehouse      (it must not escape)
--   3. the NEW parent is itself under this warehouse   (or is the warehouse)
--
-- Guard 3 is not implied by guard 2. A caller could compute a well-formed path
-- string that agrees with the warehouse prefix while pointing parent_id at a row
-- in another site, and the tree would then disagree with the path forever — the
-- precise corruption the two-representations problem invites.

CREATE OR REPLACE FUNCTION public.wie_reparent_locations_tx(
    p_warehouse_path TEXT,
    p_rows           JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated  INT;
    v_expected INT;
    v_bad      INT;
BEGIN
    IF p_warehouse_path IS NULL OR btrim(p_warehouse_path) = '' THEN
        RAISE EXCEPTION 'wie_reparent_locations_tx requires a warehouse path'
            USING ERRCODE = 'null_value_not_allowed';
    END IF;

    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'wie_reparent_locations_tx expects an array of rows'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_expected := jsonb_array_length(p_rows);
    IF v_expected = 0 THEN
        RETURN 0;
    END IF;

    -- materialized_path is NOT NULL, and parent_id is NOT NULL for every kind
    -- except WAREHOUSE (locations_parent_required, 00027). Nothing in this batch
    -- is ever a warehouse root, so both are required here.
    SELECT count(*)::INT INTO v_bad
      FROM jsonb_to_recordset(p_rows) AS r(id INT, parent_id INT, materialized_path TEXT)
     WHERE r.id IS NULL
        OR r.parent_id IS NULL
        OR r.materialized_path IS NULL
        OR btrim(r.materialized_path) = '';
    IF v_bad > 0 THEN
        RAISE EXCEPTION '% row(s) are missing an id, a parent or a path', v_bad
            USING ERRCODE = 'check_violation';
    END IF;

    WITH src AS (
        SELECT * FROM jsonb_to_recordset(p_rows)
            AS t(id INT, parent_id INT, materialized_path TEXT)
    ), upd AS (
        UPDATE public.locations l
           SET parent_id         = src.parent_id,
               materialized_path = src.materialized_path
          FROM src
         WHERE l.id = src.id
           -- 1. The row currently lives under this warehouse.
           AND (l.materialized_path = p_warehouse_path
                OR l.materialized_path LIKE p_warehouse_path || '/%')
           -- 2. And it still will afterwards.
           AND src.materialized_path LIKE p_warehouse_path || '/%'
           -- 3. And so does its new parent.
           AND EXISTS (
               SELECT 1 FROM public.locations par
                WHERE par.id = src.parent_id
                  AND (par.materialized_path = p_warehouse_path
                       OR par.materialized_path LIKE p_warehouse_path || '/%')
           )
        RETURNING l.id
    )
    SELECT count(*)::INT INTO v_updated FROM upd;

    IF v_updated <> v_expected THEN
        RAISE EXCEPTION
            'Re-parent touched % of % locations under % — the caller''s view is '
            'stale, or an id, a path or a parent escaped the warehouse',
            v_updated, v_expected, p_warehouse_path
            USING ERRCODE = 'serialization_failure';
    END IF;

    RETURN v_updated;
END;
$$;

-- A SECURITY DEFINER re-parenter reachable from the browser is a way around the
-- Edge Function role gate. Service role only, exactly as 00094.
REVOKE ALL ON FUNCTION public.wie_reparent_locations_tx(TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_reparent_locations_tx(TEXT, JSONB)
    TO service_role;

-- ── 2. An index on the path, at last ────────────────────────────────────────
-- There has never been ANY index on materialized_path, which was survivable only
-- because the ZONE LATERAL always short-circuited to NULL. Binding makes it live:
-- it now runs once per candidate row, up to PUTAWAY_CANDIDATE_LIMIT = 2000, and
-- every one of them is a sequential scan of locations.
--
-- text_pattern_ops is load-bearing, not decoration. A default btree is built on
-- the database collation and CANNOT serve LIKE 'prefix%'; only a
-- text_pattern_ops (or C-collation) index can. This also serves the ~14 other
-- LIKE '<path>/%' prefix queries across the migrations and the client services —
-- getWarehouseLocations, inv_warehouse_draw_locations, wie_replen_config_rows,
-- inv_product_stock_by_warehouse and the label-target ancestry walks.
--
-- No CONCURRENTLY: migrate.mjs runs each file inside a transaction, and
-- locations is small enough (~1k rows on the largest site) that the lock is
-- momentary.

CREATE INDEX IF NOT EXISTS idx_locations_path_pattern
    ON public.locations (materialized_path text_pattern_ops);

COMMIT;

-- Verify:
--   -- The function exists, is SECURITY DEFINER, and is service_role only:
--   SELECT p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) AS args
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'wie_reparent_locations_tx';
--
--   SELECT has_function_privilege('authenticated',
--       'public.wie_reparent_locations_tx(text,jsonb)', 'EXECUTE');   -- expect false
--
--   -- The index is there and is a pattern-ops index:
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'locations' AND indexname = 'idx_locations_path_pattern';
--
--   -- Nothing moved (this migration re-parents nobody). Expect 0:
--   SELECT count(*) FROM public.locations l
--    WHERE l.kind IN ('BIN','RACK','SHELF')
--      AND EXISTS (SELECT 1 FROM public.locations z
--                   WHERE z.kind = 'ZONE'
--                     AND l.materialized_path LIKE z.materialized_path || '/%');
--
--   -- Guard 1 bites — unknown warehouse (expect serialization_failure):
--   BEGIN;
--     SELECT public.wie_reparent_locations_tx('NOSUCH',
--       '[{"id":1,"parent_id":1,"materialized_path":"NOSUCH/X"}]'::jsonb);
--   ROLLBACK;
--
--   -- Guard 2 bites — a path that escapes the warehouse (expect the same).
--   -- Guard 3 bites — a parent in another site (expect the same). Both are
--   -- exercised against real ids in the rollback-isolated check; see the plan.
