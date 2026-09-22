// The Products table's column template, shared by the heading strip and the
// rows so the two cannot disagree about which layout is showing.
//
// ── THE ARITHMETIC, AND ITS STATUS ──────────────────────────────────────────
//
// Ten columns. Fixed widths total 744px — 2.5+3.5+7+6+6+4.5+5.5+5+6.5 rem —
// plus 9 gaps x 12px = 108, plus 24px of padding = 876px spoken for before the
// product name gets anything. 1000 - 876 = 124px for the name, which is the
// narrowest width at which a product name is worth rendering at all.
//
// 1000 is a CONTAINER width, not a viewport one, and the distinction is the
// whole reason this constant exists — `ReceiveLineCard.tsx:42-52` is a
// written-up account of encoding one as the other and computing a 0px column on
// an ordinary laptop. The AppShell sidebar is 208px and the page pads by 64px,
// so a 1280px viewport gives this container 1008px: just over, and the table
// layout that a desk has always had is preserved. A 1024px viewport gives it
// 752px and gets the card layout, which is strictly better than the sideways
// scroll it had before.
//
// THESE FIGURES ARE CALCULATED, NOT MEASURED. Resize the built page and record
// the real widths here before trusting them, and do not lower 1000 without
// re-measuring — the arithmetic is easy to get wrong in the optimistic
// direction, because the padding and the gaps are invisible until you subtract
// them.

import React from 'react'

/** select · image · name · supplier · category · brand · price · stock · m³ · actions */
export const PRODUCT_ROW_COLUMNS =
  '@min-[1000px]:grid-cols-[2.5rem_3.5rem_minmax(0,1fr)_7rem_6rem_6rem_4.5rem_5.5rem_5rem_6.5rem]'

/** Column name, repeated per-cell while the heading strip is hidden. */
export function ProductMicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-stone-600 @min-[1000px]:hidden">
      {children}
    </span>
  )
}
