-- =============================================================================
-- Operator-controlled location codes
-- Migration: 00107_location_code_patterns.sql
-- =============================================================================
-- WHY THIS EXISTS. A drawn bin's code is a grid coordinate — `AMADIYA-B-3-4` —
-- because that is where the cell happened to sit on the canvas, not because anyone
-- chose it. Nothing in the system could ever change one: `mutate-warehouse-location`
-- has no `code` field on its update schema, `wie_rename_locations_tx` can physically
-- only write the four name_* columns, and PlacementInspector locks the input on any
-- saved bin. That was correct while the code was untouchable; it stops a site ever
-- regularising a naming scheme it has to live with on the racking.
--
-- This migration adds the three pieces that make a code an operator decision: the
-- provenance columns, the per-warehouse pattern, and the one transaction that can
-- rewrite a code safely.
--
-- APPLYING THIS CHANGES NOTHING. The columns are NULL everywhere and read by
-- nothing; the pattern table ships empty and empty means the built-in grid
-- coordinate; the function is called by nobody until the Edge Function that uses it
-- deploys. That inertness is what makes it safe to apply ahead of the code.
--
-- ---------------------------------------------------------------------------
-- Why a code is dangerous to rewrite, and what that forces
-- ---------------------------------------------------------------------------
-- `locations.code` is the Code 128 payload, the `resolveScan` key, a
-- `materialized_path` SEGMENT and the CSV `bin_code`. Two consequences drive the
-- whole design of wie_recode_locations_tx below:
--
--   * The path contains the code, so a recode is TWO hand-maintained columns moving
--     together — the same two-representations hazard as parent_id/materialized_path
--     in 00096, and guard 3 is the backstop against them drifting.
--   * `code` is UNIQUE (00027, an inline constraint, therefore NOT deferrable and
--     not alterable to deferrable without a DROP/ADD that rebuilds the index under
--     ACCESS EXCLUSIVE on the table every Edge Function touches). Swapping two codes
--     in one statement would therefore trip 23505 mid-write. Hence two phases.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. locations — where a code's number came from
-- ---------------------------------------------------------------------------
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS code_block TEXT,
    ADD COLUMN IF NOT EXISTS code_seq   INT;

COMMENT ON COLUMN public.locations.code_block IS
    'The pool this code''s number was drawn from — the operator-typed block, e.g. '
    'COLD-A. STORED, never re-derived by parsing the code apart: a block may itself '
    'contain the separator (AMD-COLD-A + -01), so ^(.*)-(\d+)$ is ambiguous. Same '
    'reasoning as name_area in 00094. NULL = this code was not minted by a counter '
    'pattern, which is true of every code predating this migration.';

COMMENT ON COLUMN public.locations.code_seq IS
    'The number inside code_block. Unlike name_seq this MAY be reassigned: a name '
    'never renumbers because a printed sign cannot be un-printed, whereas rewriting '
    'codes is the entire purpose of a recode and the operator wants 01..24 '
    'contiguous. What is preserved is idempotence — re-running a sweep must write '
    'nothing.';

-- No index, deliberately. The high-water read is
-- `WHERE materialized_path LIKE '<wh>/%' GROUP BY code_block`, already served by
-- idx_locations_path_pattern (00096); code_seq is never a predicate. 00094 makes
-- the same note about name_seq for the same reason.
--
-- No backfill, deliberately. NULL everywhere is honest: no existing code was minted
-- from a counter. Same argument as 00094's name_is_auto DEFAULT false.

