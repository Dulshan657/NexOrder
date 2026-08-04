import { useQuery } from '@tanstack/react-query'
import { getLocationNames } from '@/services/supabase/locationNameService'
import type { DisplayLocation } from '@/lib/locationDisplay'

/**
 * Friendly names for a set of location ids (mig 00094).
 *
 * For the ORDER-scoped screens only — the pick queue and its route panel, whose
 * stops carry no warehouse. Everything warehouse-scoped already holds the whole
 * locations list via `useWarehouseLocations` and should resolve from that
 * instead of firing this.
 *
 * The key is the SORTED id list, so two screens showing the same wave share one
 * cache entry and re-rendering with the ids in a different order does not
 * refetch. Names change only when someone renames a bin, so a 5-minute
 * staleTime is generous; both rename mutations invalidate on success.
 */
export const locationNameKeys = {
  byIds: (ids: readonly number[]) =>
    ['location-names', [...new Set(ids)].sort((a, b) => a - b).join(',')] as const,
}

export function useLocationNames(ids: readonly number[]) {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  return useQuery({
    queryKey: locationNameKeys.byIds(unique),
    queryFn: () => getLocationNames(unique),
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: (previous: Map<number, DisplayLocation> | undefined) => previous,
  })
}
