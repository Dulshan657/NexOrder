-- =============================================================================
-- Signatures and premises photographs stop being world-readable, and no client
-- JWT can list, overwrite or delete an object in any bucket
-- Migration: 00113_lockdown_storage_buckets.sql
-- =============================================================================
-- Security-audit findings STOR-1 and STOR-2 (2026-08-19). The audit sequences
-- them as one remediation item because they are one hole: STOR-1 defeats the
-- justification STOR-2 was written on.
--
-- WHAT WAS ACTUALLY TRUE UNTIL NOW.
--   * 00004:47-63 and 00024:39-49 created five write policies whose ONLY
--     predicate is the bucket name:
--         CREATE POLICY "auth_write_signatures" ON storage.objects
--           FOR ALL TO authenticated
--           USING (bucket_id = 'signatures') WITH CHECK (bucket_id = 'signatures');
--     `FOR ALL` covers SELECT -- which on storage.objects is the LIST operation
--     -- plus UPDATE and DELETE. `Restaurant/Hotel Customer` satisfies
--     `TO authenticated`, so any customer login could enumerate every object
--     path in all five buckets and remove them, using the app's own JS client.
--     No Edge Function is involved, so _shared/audit.ts is never reached and no
--     audit_events row is written.
--   * 00004:5-13 and 00024:11-17 inserted all five buckets with `public = true`,
--     and no migration in the corpus has ever written storage.buckets.public
--     (verified by grep across all 114 files, and on dev before this ran). A
--     public bucket is served at /storage/v1/object/public/<bucket>/<path> by
--     the CDN with no JWT and with storage.objects RLS NOT CONSULTED AT ALL,
--     which makes the five public_read_* policies decorative for that path.
--   * 00081 fixed the identical `FOR ALL` bug for `anon` and said in its header
--     that it was leaving the auth_write_* policies in place. The `authenticated`
--     half was never opened as a finding until now.
--
-- WHY IT MATTERED, AND WHY THE TWO COMPOUND. 00004:15-17 justified public
-- buckets on the grounds that "object URLs are unguessable UUID-prefixed paths".
-- That is obscurity rather than access control, and STOR-1 defeats it three
-- lines further down the same file: list() hands over every path, and the
-- objects then read with no authentication at all.
--
-- The delete is the worse half. Compliance/_src/08-data-retention-policy.md:64
-- puts these signatures at SEVEN YEARS, and 04-business-continuity-plan.md and
-- risk R-23 both record that object storage is NOT covered by the database
-- backup. A logical delete of a signature is unrecoverable, and it was
-- reachable by a customer login.
--
-- Risk-register R-02 records all of this as "closed by making the buckets
-- private and issuing access through audited signed URLs". It was not closed;
-- this migration is the change that makes that sentence true.
--
-- THE FINDING'S OWN FRAMING IS WRONG, and the compliance wording inherits it.
-- Both call signatures "proof-of-delivery evidence". They are not.
-- components/OrderVerificationModal.tsx puts the canvas in the CART, at order
-- placement -- the customer signs on the REP's device before anything is picked
-- or dispatched, and context/OrderContext.tsx:315-319 skips the modal entirely
-- for a Customer login. No driver, no delivery scan. It is order-verification
-- evidence. That does not change the fix; it changes what the documents should
-- say, and they are corrected alongside this.
--
-- THE AUDIT PRESCRIBED `owner = auth.uid()` FOR avatars. That is not applied,
-- and the reason is evidence rather than preference. Checked on dev before
-- writing this: `owner` and `owner_id` are NULL on all 238 objects in all nine
-- buckets. An owner predicate would therefore deny every UPDATE and DELETE, and
-- UserForm.tsx:81 fires its cleanup delete as `void ... .catch()`, so it would
-- fail SILENTLY and orphan a file on every avatar replacement. The prescription
-- also assumes self-service avatars, which this app does not have: UserForm is
-- rendered only by UserAdmin.tsx:120, the Admin-only Users tab.
--
-- SO EACH BUCKET'S WRITE GATE IS THE GATE ON THE COLUMN THAT REFERENCES IT.
-- A file nobody can point at is not worth being able to upload:
--     company-assets  -> app_settings.company_logo_url -> mutate-app-settings -> Admin
--     product-images  -> products.image_url            -> mutate-product      -> Admin, Manager
--     avatars         -> profiles.avatar_url           -> UserAdmin           -> Admin
-- These use user_role() IN (...) rather than user_is_staff(), matching the
-- storage-policy house style (00019:41, 00031:23, 00074:114). CLAUDE.md's
-- "never compare a role to a literal" rule is about READ access (00105) and
-- does not apply to a write gate that must name specific roles.
--
-- signatures AND visit-photos GET NO CLIENT POLICY AT ALL, matching
-- floorplan-scans (00058:27, "no storage.objects policies: all access is via
-- service-role signed URLs"). Every read and every write now goes through an
-- Edge Function as service_role. That is what makes seven-year evidence
-- undeletable by a client JWT, and it is the load-bearing half of this change.
--
-- GRANTS ARE CHECKED AND DELIBERATELY NOT TOUCHED -- the one place this differs
-- from 00112. `anon` and `authenticated` do hold INSERT/UPDATE/DELETE/TRUNCATE
-- on storage.objects and storage.buckets (verified on dev), which is the
-- platform default: Supabase grants broadly there and relies on RLS. Two things
-- make it safe to leave alone, both verified rather than assumed:
--   * storage.buckets has RLS enabled with ZERO policies, so no client role can
--     read it, let alone flip `public` back on.
--   * the `storage` schema is not exposed through PostgREST -- a request with
--     `Accept-Profile: storage` and the anon key returns 406, where the same
--     request against public.orders returns 401. So TRUNCATE, the one write RLS
--     cannot constrain, has no route from a browser JWT.
-- Revoking on a platform-owned schema would buy nothing and would be undone by
-- the next storage upgrade. The policy predicate and buckets.public are the
-- only two levers here, and both are pulled below.
--
-- THE STORED VALUE IS MIGRATED, NOT JUST THE BUCKET. orders.verification
-- ->>'signatureDataUrl' and visits.photos[] hold FULL ABSOLUTE PUBLIC URLs, so
-- flipping the bucket private would 400 every existing row. Step 1 normalises
-- them to bare storage keys. On dev that is 8 order rows; 3 more hold a legacy
-- `data:` URL and are deliberately left alone -- they have no key to migrate to,
-- and the reader renders them inline as it always has. lib/storageKey.ts stays
-- tolerant of all three shapes regardless, because demo-export/ on disk still
-- carries the old spelling and re-importing it must not break the app.
--
-- Contents:
--   1. Normalise stored signature / photo values to bare storage keys
--   2. Drop all ten 00004 / 00024 policies -- the public_read_* as well
--   3. signatures and visit-photos become private
--   4. Per-verb, role-gated write policies for the three buckets that stay public
--   5. Say the rule on each surviving policy
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Absolute public URLs become bare storage keys
-- ---------------------------------------------------------------------------
-- Rows holding a `data:` URL, a bare key already, or method='call_reference'
-- are not matched by the WHERE and are left untouched.

UPDATE public.orders
   SET verification = jsonb_set(
           verification,
           '{signatureDataUrl}',
           to_jsonb(regexp_replace(
               verification->>'signatureDataUrl',
               '^.*/storage/v1/object/public/signatures/', ''))
       )
 WHERE verification->>'signatureDataUrl' LIKE '%/storage/v1/object/public/signatures/%';

-- WITH ORDINALITY is load-bearing: photos is an ordered array the operator
-- arranged, and unnest() without it makes the row order an implementation
-- detail of the plan.
UPDATE public.visits
   SET photos = ARRAY(
           SELECT regexp_replace(p.val, '^.*/storage/v1/object/public/visit-photos/', '')
             FROM unnest(visits.photos) WITH ORDINALITY AS p(val, ord)
            ORDER BY p.ord)
 WHERE photos IS NOT NULL
   AND EXISTS (
           SELECT 1 FROM unnest(visits.photos) AS q(val)
            WHERE q.val LIKE '%/storage/v1/object/public/visit-photos/%');

-- ---------------------------------------------------------------------------
-- 2. Every policy 00004 and 00024 created
-- ---------------------------------------------------------------------------
-- The public_read_* policies go too, and that is not tidying. Flipping
-- buckets.public alone would leave `public_read_signatures` -- FOR SELECT TO
-- public -- still granting anonymous reads through the authenticated object
-- API. The CDN path and the object API are two doors; this closes both.

DROP POLICY IF EXISTS "auth_write_company_assets" ON storage.objects;
DROP POLICY IF EXISTS "auth_write_visit_photos"   ON storage.objects;
DROP POLICY IF EXISTS "auth_write_signatures"     ON storage.objects;
DROP POLICY IF EXISTS "auth_write_product_images" ON storage.objects;
DROP POLICY IF EXISTS "auth_write_avatars"        ON storage.objects;

DROP POLICY IF EXISTS "public_read_company_assets" ON storage.objects;
DROP POLICY IF EXISTS "public_read_visit_photos"   ON storage.objects;
DROP POLICY IF EXISTS "public_read_signatures"     ON storage.objects;
DROP POLICY IF EXISTS "public_read_product_images" ON storage.objects;
DROP POLICY IF EXISTS "public_read_avatars"        ON storage.objects;

-- ---------------------------------------------------------------------------
-- 3. The two buckets holding personal information become private
-- ---------------------------------------------------------------------------
-- The first statement in this repo's history to write storage.buckets.public.
-- 00004/00024 used INSERT ... ON CONFLICT DO NOTHING, so even re-running them
-- could never have changed it.
--
-- Both are classified Confidential and personal in
-- Compliance/_src/20-data-classification-standard.md:100 -- a signature
-- identifies a person, and a premises photograph identifies a customer's site.

UPDATE storage.buckets
   SET public = false
 WHERE id IN ('signatures', 'visit-photos');

-- ---------------------------------------------------------------------------
-- 4. Per-verb, role-gated policies for the three buckets that stay public
-- ---------------------------------------------------------------------------
-- These three are public BY DESIGN and stay that way: the operator's logo is on
-- every page and every generated PDF, product images are on the customer Shop,
-- and an avatar appears in the header of every signed-in session. What changes
-- is that writing them is no longer something every login can do.
--
-- SELECT stays open because the bucket is public -- the CDN serves it without
-- consulting RLS at all, so a narrower SELECT policy here would be exactly the
-- decorative half-measure 00004 shipped. If one of these ever needs to be
-- private, the bucket flag is the lever, not the policy.

CREATE POLICY "company_assets_select_public"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'company-assets');

