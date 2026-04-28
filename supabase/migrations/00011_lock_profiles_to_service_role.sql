-- Lock down direct INSERT on profiles so user provisioning can only happen
-- through the invite-user Edge Function. The on_auth_user_created trigger
-- continues to insert basic profile rows when an auth user is created — it
-- runs as SECURITY DEFINER so the column-level revoke does not affect it.

REVOKE INSERT ON public.profiles FROM authenticated;
REVOKE INSERT ON public.profiles FROM anon;

-- Also ensure no INSERT policy lingers from earlier migrations.
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;

-- Update privileges remain limited by existing RLS; tighten role/horeca_id
-- changes to service-role-only by revoking column-level UPDATE for those
-- specific columns from authenticated users.
REVOKE UPDATE (role, horeca_id) ON public.profiles FROM authenticated;

COMMENT ON TABLE public.profiles IS
  'Direct INSERT denied. Profiles are created by the on_auth_user_created '
  'trigger (SECURITY DEFINER) when a user is provisioned via the '
  'invite-user Edge Function. role and horeca_id can only be modified by '
  'the service role.';
