// Shortages flagged on the floor (NX-0006/0007): a count came up short and the
// operator said so. The missing units are still on record at the dock until a
// manager decides: Found it (the task goes back on the floor's list) or Write
// off (the units are adjusted off, with a reason, in one transaction).
//
// Inline, not an overlay: a reason box and two buttons per line is less than a
// Modal would cost, and the list is short by nature.

import React, { useState } from 'react'
import { AlertTriangle, PackageSearch } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { getShortPutaways, type PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import { useResolveShortPutaway } from '@/hooks/queries/usePutawayRecommendation'
import { putawayKeys } from '@/hooks/queries/putawayKeys'
import { useToastActions } from '@/hooks/useToasts'
import { describeQuantity } from './putawayFormat'

interface PutawayShortListProps {
  warehouseId: number
}

export function PutawayShortList({ warehouseId }: PutawayShortListProps) {
  const shortQuery = useQuery({
    // Under putawayKeys.all, so every putaway mutation refreshes it.
    queryKey: [...putawayKeys.all, 'short', warehouseId],
    queryFn: () => getShortPutaways(warehouseId),
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const rows = shortQuery.data ?? []
  if (rows.length === 0) return null

  return (
    <section aria-label="Short at putaway" className="glass-card rounded-xl border-l-4 border-amber-400 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-stone-900">Short at putaway</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-900">
          {rows.length}
        </span>
      </div>
      <div className="divide-y divide-stone-100">
        {rows.map((row) => <ShortRow key={row.id} row={row} />)}
      </div>
    </section>
  )
}

const ShortRow: React.FC<{ row: PendingPutawayRow }> = ({ row }) => {
  const resolve = useResolveShortPutaway()
  const { addToast } = useToastActions()
  const [reason, setReason] = useState('')
  const name = row.product?.name ?? `Product #${row.productId}`
  const qty = describeQuantity(row.quantity, row.product)
  const reasonId = `short-reason-${row.id}`

  const act = async (resolution: 'found' | 'write_off') => {
    try {
      await resolve.mutateAsync(
        resolution === 'found'
          ? { recommendationId: row.id, resolution }
          : { recommendationId: row.id, resolution, reason: reason.trim() },
      )
      addToast(resolution === 'found' ? `${name} is back on the putaway list` : `${qty.primary} of ${name} written off`, 'success')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not resolve the shortage', 'error')
    }
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-start gap-3">
        <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-stone-900 truncate">{name}</p>
          <p className="text-xs text-stone-600">
            <span className="font-medium tabular-nums text-amber-800">{qty.primary} missing</span>
            {row.receipt?.reference ? ` · ${row.receipt.reference}` : ''}
            {row.huCode ? ` · ${row.huCode}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => act('found')}
          disabled={resolve.isPending}
          className="touch-target-y shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 btn-press disabled:opacity-50"
        >
          Found it
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label id={`${reasonId}-label`} htmlFor={reasonId} className="sr-only">Why are they missing?</label>
        <input
          id={reasonId}
          aria-labelledby={`${reasonId}-label`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are they missing? (required to write off)"
          maxLength={500}
          className="touch-target-y min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark"
        />
        <button
          type="button"
          onClick={() => act('write_off')}
          disabled={resolve.isPending || reason.trim() === ''}
          className="touch-target-y shrink-0 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white btn-press disabled:opacity-40"
        >
          Write off
        </button>
      </div>
    </div>
  )
}

export default PutawayShortList
