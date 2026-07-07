import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getZoneProfiles,
  createZoneProfile,
  updateZoneProfile,
  deactivateZoneProfile,
  type ZoneProfileInput,
} from '@/services/supabase/zoneProfileService'

const zoneProfileKeys = { all: ['zone-profiles'] as const }

export function useZoneProfiles() {
  return useQuery({
    queryKey: zoneProfileKeys.all,
    queryFn: getZoneProfiles,
    staleTime: 5 * 60_000, // profiles rarely change
  })
}

export function useCreateZoneProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ZoneProfileInput) => createZoneProfile(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: zoneProfileKeys.all }),
  })
}

export function useUpdateZoneProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ZoneProfileInput> }) => updateZoneProfile(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: zoneProfileKeys.all }),
  })
}

export function useDeactivateZoneProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deactivateZoneProfile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: zoneProfileKeys.all }),
  })
}
