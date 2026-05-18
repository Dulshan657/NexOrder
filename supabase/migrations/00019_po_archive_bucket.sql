-- =============================================================================
-- Inbound Purchase Order automation — Storage bucket
-- Migration: 00019_po_archive_bucket.sql
-- =============================================================================
-- Creates the private `po-archive` Supabase Storage bucket that holds:
--   * The raw .eml of every inbound message (audit trail)
--   * Each attachment (PDF, DOCX, scanned image) referenced by extract-po
--   * The standardized.json the extractor wrote alongside the original
--
-- Path layout, written by poll-inbox / extract-po:
--   po-archive/{email_account_id}/{provider_message_id}/original.eml
--   po-archive/{email_account_id}/{provider_message_id}/attachment-{n}.{ext}
--   po-archive/{email_account_id}/{provider_message_id}/standardized.json
--
-- Unlike the buckets created by 00004 (company-assets, visit-photos,
-- signatures) this bucket is PRIVATE. The PO Inbox UI fetches originals
-- through short-lived signed URLs issued by the create-po-document-url
-- Edge Function (or the supabase-js admin client server-side).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'po-archive',
    'po-archive',
    false,                              -- private — no anonymous access
    25 * 1024 * 1024,                   -- 25 MB / object (POs are tiny; this is generous)
    ARRAY[
        'message/rfc822',               -- .eml
        'application/octet-stream',     -- .eml fallback when MIME sniffer can't detect rfc822
        'application/pdf',              -- .pdf attachments
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- .docx
        'application/msword',           -- .doc legacy
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'application/json',             -- standardized.json
        'text/plain'                    -- raw email body fallback
    ]
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Policies on storage.objects
-- ---------------------------------------------------------------------------
-- Pattern note: storage.objects has RLS enabled by Supabase. By default no
-- role can read or write this bucket; we add an Admin/Manager-read policy
-- so the PO Inbox UI can use a signed-URL or direct SDK GET to fetch the
-- original document next to the extracted form.
--
-- All writes go through the service_role used by poll-inbox / extract-po —
-- no application-layer write policy is granted.

CREATE POLICY "po_archive_select_admin_manager"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'po-archive'
        AND (SELECT public.user_role()) IN ('Admin','Manager')
    );

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
