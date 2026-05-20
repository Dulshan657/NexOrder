// TanStack Query hooks for the mutate-po-alias Edge Function.
//
// All mutations invalidate the corresponding alias list query so the table
// reflects the new state without a manual refetch. Errors propagate to the
// caller for inline form display.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createCustomerAlias,
  createProductAlias,
  deleteCustomerAlias,
  deleteProductAlias,
  updateCustomerAlias,
  updateProductAlias,
  type CreateCustomerAliasInput,
  type CreateProductAliasInput,
  type UpdateCustomerAliasInput,
  type UpdateProductAliasInput,
} from '@/services/supabase/poAliasMutationService'

const CUSTOMER_KEY = ['po_aliases', 'customer'] as const
const PRODUCT_KEY = ['po_aliases', 'product'] as const

export function useCreateCustomerAlias() {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateCustomerAliasInput>({
    mutationFn: createCustomerAlias,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CUSTOMER_KEY })
    },
  })
}

export function useUpdateCustomerAlias() {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateCustomerAliasInput>({
    mutationFn: updateCustomerAlias,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CUSTOMER_KEY })
    },
  })
}

export function useDeleteCustomerAlias() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: deleteCustomerAlias,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CUSTOMER_KEY })
    },
  })
}

export function useCreateProductAlias() {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateProductAliasInput>({
    mutationFn: createProductAlias,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRODUCT_KEY })
    },
  })
}

export function useUpdateProductAlias() {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateProductAliasInput>({
    mutationFn: updateProductAlias,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRODUCT_KEY })
    },
  })
}

export function useDeleteProductAlias() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: deleteProductAlias,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRODUCT_KEY })
    },
  })
}
