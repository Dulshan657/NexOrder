import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  receiveStock,
  type ReceiptHeader,
  type ReceiptLine,
  type ReceiptPlate,
} from '@/services/supabase/receivingService'
import { inventoryKeys } from './useInventoryBalances'
import { supplierKeys } from './useSuppliers'
import { putawayKeys } from './putawayKeys'

export function useReceiveStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ header, lines, plates }: {
      header: ReceiptHeader
      lines: ReceiptLine[]
      plates?: ReceiptPlate[]
    }) => receiveStock(header, lines, plates),
    onSuccess: () => {
      // Receipt raised on_hand → balances + the products.inventory cache changed.
      qc.invalidateQueries({ queryKey: inventoryKeys.balances })
      qc.invalidateQueries({ queryKey: inventoryKeys.recentReceipts })
      qc.invalidateQueries({ queryKey: ['products'] })
      // A free-text supplier may have been created on the fly.
      qc.invalidateQueries({ queryKey: supplierKeys.all })
      // receive-stock generates putaway tasks server-side for layout warehouses —
      // without this the queue (and its nav badge / picker counts) served a stale
      // cache forever, since nothing else invalidated ['putaway-queue', ...].
      qc.invalidateQueries({ queryKey: putawayKeys.all })
      qc.invalidateQueries({ queryKey: putawayKeys.counts })
    },
  })
}