CREATE POLICY "company_assets_insert_admin"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'company-assets' AND (SELECT public.user_role()) = 'Admin');

CREATE POLICY "company_assets_update_admin"
    ON storage.objects FOR UPDATE TO authenticated
    USING      (bucket_id = 'company-assets' AND (SELECT public.user_role()) = 'Admin')
    WITH CHECK (bucket_id = 'company-assets' AND (SELECT public.user_role()) = 'Admin');

CREATE POLICY "company_assets_delete_admin"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'company-assets' AND (SELECT public.user_role()) = 'Admin');

CREATE POLICY "product_images_select_public"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'product-images');

CREATE POLICY "product_images_insert_admin_manager"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'product-images'
                AND (SELECT public.user_role()) IN ('Admin', 'Manager'));

CREATE POLICY "product_images_update_admin_manager"
    ON storage.objects FOR UPDATE TO authenticated
    USING      (bucket_id = 'product-images'
                AND (SELECT public.user_role()) IN ('Admin', 'Manager'))
    WITH CHECK (bucket_id = 'product-images'
                AND (SELECT public.user_role()) IN ('Admin', 'Manager'));

CREATE POLICY "product_images_delete_admin_manager"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'product-images'
           AND (SELECT public.user_role()) IN ('Admin', 'Manager'));

