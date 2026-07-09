import { useEffect } from 'react'
import { acquire, initialLockState, releaseLock, scrollbarWidthOf, type LockState } from './scrollLock'

// AppShell's root is `h-screen overflow-hidden`, so `document.body` never scrolls
// and the textbook `body { overflow: hidden }` lock would be a no-op here. The real
// scroller is the `<main data-scroll-container>` element. Auth screens mount outside
// AppShell and do scroll the document, hence the fallback chain.

let state: LockState = initialLockState
let target: HTMLElement | null = null

function resolveScroller(): HTMLElement {
  return (
    document.querySelector<HTMLElement>('[data-scroll-container]') ??
    (document.scrollingElement as HTMLElement | null) ??
    document.documentElement
  )
}

/** Freezes the page scroller while `active`, compensating for the scrollbar width. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const el = resolveScroller()
    const result = acquire(state, el.style.overflow, el.style.paddingRight)
    state = result.next

    if (result.apply) {
      target = el
      const gutter = scrollbarWidthOf(el)
      const basePadding = Number.parseFloat(window.getComputedStyle(el).paddingRight) || 0
      el.style.overflow = 'hidden'
      // Removing the scrollbar reclaims its width; pad it back so nothing shifts.
      if (gutter > 0) el.style.paddingRight = `${basePadding + gutter}px`
    }

    return () => {
      const released = releaseLock(state)
      const previous = state
      state = released.next
      if (released.restore && target) {
        target.style.overflow = previous.prevOverflow
        target.style.paddingRight = previous.prevPaddingRight
        target = null
      }
    }
  }, [active])
}

/** Test-only: forget any lock held by a previous case. */
export function __resetScrollLock(): void {
  state = initialLockState
  target = null
}
