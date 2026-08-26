-- =============================================================================
-- A print job remembers WHICH ROWS it printed, not just what they were called
-- Migration: 00124_label_print_log_location_ids.sql
-- =============================================================================
-- One nullable column. No backfill, no data change, nothing to re-run.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
--
-- `confirm-label-print` resolves a job by matching `label_print_log.codes` —
-- text, captured at print time — back onto `locations.code`, and its comment
-- reasons:
--
--   "A location renamed or retired since the sheet was generated simply matches
--    nothing, which is the correct outcome — that sticker names something that
--    no longer exists."
--
-- That is true of a rename. It is NOT true of a SWEEP. `wie_recode_locations_tx`
-- (00107) is a two-phase A→B/B→A write precisely so that codes may be SWAPPED
-- between rows without tripping the non-deferrable UNIQUE. After a swap the
-- string still matches — a DIFFERENT row. Confirming a pre-sweep job then stamps
-- `label_printed = true` on racking whose stickers were never printed, and
-- leaves the rows that were printed reading as outstanding. The sweep has
-- already reset `label_printed` on exactly those rows, so this is the moment the
-- backlog is least able to absorb a wrong answer.
--
-- ── WHY A COLUMN AND NOT A FK TABLE ─────────────────────────────────────────
--
-- `codes` STAYS, and stays denormalised, for the reason 00074 gave: the sticker
-- on the rack says what it said, and this row is the only record of that. The id
-- answers a different question — which row did we print FOR — and the two are
-- both worth keeping precisely because a sweep makes them disagree.
--
-- NULLABLE, and no backfill. Every pre-existing job keeps matching by code,
-- which is what it has always done; deriving ids for them now would be guessing
-- at exactly the ambiguity this column exists to remove. `confirm-label-print`
-- therefore prefers ids and falls back to codes, per row, forever.
--
-- Not a FK array (Postgres has no array FK) and deliberately not a join table: a
-- job is written once and read once, the array is already how `codes` is stored,
-- and the two must line up index-for-index to be readable side by side.
--
-- Apply via the Management API /database/query (the direct DB host is
-- unreachable from this box — see supabase/apply-sql.mjs).
-- =============================================================================

BEGIN;

ALTER TABLE public.label_print_log
    ADD COLUMN IF NOT EXISTS location_ids INT[];

COMMENT ON COLUMN public.label_print_log.location_ids IS
    'The locations.id of each code in `codes`, same order, captured at print '
    'time (mig 00124). NULL on every job printed before that migration, which '
    'still resolves by code. Ids exist because a code sweep (00107) SWAPS codes '
    'between rows, so a post-sweep code match can confirm the wrong racking. '
    '`codes` is still the record of what the sticker physically says.';

COMMIT;

-- =============================================================================
-- Verify with:
--
--   -- a. The column exists and is nullable:
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'label_print_log' AND column_name = 'location_ids';
--     -- expect ARRAY / YES
--
--   -- b. Every pre-existing job is untouched (NULL), so nothing changes for
--   --    them. Expect the two counts to be equal:
--   SELECT count(*) AS total, count(*) FILTER (WHERE location_ids IS NULL) AS legacy
--     FROM public.label_print_log;
--
--   -- c. After the next location print, ids and codes must line up 1:1:
--   SELECT id, array_length(codes, 1) AS n_codes,
--          array_length(location_ids, 1) AS n_ids
--     FROM public.label_print_log
--    WHERE label_kind = 'location' AND location_ids IS NOT NULL
--    ORDER BY id DESC LIMIT 5;
--
-- Rollback: ALTER TABLE public.label_print_log DROP COLUMN location_ids;
--   (confirm-label-print falls back to the code match on its own.)
-- =============================================================================
