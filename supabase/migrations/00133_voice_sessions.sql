-- =============================================================================
-- Nex Assistant (voice) -- session ledger
-- Migration: 00133_voice_sessions.sql
-- =============================================================================
-- One row per voice session the voice-session Edge Function mints. It serves
-- two purposes:
--
-- 1. THE DAILY BUDGET. Each user gets 1,800 seconds of assistant time in a
--    rolling 24 hours (_shared/voice/budget.ts). The function reads the user's
--    rows started in the last 24 hours and refuses a new session when less than
--    a minute is left. An open row (ended_at NULL) counts at the full 900 s
--    session cap, so a crashed tab never earns free minutes. This is a ledger
--    and not a rate_limit_counters bucket because that table's cleanup cron
--    deletes rows after an hour, which would forget a 24-hour window.
--
-- 2. COST. When a session ends the function stores the token usage the client
--    reports and the USD cost computed from it (_shared/voice/cost.ts), at the
--    prices of that day, so the figure never changes retroactively.
--
-- id is supplied by the function (crypto.randomUUID()), not defaulted, so the
-- row and the audit event name the same session before the insert returns.
--
-- Lockdown: service_role only. RLS on with no policies, and REVOKE ALL from the
-- two client roles removes the default-privilege grants (00101), TRUNCATE
-- included -- which is what keeps check:grants clean without a baseline entry.
-- The table is listed in config/lockedTables.mjs.
--
-- Verify:
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'voice_sessions'
--      AND grantee IN ('anon', 'authenticated');      -- expect 0 rows
--
-- Rollback: DROP TABLE public.voice_sessions;
-- =============================================================================

BEGIN;

CREATE TABLE public.voice_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_reason text,
  model text NOT NULL,
  voice text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  usage jsonb,
  cost_usd numeric(10,6)
);

-- The budget query: one user's sessions started in the last 24 hours.
CREATE INDEX idx_voice_sessions_user_started
  ON public.voice_sessions (user_id, started_at DESC);

ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_sessions FROM anon, authenticated;

COMMENT ON TABLE public.voice_sessions IS
  'Nex Assistant session ledger: daily minute budget and cost. Service role only.';

COMMIT;
