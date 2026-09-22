// The identity block every lookup screen opens with.
//
// ── THE HERO STRING IS THE ONE BEING MATCHED AGAINST A PRINTED LABEL ────────
//
// A bin code, a SKU, a plate code: the operator is holding the sticker and
// comparing it character by character. So it renders mono, large, solid
// `stone-900`, and `break-all` rather than `truncate` — a code that cannot be
// finished reading is worse than a code on two lines. Never a tinted colour,
// never below 12px. `PutawayStopCard`'s "Take it to" block is the same rule.

import React from 'react'

export interface LookupHeaderProps {
  /** Small uppercase kicker — what kind of thing this is. */
  kind: string
  /** The code. Rendered as the hero. */
  code: string
  /** The human name, when there is one worth showing beside the code. */
  name?: string | null
  /** One quiet line of context under the name. */
  detail?: React.ReactNode
  icon?: React.ReactNode
}

export function LookupHeader({ kind, code, name, detail, icon }: LookupHeaderProps) {
  return (
    <div className="px-1 pb-1 text-center">
      {icon && (
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-stone-100 text-stone-600">
          {icon}
        </div>
      )}
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">{kind}</p>
      <p className="mt-1.5 break-all font-mono text-3xl font-bold leading-none tracking-tight text-stone-900">
        {code}
      </p>
      {name && <p className="mt-2 text-base font-semibold text-stone-800">{name}</p>}
      {detail && <p className="mt-1.5 text-xs text-stone-600">{detail}</p>}
    </div>
  )
}

export default LookupHeader
