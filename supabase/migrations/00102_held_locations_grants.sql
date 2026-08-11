-- =============================================================================
-- v_held_locations — take back the grants Supabase handed out by default
-- Migration: 00102_held_locations_grants.sql
-- =============================================================================
-- 00101 created the view and its comment says "not granted to authenticated".
-- That was the intent and it was wrong about the outcome: this project carries
-- ALTER DEFAULT PRIVILEGES for anon / authenticated / service_role on new
-- objects in `public`, so the view was created with SELECT (and INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES, TRIGGER) already granted to all three. Verified
-- on dev via information_schema.role_table_grants after applying 00101 — which
-- is the only reason this is a second file rather than an edit: 00101 is applied
-- and checksummed, and the ledger treats a changed byte as a hard error.
--
-- Why it matters, in proportion: nothing catastrophic leaks — the view is
-- (location_id, zone_id, zone_profile_id) and a held bin is not a secret. But it
-- is reachable with the ANON key, so it is readable without logging in at all,
-- and "which bays is this business holding stock in, and how many" is a
-- question an anonymous caller has no business asking. It is also inconsistent
-- with every other object in this subsystem, and inconsistency is what makes the
-- next person assume a grant is deliberate.
--
-- service_role KEEPS SELECT: release-quarantine reads the view over PostgREST to
-- verify that a source really is held and a destination really is not. The
-- SECURITY DEFINER functions that read it (inv_reserve_order,
-- inv_recompute_product_cache) run as the owner and need no grant at all.
--
-- The write privileges are revoked because they are meaningless, not because
-- they are dangerous: the view is not auto-updatable (it has a DISTINCT and a
-- join), so an INSERT would fail anyway. Removing them stops the ACL implying a
-- capability that does not exist.
-- =============================================================================

REVOKE ALL ON public.v_held_locations FROM anon, authenticated;

-- Explicit rather than relying on the default that caused this: state what the
-- one legitimate reader gets.
GRANT SELECT ON public.v_held_locations TO service_role;

COMMENT ON VIEW public.v_held_locations IS
    'Locations sitting under a zone whose profile is_hold (mig 00101). Read by '
    'inv_reserve_order and inv_recompute_product_cache as the definer, and by '
    'release-quarantine as service_role. Revoked from anon/authenticated in '
    '00102 — the default privileges on this project had granted it to both.';

-- =============================================================================
-- Verify:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='v_held_locations'
--    ORDER BY grantee, privilege_type;
--     -- expect postgres (all) and service_role (SELECT). No anon, no
--     -- authenticated.
-- =============================================================================
