import React from 'react'
import { ChevronRight } from 'lucide-react'
import OptimizedImage from '../OptimizedImage'

export interface RankedItem {
  id: string | number
  label: string
  value: string
  /** A second, quieter line under the name. */
  sub?: string
  /** 0..1 of the top row; drawn as a thin bar behind the row. */
  share?: number
  avatarUrl?: string
  badge?: React.ReactNode
  /** Where the row leads. Without one the row is plain text (NX-0041). */
  onClick?: () => void
}

interface RankedListProps {
  /** Accessible name of the list. */
  label: string
  items: RankedItem[]
  emptyMessage?: string
}

function RowBody({ item, rank }: { item: RankedItem; rank: number }) {
  const share = Math.max(0, Math.min(1, item.share ?? 0))
  return (
    <>
      {share > 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-0 rounded-md bg-nexgen-blue/[0.07]"
          style={{ width: `${share * 100}%` }}
        />
      )}
      <span className="relative w-5 shrink-0 text-xs font-mono tabular-nums text-stone-500">{rank}</span>
      {item.avatarUrl && (
        <OptimizedImage
          src={item.avatarUrl}
          alt=""
          className="relative h-6 w-6 rounded-full border border-stone-200 shrink-0"
          transformWidth={96}
        />
      )}
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm text-stone-800">{item.label}</span>
          {item.badge}
        </span>
        {item.sub && <span className="block truncate text-xs text-stone-500">{item.sub}</span>}
      </span>
      <span className="relative shrink-0 text-sm font-semibold tabular-nums text-stone-900">{item.value}</span>
    </>
  )
}

/** One top-N list for every "top customers / products / reps" on both dashboards. */
export default function RankedList({ label, items, emptyMessage = 'Nothing to show yet' }: RankedListProps) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-stone-500">{emptyMessage}</p>
  }

  return (
    <ul aria-label={label} className="-mx-2 space-y-0.5">
      {items.map((item, i) => (
        <li key={item.id}>
          {item.onClick ? (
            <button
              type="button"
              onClick={item.onClick}
              className="group relative flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-stone-50 transition-colors duration-150 cursor-pointer touch-target-y"
            >
              <RowBody item={item} rank={i + 1} />
              <ChevronRight
                className="relative w-4 h-4 shrink-0 text-stone-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden="true"
              />
            </button>
          ) : (
            <div className="relative flex items-center gap-3 px-2 py-2">
              <RowBody item={item} rank={i + 1} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
