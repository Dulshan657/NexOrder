import React from 'react'
import type { LucideIcon } from 'lucide-react'
import type { DashAction } from './DashCard'

interface EmptyStateProps {
  message: string
  icon?: LucideIcon
  /** The one thing to do about it. */
  action?: DashAction
}

/** The one empty pattern on both dashboards: a line, and one action (NX-0041). */
export default function EmptyState({ message, icon: Icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      {Icon && <Icon className="w-6 h-6 text-stone-300" aria-hidden="true" />}
      <p className="text-sm text-stone-600">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-50 transition-colors duration-150 cursor-pointer touch-target-y"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
