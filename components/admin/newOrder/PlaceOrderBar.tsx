// The total, why the order cannot be placed yet, and the Place order button.
// Rendered twice by the screen — in the desktop summary pane and in the mobile
// bottom bar — from the same props, so the two can never disagree.

import React from 'react'
import { Loader2, ShoppingCart } from 'lucide-react'

import { Button } from '../../ui'
import { money } from '../../../lib/newOrder/previewPricing'

interface PlaceOrderBarProps {
  total: number
  lineCount: number
  /** Why Place order is disabled; null when it is not. */
  blockedReason: string | null
  placing: boolean
  onPlace: () => void
  compact?: boolean
}

export default function PlaceOrderBar({ total, lineCount, blockedReason, placing, onPlace, compact = false }: PlaceOrderBarProps) {
  return (
    <div className={compact ? 'flex items-center gap-3' : 'space-y-3'}>
      <div className={compact ? 'min-w-0 flex-1' : 'flex items-baseline justify-between'}>
        <p className="text-xs font-medium text-stone-600">
          {lineCount} line{lineCount === 1 ? '' : 's'} · estimated
        </p>
        <p className={`font-mono font-bold text-stone-900 ${compact ? 'text-lg' : 'text-2xl'}`}>{money(total)}</p>
      </div>
      {!compact && blockedReason && <p className="text-xs text-stone-600">{blockedReason}</p>}
      <Button
        type="button"
        onClick={onPlace}
        disabled={blockedReason !== null || placing}
        className={compact ? 'shrink-0' : 'w-full'}
        title={blockedReason ?? undefined}
      >
        {placing ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Placing…
          </>
        ) : (
          <>
            <ShoppingCart className="w-4 h-4 mr-2" aria-hidden="true" /> Place order
          </>
        )}
      </Button>
    </div>
  )
}
