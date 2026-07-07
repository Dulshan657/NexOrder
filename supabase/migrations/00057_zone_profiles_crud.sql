-- =============================================================================
-- Warehouse Intelligence Engine — user-managed zone profiles
-- Migration: 00057_zone_profiles_crud.sql
-- =============================================================================
-- Relaxes zone_profiles.zone_type from a fixed 8-value CHECK to free text so
-- operators can define their own zone kinds via the new mutate-zone-profile Edge
-- Function. The engine already treats zone_type as opaque TEXT (scoring.ts uses
-- it only for display + the allowed_categories gate; wie_putaway_candidates
-- passes it straight through), so custom types are first-class — they just don't
-- carry any built-in hazard/temperature semantics. NOT NULL and the unique
-- (name, zone_type) index are kept. Additive & idempotent.
-- =============================================================================

BEGIN;

-- Drop the inline value CHECK (auto-named zone_profiles_zone_type_check), with a
-- defensive fallback that finds any CHECK on the table still pinning the seeded
-- values, in case the name differs across environments.
ALTER TABLE public.zone_profiles DROP CONSTRAINT IF EXISTS zone_profiles_zone_type_check;

DO $$
DECLARE
    con_name TEXT;
BEGIN
    SELECT c.conname INTO con_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'zone_profiles' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%fast_moving%'
    LIMIT 1;
    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.zone_profiles DROP CONSTRAINT %I', con_name);
    END IF;
END $$;

COMMIT;

-- Verify:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'public.zone_profiles'::regclass AND contype = 'c';
--   -- (should return no CHECK mentioning fast_moving)
