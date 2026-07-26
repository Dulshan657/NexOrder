-- Drop the dev-only anonymous write policies on storage.objects.
--
-- 00004_storage_buckets.sql:47-63 and 00024_image_buckets.sql:39-49 created
-- five `FOR ALL TO anon` policies with a "DEV ONLY … remove once auth + RLS
-- are wired" note. Auth and RLS were wired in 00008-00013; the policies were
-- never removed, and a production audit on 2026-07-27 confirmed all five were
-- still live.
--
-- `FOR ALL` includes DELETE. The publishable (anon) key ships in the browser
-- bundle by design, so any internet user holding it could overwrite or delete
-- every object in these buckets — including `signatures`, which is the
-- proof-of-delivery evidence for dispatched orders.
--
-- The matching `auth_write_*` policies from the same two migrations are left
-- in place. Every upload path in the app runs through an authenticated
-- Supabase client (lib/supabase.ts singleton after sign-in), so dropping the
-- anon policies removes no legitimate capability.

BEGIN;

DROP POLICY IF EXISTS "anon_write_company_assets_dev" ON storage.objects;
DROP POLICY IF EXISTS "anon_write_visit_photos_dev"   ON storage.objects;
DROP POLICY IF EXISTS "anon_write_signatures_dev"     ON storage.objects;
DROP POLICY IF EXISTS "anon_write_product_images_dev" ON storage.objects;
DROP POLICY IF EXISTS "anon_write_avatars_dev"        ON storage.objects;

COMMIT;
