-- Rename "routes" feature to "scheduled_visits".
-- A "Scheduled Visit" (formerly "Route") is a planned itinerary of customer stops.
-- A "Visit" (unchanged) is an actual check-in at a single customer on a route.

-- Drop RLS policies that reference old table name (they are recreated below).
DROP POLICY IF EXISTS "routes_select_admin_manager" ON public.routes;
DROP POLICY IF EXISTS "routes_select_rep"           ON public.routes;
DROP POLICY IF EXISTS "routes_insert_staff"         ON public.routes;
DROP POLICY IF EXISTS "routes_update_creator_assignee_admin_manager" ON public.routes;
DROP POLICY IF EXISTS "routes_delete_admin"         ON public.routes;

-- Rename the table.
ALTER TABLE public.routes RENAME TO scheduled_visits;

-- Rename self-referencing FK column nothing to do (template_id name unchanged).
-- Rename the FK on visits that points to the (now renamed) table.
ALTER TABLE public.visits RENAME COLUMN route_id TO scheduled_visit_id;

-- Rename indexes for clarity (Postgres auto-renames the primary-key index when you
-- rename the table, but the secondary indexes keep their old names).
ALTER INDEX idx_routes_assigned_to    RENAME TO idx_scheduled_visits_assigned_to;
ALTER INDEX idx_routes_created_by     RENAME TO idx_scheduled_visits_created_by;
ALTER INDEX idx_routes_template_id    RENAME TO idx_scheduled_visits_template_id;
ALTER INDEX idx_visits_route_id       RENAME TO idx_visits_scheduled_visit_id;

-- Recreate RLS policies under the new name (same logic as before).
CREATE POLICY "scheduled_visits_select_admin_manager"
    ON public.scheduled_visits FOR SELECT
    TO authenticated
    USING (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('Admin','Manager')
    );

CREATE POLICY "scheduled_visits_select_rep"
    ON public.scheduled_visits FOR SELECT
    TO authenticated
    USING (
        created_by = auth.uid() OR assigned_to = auth.uid()
    );

CREATE POLICY "scheduled_visits_insert_staff"
    ON public.scheduled_visits FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT role FROM public.profiles WHERE id = auth.uid())
            IN ('Admin','Manager','Field Sales Rep','Office Sales Rep')
    );

CREATE POLICY "scheduled_visits_update_creator_assignee_admin_manager"
    ON public.scheduled_visits FOR UPDATE
    TO authenticated
    USING (
        created_by = auth.uid()
        OR assigned_to = auth.uid()
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('Admin','Manager')
    );

CREATE POLICY "scheduled_visits_delete_admin"
    ON public.scheduled_visits FOR DELETE
    TO authenticated
    USING (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'Admin'
    );
