// Ref-counted scroll lock arithmetic.
//
// Nested overlays share one lock: the scroller is frozen when the first one opens
// and only restored when the last one closes. Without the counter, closing a
// confirm dialog would unfreeze the page behind the form that spawned it.
//
// The DOM work lives in `useScrollLock`; this module is pure so it can be tested
// without a browser.

export interface LockState {
  count: number
  /** The scroller's inline styles as they were before the first lock. */
  prevOverflow: string
  prevPaddingRight: string
}

export const initialLockState: LockState = {
  count: 0,
  prevOverflow: '',
  prevPaddingRight: '',
}

/**
 * Width of the scroller's vertical scrollbar. Hiding the scrollbar without
 * compensating for this width makes the whole page jump sideways.
 */
export function scrollbarWidthOf(el: { offsetWidth: number; clientWidth: number }): number {
  return Math.max(0, el.offsetWidth - el.clientWidth)
}

/** `apply` is true only on the 0 -> 1 transition, when styles must be written. */
export function acquire(
  state: LockState,
  prevOverflow: string,
  prevPaddingRight: string,
): { next: LockState; apply: boolean } {
  if (state.count === 0) {
    return { next: { count: 1, prevOverflow, prevPaddingRight }, apply: true }
  }
  return { next: { ...state, count: state.count + 1 }, apply: false }
}

/** `restore` is true only on the 1 -> 0 transition, when styles must be undone. */
export function releaseLock(state: LockState): { next: LockState; restore: boolean } {
  if (state.count <= 0) return { next: state, restore: false }
  const count = state.count - 1
  return { next: { ...state, count }, restore: count === 0 }
}
