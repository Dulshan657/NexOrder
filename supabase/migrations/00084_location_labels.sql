-- =============================================================================
-- Layout label runs — know which locations have a sticker, and which are owed one
-- Migration: 00084_location_labels.sql
-- =============================================================================
--
-- generate-labels (mig 00074) can already render any set of locations onto an
-- A4 sticker sheet. What it cannot do is answer the only question an operator
-- actually has when a layout goes live: *what still needs a label?*
--
-- Two gaps produce that:
--
--   1. Selection is by warehouse + location kind, not by LAYOUT. publish-layout
--      deliberately passes an empty p_deactivate — publishing never retires old
--      bins (see the WIE gotchas in CLAUDE.md) — so "every active location under
--      the warehouse root" includes bins that no longer exist on the floor. We
--      have been printing stickers for them.
--
--   2. Nothing records that a location HAS a sticker. handling_units grew
--      label_printed in 00075 for exactly this reason; locations never did. So
--      adding twelve bays means reprinting nine hundred, or guessing.
--
-- This migration adds the state and the two read paths. It changes no existing
-- behaviour: every column is additive with a safe default, and no existing
-- function is touched.
--
-- ---------------------------------------------------------------------------
-- Relationship to 00083
-- ---------------------------------------------------------------------------
-- 00083_reserve_order_pick_zone.sql is committed but DELIBERATELY UNAPPLIED
-- until replenishment is demonstrably working. This migration is independent of
-- it: it does not touch inv_reserve_order and does not read is_pick_zone. It
-- reads level_roles.display_name only, which has been live since 00081.
-- Applying 00084 does not apply, imply, or require 00083.
--
-- ---------------------------------------------------------------------------
-- Why label_printed is set by an explicit confirm, not by generating the PDF
-- ---------------------------------------------------------------------------
-- handling_units flips label_printed the moment its sheet renders, because a
-- plate's sticker is applied at the same desk in the same minute. A rack label
-- is not: the PDF is generated at a computer and the stickers go up later, on a
-- ladder, possibly by someone else, possibly after a printer jam. Flipping on
-- generate would silently retire locations from the backlog that never got a
-- sticker — and the whole point of the column is that the backlog is trustworthy.
-- So confirm-label-print sets it, per job, after the fact.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. locations — does this place have a physical label on it?
-- ---------------------------------------------------------------------------
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS label_printed    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS label_printed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS label_printed_by UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN public.locations.label_printed IS
    'True once an operator confirmed the printed sticker is physically on this '
    'location (confirm-label-print). NOT set by generating the PDF. No backfill: '
    'every pre-00084 location starts false, which is honest — nobody has told us '
    'otherwise.';

-- Partial index: every query over this column asks for the BACKLOG, and the
-- backlog shrinks to near-zero in a labelled warehouse.
CREATE INDEX IF NOT EXISTS idx_locations_label_backlog
    ON public.locations(id) WHERE NOT label_printed AND is_active;

-- ---------------------------------------------------------------------------
-- 2. label_print_log — group the sheets of one run into one job
-- ---------------------------------------------------------------------------
-- A layout run emits several PDFs (one per die-cut stock; a bin sticker and an
-- aisle sign cannot come off the same sheet). job_id is what makes those a set:
-- it is what the confirm step resolves, and what lets the UI show "3 sheets,
-- 947 labels" instead of three unrelated rows.
ALTER TABLE public.label_print_log
    ADD COLUMN IF NOT EXISTS job_id       UUID,
    ADD COLUMN IF NOT EXISTS sheet_group  TEXT,
    ADD COLUMN IF NOT EXISTS layout_id    INT REFERENCES public.warehouse_layouts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN public.label_print_log.job_id IS
    'Groups the sheets of one print run. NULL for ad-hoc runs from the Settings '
    'panel, which are single-sheet by nature.';
COMMENT ON COLUMN public.label_print_log.confirmed_at IS
    'When an operator confirmed these stickers are on the floor. Until then the '
    'locations on this sheet remain in the backlog.';

CREATE INDEX IF NOT EXISTS idx_label_print_log_job
    ON public.label_print_log (job_id) WHERE job_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. wie_layout_label_targets — every location a published layout needs labelled
