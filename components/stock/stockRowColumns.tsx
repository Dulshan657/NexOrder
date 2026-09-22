// The Stock list's column templates, in one place so the heading strip and the
// rows cannot disagree about which layout is showing.
//
// ── WHY A CONTAINER QUERY AND NOT A BREAKPOINT ──────────────────────────────
//
// Same reasoning as `receive/ReceiveLineCard.tsx`, and the same trap: the
// quantity that matters is the width of THIS LIST, not of the viewport. The
// AppShell sidebar is 208px and the page pads by 32px, so a viewport figure
// overstates the space by ~240px on an ordinary laptop and the identity column
// computes to nothing. `@container` is declared once, on the card wrapping both
// the headings and the rows.
//
// ── THE ARITHMETIC, AND ITS STATUS ──────────────────────────────────────────
//
// OUTER (product list) — fixed columns 7rem + 6rem + 12rem + 8rem = 528px,
// plus 4 gaps x 16px = 64, plus 32px padding = 624px spoken for before the
// product column gets anything. 780 - 624 = 156px for the product name.
//
// INNER (batch slots) — fixed columns 6rem + 5rem + 5rem + 5rem + 5.5rem =
// 424px, plus 5 gaps x 12px = 60, plus 24px padding = 508px. 660 - 508 = 152px
// for "Location · Lot".
//
// THESE TWO FIGURES ARE CALCULATED, NOT MEASURED, and `ReceiveLineCard.tsx:25-58`
// is a written-up account of getting exactly this arithmetic wrong in the
// optimistic direction. Before trusting them, resize the built page and record
// the real widths here the way that file does. Do not lower either number
// without re-measuring.

import React from 'react'

/** Product · On hand · Allocated · Available · Status */
export const OPS_STOCK_ROW_COLUMNS =
  '@min-[780px]:grid-cols-[minmax(0,1fr)_7rem_6rem_12rem_8rem]'

/** Location·Lot · Expiry · On hand · Allocated · Available · Adjust */
export const OPS_BATCH_ROW_COLUMNS =
  '@min-[660px]:grid-cols-[minmax(0,1fr)_6rem_5rem_5rem_5rem_5.5rem]'

/** Column name repeated per-cell while the heading strip is hidden.
 *
 *  Two components rather than one with a prop because the threshold is baked
 *  into the class string — Tailwind cannot see a runtime value, and a
 *  `@min-[${n}px]:hidden` template would silently produce no class at all. */
export function StockMicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-600 @min-[780px]:hidden">
      {children}
    </span>
  )
}

export function BatchMicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-stone-600 @min-[660px]:hidden">
      {children}
    </span>
  )
}
