-- 00088_po_auto_approve_customer_mismatch.sql
-- Fourth PO-Inbox auto-approval policy toggle, alongside the three from 00044:
--   * po_auto_approve_block_on_customer_mismatch — hold a PO whose DOCUMENT
--     names a company other than the customer it resolved to.
--
-- Why this needed its own gate rather than riding on the sender one. 00044's
-- po_auto_approve_block_on_sender_mismatch guards a different question: "is
-- this sender allowed to order for customer X". Once an address has been
-- learned as a `sender_email` alias, resolveCustomer matches on it first and
-- detectSenderMismatch then builds its trusted set from those same aliases —
-- so that check is structurally incapable of objecting on the very path most
-- POs take. Nothing compared the printed company name to the resolved
-- customer, and a PO on Hallidays Heating and Cooling letterhead was booked
-- against Executive Heating & Cooling in silence. See
-- supabase/functions/_shared/poInbox/customerNameMatch.ts.
--
-- DEFAULT true = the new protection is ON. That is a deliberate behaviour
-- change rather than the usual "default preserves today", because today's
-- behaviour is the bug. Matching is lenient (legal suffixes stripped, "&"
-- folded to "and", containment either way, and any learned `po_text` alias for
-- the customer counts as a match), so established customers do not start
-- flagging. Admins who disagree can turn it off in Settings → Automation.
--
-- The Edge Function reads this column fail-open: a missing column or an
-- unreadable row leaves the gate ON, matching the other three toggles.

ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS po_auto_approve_block_on_customer_mismatch BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.app_settings.po_auto_approve_block_on_customer_mismatch IS
  'Hold a PO for review when the extracted customer_name_raw names a different company than the resolved HoReCa (mig 00088).';
