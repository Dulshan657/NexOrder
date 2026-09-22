// Lookup / Browse, for the ops branch of the Stock tab.
//
// Two toggle buttons with `aria-pressed`, not `role="tablist"`. A tablist is a
// promise about arrow-key roving focus and a matching `role="tabpanel"`, and
// the panel here is the entire page body including a sticky scan dock that
// lives outside it. A segmented pair of pressed/unpressed buttons is what this
// actually is, and it is honest without extra machinery.

import React from 'react'
import { ScanLine, List } from 'lucide-react'

export type StockMode = 'lookup' | 'levels'

export interface StockModeTabsProps {
  mode: StockMode
  onChange: (mode: StockMode) => void
}

const BASE =
  'touch-target-y inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 ' +
  'text-sm font-semibold btn-press focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark'

// `nexgen-blue-dark` (4.93:1) rather than `nexgen-blue` (3.70:1): white text on
// the selected segment has to clear 4.5:1, and the lighter brand blue is a
// disclosed exception for large type only.
const ON = 'bg-nexgen-blue-dark text-white'
const OFF = 'text-stone-700 hover:bg-stone-100'

export function StockModeTabs({ mode, onChange }: StockModeTabsProps) {
  return (
    <div
      role="group"
      aria-label="Stock view"
      // Full width at 360px, where both halves want a thumb's worth of target;
      // capped on a desk, where a control stretched across 1200px reads as a
      // banner rather than a switch.
      className="flex gap-1 rounded-xl border border-stone-200 bg-stone-50 p-1 sm:max-w-sm"
    >
      <button
        type="button"
        aria-pressed={mode === 'lookup'}
        onClick={() => onChange('lookup')}
        className={`${BASE} ${mode === 'lookup' ? ON : OFF}`}
      >
        <ScanLine className="w-4 h-4 shrink-0" aria-hidden="true" /> Look up
      </button>
      <button
        type="button"
        aria-pressed={mode === 'levels'}
        onClick={() => onChange('levels')}
        className={`${BASE} ${mode === 'levels' ? ON : OFF}`}
      >
        <List className="w-4 h-4 shrink-0" aria-hidden="true" /> Browse
      </button>
    </div>
  )
}

export default StockModeTabs
