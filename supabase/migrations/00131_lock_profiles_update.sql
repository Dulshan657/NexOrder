-- =============================================================================
-- A user can no longer rewrite their own role, venue or home warehouse
-- Migration: 00131_lock_profiles_update.sql
-- =============================================================================
-- Found 2026-10-12 by the security review of feat/qr-reorder; pre-existing.
--
-- WHAT WAS ACTUALLY TRUE UNTIL NOW.
--   * 00001:1084 grants table-level UPDATE (and DELETE, TRUNCATE) on
--     `profiles` to `authenticated`; 00101's default privileges did the same
--     for `anon`.
--   * 00011:16 ran `REVOKE UPDATE (role, horeca_id) ... FROM authenticated`.
--     A column-level REVOKE removes nothing while the role still holds the
--     TABLE-level privilege -- the table grant covers every column -- so that
--     line has been a no-op since it was written.
--   * `profiles_update_own_or_admin` (00001:490) passes `id = auth.uid()` for
--     both USING and WITH CHECK, and no trigger guards the columns.
--   * Net effect: any signed-in user could
--         PATCH /rest/v1/profiles?id=eq.<own uid>   {"role":"Admin"}
--     and become an Admin. Proven on dev inside BEGIN ... ROLLBACK as a
--     Restaurant/Hotel Customer before this migration was written.
--
-- WHAT THIS DOES. Drops every client write privilege on the table and gives
-- back UPDATE on exactly the columns the app edits directly (AppShell's
-- profile form writes name + email; avatar_url is the user's own picture).
-- role, horeca_id and home_warehouse_id are now writable only by the
-- service_role, i.e. by mutate-profile / invite-user, which audit.
--
-- WHY NOT A TRIGGER. A trigger is a second mechanism that has to be kept in
-- step with the policy; the grant is the one PostgREST consults first, and
-- getting it right is what 00011 intended.
-- =============================================================================

BEGIN;

REVOKE UPDATE, DELETE, TRUNCATE ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (name, email, avatar_url) ON public.profiles TO authenticated;

DO $$
DECLARE
  col text;
BEGIN
  IF has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('anon', 'public.profiles', 'UPDATE') THEN
    RAISE EXCEPTION '00131: a client role still holds table-level UPDATE on profiles';
  END IF;
  FOREACH col IN ARRAY ARRAY['id', 'role', 'horeca_id', 'home_warehouse_id', 'created_at'] LOOP
    IF has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE')
       OR has_column_privilege('anon', 'public.profiles', col, 'UPDATE') THEN
      RAISE EXCEPTION '00131: a client role can still UPDATE profiles.%', col;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.profiles', 'DELETE')
     OR has_table_privilege('anon', 'public.profiles', 'TRUNCATE') THEN
    RAISE EXCEPTION '00131: a client role still holds DELETE or TRUNCATE on profiles';
  END IF;
END $$;

COMMIT;
