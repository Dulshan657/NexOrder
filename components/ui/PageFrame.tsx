import React from 'react'

export interface PageFrameProps {
  children: React.ReactNode
  /**
   * A flex column instead of stacked spacing, for a page whose bottom scan dock
   * has to reach the foot of the screen. `sticky` only holds a bar that would
   * scroll away; it won't move one sitting above the fold on a short page.
   */
  column?: boolean
}

/**
 * The wrapper around a main page: the one padding scale and vertical rhythm.
 *
 * `StickyScanBar`'s bleed cancels exactly this padding, so a change here has to
 * change that too.
 */
export function PageFrame({ children, column = false }: PageFrameProps) {
  const spacing = column ? 'flex flex-col gap-5 sm:gap-6' : 'space-y-5 sm:space-y-6'
  return <div className={`bg-white min-h-svh p-4 sm:p-6 lg:p-8 ${spacing}`}>{children}</div>
}

export default PageFrame
