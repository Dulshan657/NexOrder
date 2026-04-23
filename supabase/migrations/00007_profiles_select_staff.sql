-- Allow staff (Admin / Manager / Sales Reps) to read every profile row.
-- Needed so UI name lookups (order submitter, visit rep, route assignee,
-- etc.) resolve for non-admin staff once RLS is re-enabled.
--
-- Customers remain limited to their own profile via the existing
-- profiles_select_own policy from 00001.

CREATE POLICY "profiles_select_staff"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        (SELECT public.user_role()) IN ('Admin','Manager','Field Sales Rep','Office Sales Rep')
    );
