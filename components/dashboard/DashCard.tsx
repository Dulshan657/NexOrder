import React from 'react'
import { ArrowRight } from 'lucide-react'

export interface DashAction {
  label: string
  onClick: () => void
}

interface DashCardProps {
  title?: string
  /** A quiet line beside the title — the window the card measures, e.g. "Last 30 days". */
  caption?: string
  /** The card's one way out, e.g. "View all". Omitted when the user cannot go there. */
  action?: DashAction
  footer?: React.ReactNode
  /** Drop the body padding, for lists that run edge to edge. */
  flush?: boolean
  className?: string
  children?: React.ReactNode
}

/**
 * The one card both dashboards are built from (NX-0041): white on the stone-50
 * page, a hairline border, a 1px resting shadow, no glass and no gradient.
 */
export default function DashCard({ title, caption, action, footer, flush = false, className = '', children }: DashCardProps) {
  const hasHeader = Boolean(title || action)
  return (
    <section className={`dash-card flex flex-col min-w-0 ${className}`}>
      {hasHeader && (
        <header className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-stone-900 truncate">{title}</h3>}
            {caption && <p className="text-xs text-stone-500 mt-0.5">{caption}</p>}
          </div>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 -mr-2 text-xs font-semibold text-nexgen-blue-dark hover:bg-stone-50 transition-colors duration-150 cursor-pointer touch-target-y"
            >
              {action.label}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </header>
      )}
      <div className={`flex-1 min-h-0 ${flush ? (hasHeader ? 'pt-3' : '') : 'p-4 sm:p-5'} ${!flush && hasHeader ? 'pt-3 sm:pt-3' : ''}`}>
        {children}
      </div>
      {footer && <footer className="border-t border-stone-100 px-4 sm:px-5 py-3">{footer}</footer>}
    </section>
  )
}
