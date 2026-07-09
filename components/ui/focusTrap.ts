// Focus containment for overlays. No dependency; ~40 lines of DOM.

export const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Index the next Tab press should land on. Wraps in both directions so focus can
 * never escape the overlay. `current === -1` (focus outside the panel) pulls focus
 * back to the first element.
 */
export function nextTabIndex(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1
  if (shift) return current <= 0 ? count - 1 : current - 1
  return current >= count - 1 || current === -1 ? 0 : current + 1
}

/**
 * Deliberately not an `offsetParent !== null` check: that is `null` for anything
 * inside a `position: fixed` subtree (which every overlay is) and always `null` under
 * jsdom, which has no layout engine.
 */
function isVisible(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false
  return el.closest('[hidden]') === null
}

/** Visible, focusable descendants in DOM order. */
export function getTabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(isVisible)
}
