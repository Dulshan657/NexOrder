import React from 'react'

export interface PageFrameProps {
  children: React.ReactNode
}

/**
 * The wrapper around a main page: the one padding scale and vertical rhythm.
 *
 * `StickyScanBar`'s default `bleed="lg"` cancels exactly this padding, so a change
 * here has to change that too.
 */
export function PageFrame({ children }: PageFrameProps) {
  return <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">{children}</div>
}

export default PageFrame
