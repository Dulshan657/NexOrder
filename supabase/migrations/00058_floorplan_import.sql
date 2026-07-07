-- =============================================================================
-- Warehouse Intelligence Engine — floor-plan image import
-- Migration: 00058_floorplan_import.sql
-- =============================================================================
-- Lets an admin upload a photo/scan of a warehouse floor plan and have OpenAI
-- vision turn it into an editable DRAFT layout. Adds:
--   * a PRIVATE `floorplan-scans` bucket for the uploaded images (sensitive —
--     served only via short-lived signed URLs from the Edge Functions)
--   * a `floorplan_imports` job table tracking each upload → extraction attempt
--
-- Writes are service-role only (create-floorplan-upload-url / extract-floorplan);
-- admins can read their import rows. Additive & idempotent.
-- =============================================================================

BEGIN;

-- 1. Private bucket ----------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'floorplan-scans',
    'floorplan-scans',
    false,                              -- private
    10 * 1024 * 1024,                   -- 10 MB / image
    ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
-- No storage.objects policies: all access is via service-role signed URLs.

-- 2. Import job table --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.floorplan_imports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id  INT NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    storage_path  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
    layout_id     INT REFERENCES public.warehouse_layouts(id) ON DELETE SET NULL,
    confidence    NUMERIC(4,3),
    needs_review  BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_floorplan_imports_warehouse ON public.floorplan_imports(warehouse_id);

-- RLS: admins read their import history; all writes are service-role only.
ALTER TABLE public.floorplan_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "floorplan_imports_select_admin" ON public.floorplan_imports;
CREATE POLICY "floorplan_imports_select_admin" ON public.floorplan_imports FOR SELECT TO authenticated
    USING ((SELECT public.user_role()) = 'Admin');
GRANT SELECT ON public.floorplan_imports TO authenticated;

COMMIT;

-- Verify:
--   SELECT id, public FROM storage.buckets WHERE id = 'floorplan-scans';
--   SELECT status, needs_review FROM public.floorplan_imports ORDER BY created_at DESC LIMIT 5;
