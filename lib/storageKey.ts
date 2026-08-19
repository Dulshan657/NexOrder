// Client-side entry point for stored media references (mig 00113).
//
// The classification lives in the pure shared module so the Edge Functions and
// the browser run the very same code: what the reader decides to sign IS what
// the server will agree to sign, decided early. Mirrors lib/binCount.ts and
// lib/levelRoles.ts.

export { toStorageRef, signableKey, isSafeStorageKey, PUBLIC_BUCKETS, PRIVATE_MEDIA_BUCKETS } from '@/supabase/functions/_shared/storageKey'

export type {
  StorageRef,
  MediaBucket,
  PublicBucket,
  PrivateMediaBucket,
} from '@/supabase/functions/_shared/storageKey'
