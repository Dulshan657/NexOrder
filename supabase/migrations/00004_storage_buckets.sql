-- Create Supabase Storage buckets and access policies for the four features
-- now persisted properly: company logo, visit photos, order signatures, and
-- (room for future) product images.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('company-assets', 'company-assets', true, 5 * 1024 * 1024,
   ARRAY['image/png','image/jpeg','image/svg+xml','image/webp']),
  ('visit-photos',   'visit-photos',   true, 10 * 1024 * 1024,
   ARRAY['image/png','image/jpeg','image/webp']),
  ('signatures',     'signatures',     true, 2 * 1024 * 1024,
   ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

-- Public read for all three buckets (they hold non-sensitive public-by-design
-- assets — logo on every page, photos viewable in admin, signatures referenced
-- in invoices/order detail).  Object URLs are unguessable UUID-prefixed paths.
CREATE POLICY "public_read_company_assets"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'company-assets');

CREATE POLICY "public_read_visit_photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'visit-photos');

CREATE POLICY "public_read_signatures"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'signatures');

-- Authenticated write/update/delete (per-user gating happens client-side via
-- role checks; once auth is wired and RLS re-enabled this should be tightened).
CREATE POLICY "auth_write_company_assets"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'company-assets')
  WITH CHECK (bucket_id = 'company-assets');

CREATE POLICY "auth_write_visit_photos"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'visit-photos')
  WITH CHECK (bucket_id = 'visit-photos');

CREATE POLICY "auth_write_signatures"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'signatures')
  WITH CHECK (bucket_id = 'signatures');

-- DEV ONLY: allow anon writes too because the app currently runs without auth
-- (per CLAUDE.md "RLS disabled for dev"). Remove these three policies once
-- auth + RLS are wired in production.
CREATE POLICY "anon_write_company_assets_dev"
  ON storage.objects FOR ALL TO anon
  USING (bucket_id = 'company-assets')
  WITH CHECK (bucket_id = 'company-assets');

CREATE POLICY "anon_write_visit_photos_dev"
  ON storage.objects FOR ALL TO anon
  USING (bucket_id = 'visit-photos')
  WITH CHECK (bucket_id = 'visit-photos');

CREATE POLICY "anon_write_signatures_dev"
  ON storage.objects FOR ALL TO anon
  USING (bucket_id = 'signatures')
  WITH CHECK (bucket_id = 'signatures');
