-- 00044_po_auto_approve_settings.sql
-- Admin-configurable PO-Inbox auto-approval policy toggles (singleton app_settings).
-- All default TRUE = today's behaviour, so nothing changes until an admin flips one.
--   * po_auto_approve_enabled                  — master switch (off ⇒ every PO needs review)
--   * po_auto_approve_block_on_short_stock      — hold a PO that can't be fully filled
--   * po_auto_approve_block_on_sender_mismatch  — hold a PO from an untrusted (spoofed) sender
--
-- Apply (Management API — direct DB host is unresolvable on this box):
--   node supabase/apply-sql.mjs supabase/migrations/00044_po_auto_approve_settings.sql

ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS po_auto_approve_enabled                 BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS po_auto_approve_block_on_short_stock     BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS po_auto_approve_block_on_sender_mismatch BOOLEAN NOT NULL DEFAULT true;
