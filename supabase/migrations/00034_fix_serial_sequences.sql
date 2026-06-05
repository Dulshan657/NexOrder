-- =============================================================================
-- Heal SERIAL sequences that lag behind their tables' MAX(id)
-- Migration: 00034_fix_serial_sequences.sql
-- =============================================================================
-- The seed (supabase/seed.ts) upserts rows with EXPLICIT integer ids
-- (suppliers, products, horecas, …) via `onConflict: 'id'`. An explicit INSERT
-- does NOT advance the owning SERIAL sequence, so after seeding each sequence
-- still points near 1 while real rows occupy much higher ids. The next default
-- INSERT then calls nextval() -> an id that already exists ->
--   duplicate key value violates unique constraint "<tbl>_pkey".
--
-- The app dodges this today by generating ids itself, but any raw default
-- INSERT (and the inventory balancing integration test, which surfaced this)
-- would break. This migration realigns every public SERIAL/IDENTITY sequence to
-- its table's current MAX(id).
--
-- Idempotent and safe: setval to MAX(id) only moves a lagging sequence FORWARD
-- to a value past all existing rows; re-running is a no-op once healed. For an
-- empty table it resets to 1 (is_called=false) so the first id is 1.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    r       RECORD;
    v_max   BIGINT;
BEGIN
    FOR r IN
        SELECT
            c.relname                                                            AS tbl,
            a.attname                                                            AS col,
            pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname),
                                   a.attname)                                    AS seq
        FROM pg_class      c
        JOIN pg_namespace  n ON n.oid = c.relnamespace
        JOIN pg_attribute  a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname),
                                     a.attname) IS NOT NULL
    LOOP
        EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM public.%I', r.col, r.tbl)
            INTO v_max;
        -- is_called = (v_max > 0): when rows exist, next id = MAX+1; when empty,
        -- leave the sequence "uncalled" so the first id is 1.
        PERFORM setval(r.seq, GREATEST(v_max, 1), v_max > 0);
        RAISE NOTICE 'Reset % -> % (is_called=%)', r.seq, GREATEST(v_max, 1), v_max > 0;
    END LOOP;
END $$;

COMMIT;
