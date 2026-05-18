-- =============================================================================
-- Inbound Purchase Order automation — schema
-- Migration: 00018_po_inbox.sql
-- =============================================================================
-- Adds the data model for the HORECA Email PO Processing feature:
--   email_accounts          OAuth-connected Gmail/Outlook mailboxes
--   inbound_messages        every raw inbound email observed by the poller
--   pending_pos             extracted PO data awaiting review/approval
--   po_customer_aliases     deterministic sender/text → horeca mappings
--   po_product_aliases      per-customer item code/description → product mappings
--   po_extraction_audit     per-AI-call cost/latency/result log
--
-- Lockdown stance (matches migrations 00009 / 00013):
--   * Direct writes from `authenticated` are NOT granted via policy.
--   * All INSERT/UPDATE/DELETE happens through Edge Functions running with
--     the service_role key (which bypasses RLS).
--   * `authenticated` admins/managers only have SELECT here, gated by the
--     existing `public.user_role()` helper.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
-- pgcrypto already enabled by 00001 (used for gen_random_uuid).

-- ---------------------------------------------------------------------------
-- 1. email_accounts
-- ---------------------------------------------------------------------------
-- A connected mailbox the system polls for inbound POs. One row per
-- distributor-owned mailbox (e.g., orders@distributor.com).
--
-- oauth_refresh_token_encrypted holds the OAuth refresh token AES-encrypted
-- by the Edge Function before persistence. The DB never sees plaintext.
-- Short-lived access tokens are NOT persisted — every poll cycle exchanges
-- the refresh token for a fresh access token, which lives only in the Edge
-- Function's request scope. This removes a class of secret-at-rest risk.
CREATE TABLE public.email_accounts (
    id                              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    provider                        TEXT            NOT NULL
                                        CHECK (provider IN ('gmail','outlook')),
    email_address                   TEXT            NOT NULL,
    oauth_refresh_token_encrypted   TEXT            NOT NULL
                                        -- Cheap defense-in-depth: reject obvious plaintext OAuth tokens.
                                        -- Gmail refresh tokens start "1//", Microsoft "M.C..." or "OAQABAA",
                                        -- access tokens "ya29." (Google) or "ey..." (JWT). The encrypted
                                        -- ciphertext envelope ({iv}:{ciphertext} base64) never matches.
                                        CHECK (
                                            oauth_refresh_token_encrypted NOT LIKE '1//%'
                                            AND oauth_refresh_token_encrypted NOT LIKE 'ya29.%'
                                            AND oauth_refresh_token_encrypted NOT LIKE 'ey%'
                                            AND oauth_refresh_token_encrypted NOT LIKE 'M.C%'
                                            AND oauth_refresh_token_encrypted NOT LIKE 'OAQABAA%'
                                        ),
    watermark                       TEXT,                    -- Gmail historyId or Graph deltaLink
    status                          TEXT            NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active','paused','error')),
    last_sync_at                    TIMESTAMPTZ,
    last_error                      TEXT,
    connected_by                    UUID            NOT NULL REFERENCES public.profiles(id),
    created_at                      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (provider, email_address)
);

COMMENT ON TABLE public.email_accounts IS
  'OAuth-connected mailboxes polled for inbound POs. Direct INSERT/UPDATE/DELETE denied to all roles; mutations route through gmail-oauth-callback / outlook-oauth-callback / reconnect Edge Functions.';
COMMENT ON COLUMN public.email_accounts.oauth_refresh_token_encrypted IS
  'AES-256-GCM ciphertext (base64 {iv}:{ciphertext}) produced by the Edge Function before persistence. Plaintext never reaches the DB. Access tokens are not stored — refreshed on every poll cycle.';

