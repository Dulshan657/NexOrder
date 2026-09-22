// Before the first scan.
//
// It names the three things the gun can be pointed at, because "scan something"
// is only useful to someone who already knows what this screen accepts. Built
// on the shape of `warehouse/WarehouseEmptyState` — squarer icon tile, larger
// headline, a measured column of body text — which `ReceiveStockView` also
// copies for its "start a goods receipt" state.

import React from 'react'
import { Barcode, MapPin, ScanLine, Layers } from 'lucide-react'

const PROMPTS = [
  {
    icon: Barcode,
    title: 'A product barcode',
    body: 'How many are on site, and which bins hold them.',
  },
  {
    icon: MapPin,
    title: 'A bin label',
    body: 'Everything sitting in that location, lot by lot.',
  },
  {
    icon: Layers,
    title: 'A pallet plate',
    body: "What is on it, and where it is right now.",
  },
]

export function LookupIdleCard() {
  return (
    <div className="glass-panel shadow-card rounded-2xl p-6 sm:p-10 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-nexgen-blue/10 text-nexgen-blue-dark">
        <ScanLine className="h-7 w-7" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-stone-900">Scan to look something up</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
        Nothing here changes stock — this screen only reads. Type a code instead if the label
        will not scan.
      </p>

      <ul className="mx-auto mt-7 max-w-sm space-y-2 text-left">
        {PROMPTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white/60 px-3 py-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-stone-900">{title}</span>
              <span className="block text-xs text-stone-600">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default LookupIdleCard
