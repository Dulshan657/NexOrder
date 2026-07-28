-- 00086_environment_marker.sql
-- The database's own answer to "which environment am I?".
--
-- From 2026-07 there are two Supabase projects: the Singapore project
-- (dev / sales demo) and a Sydney project (production, Amadiya Agro Products).
-- Seed, demo and reset scripts must never run against the second one.
--
-- Three independent guards stop that (PRODUCTION-LAUNCH-PLAN.md §A2.3):
--
--   1. resolveTarget({ allow: ['dev'] })  — argv/NEXORDER_ENV must say dev
--   2. a registry credential assertion    — the loaded creds must be dev's
--   3. THIS TABLE                          — the database itself must say dev
--
-- Only #3 survives BOTH a mis-set env file and a mis-edited registry, because
-- it is the only one that asks the thing about to be written to.
--
-- The table is deliberately created EMPTY. `migrate.mjs` writes the row from
-- config/environments.mjs immediately afterwards. An unstamped database is
-- therefore treated as unsafe rather than as dev — and default_tenant()
-- (migration 00087) returns NULL, which the NOT NULL tenant columns reject
-- loudly instead of silently stamping the wrong client's name onto real data.

BEGIN;

CREATE TABLE IF NOT EXISTS public.environment_marker (
  -- Singleton. The CHECK is what makes "the row" unambiguous, so every reader
  -- can use `WHERE id = 1` and no reader has to decide which of two rows wins.
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- 'dev' or 'prod'. Read by every fixture script before it writes anything.
  name        text NOT NULL CHECK (name IN ('dev', 'prod')),

  -- The tenant tag stamped onto new rows; see 00087. 'ayam' on dev,
  -- 'amadiya' on the Sydney project.
  tenant_key  text NOT NULL CHECK (tenant_key <> ''),

  stamped_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.environment_marker IS
  'Singleton identifying this database as dev or prod. Written by supabase/migrate.mjs from config/environments.mjs. Fixture scripts refuse to run when name = ''prod'', and refuse to run when the table is empty.';

-- service_role only: RLS on, no policies. Nothing in the app reads this — it is
-- read by operator tooling through the Management API and by SECURITY DEFINER
-- functions (00087), both of which bypass RLS.
ALTER TABLE public.environment_marker ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.environment_marker FROM anon, authenticated;

COMMIT;
