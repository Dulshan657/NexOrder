import { useMutation } from '@tanstack/react-query'
import { getSignatureUrl } from '@/services/supabase/signatureService'

/**
 * Mints a fresh short-lived signed URL for an order's verification signature.
 *
 * A mutation rather than a query, for the same reason `useOrderDocumentUrl` is:
 * the URL expires in five minutes, so caching it would hand a stale link to the
 * second person who opened the order.
 */
export function useSignatureUrl() {
  return useMutation({
    mutationFn: (orderId: string) => getSignatureUrl(orderId),
  })
}
