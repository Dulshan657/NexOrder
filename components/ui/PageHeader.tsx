import React from 'react'

export interface PageHeaderProps {
  /** A tab's title comes from `ADMIN_TAB_LABELS`, so it can't drift from the sidebar. */
  title: React.ReactNode
  /** One fixed sentence saying what the page is for. Live counts belong in the body. */
  description?: React.ReactNode
  /** Buttons and the warehouse picker. Stays visible at every width. */
  actions?: React.ReactNode
  /**
   * Keeps the text on a phone. Only for a title `MobileTopBar` isn't already
   * showing, such as a greeting or a venue name.
   */
  visibleOnMobile?: boolean
}

/**
 * The top of a main page: title and description on the left, controls on the right.
 *
 * Below `md`, where `MobileTopBar` names the page, the text is `sr-only` rather
 * than removed. The bar's title is a span, so this stays the page's one heading
 * for a screen reader. The breakpoint must match the bar's `md:hidden`.
 */
export function PageHeader({ title, description, actions, visibleOnMobile = false }: PageHeaderProps) {
  // With no controls and the text hidden, the header has nothing to show on a
  // phone. Taking it out of flow stops its PageFrame spacing leaving an empty row.
  const nothingOnPhone = !actions && !visibleOnMobile

  return (
    <header className={`flex flex-wrap items-center justify-between gap-3 ${nothingOnPhone ? 'max-md:absolute' : ''}`}>
      <div className={visibleOnMobile ? 'min-w-0' : 'sr-only md:not-sr-only md:min-w-0'}>
        <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">{title}</h1>
        {description && <p className="text-xs text-stone-500 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3 min-w-0 max-w-full">{actions}</div>}
    </header>
  )
}

export default PageHeader
