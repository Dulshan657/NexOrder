-- =============================================================================
-- The tenant's own-product rule for QuickBooks uploads (NX-0031)
-- Migration: 00141_qb_import_settings.sql
-- =============================================================================
-- An upload can hold other brands' lines, which are skipped and named. A line that
-- is one of the tenant's own products but is missing from qb_product_map must not
-- be skipped: that would be a short order nobody was told about. So the tenant
-- stores what its own product names look like, and such a line rejects its invoice.
--
--   qb_own_product_prefixes  an unmapped name starting with one of these is ours
--   qb_own_product_terms     an unmapped name containing one of these is ours
--
-- Both are compared trimmed and ignoring case. Empty, the default, means nothing is
-- the tenant's own, so every unmapped line is skipped and named. Values are data,
-- loaded per tenant outside this repository, so no brand appears in code.
--
-- WHO CAN WRITE. Nobody but the service role. app_settings has had no client
-- INSERT, UPDATE or DELETE since 00013, and a new column adds no grant. These two
-- are deliberately absent from mutate-app-settings' schema, which strips unknown
-- keys, so this adds no write path. It is why this file touches no grant or policy.
--
-- WHO CAN READ. import-qb-invoices is the only reader in the code, but
-- app_settings_select_authenticated lets any signed-in user select the row, and
-- these columns inherit that. The values are name fragments, not secrets.
--
-- No BEGIN or COMMIT here: supabase/migrate.mjs wraps this file.
--
-- Verify:
--   SELECT qb_own_product_prefixes, qb_own_product_terms FROM public.app_settings;
--   -- expect {} and {}
--
-- Rollback:
--   ALTER TABLE public.app_settings
--     DROP COLUMN qb_own_product_terms,
--     DROP COLUMN qb_own_product_prefixes;
-- =============================================================================

ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS qb_own_product_prefixes TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS qb_own_product_terms    TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.app_settings.qb_own_product_prefixes IS
    'An unmapped QuickBooks product name starting with one of these is the tenant''s '
    'own, so its invoice is rejected. Empty means none. Read by import-qb-invoices '
    '(mig 00141).';
COMMENT ON COLUMN public.app_settings.qb_own_product_terms IS
    'An unmapped QuickBooks product name containing one of these is the tenant''s '
    'own, so its invoice is rejected. Empty means none. Read by import-qb-invoices '
    '(mig 00141).';
