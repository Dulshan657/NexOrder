// The offer a Manager or Admin sees on a Walk stop for a product with no home bin
// (NX-0033, G4). Presentational: the stop card owns the state and the chooser.

import React from 'react'
import { Home } from 'lucide-react'
import { Callout } from '@/components/ui'

interface GiveHomeOfferProps {
  onGive: () => void
  onDecline: () => void
}

// React.FC deliberately, as in PutawayStopCard: this repo ships no @types/react.
export const GiveHomeOffer: React.FC<GiveHomeOfferProps> = ({ onGive, onDecline }) => (
  <Callout
    tone="info"
    dense
    icon={<Home className="w-4 h-4" aria-hidden="true" />}
    action={
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onGive}
          className="touch-target-y inline-flex items-center rounded-lg bg-nexgen-blue-dark px-3.5 py-2 text-sm font-medium text-white btn-press"
        >
          Give it a home
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="touch-target-y inline-flex items-center rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 btn-press"
        >
          Not now
        </button>
      </div>
    }
  >
    This product has no home bin. Give it one?
  </Callout>
)
