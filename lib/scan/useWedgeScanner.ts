// The safety net for a scan fired at nothing.
//
// `ScanField` handles the gun perfectly well WHEN IT HAS FOCUS. On a phone that
// is nearly always true — there is one field on screen and the operator just
// tapped it. On a desktop it is often false: the operator clicked a button,
// clicked a row, clicked whitespace, or the page just re-rendered. The
// characters then go to the body and vanish, and — this is the part that costs
// real time on a floor — NOTHING SAYS SO. The gun beeped, the screen did not
// move, and the operator scans again, harder.
//
// This hook listens at the document and routes such a scan to the surface's own
// handler, exactly as though the field had been focused.
//
// ── THE STAND-DOWN RULE IS THE WHOLE SAFETY ARGUMENT ────────────────────────
//
// It does nothing while focus is inside an input, textarea, select or
// contenteditable. Two things follow, and both matter more than the feature:
//
//   1. It cannot corrupt typing, because it is not listening while anyone is
//      typing.
//   2. It cannot double-commit against `ScanField`'s own Enter handler, because
//      whenever that field is focused this hook has already stood down. There is
//      no coordination between the two paths and none is needed.
//
// The cost, stated plainly: a scan fired while focus sits in some OTHER input —
// a quantity box, say — still types into that box. Catching that would mean
// calling preventDefault on characters we have not yet classified as a scan,
// which risks swallowing genuine keystrokes. It is not worth it. The mitigation
// is that `ScanField` now refocuses itself, so focus lives in the scan box by
// default, and a misdirected scan is audible.
//
// ── ON ANDROID THIS REQUIRES "Key Event" MODE, AND CANNOT BE MADE NOT TO ────
//
// The CipherLab RS35 ships with ReaderConfig → Data Output → Keyboard Emulation
// = "Input Method", which delivers scans through an IME. An IME types into the
// FOCUSED EDITABLE and nothing else — so when nothing is focused, which is the
// entire case this hook exists for, no characters are produced anywhere and
// there is nothing to listen to. That is a property of Android text input, not
// a gap in this file, and no amount of code here changes it.
//
// `ScanField` still works under Input Method (its timing moved to onChange for
// exactly this reason). It is only the stray-scan net that needs "Key Event".
// Do not try to "fix" this; recommend the mode instead — SCAN-GUN-TEST-GUIDE.md
// does, and says why.

import { useEffect, useRef } from 'react'
import {
  emptyWedgeBuffer,
  feedWedgeKey,
  flushWedgeBuffer,
  WEDGE_FLUSH_IDLE_MS,
  type WedgeBuffer,
} from './wedgeBuffer'
import { registerWedgeConsumer } from './wedgeRegistry'

export interface UseWedgeScannerOptions {
  /**
   * Opt in. Scanning surfaces pass true; everything else never mounts this at
   * all. Pass false while a dialog owns the screen so a scan cannot reach the
   * page behind it.
   */
  active: boolean
  /** A code arrived while no field was ready for it. */
  onScan: (code: string) => void
  /**
   * Announce to `wedgeRegistry` that this surface is handling stray scans.
   *
   * True for every real scanning surface, and that is the default. The ONLY
   * caller that passes false is the app-wide fallback in
   * `components/StrayScanListener.tsx`, whose whole job is to notice that
   * nobody claimed the scan — if it claimed capture itself it would suppress
   * exactly the condition it is watching for.
   */
  claim?: boolean
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (el as HTMLElement).isContentEditable === true
}

export function useWedgeScanner({ active, onScan, claim = true }: UseWedgeScannerOptions): void {
  // Held in a ref so a parent re-render between the first character and the
  // terminator cannot tear the listener down mid-burst — the same discipline
  // `useBarcodeScanner` uses for its decode callback.
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  // Claim registered in its OWN effect, deliberately.
  //
  // React runs child effects before parent effects, so a scanning surface deep
  // in the tree claims before the app-level fallback's effect reads the count —
  // which is the ordering the fallback depends on. Keeping the claim separate
  // from the listener means that ordering holds even if the listener effect
  // later grows dependencies that make it re-run.
  useEffect(() => {
    if (!active || !claim) return
    return registerWedgeConsumer()
  }, [active, claim])

  useEffect(() => {
    if (!active) return
    if (typeof document === 'undefined') return

    let buffer: WedgeBuffer = emptyWedgeBuffer
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const clearIdle = () => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    // The suffix-less gun: nothing more arrived, so the run is the code.
    const armIdle = () => {
      clearIdle()
      idleTimer = setTimeout(() => {
        idleTimer = null
        const step = flushWedgeBuffer(buffer)
        buffer = step.next
        if (step.outcome.action === 'commit') onScanRef.current(step.outcome.code)
      }, WEDGE_FLUSH_IDLE_MS)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) {
        // Someone is typing. Drop anything half-buffered so a later scan cannot
        // be spliced onto it.
        buffer = emptyWedgeBuffer
        clearIdle()
        return
      }

      const step = feedWedgeKey(buffer, {
        key: event.key,
        timeStamp: event.timeStamp,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        altGraph: event.getModifierState?.('AltGraph') === true,
      })
      buffer = step.next

      if (step.outcome.action === 'buffered') {
        // Only from the second character on — see WedgeOutcome.claim. A code
        // containing a space would otherwise press whatever button has focus.
        if (step.outcome.claim) event.preventDefault()
        armIdle()
        return
      }

      clearIdle()

      if (step.outcome.action === 'commit') {
        // The terminator must not also do its ordinary job. Focus commonly sits
        // on the button the operator last pressed, and an unguarded Enter would
        // press it again — confirming a putaway the operator was only trying to
        // scan into.
        event.preventDefault()
        onScanRef.current(step.outcome.code)
      }
    }

    // A burst interrupted by Alt+Tab must not complete when the operator comes
    // back: the characters either side of the gap are from different scans.
    const discard = () => {
      buffer = emptyWedgeBuffer
      clearIdle()
    }

    // Capture phase: the terminator has to be intercepted before it reaches a
    // focused button's own activation handling.
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', discard)
    document.addEventListener('visibilitychange', discard)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', discard)
      document.removeEventListener('visibilitychange', discard)
      clearIdle()
    }
  }, [active])
}
