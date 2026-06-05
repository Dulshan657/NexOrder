import { useMutation, useQueryClient } from '@tanstack/react-query'
import { receiveStock, type ReceiptLine } from '@/services/supabase/receivingService'
import { inventoryKeys } from './useInventoryBalances'

export function useReceiveStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lines: ReceiptLine[]) => receiveStock(lines),
    onSuccess: () => {
      // Receipt raised on_hand → balances + the products.inventory cache changed.
      qc.invalidateQueries({ queryKey: inventoryKeys.balances })
      qc.invalidateQueries({ queryKey: inventoryKeys.recentReceipts })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}
