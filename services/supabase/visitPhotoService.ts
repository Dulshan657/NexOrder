import { supabase } from '@/lib/supabase'

// Visit photographs, private since mig 00113 (security-audit findings
// STOR-1 / STOR-2). The `visit-photos` bucket carries no client policy, so
// every read and every write routes through an Edge Function as service_role.

export type VisitPhotoMime = 'image/png' | 'image/jpeg' | 'image/webp'

interface UploadTarget {
  key: string
  path: string
  token: string
  bucket: string
}

/** One stored photo, resolved for rendering. */
export interface ResolvedPhoto {
  /** The value as stored on `visits.photos`; use it as the React key. */
  value: string
  /** Present when the value was a storage key the server signed for us. */
  signedUrl?: string
  kind: 'key' | 'inline' | 'external'
}

export interface VisitPhotos {
  visitId: string
  photos: ResolvedPhoto[]
}

/**
 * Signed URLs for the photos on these visits, in one call.
 *
 * Batched deliberately: a timeline renders many visits at once, and the server
 * writes one audit event per CALL. One request per thumbnail would put a row in
 * `audit_events` for every image on screen.
 */
export async function getVisitPhotoUrls(visitIds: string[]): Promise<VisitPhotos[]> {
  if (visitIds.length === 0) return []
  const { data, error } = await supabase.functions.invoke<{ visits: VisitPhotos[] }>(
    'create-visit-photo-urls',
    { body: { visitIds } },
  )
  if (error) throw error
  return data?.visits ?? []
}

/**
 * Upload one photo and get back the bare storage key to store on the visit.
 *
 * Two steps on purpose. The bytes go straight to Storage through a one-shot
 * signed upload URL rather than through the function body, because a visit
 * photo is an uncompressed phone-camera capture up to the bucket's 10 MB limit.
 * Same shape as the floor-plan importer; `upload-signature` differs precisely
 * because a canvas PNG is small.
 */
export async function uploadVisitPhoto(file: File | Blob, mimeType: VisitPhotoMime): Promise<string> {
  const { data, error } = await supabase.functions.invoke<UploadTarget>('mutate-visit-photo', {
    body: { action: 'upload', mimeType },
  })
  if (error) throw error
  const target = data as UploadTarget | null
  if (!target?.token) throw new Error('No upload URL returned')

  const { error: putError } = await supabase.storage
    .from(target.bucket)
    .uploadToSignedUrl(target.path, target.token, file)
  if (putError) throw putError

  return target.key
}

/**
 * Remove one photo object.
 *
 * The server decides whether this is allowed: an object no visit references is
 * an unsaved upload and anyone who may create a visit may drop it, while an
 * object already attached to a visit may only be removed by someone who can see
 * that visit. Accepts a legacy absolute URL as well as a key, so a photo added
 * before 00113 is still removable from the same button.
 */
export async function deleteVisitPhoto(keyOrUrl: string): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-visit-photo', {
    body: { action: 'delete', key: keyOrUrl },
  })
  if (error) throw error
}

/** The bucket's allowed MIME types (00004:9); anything else is refused. */
export function visitPhotoMime(file: File | Blob): VisitPhotoMime | null {
  const type = (file as File).type ?? ''
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') return type
  return null
}
