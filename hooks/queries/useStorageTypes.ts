import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getStorageTypes,
  createStorageType,
  updateStorageType,
  deactivateStorageType,
  type StorageTypeInput,
} from '@/services/supabase/storageTypeService'

const storageTypeKeys = { all: ['storage-types'] as const }

export function useStorageTypes() {
  return useQuery({
    queryKey: storageTypeKeys.all,
    queryFn: getStorageTypes,
    staleTime: 5 * 60_000, // types rarely change
  })
}

export function useCreateStorageType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: StorageTypeInput) => createStorageType(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: storageTypeKeys.all }),
  })
}

export function useUpdateStorageType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch, applyToExisting }: { id: number; patch: Partial<StorageTypeInput>; applyToExisting?: boolean }) =>
      updateStorageType(id, patch, applyToExisting ?? false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storageTypeKeys.all })
      // Retro-apply may have changed location capacities → refresh warehouse reads.
      qc.invalidateQueries({ queryKey: ['warehouse-locations'] })
      qc.invalidateQueries({ queryKey: ['inventory_balances'] })
    },
  })
}

export function useDeactivateStorageType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deactivateStorageType(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: storageTypeKeys.all }),
  })
}
