import { useQuery, useMutation } from '@tanstack/react-query'
import { getOrderDocuments, getOrderDocumentUrl } from '@/services/supabase/orderDocumentService'

export const orderDocumentKeys = {
  all: ['order_documents'] as const,
  byOrder: (orderId: string) => ['order_documents', orderId] as const,
}

/**
 * Lists generated order documents (pick slips + dispatch advices). Pass
 * `enabled=false` for non-ops roles so reps/customers never fire a query that
 * RLS would reject. Omit `orderId` to list all (the Documents view + the
 * Order Import page fetch all once and group client-side).
 */
export function useOrderDocuments(orderId?: string, enabled = true) {
  return useQuery({
    queryKey: orderId ? orderDocumentKeys.byOrder(orderId) : orderDocumentKeys.all,
    queryFn: () => getOrderDocuments(orderId),
    enabled,
  })
}

/** Mints a fresh short-lived signed URL for a stored document by its id. */
export function useOrderDocumentUrl() {
  return useMutation({
    mutationFn: (orderDocumentId: number) => getOrderDocumentUrl(orderDocumentId),
  })
}
