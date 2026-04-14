import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '@/services/supabase/supplierService'
import type { Database } from '@/lib/database.types'

type SupplierInsert = Database['public']['Tables']['suppliers']['Insert']
type SupplierUpdate = Database['public']['Tables']['suppliers']['Update']

export const supplierKeys = {
  all: ['suppliers'] as const,
} as const

export function useSuppliers() {
  return useQuery({
    queryKey: supplierKeys.all,
    queryFn: getSuppliers,
  })
}

export function useCreateSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (supplier: SupplierInsert) => createSupplier(supplier),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supplierKeys.all })
    },
  })
}

export function useUpdateSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: SupplierUpdate }) =>
      updateSupplier(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supplierKeys.all })
    },
  })
}

export function useDeleteSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteSupplier(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supplierKeys.all })
    },
  })
}
