// Lookup / Browse, for the ops branch of the Stock tab.
//
// Two toggle buttons with `aria-pressed`, not `role="tablist"`. A tablist is a
// promise about arrow-key roving focus and a matching `role="tabpanel"`, and
// the panel here is the entire page body including a sticky scan dock that
// lives outside it. A segmented pair of pressed/unpressed buttons is what this
// actually is, and it is honest without extra machinery.

import React from 'react'

export type StockMode = 'lookup' | 'levels'

export interface StockModeTabsProps {
  mode: StockMode
  onChange: (mode: StockMode) => void
}

// Looks like PageTabs, but stays its own component because of the aria-pressed
// reasoning above and the full-width halves below.
const BASE =
  'touch-target-y relative -mb-px inline-flex flex-1 items-center justify-center py-2.5 ' +
  'text-sm transition-colors border-b-2 focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark'

const ON = 'border-stone-900 text-stone-900 font-medium'
const OFF = 'border-transparent text-stone-500 hover:text-stone-800'

export function StockModeTabs({ mode, onChange }: StockModeTabsProps) {
  return (
    <div
      role="group"
      aria-label="Stock view"
      // Full width at 360px, where both halves want a thumb's worth of target;
      // capped on a desk, where a control stretched across 1200px reads as a
      // banner rather than a switch.
      className="flex border-b border-stone-200/70 sm:max-w-sm"
    >
      <button
        type="button"
        aria-pressed={mode === 'lookup'}
        onClick={() => onChange('lookup')}
        className={`${BASE} ${mode === 'lookup' ? ON : OFF}`}
      >
        Look up
      </button>
      <button
        type="button"
        aria-pressed={mode === 'levels'}
        onClick={() => onChange('levels')}
        className={`${BASE} ${mode === 'levels' ? ON : OFF}`}
      >
        Browse
      </button>
    </div>
  )
}

export default StockModeTabs