CREATE POLICY "avatars_select_public"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'avatars');

CREATE POLICY "avatars_insert_admin"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND (SELECT public.user_role()) = 'Admin');

CREATE POLICY "avatars_update_admin"
    ON storage.objects FOR UPDATE TO authenticated
    USING      (bucket_id = 'avatars' AND (SELECT public.user_role()) = 'Admin')
    WITH CHECK (bucket_id = 'avatars' AND (SELECT public.user_role()) = 'Admin');

CREATE POLICY "avatars_delete_admin"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'avatars' AND (SELECT public.user_role()) = 'Admin');

-- signatures and visit-photos deliberately get NOTHING here. See the header.

-- ---------------------------------------------------------------------------
-- 5. State the rule where the next person will read it
-- ---------------------------------------------------------------------------

COMMENT ON POLICY "company_assets_select_public" ON storage.objects IS
    'company-assets is public by design -- the operator logo is on every page '
    'and every generated PDF. Writes are Admin-only (mig 00113), matching '
    'mutate-app-settings, which owns app_settings.company_logo_url.';

COMMENT ON POLICY "product_images_select_public" ON storage.objects IS
    'product-images is public by design -- the customer Shop renders it. Writes '
    'are Admin/Manager (mig 00113), matching mutate-product, which owns '
    'products.image_url.';

