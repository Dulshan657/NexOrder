// A one-sentence hint attached to a field label.
//
// ── WHY IT PORTALS, WHICH IS NOT OBVIOUS ────────────────────────────────────
//
// The first version rendered `absolute` inside a `relative` wrapper, which is
// the textbook answer and is wrong here for two independent reasons:
//
//   1. `ReceiveStockView`'s staged-lines container is `glass-card rounded-xl
//      overflow-hidden`. An inline popover on the last line, or on the
//      right-hand columns, is CLIPPED — silently, and only on the rows nobody
//      tests.
//   2. `ProductForm` renders inside a `<Modal>`, which sits at `BASE_Z` (1000)
//      in `overlayStack.ts`. A tooltip in a local stacking context cannot climb
//      over it.
//
// So it portals to `document.body` and positions itself `fixed` from the
// trigger's own rect. That is `position: fixed` — NOT `fixed inset-0`, which is
// what `scripts/check-overlays.mjs` fails CI on. Living in `components/ui/`
// exempts it either way, but the distinction is the point: a backdrop is wrong
// for a tooltip, and this has none.
//
// ── IT IS NOT AN OVERLAY ────────────────────────────────────────────────────
//
// No focus trap, no scroll lock, no backdrop, and it does not join the overlay
// stack. It explains the control the operator is standing on rather than
// replacing it. It closes on scroll instead of tracking, because a hint that
// follows you down the page is a distraction and re-measuring per frame on a
// dock phone is not free.
//
// ── NEVER HOVER-ONLY ────────────────────────────────────────────────────────
//
// The device this most needs to work on is a CipherLab RS35 at a loading dock,
// which has no pointer to hover with. The trigger is a real `<button>`: it
// opens on click and on keyboard focus, closes on Escape, and is in the tab
// order. `title=` was the alternative and is invisible to touch entirely.
//
// `aria-describedby`, deliberately NOT `aria-controls`: this is a tooltip, not
// a disclosure. (It also keeps it out of
// `tests/e2e/mobile/receive-stock.spec.ts`'s
// `button[aria-expanded][aria-controls]` disclosure selector, which would
// otherwise match the first tooltip on the page instead of the line toggle.)

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { BASE_Z, MAX_STACK_DEPTH, Z_STEP } from './overlayStack'
import { placePopover, type PopoverPlacement } from '@/lib/popoverPosition'

/** Above every modal the stack can allocate, and below the toasts at TOAST_Z. */
const TOOLTIP_Z = BASE_Z + MAX_STACK_DEPTH * Z_STEP - 1

const PANEL_WIDTH = 224 // 14rem, matching the w-56 the panel is sized at
const VIEWPORT_MARGIN = 8
/** Roughly five wrapped lines at this width. Used only to decide whether the
 *  panel still fits below the trigger; the panel itself is never height-capped,
 *  because a clipped hint is worse than one that flips. */
const ESTIMATED_PANEL_HEIGHT = 140

export type TooltipProps = {
  /** The hint itself. One or two sentences — anything longer belongs in a doc. */
  text: string
  /**
   * What the trigger is called for a screen reader, e.g. "What does Arrived on
   * mean?". Required: an unlabelled icon button is a dead end without sight.
   */
  label: string
  /**
   * Preferred edge to hang from. Only a preference — the panel is clamped into
   * the viewport regardless, which is what actually protects a 360px screen.
   */
  align?: 'left' | 'right'
  className?: string
}

export function Tooltip({ text, label, align = 'left', className = '' }: TooltipProps) {
  // ── THREE INPUTS, NOT ONE `open` FLAG ─────────────────────────────────────
  //
  // A single boolean toggled by click looked right and was broken on a mouse:
  // `mouseenter` had already opened it, so the click that followed toggled it
  // straight back shut and the hint never appeared. Only a browser showed that
  // — jsdom fires no hover.
  //
  // So each way in owns its own state and the panel is their union. Click
  // toggles PINNED, which is the one that outlives the pointer leaving; hover
  // and focus are transient. On touch there is no hover, so the tap's click
  // pins it, which is the whole reason this is not hover-only.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = pinned || hovered || focused
  const close = () => { setPinned(false); setHovered(false); setFocused(false) }

  const [pos, setPos] = useState<PopoverPlacement | null>(null)
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Measured before paint, so the panel never appears at 0,0 and jump to place.
  //
  // This clamped HORIZONTALLY and nothing else, which was half a fix. `top` was
  // always `r.bottom + 6`, so a hint on a control low on a 664px handheld screen
  // rendered below the fold — and because the panel is portalled, `fixed`, and
  // closes on scroll, it could not be scrolled to. It was simply unreachable.
  //
  // `placePopover` does both axes and flips above when below cannot hold it. The
  // estimate for the panel's height is deliberately generous: at 224px wide a
  // one-or-two-sentence hint wraps to four or five lines on this screen, and
  // over-estimating only makes the flip decision more eager, while
  // under-estimating puts it back off the bottom.
  useLayoutEffect(() => {
    if (!open) return
    const el = triggerRef.current
    if (!el) return
    setPos(placePopover({
      trigger: el.getBoundingClientRect(),
      preferredWidth: PANEL_WIDTH,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      align,
      margin: VIEWPORT_MARGIN,
      preferredMaxHeight: ESTIMATED_PANEL_HEIGHT,
    }))
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Stop the Modal this may be sitting inside from closing as well: the
      // operator meant to dismiss the hint, not lose the form behind it.
      e.stopPropagation()
      close()
    }
    const onDown = (e: Event) => {
      if (!triggerRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    // Capture phase: the app scrolls `main[data-scroll-container]`, not the
    // window, so a bubbling listener on document would never hear it.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Hover is an enhancement on top of click and focus, never the way in.
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-stone-500 ' +
          `hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/40 ${className}`
        }
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            id={panelId}
            role="tooltip"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: TOOLTIP_Z }}
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-stone-600 shadow-lg"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}

export default Tooltip
