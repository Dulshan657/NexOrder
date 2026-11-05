import React from 'react'

export interface PageTab<Id extends string = string> {
  id: Id
  label: React.ReactNode
  /** A count shown beside the label. Zero or absent shows nothing. */
  badge?: number
}

export interface PageTabsProps<Id extends string = string> {
  /** Names the row for a screen reader, e.g. "Putaway stage". */
  ariaLabel: string
  tabs: ReadonlyArray<PageTab<Id>>
  activeId: Id
  onChange: (id: Id) => void
}

/**
 * The underlined row under a page header. It scrolls sideways rather than wrapping,
 * so a page with many tabs still fits a 360px screen.
 *
 * A `nav` of buttons with `aria-current`, not a `tablist`: a tablist promises
 * arrow-key focus and matching panels, which these pages don't have.
 */
export function PageTabs<Id extends string = string>({ ariaLabel, tabs, activeId, onChange }: PageTabsProps<Id>) {
  return (
    <nav aria-label={ariaLabel} className="flex items-center gap-6 border-b border-stone-200/70 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => onChange(tab.id)}
            className={`relative -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2.5 touch-target-y text-sm transition-colors border-b-2 ${
              active
                ? 'border-stone-900 text-stone-900 font-medium'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            {tab.label}
            {tab.badge ? (
              <span className="px-1.5 py-0.5 rounded-full bg-nexgen-blue-dark text-white text-[10px] tabular-nums">
                {tab.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}

export default PageTabs
