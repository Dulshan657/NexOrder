-- 00022_po_aliases_origin.sql
--
-- Adds origin tracing to the PO alias tables: every alias row gets a nullable
-- FK back to the pending_pos row that taught the system the mapping. AI auto-
-- created aliases (via aliasResolver at >=0.9 confidence) and human-confirmed
-- aliases (via aliasDiff during approve-po) both populate this column going
-- forward. Manual aliases created through the new "+ New alias" UI leave it
-- NULL (no source PO). Pre-migration rows also stay NULL — legitimate; they
-- predate origin tracing.
--
-- Lockdown is already in place from 00018 (RLS enabled, no INSERT/UPDATE/
-- DELETE policies for authenticated, only SELECT granted). So this migration
-- is purely additive and does NOT need to REVOKE anything.

BEGIN;

-- =============================================================================
-- 1. po_customer_aliases.pending_po_id
-- =============================================================================
-- ON DELETE SET NULL: if a pending_po is ever hard-deleted, the alias survives
-- (it's a learned mapping that may still be valid), it just loses its origin
-- link. Soft-delete is preferred in the app layer, but the FK behaviour stays
-- defensive.

ALTER TABLE public.po_customer_aliases
    ADD COLUMN IF NOT EXISTS pending_po_id UUID
        REFERENCES public.pending_pos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.po_customer_aliases.pending_po_id IS
    'Origin pending_pos row that taught this alias (AI auto-create at >=0.9 '
    'confidence, or human approval write-back via aliasDiff). NULL for '
    'manually-created aliases and rows pre-dating 00022.';

CREATE INDEX IF NOT EXISTS idx_po_customer_aliases_pending_po
    ON public.po_customer_aliases (pending_po_id)
    WHERE pending_po_id IS NOT NULL;

-- =============================================================================
-- 2. po_product_aliases.pending_po_id
-- =============================================================================

ALTER TABLE public.po_product_aliases
    ADD COLUMN IF NOT EXISTS pending_po_id UUID
        REFERENCES public.pending_pos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.po_product_aliases.pending_po_id IS
    'Origin pending_pos row that taught this alias (AI auto-create at >=0.9 '
    'confidence, or human approval write-back via aliasDiff). NULL for '
    'manually-created aliases and rows pre-dating 00022.';

CREATE INDEX IF NOT EXISTS idx_po_product_aliases_pending_po
    ON public.po_product_aliases (pending_po_id)
    WHERE pending_po_id IS NOT NULL;

COMMIT;