-- ---------------------------------------------------------------------------
-- 2. warehouse_code_patterns — how a site spells a new code
-- ---------------------------------------------------------------------------
-- NO ROW MEANS THE BUILT-IN DEFAULT, exactly as warehouse_label_prefs (00106) works.
-- BUILTIN_PATTERN in _shared/wie/codePattern.ts is `{wh}-{block}-{x}-{y}` with
-- default block `B`, which formats byte-for-byte identically to the historical code
-- — so nothing needs backfilling, a new warehouse works before anyone opens the
-- editor, and clearing a pattern is a DELETE rather than a sentinel value.
--
-- This is a table and not two columns on `locations` because `locations` is the
-- hottest table in the system and getWarehouseLocations does `select('*')` over
-- every row on the site (1134 on MAIN). Columns meaningful on exactly the WAREHOUSE
-- row and NULL on 1133 others would ride into every bin object in the browser.
CREATE TABLE IF NOT EXISTS public.warehouse_code_patterns (
    warehouse_id  INT         PRIMARY KEY
                      REFERENCES public.locations(id) ON DELETE CASCADE,
    template      TEXT        NOT NULL CHECK (length(template) BETWEEN 1 AND 64),
    default_block TEXT        NOT NULL DEFAULT 'B'
                      CHECK (default_block ~ '^[A-Z0-9.-]{1,24}$'),
    start_at      INT         NOT NULL DEFAULT 1 CHECK (start_at BETWEEN 1 AND 9999),
    fill_order    TEXT        NOT NULL DEFAULT 'row'
                      CHECK (fill_order IN ('row','column','serpentine-row','serpentine-column')),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.warehouse_code_patterns IS
    'How each warehouse spells a newly minted location code. Absent row = '
    'BUILTIN_PATTERN in _shared/wie/codePattern.ts, which reproduces the historical '
    'grid coordinate exactly. Written only by the mutate-warehouse Edge Function '
    'via service_role.';

COMMENT ON COLUMN public.warehouse_code_patterns.template IS
    'A token template, e.g. {wh}-{block}-{n:02}. Deliberately TEXT with no '
    'token-validating CHECK: the grammar lives in TypeScript (templateIssue) and a '
    'regex here would be a second definition in the place nobody remembers to '
    'update. Same reasoning as warehouse_label_prefs.preset.';

COMMENT ON COLUMN public.warehouse_code_patterns.default_block IS
    'What {block} resolves to when the operator has not armed one. The CHECK is the '
    'code charset, which IS closed vocabulary — unlike the template grammar it can '
    'never gain a member, because it is bounded by what Code 128, materialized_path '
    'and LIKE will tolerate.';

-- RLS: ops read, service_role writes. Same shape as warehouse_label_prefs (00106),
-- label_print_log (00074) and every other Edge-Function-owned table.
ALTER TABLE public.warehouse_code_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_code_patterns_select_ops" ON public.warehouse_code_patterns;
CREATE POLICY "warehouse_code_patterns_select_ops"
    ON public.warehouse_code_patterns FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager','Warehouse'));

-- No INSERT/UPDATE/DELETE policy for `authenticated` at all: with RLS enabled and
-- no permissive policy every such write is denied, while service_role bypasses RLS
-- so the Edge Function still writes.

GRANT SELECT ON public.warehouse_code_patterns TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. wie_recode_locations_tx — the batched code writer
-- ---------------------------------------------------------------------------
-- Rows are { id, code, materialized_path, code_block, code_seq }.
--
-- A levelled rack's SHELF children MUST ride in the same batch. A level's path is
-- composed from string parts at creation (mutate-layout builds
-- `${parentPath}/${rackCode}/${levelCode}`) and never read back from its rack, so
-- recoding a rack silently invalidates every child path unless the children are
-- here too — and the child's own CODE embeds the rack code as well, which is the
-- extra half this has over 00096's re-parent.
--
-- TWO PHASES, because `code` is UNIQUE and not deferrable. An A→B, B→A swap is a
-- normal thing for an operator to ask for (renumbering an aisle end-for-end), and
-- there is no ordering of a single UPDATE that survives it. Phase 1 parks every
-- target at `~RECODE~<id>`: unique by construction, and `~` is outside the code
-- charset that codePattern.ts enforces, so it can never collide with a real code.
-- The rows are momentarily inconsistent with their paths, which is invisible
-- because it is inside the transaction.
--
-- THREE scope guards on the real write:
--   1. the row's CURRENT path is under this warehouse   (same guard as 00094)
--   2. the row's NEW path is under this warehouse       (it must not escape)
--   3. the NEW path ENDS with '/' || the NEW code       (recode-specific)
--
-- Guard 3 is this migration's analogue of 00096's guard 3, and it is the one that
-- matters most here: it is the database refusing to let the two hand-maintained
-- copies of one edge drift. A caller that rewrites a code and forgets the path — or
-- rewrites a rack's path and forgets a child's suffix — is caught now rather than
-- discovered six weeks later by a picker standing at the wrong bay.
--
-- parent_id is deliberately NOT written: a recode does not move anything.

DROP FUNCTION IF EXISTS public.wie_recode_locations_tx(TEXT, JSONB);

CREATE FUNCTION public.wie_recode_locations_tx(
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
    v_parked   INT;
    v_expected INT;
    v_bad      INT;
    v_dupe     INT;
BEGIN
    IF p_warehouse_path IS NULL OR btrim(p_warehouse_path) = '' THEN
        RAISE EXCEPTION 'wie_recode_locations_tx requires a warehouse path'
            USING ERRCODE = 'null_value_not_allowed';
    END IF;

    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'wie_recode_locations_tx expects an array of rows'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_expected := jsonb_array_length(p_rows);
    IF v_expected = 0 THEN
        RETURN 0;
    END IF;

    -- ── Phase 0: shape ──
    SELECT count(*)::INT INTO v_bad
      FROM jsonb_to_recordset(p_rows) AS r(id INT, code TEXT, materialized_path TEXT)
     WHERE r.id IS NULL
        OR r.code IS NULL OR btrim(r.code) = ''
        OR r.materialized_path IS NULL OR btrim(r.materialized_path) = '';
    IF v_bad > 0 THEN
        RAISE EXCEPTION '% row(s) are missing an id, a code or a path', v_bad
            USING ERRCODE = 'check_violation';
    END IF;

    -- A duplicate target inside the batch is a CALLER BUG, and it must not be left
    -- to surface as an unreadable 23505 from phase 2. Case-folded, because
    -- normalizeScan folds case and two codes differing only in case are one key to
    -- the scan resolver even though the UNIQUE constraint tells them apart.
    SELECT count(*)::INT INTO v_dupe FROM (
        SELECT lower(r.code) AS c
          FROM jsonb_to_recordset(p_rows) AS r(code TEXT)
         GROUP BY lower(r.code) HAVING count(*) > 1
    ) d;
    IF v_dupe > 0 THEN
        RAISE EXCEPTION '% code(s) appear more than once in this batch', v_dupe
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT count(*)::INT INTO v_dupe FROM (
        SELECT r.id FROM jsonb_to_recordset(p_rows) AS r(id INT)
         GROUP BY r.id HAVING count(*) > 1
    ) d;
    IF v_dupe > 0 THEN
        RAISE EXCEPTION '% location(s) appear more than once in this batch', v_dupe
            USING ERRCODE = 'check_violation';
    END IF;

    -- A leftover park means someone ran the phases by hand and the table is in a
    -- state no application code can produce. Refuse rather than build on it.
    SELECT count(*)::INT INTO v_bad FROM public.locations WHERE code LIKE '~RECODE~%';
    IF v_bad > 0 THEN
        RAISE EXCEPTION
            '% location(s) are still parked at ~RECODE~ from an interrupted recode', v_bad
            USING ERRCODE = 'raise_exception';
    END IF;

    -- ── Phase 1: park, so a swap cannot collide ──
    WITH src AS (
        SELECT * FROM jsonb_to_recordset(p_rows) AS t(id INT)
    ), upd AS (
        UPDATE public.locations l
           SET code = '~RECODE~' || l.id::TEXT
          FROM src
         WHERE l.id = src.id
           AND (l.materialized_path = p_warehouse_path
                OR l.materialized_path LIKE p_warehouse_path || '/%')
        RETURNING l.id
    )
    SELECT count(*)::INT INTO v_parked FROM upd;

    IF v_parked <> v_expected THEN
        RAISE EXCEPTION
            'Recode reached % of % locations under % — the caller''s view is stale, '
            'or an id escaped the warehouse',
            v_parked, v_expected, p_warehouse_path
            USING ERRCODE = 'serialization_failure';
    END IF;

    -- ── Phase 2: the real write ──
    -- label_printed is reset unconditionally. A sticker naming the old code is now
    -- wrong, and 00084 built this column so the backlog could be trusted: leaving it
    -- true would have wie_layout_label_targets report zero outstanding while every
    -- label on the racking names a code no row holds. Resetting turns "your stickers
    -- are wrong" into a work queue, which is the whole point of the column.
    WITH src AS (
        SELECT * FROM jsonb_to_recordset(p_rows)
            AS t(id INT, code TEXT, materialized_path TEXT, code_block TEXT, code_seq INT)
    ), upd AS (
        UPDATE public.locations l
           SET code              = src.code,
               materialized_path = src.materialized_path,
               code_block        = src.code_block,
               code_seq          = src.code_seq,
               label_printed     = false,
               label_printed_at  = NULL,
               label_printed_by  = NULL
          FROM src
         WHERE l.id = src.id
           -- 1. The row lives under this warehouse. (Its code is parked, so this
           --    reads the path, which phase 1 deliberately left alone.)
           AND (l.materialized_path = p_warehouse_path
                OR l.materialized_path LIKE p_warehouse_path || '/%')
           -- 2. And it still will afterwards.
           AND src.materialized_path LIKE p_warehouse_path || '/%'
           -- 3. And the path and the code agree about what this row is called.
           AND right(src.materialized_path, length(src.code) + 1) = '/' || src.code
        RETURNING l.id
    )
    SELECT count(*)::INT INTO v_updated FROM upd;

    IF v_updated <> v_expected THEN
        RAISE EXCEPTION
            'Recode wrote % of % locations under % — a path escaped the warehouse, '
            'or a path does not end with its own code',
            v_updated, v_expected, p_warehouse_path
            USING ERRCODE = 'serialization_failure';
    END IF;

    RETURN v_updated;
END;
$$;

-- A SECURITY DEFINER recoder reachable from the browser is a way around the Edge
-- Function role gate. Service role only.
REVOKE ALL ON FUNCTION public.wie_recode_locations_tx(TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wie_recode_locations_tx(TEXT, JSONB)
    TO service_role;

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'locations' AND column_name LIKE 'code\_%';
--
--   -- No backfill happened (expect 0):
--   SELECT count(*) FROM public.locations WHERE code_seq IS NOT NULL;
--
--   -- Ships empty, so every site is on the built-in pattern (expect 0):
--   SELECT count(*) FROM public.warehouse_code_patterns;
--
--   -- Definer, and not reachable from the browser (expect true, false):
--   SELECT p.prosecdef,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE')
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'wie_recode_locations_tx';
--
--   -- THE acceptance query: every path ends with its own code, under its parent.
--   -- Expect 0, before and after any recode.
--   SELECT count(*) FROM public.locations l
--     JOIN public.locations p ON p.id = l.parent_id
--    WHERE l.materialized_path <> p.materialized_path || '/' || l.code;
--
--   -- Guard 3 bites (expect the "does not end with its own code" error), rolled back:
--   BEGIN;
--     SELECT public.wie_recode_locations_tx('MAIN',
--       '[{"id":1,"code":"MAIN-X-1","materialized_path":"MAIN/WRONG","code_block":"X","code_seq":1}]'::jsonb);
--   ROLLBACK;
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.wie_recode_locations_tx(TEXT, JSONB);
--   DROP TABLE IF EXISTS public.warehouse_code_patterns;
--   ALTER TABLE public.locations DROP COLUMN IF EXISTS code_block,
--                                DROP COLUMN IF EXISTS code_seq;
-- =============================================================================
