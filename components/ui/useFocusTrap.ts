import { useEffect, type RefObject } from 'react'
import { getTabbables, nextTabIndex } from './focusTrap'

/**
 * Confines Tab/Shift+Tab to `ref` while `active`, focuses the first control on open,
 * and returns focus to whatever was focused before (i.e. the trigger button) on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const root = ref.current
    if (!active || !root) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const initial = getTabbables(root)[0] ?? root
    initial.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = getTabbables(root)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const current = items.indexOf(document.activeElement as HTMLElement)
      const index = nextTabIndex(items.length, current, event.shiftKey)
      event.preventDefault()
      items[index]?.focus()
    }

    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [ref, active])
}
