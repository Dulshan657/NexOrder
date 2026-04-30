-- Client-side error log.
-- Written exclusively by the `log-client-error` Edge Function via service_role.
-- Authenticated Admins may SELECT; nobody else has any policy.
--
-- Why a dedicated table (vs. reusing audit_events)?
-- audit_events.actor_id is NOT NULL (FK to auth.users), but we want to capture
-- crashes that happen before the user authenticates (e.g. a LoginPage render
-- error). actor_id here is nullable.

create table client_errors (
  id              uuid        primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  actor_id        uuid        references auth.users(id),  -- nullable for pre-auth errors
  actor_role      text,                                    -- nullable; resolved when JWT is present
  message         text        not null,
  stack           text,
  component_stack text,                                    -- React error boundary's componentStack
  url             text,                                    -- pathname only — query strings are stripped client-side
  user_agent      text,
  metadata        jsonb       not null default '{}'::jsonb -- { breadcrumbs?, route?, ... }
);

create index client_errors_occurred_idx
  on client_errors(occurred_at desc);

create index client_errors_actor_idx
  on client_errors(actor_id, occurred_at desc)
  where actor_id is not null;

alter table client_errors enable row level security;

-- Admin users may read all client errors.
create policy client_errors_admin_read on client_errors
  for select
  to authenticated
  using (
    exists (
      select 1
      from profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'Admin'
    )
  );

-- No INSERT/UPDATE/DELETE policies. Only service_role (Edge Function) writes.
