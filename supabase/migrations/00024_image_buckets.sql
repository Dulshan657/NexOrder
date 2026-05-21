-- Storage buckets for admin-uploaded product images and user avatars.
-- Previously these were stuffed into the DB as base64 data URLs
-- (products.image_url / profiles.avatar_url), which bloated every product and
-- profile query and could never be cached or resized. Uploads now go to these
-- buckets as compressed WebP and the columns store a public object URL.
--
-- Policy shape mirrors 00004_storage_buckets.sql: public read (these are
-- public-by-design catalog/avatar assets behind unguessable UUID paths),
-- authenticated write, plus dev-only anon write.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('product-images', 'product-images', true, 5 * 1024 * 1024,
   ARRAY['image/png','image/jpeg','image/webp']),
  ('avatars',        'avatars',        true, 2 * 1024 * 1024,
   ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "public_read_product_images"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'product-images');

CREATE POLICY "public_read_avatars"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- Authenticated write/update/delete
CREATE POLICY "auth_write_product_images"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'product-images')
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "auth_write_avatars"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');

-- DEV ONLY: allow anon writes too (matches the existing buckets in 00004).
-- Remove once the app no longer runs without auth in any environment.
CREATE POLICY "anon_write_product_images_dev"
  ON storage.objects FOR ALL TO anon
  USING (bucket_id = 'product-images')
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "anon_write_avatars_dev"
  ON storage.objects FOR ALL TO anon
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');
