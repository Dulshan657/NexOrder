-- Audit log table for all privileged mutations.
-- Written exclusively by Edge Functions via service_role.
-- Authenticated users (including Admins) may only SELECT.
-- No INSERT/UPDATE/DELETE policy is defined, so only service_role can write.

create table audit_events (
  id          uuid        primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id    uuid        not null references auth.users(id),
  actor_role  text        not null,
  action      text        not null,   -- 'create' | 'update' | 'delete'
  resource    text        not null,   -- 'promotion' | 'app_settings' | 'horeca' | ...
  resource_id text,                   -- nullable for create-before-id-is-known
  before_data jsonb,                  -- nullable for create
  after_data  jsonb,                  -- nullable for delete
  reason      text,                   -- free-text; populated on sensitive writes
  metadata    jsonb       not null default '{}'::jsonb
);

create index audit_events_actor_idx
  on audit_events(actor_id, occurred_at desc);

create index audit_events_resource_idx
  on audit_events(resource, resource_id, occurred_at desc);

alter table audit_events enable row level security;

-- Admin users may read all audit events.
-- The (select auth.uid()) pattern avoids a per-row function call.
create policy audit_events_admin_read on audit_events
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

-- No INSERT / UPDATE / DELETE policies.
-- Only service_role (used by Edge Functions) can write to this table.
