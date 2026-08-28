import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// A sortable column header that a keyboard can actually operate.
//
// Every sortable table in this app had the same two defects, copied four times:
// the click handler was on the <th> itself, which is not focusable and has no
// interactive role -- so the column could not be sorted without a mouse at all --
// and the current sort was conveyed only by a chevron glyph, so nothing announced
// which column was sorted or in which direction.
//
// The fix is two elements doing one job each. The <th> carries `aria-sort`,
// which is the only thing assistive technology reads for sort state and which
// belongs on the header cell rather than on a control inside it. The <button>
// carries the click, the focus and the accessible name.
//
// A real <button>, not `<th role="button" tabIndex={0}>`: the latter needs a
// hand-written Enter/Space handler, and hand-written key handling is exactly the
// thing that gets one of the two keys wrong.

export type SortDirection = 'asc' | 'desc'

export interface SortableHeaderProps {
  /** This column's key, passed back to `onSort`. */
  column: string
  label: ReactNode
  /** The column currently sorted, or null when nothing is. */
  activeColumn: string | null
  direction: SortDirection
  onSort: (column: string) => void
  align?: 'left' | 'right'
  /** Classes for the <th>. The button's own layout classes are fixed. */
  className?: string
}

export function SortableHeader({
  column,
  label,
  activeColumn,
  direction,
  onSort,
  align = 'left',
  className = '',
}: SortableHeaderProps) {
  const active = activeColumn === column

  return (
    <th
      scope="col"
      // 'none' rather than omitting the attribute on inactive columns: it is
      // what tells a screen reader the column is sortable but not currently
      // sorted. Leaving it off says only that it is not sorted.
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={
          'inline-flex w-full items-center gap-1.5 touch-target-y select-none ' +
          'rounded transition-colors hover:text-stone-900 ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark ' +
          (align === 'right' ? 'justify-end text-right' : 'text-left')
        }
      >
        {label}
        {/* aria-hidden because aria-sort on the <th> already carries this, and
            announcing it twice is worse than announcing it once. The invisible
            placeholder keeps the header from shifting as sort moves between
            columns. */}
        {active ? (
          direction === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-0" aria-hidden="true" />
        )}
      </button>
    </th>
  )
}
