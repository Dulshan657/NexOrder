-- =============================================================================
-- Inbound Purchase Order automation — realtime + cron scaffolding
-- Migration: 00020_po_realtime_and_cron.sql
-- =============================================================================
-- 1) Adds pending_pos to the supabase_realtime publication so the PO Inbox
--    UI gets row-level notifications without polling. inbound_messages is
--    deliberately NOT added — it contains sender PII and is not subscribed
--    to by the UI (the PO Inbox subscribes to pending_pos and fetches the
--    related inbound_message row on demand). Keeping it out of the
--    publication reduces the realtime PII surface.
--
-- 2) Enables pg_cron + pg_net so the poll-inbox Edge Function can be
--    scheduled to run every 60s. Locks down the net schema so only
--    privileged roles (postgres / service_role) can invoke net.http_*
--    — denies authenticated and anon to block SSRF via any future
--    SQL-injection vector.
--
-- 3) The actual cron.schedule() call lives outside this migration — it
--    embeds a dedicated cron bearer token (NOT the Supabase service-role
--    JWT) that the poll-inbox Edge Function compares against the value
--    of the POLL_INBOX_CRON_TOKEN secret. The operator runs the snippet
--    at the bottom of this file once after deploying the function and
--    setting the secret. The snippet is commented out so applying this
--    migration never embeds a secret in source control.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Realtime — idempotent ADD TABLE
-- ---------------------------------------------------------------------------
-- ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS guard; on re-run it
-- raises "relation ... is already member of publication" and fails the
-- migration. Wrap in a DO block so `supabase db reset` and similar workflows
-- don't break.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'pending_pos'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_pos;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'email_accounts'
    ) THEN
        -- email_accounts is added so the Email Accounts admin UI sees
        -- status flips (active → error on token-refresh failure) in real
        -- time and surfaces the "Reconnect" CTA without a manual refresh.
        ALTER PUBLICATION supabase_realtime ADD TABLE public.email_accounts;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Extensions for scheduled invocation
-- ---------------------------------------------------------------------------
-- Both extensions ship with Supabase but are not enabled by default.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 3. Lock down net.* — SSRF hardening
-- ---------------------------------------------------------------------------
-- pg_net's net.http_post / net.http_get can target any URL reachable from
-- the Supabase DB host, including AWS metadata endpoints and internal
-- services. Supabase grants USAGE on the net schema broadly by default;
-- we revoke it from the application roles so only postgres / service_role
-- (used by Edge Functions and our cron job) can invoke it. This prevents
-- any future SQL-injection vulnerability in the authenticated path from
-- becoming an SSRF primitive.
REVOKE USAGE ON SCHEMA net FROM PUBLIC;
REVOKE USAGE ON SCHEMA net FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net FROM anon, authenticated;
-- Also lock down future net.* functions added by extension upgrades.
ALTER DEFAULT PRIVILEGES IN SCHEMA net REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA net REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- =============================================================================
-- OPERATOR ONE-TIME SETUP (NOT run by the migration)
-- =============================================================================
-- After deploying the poll-inbox Edge Function, generate a strong random
-- string and set it as the secret POLL_INBOX_CRON_TOKEN:
--
--     SUPABASE_ACCESS_TOKEN="$TOK" npx supabase secrets set \
--         POLL_INBOX_CRON_TOKEN="$(openssl rand -base64 48)" \
--         --project-ref lsgkznyiabqitqfpveey
--
-- Then run the SQL block below (with the actual token substituted) in the
-- Supabase SQL editor to start the 60s schedule. NB: this token is NOT the
-- service-role JWT — the poll-inbox function reads the project's
-- SUPABASE_SERVICE_ROLE_KEY from its own env to talk to the DB, and only
-- uses POLL_INBOX_CRON_TOKEN to verify the cron invocation is authentic.
--
-- Re-running the snippet is safe — the unschedule call is guarded.
--
-- ----------------------------------------------------------------------
-- DO $$
-- BEGIN
--     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'po-poll-inbox') THEN
--         PERFORM cron.unschedule('po-poll-inbox');
--     END IF;
-- END
-- $$;
--
-- SELECT cron.schedule(
--     'po-poll-inbox',
--     '* * * * *',                                -- every minute
--     $$
--         SELECT net.http_post(
--             url := 'https://lsgkznyiabqitqfpveey.supabase.co/functions/v1/poll-inbox',
--             headers := jsonb_build_object(
--                 'Content-Type',  'application/json',
--                 'Authorization', 'Bearer <POLL_INBOX_CRON_TOKEN>'
--             ),
--             body := '{}'::jsonb,
--             timeout_milliseconds := 50000          -- under cron's 60s tick
--         );
--     $$
-- );
-- ----------------------------------------------------------------------
-- Verify with:   SELECT * FROM cron.job;
-- Inspect runs:  SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- =============================================================================
