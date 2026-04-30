// Auto-signout after a period of user inactivity.
//
// Listens for "real" interaction events (pointer + key + scroll + touch +
// tab refocus) and resets a setTimeout each time. When the timer expires,
// the supplied onIdle callback fires — typically wired to signOut().
//
// Pure browser API; no React imports beyond the effect plumbing. Kept off
// the render path so it never causes re-renders.

import { useEffect, useRef } from 'react'

const DEFAULT_IDLE_MS = 30 * 60 * 1000 // 30 minutes

const ACTIVITY_EVENTS = [
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'visibilitychange',
] as const

interface UseIdleTimeoutArgs {
  /** Whether the timer is armed. Pass false when the user is signed out. */
  enabled: boolean
  /** Idle threshold in milliseconds. Defaults to 30 minutes. */
  idleMs?: number
  /** Fired exactly once when the threshold is reached. */
  onIdle: () => void
}

export function useIdleTimeout({
  enabled,
  idleMs = DEFAULT_IDLE_MS,
  onIdle,
}: UseIdleTimeoutArgs): void {
  // Latest onIdle in a ref so we don't re-arm the timer every render.
  const onIdleRef = useRef(onIdle)
  useEffect(() => {
    onIdleRef.current = onIdle
  }, [onIdle])

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    let timer: ReturnType<typeof setTimeout> | null = null
    let fired = false

    const reset = () => {
      if (fired) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        fired = true
        onIdleRef.current()
      }, idleMs)
    }

    const handler = () => {
      // visibilitychange fires for both hide and show; only reset on show.
      if (document.visibilityState === 'hidden') return
      reset()
    }

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handler, { passive: true })
    }
    reset()

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, handler)
      }
      if (timer) clearTimeout(timer)
    }
  }, [enabled, idleMs])
}
