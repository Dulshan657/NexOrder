import React from 'react'

interface BandProps {
  label: string
  /** Controls that act on the whole band, e.g. the period picker. */
  actions?: React.ReactNode
  children: React.ReactNode
}

/** A quiet labelled band between a dashboard's sections — the same on Admin and Rep (NX-0043). */
export default function Band({ label, actions, children }: BandProps) {
  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{label}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}
