-- =============================================================================
-- Messages say "location", not "bin" (NX-0039 A15)
-- Migration: 00147_location_wording.sql
-- =============================================================================
-- The owner (2026-11-17): not every place is a bin — a rack level is a rack and
-- a level, a floor bay is a bay — so nothing an operator reads may call it one.
-- The screens and the Edge Functions were reworded in code; these messages are
-- raised by SQL functions, so they need a migration.
--
-- HOW: each function is redefined from ITS OWN CURRENT DEFINITION
-- (pg_get_functiondef), with only the message phrases below replaced. Nothing
-- is copied out of an older migration file, so no logic can be rolled back by
-- accident, and signatures, SECURITY DEFINER, search_path and grants are kept
-- (CREATE OR REPLACE with an unchanged signature keeps the ACL).
--
-- What is NOT changed: error CODE prefixes ('PICK_OWN_SHORTFALL:',
-- 'STOCK_IN_REMOVED_BIN:', 'INVALID_INPUT:', 'CONFLICT:') — callers read them —
-- and every identifier, column and value.
--
-- Idempotent: a re-run finds no old phrase and redefines nothing. A function
-- whose text no longer carries a phrase (a later migration reworded it) is
-- simply left alone. The final check fails the migration if any old phrase is
-- still in one of these functions afterwards.
--
-- Rollback: run the same DO block with each pair swapped.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    -- old phrase -> new phrase. Whole phrases, so a comment or identifier that
    -- merely contains the word is never touched.
    v_pairs CONSTANT text[][] := ARRAY[
        ARRAY['the bin holds %',                                   'the location holds %'],
        ARRAY['every portion needs a destination bin',             'every portion needs a destination location'],
        ARRAY['a reason is required when it goes to a different bin', 'a reason is required when it goes to a different location'],
        ARRAY['the bin it was placed in is required',              'the location it was placed in is required'],
        ARRAY['both the source and the destination bin are required', 'both the source and the destination location are required'],
        ARRAY['That bin is no longer active',                      'That location is no longer active'],
        ARRAY['The suggested bin for this line is now',            'The suggested location for this line is now'],
        ARRAY['is the home bin of %s; choose another bin.',        'is the home location of %s; choose another location.'],
        ARRAY['Put this in its home bin %s',                       'Put this in its home location %s'],
        ARRAY['% bin(s) slated for removal still hold stock',      '% location(s) slated for removal still hold stock']
    ];
    v_fns CONSTANT text[] := ARRAY[
        'inv_pick_imported_line', 'inv_release_bin', 'qb_release_own_allocation',
        'wie_break_down_putaway_tx', 'wie_complete_putaway_tx', 'wie_complete_replen_tx',
        'wie_confirm_overflow_tx', 'wie_home_block', 'wie_publish_layout_tx'
    ];
    r        record;
    v_def    text;
    v_new    text;
    i        int;
    v_left   int;
BEGIN
    FOR r IN
        SELECT p.oid
          FROM pg_proc p
          JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public'
           AND p.prokind = 'f'
           AND p.proname = ANY (v_fns)
    LOOP
        v_def := pg_get_functiondef(r.oid);
        v_new := v_def;
        FOR i IN 1 .. array_length(v_pairs, 1) LOOP
            v_new := replace(v_new, v_pairs[i][1], v_pairs[i][2]);
        END LOOP;
        IF v_new IS DISTINCT FROM v_def THEN
            EXECUTE v_new;
        END IF;
    END LOOP;

    -- Nothing an operator reads in these functions may still say it.
    SELECT count(*) INTO v_left
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace,
           unnest(v_pairs[1:array_length(v_pairs, 1)][1:1]) AS old(phrase)
     WHERE ns.nspname = 'public'
       AND p.proname = ANY (v_fns)
       AND strpos(pg_get_functiondef(p.oid), old.phrase) > 0;
    IF v_left > 0 THEN
        RAISE EXCEPTION '00147: % old "bin" message(s) remain after the rewrite', v_left;
    END IF;
END
$$;

COMMIT;
