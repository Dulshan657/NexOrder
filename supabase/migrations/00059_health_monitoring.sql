-- =============================================================================
-- 00059_health_monitoring.sql
--
-- Continuous deployment-monitoring primitives:
--   * health_checks — one row per cron tick of the `health` Edge Function
--     (DB latency, frontend /version.json probe, client-error spike count).
--   * deployments  — one row per `npm run deploy`, written by scripts/deploy.mjs
--     with the service role; `verified` = /version.json served the new sha.
--
-- Writes go exclusively through service_role (health function / deploy script),
-- which bypasses RLS. Authenticated Admins may SELECT (00014 pattern); nobody
-- else has any policy.
--
-- The actual health-check cron.schedule() call lives at the bottom of this
-- file, commented out (00020 pattern) — it embeds the HEALTH_CRON_TOKEN
-- secret, so the operator runs it once after the function + secret are live.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. health_checks
-- ---------------------------------------------------------------------------
create table health_checks (
  id               uuid        primary key default gen_random_uuid(),
  checked_at       timestamptz not null default now(),
  status           text        not null check (status in ('ok', 'degraded', 'down')),
  db_latency_ms    integer,
  frontend_ok      boolean,
  frontend_version text,                                    -- sha served by /version.json
  error_count_10m  integer     not null default 0,          -- client_errors in the last 10 min
  error            text,                                    -- human-readable failure summary
  metadata         jsonb       not null default '{}'::jsonb
);

create index health_checks_checked_idx
  on health_checks(checked_at desc);

alter table health_checks enable row level security;

create policy health_checks_admin_read on health_checks
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

-- No INSERT/UPDATE/DELETE policies. Only service_role (health function) writes.
revoke insert, update, delete on health_checks from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. deployments
-- ---------------------------------------------------------------------------
create table deployments (
  id          uuid        primary key default gen_random_uuid(),
  deployed_at timestamptz not null default now(),
  commit_sha  text        not null,
  branch      text,
  deployer    text,                                          -- os user running deploy.mjs
  url         text,                                          -- vercel deployment url
  verified    boolean     not null default false,            -- /version.json matched sha
  verified_at timestamptz,
  notes       text
);

create index deployments_deployed_idx
  on deployments(deployed_at desc);

alter table deployments enable row level security;

create policy deployments_admin_read on deployments
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

-- No INSERT/UPDATE/DELETE policies. Only service_role (deploy script) writes.
revoke insert, update, delete on deployments from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Retention — keep 30 days of health ticks (00026 guarded-cron pattern)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'health-checks-retention') THEN
            PERFORM cron.unschedule('health-checks-retention');
        END IF;
        PERFORM cron.schedule(
            'health-checks-retention',
            '43 2 * * *',                              -- daily, 02:43 UTC
            $cron$ DELETE FROM public.health_checks WHERE checked_at < now() - interval '30 days' $cron$
        );
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- OPERATOR SNIPPET — run once in the SQL editor AFTER:
--   1. the `health` Edge Function is deployed,
--   2. the HEALTH_CRON_TOKEN secret is set (npx supabase secrets set ...),
--   3. https://nexorder.vercel.app/version.json serves the deployed sha
--      (otherwise the first ticks log false `degraded` alerts).
-- Replace <HEALTH_CRON_TOKEN> with the real token. Commented out so applying
-- this migration never embeds a secret in source control.
-- ----------------------------------------------------------------------
-- SELECT cron.schedule(
--     'health-check',
--     '*/5 * * * *',                              -- every 5 minutes
--     $$
--         SELECT net.http_post(
--             url := 'https://lsgkznyiabqitqfpveey.supabase.co/functions/v1/health',
--             headers := jsonb_build_object(
--                 'Content-Type',  'application/json',
--                 'Authorization', 'Bearer <HEALTH_CRON_TOKEN>'
--             ),
--             body := '{}'::jsonb,
--             timeout_milliseconds := 50000          -- under cron's 60s tick
--         );
--     $$
-- );
-- ----------------------------------------------------------------------
-- Verify with:   SELECT * FROM cron.job WHERE jobname LIKE 'health%';
-- Inspect runs:  SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- =============================================================================
