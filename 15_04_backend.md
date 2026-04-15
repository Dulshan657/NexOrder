# Backend Wiring — 2026-04-15

Four frontend features that previously had no real backend are now persisted to Supabase. Authored in one batch on this date.

## Summary table

| Feature | Before | After | Bucket / Table |
|---|---|---|---|
| **Pantry items** | Read/written to `localStorage` (key `pantry_lists`); cleared on logout | Read via `usePantryItems(horecaId)` hook, written via `useUpsertPantryItem` / `useDeletePantryItem` | DB table `pantry_items` |
| **Company logo** | Base64 in `localStorage` (key `app_logo`); lost on cache clear | Uploaded to `company-assets` Storage bucket; URL stored in `app_settings.company_logo_url` | Bucket `company-assets` + new column |
| **Visit photos** | Base64 data URLs in component state; lost on refresh | Uploaded to `visit-photos` Storage bucket; URLs stored in `visits.photos` array | Bucket `visit-photos` |
| **Order signatures** | Canvas `toDataURL()` blob held in in-memory verification object | Uploaded to `signatures` Storage bucket; URL stored in `OrderVerification.signatureDataUrl` (now contains a URL, not base64) | Bucket `signatures` |

## Schema changes

### Migration `00004_storage_buckets.sql`

Created three Storage buckets via `INSERT INTO storage.buckets`:

- `company-assets` — public, 5 MB cap, image MIME types only
- `visit-photos` — public, 10 MB cap, image MIME types only
- `signatures` — public, 2 MB cap, PNG only

Plus per-bucket RLS policies:

- Public **read** for all three (paths are unguessable UUIDs; URLs intended to be embedded in `<img>`).
- **Authenticated write/update/delete** for all three.
- **Anonymous write** dev-only policies — must be removed once auth + RLS are wired in production.

### Migration `00005_add_logo_url.sql`

```sql
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS company_logo_url TEXT;
```

The `app_settings` row is a singleton (id = 1), so no per-tenant logic.

## Code surface

### New shared helper

`services/supabase/storageService.ts`
- `uploadToBucket(bucket, blob|file, { prefix?, contentType?, ext? })` → returns the public URL. Generates a UUID-prefixed path so concurrent uploads never collide.
- `dataUrlToBlob(dataUrl)` → converts canvas/file-reader base64 output to a `Blob` for upload.
- `deleteFromBucketByUrl(bucket, url)` → best-effort cleanup; ignores failures.

### Pantry

- `App.tsx`: removed `useLocalStorage<PantryLists>('pantry_lists', INITIAL_PANTRY_LISTS)`. Replaced with `usePantryItems(selectedHoReCa?.id)` query → mapped to `PantryItem[]` for the current customer. The three handlers (`handleTogglePantry`, `handleRemoveFromPantry`, `handleUpdatePantryItem`) now call `useUpsertPantryItem().mutate(...)` and `useDeletePantryItem().mutate(...)` instead of mutating localStorage.
- `INITIAL_PANTRY_LISTS` import removed from App.tsx (still consumed by `supabase/seed.ts`, kept).
- The existing `services/supabase/pantryService.ts` and `hooks/queries/usePantry.ts` were already in place — only App.tsx wiring changed.

### Company logo

- `types.ts`: `AppSettings.companyLogoUrl?: string | null`.
- `lib/database.types.ts`: added `company_logo_url` to the `app_settings` Row/Update.
- `lib/adapters.ts`: `toAppSettings` reads it; `fromAppSettings` writes it.
- `App.tsx`: removed `useLocalStorage<string | null>('app_logo', null)`. Now reads `appSettings.companyLogoUrl ?? null` and persists via `updateSettingsMutation.mutate(fromAppSettings({ companyLogoUrl: logo }))`.
- `components/SettingsPanel.tsx`: file-input handler is now async — calls `uploadToBucket('company-assets', file, { prefix: 'logos' })`, then propagates the URL to App via the existing `onUpdateLogo` callback. Added `isUploadingLogo` spinner state. "Remove" button now calls `deleteFromBucketByUrl` for cleanup.

### Visit photos

- `components/visits/PhotoUpload.tsx` rewritten:
  - On file select / camera capture: each file goes to `uploadToBucket('visit-photos', file, { prefix: 'visits' })` concurrently (`Promise.all`).
  - Per-file try/catch: on failure surfaces toast and skips that file (never appends a broken URL).
  - `uploadingCount` state renders a spinner placeholder tile per in-flight upload.
  - `maxPhotos` gating accounts for in-flight uploads (prevents burst-selecting past the cap).
  - Removal calls `deleteFromBucketByUrl('visit-photos', url)` best-effort.
  - The `onPhotosChange(string[])` contract is unchanged — strings are now URLs instead of base64 data URLs. `VisitTimeline` / `VisitCard` / `VisitModal` are URL-agnostic so no changes needed there.

### Order signatures

- `types.ts`: `SignatureVerification.signatureDataUrl` field name kept; semantically it now holds a public URL instead of a base64 string. `OrderDetailView.tsx` continues to render `<img src={order.verification.signatureDataUrl}>` and works either way.
- `components/OrderVerificationModal.tsx`:
  - `handleConfirm` is now `async`. When the user confirms a signature: convert canvas via `dataUrlToBlob(canvas.toDataURL('image/png'))`, then `await uploadToBucket('signatures', blob, { prefix: 'orders', contentType: 'image/png', ext: 'png' })`.
  - On the upstream `onConfirm`, the URL is passed in `signatureDataUrl`.
  - `isUploading` state disables the confirm button and shows "Uploading signature…" with a spinner.
  - On failure: toast and let the user retry — modal stays open.
- `constants.ts`: demo verification objects untouched (still hold the inline base64 demo signature; that path renders fine because `<img src>` accepts both URL and base64).

## Verification

```bash
npm run build   # passes
npm test        # 41/41 passing
```

Migrations applied to production Supabase via `supabase/run-migration.mjs`:
- `00004_storage_buckets.sql` ✅
- `00005_add_logo_url.sql` ✅

## Smoke-test checklist for prod

1. Open https://nexorder.vercel.app, hard-refresh.
2. As Admin → Settings → upload a logo. Reload page. Logo persists. Open the network tab; the URL should be `https://lsgkznyiabqitqfpveey.supabase.co/storage/v1/object/public/company-assets/logos/<uuid>.png`.
3. As Customer/Rep → Shop → toggle a product into Pantry. Switch HoReCas (rep) or sign out and back in. Pantry contents persist in DB, not localStorage.
4. As Field Rep → start a visit → take/select photo. Reload. Photo URL persists; image still renders.
5. Place an order → confirm with signature. Check Admin → Order Detail → signature image renders from a `signatures/orders/<uuid>.png` URL.

## Caveats / follow-ups

- **Anon write Storage policies are dev-only.** Once auth + RLS are wired, drop the three `anon_write_*_dev` policies from migration 00004 and rely on the `authenticated` policies only. Today the app runs with the anon key.
- **Old localStorage keys (`pantry_lists`, `app_logo`) remain in users' browsers.** They are no longer read; harmless but you can clear them with a one-shot effect if desired.
- **No bucket cleanup job.** Removing a pantry item / visit photo / logo deletes its blob best-effort from the client. If a remove fails, blobs accumulate. A scheduled cleanup edge function would be a nice add later.
- **Signatures field renamed semantically but not in name** (`signatureDataUrl` still). A future PR could rename to `signatureUrl` for clarity; left alone now to keep the diff minimal.
