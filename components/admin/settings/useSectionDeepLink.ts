// Scroll a Settings section into view from a `?section=` deep link.
//
// Four things make this harder than an anchor, and all four are why native
// `#hash` links are useless in this app:
//
//   1. document.body never scrolls — AppShell's root is `h-screen
//      overflow-hidden` and the real scroller is `main[data-scroll-container]`;
//   2. Settings sub-tabs lazy-load, so the target may not be in the DOM when
//      the effect first fires;
//   3. once loaded they stay mounted-but-`hidden` (display:none), where
//      scrollIntoView is a SILENT no-op — hence the offsetParent check;
//   4. every section is a TanStack Query consumer that renders a skeleton
//      first, so heights shift under a scroll fired too early — hence the
//      corrective second pass.

import { useEffect, useRef } from 'react'

/** ~1s of frames. Past that the chunk is not coming and we stop rather than
 *  spin, leaving the operator on the sub-tab they asked for. */
const MAX_FRAMES = 60
/** Long enough for a query to swap its skeleton for real content. */
const SETTLE_MS = 450

export function useSectionDeepLink(validIds: readonly string[]): void {
  const consumed = useRef(false)

  useEffect(() => {
    if (consumed.current) return
    if (typeof window === 'undefined') return

    const raw = new URLSearchParams(window.location.search).get('section')
    if (!raw) return

    // Strip UNCONDITIONALLY, before deciding whether we can honour it. A param
    // left behind because it didn't resolve re-fires on every later visit to
    // Settings — the bug the ?designer= consumer has, multiplied per param.
    consumed.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete('section')
    window.history.replaceState({}, '', url.toString())

    if (!validIds.includes(raw)) return

    let frames = 0
    let raf = 0
    let settle: ReturnType<typeof setTimeout> | undefined

    const scrollTo = (el: HTMLElement) => {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }

    const attempt = () => {
      const el = document.getElementById(raw) as HTMLElement | null
      // offsetParent is null while any ancestor is display:none.
      if (el && el.offsetParent !== null) {
        scrollTo(el)
        // Brief highlight — with several sections stacked on one page, landing
        // silently reads as "the link did nothing".
        el.classList.add('ring-2', 'ring-nexgen-blue/40', 'rounded-2xl')
        settle = setTimeout(() => {
          const again = document.getElementById(raw) as HTMLElement | null
          if (again && again.offsetParent !== null) scrollTo(again)
          again?.classList.remove('ring-2', 'ring-nexgen-blue/40', 'rounded-2xl')
        }, SETTLE_MS)
        return
      }
      if (frames++ < MAX_FRAMES) raf = requestAnimationFrame(attempt)
    }

    raf = requestAnimationFrame(attempt)
    return () => {
      cancelAnimationFrame(raf)
      if (settle) clearTimeout(settle)
    }
  }, [validIds])
}
