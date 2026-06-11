import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  receiveStock,
  type ReceiptHeader,
  type ReceiptLine,
} from '@/services/supabase/receivingService'
import { inventoryKeys } from './useInventoryBalances'
import { supplierKeys } from './useSuppliers'

export function useReceiveStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ header, lines }: { header: ReceiptHeader; lines: ReceiptLine[] }) =>
      receiveStock(header, lines),
    onSuccess: () => {
      // Receipt raised on_hand → balances + the products.inventory cache changed.
      qc.invalidateQueries({ queryKey: inventoryKeys.balances })
      qc.invalidateQueries({ queryKey: inventoryKeys.recentReceipts })
      qc.invalidateQueries({ queryKey: ['products'] })
      // A free-text supplier may have been created on the fly.
      qc.invalidateQueries({ queryKey: supplierKeys.all })
    },
  })
}
