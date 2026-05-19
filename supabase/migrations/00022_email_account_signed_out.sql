-- 00022_email_account_signed_out.sql
--
-- Adds support for "Sign out" of an email account. A signed-out row stops
-- being polled (poll-inbox already filters status='active'), has its
-- refresh token cleared, and is hidden from the EmailAccountsTab admin
-- list — but its FK is preserved so inbound_messages / pending_pos /
-- orders that came from this mailbox keep their lineage in the audit
-- trail.
--
--   1. Extend email_accounts.status CHECK to include 'signed_out'
--   2. Drop the NOT NULL on oauth_refresh_token_encrypted so the
--      disconnect-email-account function can null it out atomically
--   3. Add signed_out_at + signed_out_by columns for audit attribution

BEGIN;

-- =============================================================================
-- 1. Extend the status CHECK
-- =============================================================================

ALTER TABLE public.email_accounts
    DROP CONSTRAINT IF EXISTS email_accounts_status_check;

ALTER TABLE public.email_accounts
    ADD CONSTRAINT email_accounts_status_check
    CHECK (status IN ('active','paused','error','signed_out'));

-- =============================================================================
-- 2. Make oauth_refresh_token_encrypted nullable
-- =============================================================================
-- A signed-out row stores no token. Active/paused/error rows still need
-- one — that invariant is enforced in the application layer (the OAuth
-- callback always sets a fresh value before flipping status away from
-- signed_out, and disconnect-email-account always nulls the token at the
-- same instant it sets status='signed_out').

ALTER TABLE public.email_accounts
    ALTER COLUMN oauth_refresh_token_encrypted DROP NOT NULL;

-- =============================================================================
-- 3. Audit columns
-- =============================================================================
-- Nullable: existing rows have never been signed out, and the
-- disconnect-email-account function populates both atomically when a
-- human signs out.  signed_out_by is nullable rather than the more
-- aggressive NOT NULL so service-role housekeeping (e.g. a future
-- expiry-based auto-signout) isn't blocked by the FK.

ALTER TABLE public.email_accounts
    ADD COLUMN IF NOT EXISTS signed_out_at TIMESTAMPTZ;

ALTER TABLE public.email_accounts
    ADD COLUMN IF NOT EXISTS signed_out_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.email_accounts.signed_out_at IS
    'Set by disconnect-email-account when status flips to signed_out. NULL for non-signed-out rows.';
COMMENT ON COLUMN public.email_accounts.signed_out_by IS
    'profiles.id of the operator who signed out this mailbox, or NULL for system-initiated sign-outs.';

COMMIT;