COMMENT ON POLICY "avatars_select_public" ON storage.objects IS
    'avatars is public by design -- shown in the header of every signed-in '
    'session. Writes are Admin-only (mig 00113): UserForm is rendered only by '
    'the Admin-only Users tab, there is no self-service upload, and the audit''s '
    'suggested owner = auth.uid() predicate would deny everything because '
    'storage.objects.owner is NULL on every object in this project.';

COMMIT;

-- =============================================================================
-- Verify with (the security audit's own Appendix A steps 4 and 9, inverted --
-- these are the queries that reported the defect, so they are the ones that
-- must now come back clean):
--
--   SELECT id, public FROM storage.buckets ORDER BY id;
--     -- expect signatures = false and visit-photos = false; company-assets,
--     -- product-images and avatars still true; the other four unchanged.
--
--   SELECT policyname, cmd, roles, qual
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--    ORDER BY policyname;
--     -- expect NO policy with cmd = 'ALL' to authenticated, anywhere, and no
--     -- policy naming 'signatures' or 'visit-photos' at all.
--
--   -- Unauthenticated, against a path taken from storage.objects:
--   curl -s -o /dev/null -w "%{http_code}\n" \
--     "https://<ref>.supabase.co/storage/v1/object/public/signatures/<path>"
--     -- expect 400 or 404. A 200 means the bucket is still public.
--
--   -- And from a real CUSTOMER browser session, which is the failure mode
--   -- STOR-1 actually described -- both must come back empty or refused:
--   --   await supabase.storage.from('signatures').list('orders')
--   --   await supabase.storage.from('signatures').remove(['orders/<x>.png'])
--
-- `npm run check:storage:<target>` asserts every bucket flag and the absence of
-- any FOR ALL policy, from config/storageBuckets.mjs.
--
-- Rollback (do not -- this reopens STOR-1 and STOR-2; recorded only so the
-- change is legible):
--   UPDATE storage.buckets SET public = true WHERE id IN ('signatures','visit-photos');
--   -- the ten policies would also have to be recreated from 00004:18-63 and
--   -- 00024:20-49, and step 1's key normalisation reversed by prefixing
--   -- https://<ref>.supabase.co/storage/v1/object/public/<bucket>/ back on.
-- =============================================================================