-- ---------------------------------------------------------------------------
-- Selection, in one place, so the Edge Function stays I/O-only:
--
--   * placements of THIS layout          — the storable slots (BIN, SHELF, BAY)
--   * dock/staging objects of this layout — via layout_objects.staging_location_id
--   * the ancestors of both, restricted to ZONE / AISLE / RACK — the wayfinding
--     signs. A levelled rack has NO placement row (00072 deletes it), so it can
--     only be reached this way; without the ancestor walk a racked warehouse
--     gets zero rack signs.
--
-- The ancestor walk climbs parent_id recursively rather than prefix-matching
-- materialized_path against the whole table: it is O(depth) per branch instead
-- of O(locations^2), and it cannot be fooled by a code containing a LIKE
-- metacharacter — a class of bug generate-labels already had to escape around.
--
-- zone_name / aisle_code ARE resolved by path prefix, but against the handful of
-- zones and aisles only, and with plain string comparison (left(...) = ...||'/')
-- rather than LIKE, so again no metacharacter can widen the match.
--
-- Returns raw pieces, NOT a composed context string and NOT a sheet group:
-- both of those live in _shared/labels/layoutLabelPlan.ts so there is exactly
-- one definition, shared by the server and the browser. Duplicating the grouping
-- here is the same mistake as forking the scan-folding rules.
DROP FUNCTION IF EXISTS public.wie_layout_label_targets(INT, INT, BOOLEAN);
CREATE FUNCTION public.wie_layout_label_targets(
    p_layout_id          INT,
    p_root_location_id   INT     DEFAULT NULL,
    p_only_unprinted     BOOLEAN DEFAULT true
)
RETURNS TABLE (
    location_id      INT,
    code             TEXT,
    kind             TEXT,
    name             TEXT,
    zone_name        TEXT,
    aisle_code       TEXT,
    level_role_name  TEXT,
    level_index      INT,
    label_printed    BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH RECURSIVE base_ids AS (
    -- Storable slots placed on this layout.
    SELECT pl.location_id AS id
    FROM public.layout_placements pl
    WHERE pl.layout_id = p_layout_id
    UNION
    -- Dock / staging areas that point at a real location.
    SELECT o.staging_location_id AS id
    FROM public.layout_objects o
    WHERE o.layout_id = p_layout_id
      AND o.staging_location_id IS NOT NULL
),
ancestor_ids AS (
    SELECT l.parent_id AS id
    FROM public.locations l
    JOIN base_ids b ON b.id = l.id
    WHERE l.parent_id IS NOT NULL
    UNION
    SELECT l.parent_id AS id
    FROM public.locations l
    JOIN ancestor_ids a ON a.id = l.id
    WHERE l.parent_id IS NOT NULL
),
target_ids AS (
    SELECT id FROM base_ids
    UNION
    SELECT a.id
    FROM ancestor_ids a
    JOIN public.locations l ON l.id = a.id
    -- Only the wayfinding levels get a sign. The WAREHOUSE root does not: it is
    -- a building, not a place you scan.
    WHERE l.kind IN ('ZONE', 'AISLE', 'RACK')
),
zones AS (
    SELECT z.id, z.name, z.materialized_path
    FROM public.locations z
    WHERE z.kind = 'ZONE' AND z.is_active
),
aisles AS (
    SELECT s.id, s.code, s.materialized_path
    FROM public.locations s
    WHERE s.kind = 'AISLE' AND s.is_active
),
root AS (
    SELECT r.materialized_path
    FROM public.locations r
    WHERE p_root_location_id IS NOT NULL AND r.id = p_root_location_id
)
SELECT
    t.id,
    t.code,
    t.kind,
    t.name,
    zn.name,
    al.code,
    lr.display_name,
    t.level_index,
    t.label_printed
FROM public.locations t
JOIN target_ids ti ON ti.id = t.id
LEFT JOIN public.level_roles lr ON lr.key = t.level_role
-- Nearest enclosing zone / aisle. Longest path wins, so a nested zone beats the
-- outer one it sits in.
LEFT JOIN LATERAL (
    SELECT z.name
    FROM zones z
    WHERE left(t.materialized_path, length(z.materialized_path) + 1) = z.materialized_path || '/'
    ORDER BY length(z.materialized_path) DESC
    LIMIT 1
) zn ON true
LEFT JOIN LATERAL (
    SELECT s.code
    FROM aisles s
    WHERE left(t.materialized_path, length(s.materialized_path) + 1) = s.materialized_path || '/'
    ORDER BY length(s.materialized_path) DESC
    LIMIT 1
) al ON true
WHERE t.is_active
  AND (NOT p_only_unprinted OR NOT t.label_printed)
  -- Optional subtree narrowing, for "reprint aisle A3". Includes the root itself
  -- so picking an aisle also reprints that aisle's own sign.
  AND (
        p_root_location_id IS NULL
     OR t.id = p_root_location_id
     OR EXISTS (
          SELECT 1 FROM root r
          WHERE left(t.materialized_path, length(r.materialized_path) + 1)
                = r.materialized_path || '/'
        )
      )
ORDER BY t.code;
$$;

COMMENT ON FUNCTION public.wie_layout_label_targets(INT, INT, BOOLEAN) IS
    'Every location a published layout needs a QR label for: its placements, its '
    'dock/staging areas, and their ZONE/AISLE/RACK ancestors. Scoped to the '
    'layout rather than the warehouse subtree because publishing never retires '
    'old bins. Context composition and sheet grouping live in '
    '_shared/labels/layoutLabelPlan.ts, not here.';

-- ---------------------------------------------------------------------------
-- 4. wie_layout_label_status — the backlog badge
-- ---------------------------------------------------------------------------
-- Counts per location KIND, not per sheet group. The kind -> group mapping is
-- TypeScript (layoutLabelPlan.ts) and must stay that way; if this function
-- returned groups there would be two definitions of the grouping, and the one
-- in SQL would be the one nobody remembers to update.
DROP FUNCTION IF EXISTS public.wie_layout_label_status(INT);
CREATE FUNCTION public.wie_layout_label_status(p_layout_id INT)
RETURNS TABLE (
    kind        TEXT,
    total       BIGINT,
    printed     BIGINT,
    outstanding BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
SELECT
    t.kind,
    count(*)                                        AS total,
    count(*) FILTER (WHERE t.label_printed)         AS printed,
    count(*) FILTER (WHERE NOT t.label_printed)     AS outstanding
FROM public.wie_layout_label_targets(p_layout_id, NULL, false) t
GROUP BY t.kind
ORDER BY t.kind;
$$;

COMMENT ON FUNCTION public.wie_layout_label_status(INT) IS
    'Per-kind label counts for a layout: total / printed / outstanding. Backs the '
    '"38 locations have no label" badge. Kinds, not sheet groups — the grouping '
    'is defined once, in TypeScript.';

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- Both are read-only over data the ops roles can already SELECT. SECURITY
-- DEFINER is for the recursive walk over locations, not to widen access.
GRANT EXECUTE ON FUNCTION public.wie_layout_label_targets(INT, INT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wie_layout_label_status(INT) TO authenticated;

-- locations write policies are UNCHANGED. label_printed is set only by
-- confirm-label-print through service_role, exactly like every other
-- Edge-Function-owned column.

COMMIT;

-- =============================================================================
-- Verify with:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'locations' AND column_name LIKE 'label_printed%';
--
--   SELECT count(*) FROM public.wie_layout_label_targets(
--       (SELECT id FROM public.warehouse_layouts WHERE status = 'published' LIMIT 1),
--       NULL, false);
--
--   SELECT * FROM public.wie_layout_label_status(
--       (SELECT id FROM public.warehouse_layouts WHERE status = 'published' LIMIT 1));
--
-- Expect: the target count equals that layout's layout_placements count, plus
-- its distinct ZONE/AISLE/RACK ancestors, plus its staging locations. Any
-- location NOT on the published layout must be absent.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.wie_layout_label_status(INT);
--   DROP FUNCTION IF EXISTS public.wie_layout_label_targets(INT, INT, BOOLEAN);
--   DROP INDEX IF EXISTS public.idx_label_print_log_job;
--   DROP INDEX IF EXISTS public.idx_locations_label_backlog;
--   ALTER TABLE public.label_print_log
--       DROP COLUMN IF EXISTS job_id, DROP COLUMN IF EXISTS sheet_group,
--       DROP COLUMN IF EXISTS layout_id, DROP COLUMN IF EXISTS confirmed_at,
--       DROP COLUMN IF EXISTS confirmed_by;
--   ALTER TABLE public.locations
--       DROP COLUMN IF EXISTS label_printed, DROP COLUMN IF EXISTS label_printed_at,
--       DROP COLUMN IF EXISTS label_printed_by;
-- =============================================================================
