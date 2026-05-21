-- =============================================================================
-- Cross-isolate rate limiting — Postgres backing store
-- Migration: 00026_rate_limit_backing.sql
-- =============================================================================
-- The Edge Function rate limiter (_shared/rateLimit.ts) was an in-memory
-- counter scoped to a single Deno isolate, so a caller landing on a fresh
-- isolate got a fresh budget — it slowed bursts but was not a true global cap.
--
-- This migration adds a shared backing store so the cap holds across every
-- isolate:
--   1. rate_limit_counters  — one row per limiter key (a fixed-window counter).
--   2. rate_limit_hit()     — atomic increment-and-check RPC, called by the
--                             limiter via the service-role client.
--   3. rate-limit-cleanup   — hourly pg_cron job that prunes stale rows.
--
-- Algorithm note: this is a FIXED window (the old in-memory limiter was a
-- sliding-window log). A fixed window can allow up to ~2x the limit across a
-- window boundary — acceptable for abuse-burst protection, and it reduces the
-- check to a single atomic upsert. The limiter falls back to the in-memory
-- counter if this RPC ever errors (fail-open), so a DB hiccup never hard-fails
-- the API.
--
-- Lockdown: like the other PO/admin tables, direct access is denied to
-- authenticated/anon. Only service_role (used by Edge Functions, bypasses RLS)
-- can touch the table, and only service_role may EXECUTE the RPC. This stops an
-- authenticated user from calling rate_limit_hit() directly with another user's
-- namespaced key (e.g. "place-order:<victim-uuid>") to exhaust their budget.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. rate_limit_counters — one fixed-window bucket per key
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
    key             TEXT            PRIMARY KEY,   -- "<fn>:<userId|ip>", e.g. "place-order:<uuid>"
    hits            INTEGER         NOT NULL,
    window_start    TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Cleanup job filters by window_start.
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window_start
    ON public.rate_limit_counters (window_start);

COMMENT ON TABLE public.rate_limit_counters IS
    'Cross-isolate rate-limit buckets (fixed window). One row per limiter key. '
    'No direct access for authenticated/anon — written only by the rate_limit_hit() '
    'RPC via the service-role client. Stale rows are pruned by the rate-limit-cleanup '
    'pg_cron job and overwritten lazily on the next hit.';

-- RLS: lock the table to service_role only. No policies => authenticated denied;
-- the REVOKE removes the default table grants too. service_role bypasses RLS.
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_counters FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. rate_limit_hit() — atomic increment-and-check
-- ---------------------------------------------------------------------------
-- Returns { allowed: bool, hits: int, reset_ms: int }. Increments the bucket if
-- still inside the current window, otherwise resets it. The decision and the
-- increment happen in one INSERT ... ON CONFLICT statement, so concurrent
-- callers serialise on the row lock and the count stays accurate.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
    p_key       TEXT,
    p_max       INTEGER,
    p_window_ms INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now    TIMESTAMPTZ := now();
    v_window INTERVAL    := make_interval(secs => p_window_ms / 1000.0);
    v_hits   INTEGER;
    v_start  TIMESTAMPTZ;
BEGIN
    INSERT INTO public.rate_limit_counters AS rlc (key, hits, window_start)
    VALUES (p_key, 1, v_now)
    ON CONFLICT (key) DO UPDATE
        SET hits = CASE
                       WHEN rlc.window_start + v_window > v_now
                       THEN rlc.hits + 1
                       ELSE 1
                   END,
            window_start = CASE
                       WHEN rlc.window_start + v_window > v_now
                       THEN rlc.window_start
                       ELSE v_now
                   END
    RETURNING rlc.hits, rlc.window_start INTO v_hits, v_start;

    RETURN jsonb_build_object(
        'allowed',  v_hits <= p_max,
        'hits',     v_hits,
        'reset_ms', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_start + v_window - v_now)) * 1000))::BIGINT
    );
END;
$$;

-- Only service_role may run it (keys embed user IDs / IPs — see header).
REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Hourly cleanup of stale buckets
-- ---------------------------------------------------------------------------
-- pg_cron is enabled in 00020. Unlike the poll-inbox job this is pure SQL with
-- no secret, so it can be scheduled directly here. Guarded by extension
-- existence and idempotent (unschedule-then-schedule) so re-runs are safe.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate-limit-cleanup') THEN
            PERFORM cron.unschedule('rate-limit-cleanup');
        END IF;
        PERFORM cron.schedule(
            'rate-limit-cleanup',
            '17 * * * *',                              -- hourly, at :17
            $cron$ DELETE FROM public.rate_limit_counters WHERE window_start < now() - interval '1 hour' $cron$
        );
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- Verify with:   SELECT * FROM cron.job WHERE jobname = 'rate-limit-cleanup';
--                SELECT public.rate_limit_hit('test:demo', 3, 60000);  -- run 4x
--                SELECT * FROM public.rate_limit_counters;
-- =============================================================================