-- ---------------------------------------------------------------------------
-- 1b. oauth_pending_states
-- ---------------------------------------------------------------------------
-- Holds the OAuth `state` parameter (and PKCE verifier, where used) between
-- the authorization redirect and the callback. The Edge Function generates a
-- random state, persists it here keyed to the requesting admin, then verifies
-- on callback. Rows are deleted on success or expire after 10 minutes.
-- This table exists to keep the CSRF / replay window narrow — without it,
-- Stream C's OAuth callback would be forced into an insecure cookie-or-memory
-- pattern that does not survive serverless cold starts.
CREATE TABLE public.oauth_pending_states (
    state               TEXT            PRIMARY KEY,
    provider            TEXT            NOT NULL
                            CHECK (provider IN ('gmail','outlook')),
    pkce_verifier       TEXT,                                  -- nullable: only used by PKCE-enabled flows
    requested_by        UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    expires_at          TIMESTAMPTZ     NOT NULL,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.oauth_pending_states IS
  'Short-lived OAuth state tokens for CSRF protection during the authorize → callback round-trip. Direct writes denied; written by start-oauth Edge Function, consumed and deleted by gmail/outlook-oauth-callback.';

-- ---------------------------------------------------------------------------
-- 2. inbound_messages
-- ---------------------------------------------------------------------------
-- One row per email observed by poll-inbox. The original MIME envelope and
-- attachments are uploaded to Supabase Storage under
--   po-archive/{email_account_id}/{provider_message_id}/...
-- and referenced here by storage_path_prefix.
--
-- (email_account_id, provider_message_id) is unique so re-runs of poll-inbox
-- cannot double-insert when Gmail/Graph replays an event.
CREATE TABLE public.inbound_messages (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ON DELETE RESTRICT: a mailbox cannot be deleted while it still has
    -- inbound messages. Operators decommission a mailbox by setting
    -- status='paused' or 'error' — never DELETE — so the audit trail of
    -- every PO that came through it (including approved orders) is preserved.
    email_account_id        UUID            NOT NULL REFERENCES public.email_accounts(id) ON DELETE RESTRICT,
    provider_message_id     TEXT            NOT NULL,
    from_address            TEXT            NOT NULL,
    subject                 TEXT,
    received_at             TIMESTAMPTZ     NOT NULL,
    storage_path_prefix     TEXT            NOT NULL,         -- e.g. po-archive/{accountId}/{messageId}/
    processing_status       TEXT            NOT NULL DEFAULT 'queued'
                                CHECK (processing_status IN (
                                    'queued','extracting','extracted',
                                    'failed','skipped_not_po'
                                )),
    classification_reason   TEXT,
    failure_reason          TEXT,
    retry_count             INT             NOT NULL DEFAULT 0
                                CHECK (retry_count >= 0 AND retry_count <= 10),
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (email_account_id, provider_message_id)
);

COMMENT ON TABLE public.inbound_messages IS
  'Raw inbound emails observed by poll-inbox. Idempotency key: (email_account_id, provider_message_id). Direct INSERT/UPDATE denied; written by poll-inbox + extract-po Edge Functions.';

-- ---------------------------------------------------------------------------
-- 3. pending_pos
-- ---------------------------------------------------------------------------
-- Extracted PO data awaiting review or auto-approval. One row per successful
-- extract-po run on an inbound_message classified as a PO. The standardized
-- PO JSON shape is documented in the project's MVP_PLAN.md.
--
-- matched_horeca_id is NULL when the customer couldn't be resolved (forces
-- needs_review). matched_items is a JSONB array of
--   { po_line_index, product_id, quantity, pack_size, confidence }
-- with product_id NULL for lines that need human resolution.
CREATE TABLE public.pending_pos (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ON DELETE RESTRICT: once an inbound_message is the source of an
    -- approved order, nothing should silently delete the linkage. Operators
    -- must explicitly reject or archive pending POs.
    inbound_message_id      UUID            NOT NULL UNIQUE REFERENCES public.inbound_messages(id) ON DELETE RESTRICT,
    extracted_po            JSONB           NOT NULL,
    confidence_overall      NUMERIC(3,2)    NOT NULL
                                CHECK (confidence_overall >= 0 AND confidence_overall <= 1),
    confidence_fields       JSONB           NOT NULL DEFAULT '{}'::jsonb,
    matched_horeca_id       INT             REFERENCES public.horecas(id) ON DELETE SET NULL,
    matched_items           JSONB           NOT NULL DEFAULT '[]'::jsonb,
    status                  TEXT            NOT NULL DEFAULT 'needs_review'
                                CHECK (status IN (
                                    'needs_review','approved','rejected','auto_approved'
                                )),
    approved_order_id       TEXT            REFERENCES public.orders(id) ON DELETE SET NULL,
    reviewed_by             UUID            REFERENCES public.profiles(id),
    reviewed_at             TIMESTAMPTZ,
    rejection_reason        TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    -- Reviewer co-presence: either both reviewed_* are set or neither is.
    CONSTRAINT chk_pending_pos_reviewer_pair CHECK (
        (reviewed_by IS NULL AND reviewed_at IS NULL)
        OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
    -- approved / auto_approved rows must point to a real order.
    CONSTRAINT chk_pending_pos_approved_has_order CHECK (
        status NOT IN ('approved','auto_approved') OR approved_order_id IS NOT NULL
    ),
    -- rejected rows must have a reviewer (human action) and a reason.
    CONSTRAINT chk_pending_pos_rejected_has_reviewer CHECK (
        status <> 'rejected'
        OR (reviewed_by IS NOT NULL AND rejection_reason IS NOT NULL)
    )
);

COMMENT ON TABLE public.pending_pos IS
  'Extracted PO data awaiting human review (or already auto-approved). UPDATE/INSERT happens only via extract-po / approve-po / reject-po Edge Functions.';

-- ---------------------------------------------------------------------------
-- 4. po_customer_aliases
-- ---------------------------------------------------------------------------
-- Deterministic sender → horeca mappings learned from past approvals. The
-- alias resolver consults this table first before falling back to AI fuzzy
-- match. Rows are inserted by extract-po (high-confidence auto-match) or
-- mutate-po-alias (human approval write-back).
--
-- source_type controls how the resolver compares source_value:
--   'sender_email'  → exact match against the From: address
--   'sender_domain' → exact match against the domain portion of From:
--   'po_text'       → normalized exact match against the customer name
--                     printed on the PO document
CREATE TABLE public.po_customer_aliases (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type                 TEXT            NOT NULL
                                    CHECK (source_type IN ('sender_email','sender_domain','po_text')),
    source_value                TEXT            NOT NULL,
    horeca_id                   INT             NOT NULL REFERENCES public.horecas(id) ON DELETE CASCADE,
    confidence_at_creation      NUMERIC(3,2)
                                    CHECK (confidence_at_creation IS NULL
                                           OR (confidence_at_creation >= 0 AND confidence_at_creation <= 1)),
    created_by                  UUID            REFERENCES public.profiles(id),    -- NULL = AI auto-created
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (source_type, source_value)
);

COMMENT ON TABLE public.po_customer_aliases IS
  'Customer alias table consulted before AI fuzzy match. Direct writes denied; alias-resolver and mutate-po-alias Edge Functions own this table.';

-- ---------------------------------------------------------------------------
-- 5. po_product_aliases
-- ---------------------------------------------------------------------------
-- Per-customer item code/description → product mappings. Customer-scoped
-- because the same item code (e.g. "402") can mean different products for
-- different customers.
CREATE TABLE public.po_product_aliases (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    horeca_id                   INT             NOT NULL REFERENCES public.horecas(id) ON DELETE CASCADE,
    source_code                 TEXT,                                       -- customer's item code (e.g. "402")
    source_description          TEXT,                                       -- customer's free-text product name
    product_id                  INT             NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    default_pack_size           INT
                                    CHECK (default_pack_size IS NULL OR default_pack_size > 0),
    confidence_at_creation      NUMERIC(3,2)
                                    CHECK (confidence_at_creation IS NULL
                                           OR (confidence_at_creation >= 0 AND confidence_at_creation <= 1)),
    created_by                  UUID            REFERENCES public.profiles(id),    -- NULL = AI auto-created
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    -- At least one of source_code / source_description must be non-null
    CHECK (source_code IS NOT NULL OR source_description IS NOT NULL)
);

-- Uniqueness is partial because either column may be NULL but never both.
-- We need two unique indexes — one per non-null source field — to enforce
-- "no duplicate alias for the same customer + code" and
-- "no duplicate alias for the same customer + description".
CREATE UNIQUE INDEX uq_po_product_aliases_code
    ON public.po_product_aliases (horeca_id, source_code)
    WHERE source_code IS NOT NULL;

CREATE UNIQUE INDEX uq_po_product_aliases_desc
    ON public.po_product_aliases (horeca_id, lower(source_description))
    WHERE source_description IS NOT NULL;

COMMENT ON TABLE public.po_product_aliases IS
  'Per-customer product alias table consulted before AI fuzzy match. Direct writes denied; alias-resolver and mutate-po-alias Edge Functions own this table.';

-- ---------------------------------------------------------------------------
-- 6. po_extraction_audit
-- ---------------------------------------------------------------------------
-- Logs every OpenAI call made by extract-po (and any future AI-touching
-- Edge Function). Drives the cost dashboard tile and helps debug
-- low-quality extractions. Inbound_message_id is nullable for calls that
-- aren't tied to a single message (e.g., embeddings rebuilds).
CREATE TABLE public.po_extraction_audit (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    inbound_message_id  UUID            REFERENCES public.inbound_messages(id) ON DELETE SET NULL,
    edge_function       TEXT            NOT NULL,            -- e.g. 'extract-po'
    purpose             TEXT            NOT NULL,            -- 'classify' | 'extract_pdf' | 'extract_text' | ...
    model               TEXT            NOT NULL,            -- 'gpt-4o-mini' | 'gpt-4o'
    prompt_hash         TEXT,                                -- sha256 of normalized prompt — for cache analysis
    input_tokens        INT,
    output_tokens       INT,
    latency_ms          INT,
    cost_usd            NUMERIC(10,6),                       -- computed by helper at write-time
    success             BOOLEAN         NOT NULL,
    error_message       TEXT,
    occurred_at         TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.po_extraction_audit IS
  'Per-AI-call cost/latency log. Admin-read only. INSERT only by Edge Functions via service_role.';

-- =============================================================================
-- INDEXES
-- =============================================================================

-- email_accounts: poll-inbox loops over active rows
CREATE INDEX idx_email_accounts_status_provider
    ON public.email_accounts(status, provider);

-- oauth_pending_states: callback lookups by state PK (implicit index); the
-- cleanup job filters by expires_at.
CREATE INDEX idx_oauth_pending_states_expires_at
    ON public.oauth_pending_states(expires_at);

-- inbound_messages: PO Inbox UI filters by status; idempotency-check needs FK index
CREATE INDEX idx_inbound_messages_status_received
    ON public.inbound_messages(processing_status, received_at DESC);
CREATE INDEX idx_inbound_messages_email_account_id
    ON public.inbound_messages(email_account_id);

-- pending_pos: review queue UI lists by status + age
CREATE INDEX idx_pending_pos_status_created
    ON public.pending_pos(status, created_at DESC);
CREATE INDEX idx_pending_pos_matched_horeca
    ON public.pending_pos(matched_horeca_id)
    WHERE matched_horeca_id IS NOT NULL;

-- po_customer_aliases: resolver does point lookups on (source_type, source_value)
-- already covered by the UNIQUE constraint. Additional index on horeca_id for
-- "show all aliases for this customer" UI.
CREATE INDEX idx_po_customer_aliases_horeca_id
    ON public.po_customer_aliases(horeca_id);

-- po_product_aliases: per-customer code/description lookups already indexed
-- by the partial unique indexes. Additional index on product_id for impact
-- analysis ("which customers map to this product?").
CREATE INDEX idx_po_product_aliases_product_id
    ON public.po_product_aliases(product_id);

-- po_extraction_audit: cost dashboard groups by day + model
CREATE INDEX idx_po_extraction_audit_occurred_at
    ON public.po_extraction_audit(occurred_at DESC);
CREATE INDEX idx_po_extraction_audit_inbound_message
    ON public.po_extraction_audit(inbound_message_id)
    WHERE inbound_message_id IS NOT NULL;

-- =============================================================================
-- updated_at TRIGGERS
-- =============================================================================
-- email_accounts, inbound_messages, pending_pos all have updated_at columns
-- that should track row-level changes automatically.

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_email_accounts_updated_at
    BEFORE UPDATE ON public.email_accounts
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_inbound_messages_updated_at
    BEFORE UPDATE ON public.inbound_messages
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_pending_pos_updated_at
    BEFORE UPDATE ON public.pending_pos
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.email_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_pending_states    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_pos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_customer_aliases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_product_aliases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_extraction_audit     ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- email_accounts: Admin/Manager SELECT (UI lists connected mailboxes).
-- No INSERT/UPDATE/DELETE policy — handled by gmail/outlook OAuth callback
-- Edge Functions running with service_role.
-- ---------------------------------------------------------------------------
CREATE POLICY "email_accounts_select_admin_manager"
    ON public.email_accounts FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- inbound_messages: Admin/Manager SELECT (PO Inbox / Failed / Skipped tabs).
-- ---------------------------------------------------------------------------
CREATE POLICY "inbound_messages_select_admin_manager"
    ON public.inbound_messages FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- pending_pos: Admin/Manager SELECT (PO Inbox review queue).
-- ---------------------------------------------------------------------------
CREATE POLICY "pending_pos_select_admin_manager"
    ON public.pending_pos FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- po_customer_aliases / po_product_aliases: Admin/Manager SELECT (alias UI).
-- Mutations through mutate-po-alias Edge Function.
-- ---------------------------------------------------------------------------
CREATE POLICY "po_customer_aliases_select_admin_manager"
    ON public.po_customer_aliases FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

CREATE POLICY "po_product_aliases_select_admin_manager"
    ON public.po_product_aliases FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) IN ('Admin','Manager'));

-- ---------------------------------------------------------------------------
-- po_extraction_audit: Admin-only SELECT (matches audit_events policy).
-- ---------------------------------------------------------------------------
CREATE POLICY "po_extraction_audit_select_admin"
    ON public.po_extraction_audit FOR SELECT
    TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');

-- oauth_pending_states: no SELECT/INSERT/UPDATE/DELETE policy for authenticated.
-- Only service_role reads or writes this table. Even Admins should not see
-- live state tokens (they would be a CSRF replay primitive if leaked).

-- No INSERT / UPDATE / DELETE policies on any of the seven tables.
-- service_role bypasses RLS; that's how Edge Functions write.

-- =============================================================================
-- GRANTS
-- =============================================================================
-- authenticated needs SELECT on the six operator-visible tables (RLS filters
-- which rows). oauth_pending_states is intentionally excluded — service_role
-- only. INSERT/UPDATE/DELETE are intentionally NOT granted — service_role
-- handles those via Edge Functions.

GRANT SELECT ON
    public.email_accounts,
    public.inbound_messages,
    public.pending_pos,
    public.po_customer_aliases,
    public.po_product_aliases,
    public.po_extraction_audit
TO authenticated;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
