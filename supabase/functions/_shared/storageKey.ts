// What a stored media reference actually is, resolved once for both runtimes.
//
// Imported by the Edge Functions (Deno) and re-exported to the browser by
// lib/storageKey.ts. Dependency-free for that reason — never add an import here.
//
// WHY THIS EXISTS. Until mig 00113 the `signatures` and `visit-photos` buckets
// were public, and the app stored the FULL ABSOLUTE CDN URL of every object:
// `orders.verification->>'signatureDataUrl'` and every element of
// `visits.photos`. 00113 makes both buckets private, so those URLs 400, and it
// normalises the stored values to bare storage keys.
//
// A normalising migration is not enough on its own, and this module is the
// reason. Three shapes remain reachable in practice:
//
//   1. a bare key            `orders/6f1c….png`   — what everything writes now
//   2. an absolute public URL of a bucket we own  — a row written between the
//      frontend deploy and the migration, or restored from demo-export/, which
//      still holds the pre-00113 spelling on disk and is the demo's only backup
//   3. a `data:` URL         `data:image/png;base64,…` — the pre-storage
//      original. supabase/seedData/orders.ts:99 still seeds three of them, and
//      they have no key to migrate to, so 00113 deliberately leaves them alone
//
// Classifying rather than guessing is what lets the caller do the right thing
// with each: sign a key, render an inline image directly, and leave anything
// genuinely foreign alone (UserForm lets an operator type an arbitrary avatar
// URL, and Header.tsx falls back to i.pravatar.cc).

/** The buckets this app owns. Two are private as of 00113. */
export const PUBLIC_BUCKETS = ['company-assets', 'product-images', 'avatars'] as const
export const PRIVATE_MEDIA_BUCKETS = ['signatures', 'visit-photos'] as const

export type PublicBucket = (typeof PUBLIC_BUCKETS)[number]
export type PrivateMediaBucket = (typeof PRIVATE_MEDIA_BUCKETS)[number]
export type MediaBucket = PublicBucket | PrivateMediaBucket

/** A stored value, classified. */
export type StorageRef =
  /** Null, undefined, or blank. Nothing to render. */
  | { kind: 'empty' }
  /** A storage key inside the named bucket. Sign it to read it. */
  | { kind: 'key'; key: string }
  /** A `data:` URL. Render it directly; there is no object behind it. */
  | { kind: 'inline'; url: string }
  /** An absolute URL that is not ours. Render it as-is; never try to sign it. */
  | { kind: 'external'; url: string }

/** The CDN path segment a public bucket's objects were served under pre-00113. */
function publicMarker(bucket: MediaBucket): string {
  return `/storage/v1/object/public/${bucket}/`
}

/**
 * A key we are willing to sign.
 *
 * `%` is rejected outright, and that is not paranoia — it is the trap
 * _shared/poInbox/archivePaths.ts documents at length. A Storage key may not
 * contain a percent sign: `createSignedUrl` signs the encoded spelling
 * *successfully* and hands back a URL that only 400s when someone fetches it.
 * Every key this app mints is `<prefix>/<uuid>.<ext>`, so a `%` here means the
 * value is malformed, not that it needs decoding.
 */
export function isSafeStorageKey(key: string): boolean {
  if (key === '' || key.length > 512) return false
  if (key.startsWith('/') || key.includes('//')) return false
  if (key.includes('%') || key.includes('\\')) return false
  if (key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false
  return true
}

/**
 * Classify one stored media value for a given bucket.
 *
 * Order matters: `data:` is checked before anything URL-shaped, because a data
 * URL contains no host to reason about and must never reach the key branch.
 */
export function toStorageRef(bucket: MediaBucket, value: string | null | undefined): StorageRef {
  if (value == null) return { kind: 'empty' }
  const trimmed = value.trim()
  if (trimmed === '') return { kind: 'empty' }

  if (trimmed.startsWith('data:')) return { kind: 'inline', url: trimmed }

  if (/^https?:\/\//i.test(trimmed)) {
    const marker = publicMarker(bucket)
    const at = trimmed.indexOf(marker)
    if (at < 0) return { kind: 'external', url: trimmed }
    // Drop any query string or fragment — a cache-busting `?t=` is not part of
    // the key, and signing it would produce a path that exists nowhere.
    const tail = trimmed.slice(at + marker.length).split(/[?#]/)[0]
    return isSafeStorageKey(tail) ? { kind: 'key', key: tail } : { kind: 'empty' }
  }

  const bare = trimmed.split(/[?#]/)[0]
  return isSafeStorageKey(bare) ? { kind: 'key', key: bare } : { kind: 'empty' }
}

/**
 * The key to sign, or null when there is nothing signable.
 *
 * Convenience for the two Edge Functions, which only ever care about that one
 * case — an inline or external value is something they must decline to sign
 * rather than something they can serve.
 */
export function signableKey(bucket: MediaBucket, value: string | null | undefined): string | null {
  const ref = toStorageRef(bucket, value)
  return ref.kind === 'key' ? ref.key : null
}
