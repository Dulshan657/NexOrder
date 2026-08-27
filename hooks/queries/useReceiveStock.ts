import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getReceiptPlates,
  receiveStock,
  type ReceiptHeader,
  type ReceiptLine,
  type ReceiptPlate,
  type ReceiptPlateResult,
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

/**
 * The plates one receipt minted, so the desk can print their stickers before
 * the goods leave goods-in.
 *
 * This is the moment a plate label is cheap. Everywhere later it is expensive:
 * the pallet has moved, the operator is on a handheld at a rack, and the
 * putaway walk is reduced to identifying goods by their own barcode — or, for
 * a pallet, to guessing between two identical ones. `receive-stock` mints a
 * plate for EVERY line and prints nothing, which is how a site accumulates
 * stock the system can name and nobody can scan.
 *
 * Keyed on the receipt and never invalidated by anything: a receipt's plate
 * list is immutable once written. `label_printed` on those rows is not — so
 * `staleTime: 0` keeps a second visit honest about what has already been run.
 */
export function useReceiptPlates(goodsReceiptId: number | null) {
  return useQuery<ReceiptPlateResult[]>({
    queryKey: ['receipt-plates', goodsReceiptId],
    queryFn: () => getReceiptPlates(goodsReceiptId as number),
    enabled: goodsReceiptId != null,
    staleTime: 0,
  })
}
