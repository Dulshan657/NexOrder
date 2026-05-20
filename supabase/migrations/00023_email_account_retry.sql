-- 00023_email_account_retry.sql
--
-- Keeps a connected mailbox "signed in" through transient failures. Before
-- this migration, poll-inbox flipped an account to status='error' on ANY
-- exception (a 15s timeout, a provider 5xx, a 429 rate-limit, a network
-- blip), and the poll query only selects status='active' — so an errored
-- account was never polled again and could never auto-recover. One transient
-- hiccup permanently disconnected the mailbox until a human re-ran OAuth.
--
-- These columns let poll-inbox keep transiently-failing accounts ACTIVE and
-- retry them with exponential backoff, reserving status='error' for genuine
-- provider revocation (invalid_grant) that truly requires re-authorization.
--
--   1. consecutive_failures — count of back-to-back failed poll cycles;
--      reset to 0 on the next successful sync.
--   2. next_retry_at — when set in the future, poll-inbox skips the row this
--      cycle (backoff) but leaves it active so it WILL be retried later.
--   3. Partial index on (next_retry_at) WHERE status='active' so the
--      per-cycle "active and due" scan stays cheap as accounts accumulate.

BEGIN;

ALTER TABLE public.email_accounts
    ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_retry_at        TIMESTAMPTZ;

COMMENT ON COLUMN public.email_accounts.consecutive_failures IS
    'Back-to-back failed poll cycles. Incremented on transient failure, reset to 0 on a successful sync. Surfaced in the admin UI as a "reconnecting" indicator while the account stays active.';
COMMENT ON COLUMN public.email_accounts.next_retry_at IS
    'Backoff gate set by poll-inbox after a transient failure. While > now() the account is skipped this cycle but remains active and WILL be retried later. NULL means due immediately.';

CREATE INDEX IF NOT EXISTS idx_email_accounts_poll
    ON public.email_accounts (next_retry_at)
    WHERE status = 'active';

COMMIT;
