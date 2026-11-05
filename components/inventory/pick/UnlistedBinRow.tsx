// An open line of an imported order that no bin is known to hold: the picker scans
// whichever bin they found it in (NX-0029).
//
// The invoice came from elsewhere, so the shelf can hold stock the system does not
// show. This is the way to record it. It is a PickTaskRow in any-bin mode: the bin is
// scanned rather than given, then the item, then the count, and the row says plainly
// that the system shows none there. This wrapper only supplies the one thing that
// mode needs, a way to turn a scanned code into a location, from the locations the app
// already holds (the same resolveScan the Stock lookup and the stocktake finder use).

import React, { useMemo } from 'react'
import { useLocations } from '@/hooks/queries/useInventoryBalances'
import type { PickQueueLine, PickTask } from '@/services/supabase/pickService'
import { PickTaskRow } from './PickTaskRow'
import { buildPickBinIndex, resolvePickBin, type PickBinResolution } from './resolvePickBin'

interface UnlistedBinRowProps {
  orderId: string
  line: PickQueueLine
  disabled: boolean
}

export const UnlistedBinRow: React.FC<UnlistedBinRowProps> = ({ orderId, line, disabled }) => {
  const { data: locations } = useLocations()
  const index = useMemo(() => buildPickBinIndex(locations ?? []), [locations])
  const anyBin = useMemo(
    () => ({
      resolveBin: (raw: string): PickBinResolution =>
        locations
          ? resolvePickBin(raw, index, locations)
          : { ok: false, message: 'Bins are still loading. Try again in a moment.' },
    }),
    [index, locations],
  )

  // No bin is named, so the "task" is just the line's open amount, in line units.
  const open = Math.max(line.quantity - line.picked, 0)
  const task = useMemo<PickTask>(
    () => ({
      orderItemId: line.orderItemId,
      productId: line.productId,
      warehouseId: 0,
      warehouseCode: '',
      locationId: 0,
      code: '',
      graphNodeId: null,
      allocatedQty: open,
      pickedQty: 0,
      remaining: open,
      unreserved: true,
    }),
    [line.orderItemId, line.productId, open],
  )

  // Only an imported order ever gets here, so its picks always refetch the tasks.
  return <PickTaskRow orderId={orderId} task={task} line={line} disabled={disabled} anyBin={anyBin} imported />
}
