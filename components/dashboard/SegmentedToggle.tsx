import React from 'react'

interface SegmentedToggleProps<T extends string | number> {
  /** Accessible name of the group. */
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}

/**
 * The one segmented control on the dashboards (NX-0042): the page period and
 * each card's own window look and behave the same.
 */
export default function SegmentedToggle<T extends string | number>({ label, options, value, onChange }: SegmentedToggleProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-stone-200/80 bg-stone-100 p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`touch-target-y cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-150 ${
              active ? 'bg-white text-stone-900 shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
