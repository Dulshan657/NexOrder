import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getInvoices,
  getInvoiceByOrderId,
  mutateInvoiceStatus,
  type MutateInvoiceStatusInput,
} from '@/services/supabase/invoiceService'
import type { InvoiceFilters } from '@/services/supabase/invoiceService'

export const invoiceKeys = {
  all: ['invoices'] as const,
  filtered: (filters: InvoiceFilters) => ['invoices', filters] as const,
  byOrder: (orderId: string) => ['invoices', 'order', orderId] as const,
} as const

export function useInvoices(filters: InvoiceFilters = {}) {
  return useQuery({
    queryKey: invoiceKeys.filtered(filters),
    queryFn: () => getInvoices(filters),
  })
}

export function useInvoiceByOrderId(orderId: string | null | undefined) {
  return useQuery({
    queryKey: invoiceKeys.byOrder(orderId ?? ''),
    queryFn: () => getInvoiceByOrderId(orderId!),
    enabled: !!orderId,
  })
}

export function useUpdateInvoiceStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: MutateInvoiceStatusInput) => mutateInvoiceStatus(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoiceKeys.all })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
