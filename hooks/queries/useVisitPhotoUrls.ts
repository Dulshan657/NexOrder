import { useQuery } from '@tanstack/react-query'
import { getVisitPhotoUrls, type ResolvedPhoto } from '@/services/supabase/visitPhotoService'

export const visitPhotoKeys = {
  forVisits: (visitIds: readonly string[]) => ['visit_photo_urls', [...visitIds].sort()] as const,
}

/** Signed URLs live 5 minutes; refresh a little before that so a timeline left
 *  open does not start showing broken images. */
const TTL_MS = 5 * 60 * 1000
const STALE_MS = 4 * 60 * 1000

/**
 * Signed URLs for the photos on a set of visits, keyed by visit id.
 *
 * A query rather than a mutation — unlike `useSignatureUrl` — because a
 * timeline renders these continuously and needs them refetched on their own
 * schedule rather than on a click. The short `staleTime` plus `refetchInterval`
 * is what keeps the `<img>` sources valid while the page stays open; the
 * default 5-minute `staleTime` from `lib/queryClient.ts` would expire at
 * exactly the wrong moment.
 */
export function useVisitPhotoUrls(visitIds: readonly string[], enabled = true) {
  const ids = [...new Set(visitIds)].sort()
  return useQuery({
    queryKey: visitPhotoKeys.forVisits(ids),
    queryFn: () => getVisitPhotoUrls(ids),
    enabled: enabled && ids.length > 0,
    staleTime: STALE_MS,
    refetchInterval: STALE_MS,
    gcTime: TTL_MS,
  })
}

/** Flatten the response into `storedValue -> renderable src`. */
export function photoSrcMap(
  data: Array<{ visitId: string; photos: ResolvedPhoto[] }> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const visit of data ?? []) {
    for (const photo of visit.photos) {
      const src = photo.signedUrl ?? (photo.kind === 'key' ? undefined : photo.value)
      if (src) map[photo.value] = src
    }
  }
  return map
}
