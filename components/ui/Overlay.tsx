import React, { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from './useFocusTrap'
import { useModalStack } from './useModalStack'
import { useScrollLock } from './useScrollLock'

// Shared base for Modal and Sheet. Owns everything that is easy to get wrong:
// portalling out of the app tree, z-index, scroll lock, focus trap, Escape, and
// backdrop dismissal. Modal/Sheet supply only positioning classes and a panel.
//
// Never a scroll container. The panel caps its own height and scrolls internally,
// which is what makes the "modal taller than the viewport clips its own header"
// bug structurally impossible.

const ENTERED_FALLBACK_MS = 250

export interface OverlayProps {
  open: boolean
  /** Called for every dismiss attempt. The caller decides whether to actually close. */
  onRequestClose: () => void
  /** Positioning + backdrop classes. Applied after `fixed inset-0`. */
  containerClassName: string
  dismissOnBackdrop?: boolean
  dismissOnEsc?: boolean
  /** Off for transient overlays (e.g. a Suspense spinner) that hold nothing to focus
   *  and would otherwise yank focus away and back as they mount and unmount. */
  trapFocus?: boolean
  /** Fires once the entrance animation settles. Used to re-measure embedded widgets. */
  onEntered?: () => void
  children: ReactNode
}

export function Overlay({
  open,
  onRequestClose,
  containerClassName,
  dismissOnBackdrop = true,
  dismissOnEsc = true,
  trapFocus = true,
  onEntered,
  children,
}: OverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { z, isTopmost } = useModalStack(open)

  useScrollLock(open)
  useFocusTrap(containerRef, open && trapFocus)

  // Escape is handled by the topmost overlay only, so a nested confirm closes
  // itself rather than the form that spawned it.
  useEffect(() => {
    if (!open || !dismissOnEsc || !isTopmost) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onRequestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, dismissOnEsc, isTopmost, onRequestClose])

  // `animationend` never fires under prefers-reduced-motion (animations are
  // disabled), so a timer backs it up. Whichever lands first wins.
  const enteredRef = useRef(false)
  useEffect(() => {
    if (!open || !onEntered) return
    enteredRef.current = false
    const fire = () => {
      if (enteredRef.current) return
      enteredRef.current = true
      onEntered()
    }
    const timer = window.setTimeout(fire, ENTERED_FALLBACK_MS)
    const node = containerRef.current
    node?.addEventListener('animationend', fire)
    return () => {
      window.clearTimeout(timer)
      node?.removeEventListener('animationend', fire)
    }
  }, [open, onEntered])

  if (!open) return null

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // React events cross a portal via the React tree, not the DOM tree, so a click
    // inside the panel would otherwise reach whatever component rendered us — e.g. a
    // clickable table row. Stop it here, and treat a click that lands on the
    // container itself (not a descendant) as a backdrop click.
    event.stopPropagation()
    if (dismissOnBackdrop && event.target === event.currentTarget) onRequestClose()
  }

  return createPortal(
    <div
      ref={containerRef}
      style={{ zIndex: z }}
      className={`fixed inset-0 ${containerClassName}`}
      onClick={handleClick}
    >
      {children}
    </div>,
    document.body,
  )
}
