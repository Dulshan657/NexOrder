// Where an open Walk stop is going, and what is being carried there: the "Take it
// to" block and the quantity / plate facts under it. Presentational.

import React from 'react'

interface StopDestinationProps {
  /** Above "Take it to": a question the walker answers with the scan (NX-0033). */
  heading?: string
  /** The scannable identity of the bin, the hero of the card. */
  binCode: string
  /** The bin's friendly name, when it says something the code does not. */
  binName?: string
  qty: { primary: string; secondary?: string | null }
  huCode: string | null
}

export const StopDestination: React.FC<StopDestinationProps> = ({ heading, binCode, binName, qty, huCode }) => (
  <>
    {/* The destination, and nothing competing with it. The code is set in mono
        at the size it is printed on the bin label, because that is the
        comparison the operator is actually making. `break-all` rather than
        `truncate`: a code the operator cannot finish reading is worse than a
        code on two lines. */}
    <div className="px-4 pt-4 pb-3 text-center">
      {heading && (
        <p className="mb-2 inline-block rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900">
          {heading}
        </p>
      )}
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">Take it to</p>
      <p className="mt-1.5 font-mono text-3xl sm:text-4xl font-bold leading-none tracking-tight text-stone-900 break-all">
        {binCode}
      </p>
      {binName && <p className="mt-2 text-base font-semibold text-emerald-700">{binName}</p>}
    </div>

    {/* Facts, separated by rules rather than boxed into cards — the card is
        already the box. */}
    <dl
      className={`grid ${huCode ? 'grid-cols-2' : 'grid-cols-1'} divide-x divide-nexgen-blue/15 border-y border-nexgen-blue/20 bg-white/50 text-center`}
    >
      <div className="min-w-0 px-3 py-2.5">
        <dt className="text-xs text-stone-600">Quantity</dt>
        <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-stone-900">{qty.primary}</dd>
        {qty.secondary && <dd className="text-xs text-stone-600">{qty.secondary}</dd>}
      </div>
      {huCode && (
        <div className="min-w-0 px-3 py-2.5">
          <dt className="text-xs text-stone-600">Plate</dt>
          <dd className="mt-0.5 truncate font-mono text-xl font-semibold text-stone-900">{huCode}</dd>
        </div>
      )}
    </dl>
  </>
)
