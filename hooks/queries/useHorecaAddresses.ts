import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listHorecaAddresses,
  createHorecaAddress,
  updateHorecaAddress,
  deleteHorecaAddress,
  setDefaultHorecaAddress,
  type HorecaAddressInput,
} from '@/services/supabase/horecaAddressService'

export const horecaAddressKeys = {
  all: ['horeca_addresses'] as const,
  byHoreca: (horecaId: number) => ['horeca_addresses', horecaId] as const,
} as const

export function useHorecaAddresses(horecaId: number | null | undefined) {
  return useQuery({
    queryKey: horecaId == null ? horecaAddressKeys.all : horecaAddressKeys.byHoreca(horecaId),
    queryFn: () => (horecaId == null ? Promise.resolve([]) : listHorecaAddresses(horecaId)),
    enabled: horecaId != null,
  })
}

export function useCreateHorecaAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      horecaId,
      input,
      isDefault,
    }: {
      horecaId: number
      input: HorecaAddressInput
      isDefault?: boolean
    }) => createHorecaAddress(horecaId, input, { isDefault }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: horecaAddressKeys.byHoreca(vars.horecaId) })
    },
  })
}

export function useUpdateHorecaAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ addressId, patch }: { addressId: string; patch: Partial<HorecaAddressInput> }) =>
      updateHorecaAddress(addressId, patch),
    onSuccess: (data) => {
      // address.horeca_id comes back on the response — invalidate that bucket
      qc.invalidateQueries({ queryKey: horecaAddressKeys.byHoreca(data.horeca_id) })
    },
  })
}

export function useDeleteHorecaAddress(horecaId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (addressId: string) => deleteHorecaAddress(addressId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: horecaAddressKeys.byHoreca(horecaId) })
    },
  })
}

export function useSetDefaultHorecaAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: setDefaultHorecaAddress,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: horecaAddressKeys.byHoreca(data.horeca_id) })
    },
  })
}
