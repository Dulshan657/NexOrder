import { useEffect } from 'react'

// Hides the application behind an open overlay from assistive technology.
//
// The focus trap already stops a KEYBOARD leaving the dialog, but it does
// nothing about a screen reader's virtual cursor, which reads the document
// rather than following focus. Without this, a VoiceOver or NVDA user can swipe
// straight out of a modal into the page behind it, operate a control there, and
// have no indication a dialog is open at all.
//
// `inert` is the right tool and does both halves: it removes the subtree from
// the accessibility tree AND makes everything in it unfocusable and unclickable.
//
// IT GOES ON `#root`, WHICH IS A SIBLING OF THE OVERLAY, NOT AN ANCESTOR.
// `components/ui/Overlay.tsx` portals to `document.body`, so the dialog is not
// inside `#root` and cannot inert itself. That is a property worth checking
// before touching either file: if an overlay ever rendered inline, this would
// silently disable the dialog it was meant to protect. `ToastContainer` portals
// to body as well, so notifications stay announceable, which is correct — a
// toast raised while a modal is open is still something the user needs.
//
// Ref-counted, like `useScrollLock`, so a nested confirm dialog closing does not
// un-hide the page while its parent modal is still open.

const ROOT_ID = 'root'

let depth = 0
let target: HTMLElement | null = null
let hadInert = false

function resolveRoot(): HTMLElement | null {
  return document.getElementById(ROOT_ID)
}

/** Marks the app root `inert` while `active`, for as long as anything holds it. */
export function useInertBackground(active: boolean): void {
  useEffect(() => {
    if (!active) return

    if (depth === 0) {
      const el = resolveRoot()
      if (el) {
        target = el
        // Remembered rather than assumed: something else may legitimately have
        // set it, and releasing should restore what was there, not clear it.
        hadInert = el.hasAttribute('inert')
        el.setAttribute('inert', '')
      }
    }
    depth += 1

    return () => {
      depth -= 1
      if (depth > 0) return
      if (target && !hadInert) target.removeAttribute('inert')
      target = null
      hadInert = false
    }
  }, [active])
}

/** Test-only: forget any state held by a previous case. */
export function __resetInertBackground(): void {
  if (target && !hadInert) target.removeAttribute('inert')
  depth = 0
  target = null
  hadInert = false
}
