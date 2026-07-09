import { X } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { guardReducer, type GuardState } from './dirtyGuard'

// The header/body/footer column shared by Modal and Sheet.
//
// This shape is the whole point of the primitive:
//   panel   max-h-[...] flex flex-col overflow-hidden
//     header  shrink-0                        <- always visible
//     body    flex-1 min-h-0 overflow-y-auto  <- the ONLY scroller
//     footer  shrink-0                        <- always reachable
//
// `min-h-0` is load-bearing. Flexbox defaults a flex item's `min-height` to `auto`,
// which refuses to shrink below its content — drop it and the body grows past the
// panel, the panel outgrows the viewport, and the header is clipped again.

export interface DialogChromeProps {
  titleId: string
  title?: ReactNode
  icon?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  /** Escape hatch for full-bleed bodies, e.g. `p-0 flex min-h-0` for a two-pane layout. */
  bodyClassName?: string
  onRequestClose: () => void
  children: ReactNode
}

export function DialogChrome({
  titleId,
  title,
  icon,
  description,
  footer,
  bodyClassName,
  onRequestClose,
  children,
}: DialogChromeProps) {
  return (
    <>
      {(title || icon) && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <div className="p-1.5 rounded-lg bg-nexgen-blue/10 shrink-0">{icon}</div>}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-display font-bold text-stone-900 truncate">
                {title}
              </h2>
              {description && <p className="text-xs text-stone-500 truncate">{description}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onRequestClose}
            aria-label="Close"
            className="p-1 rounded-lg hover:bg-stone-100 btn-press shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue/40"
          >
            <X className="w-4 h-4 text-stone-500" />
          </button>
        </div>
      )}

      <div className={bodyClassName ?? 'flex-1 min-h-0 overflow-y-auto px-6 py-5'}>{children}</div>

      {footer && (
        <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-stone-100 bg-white">
          {footer}
        </div>
      )}
    </>
  )
}

export interface DismissGuard {
  /** Every dismiss path calls this: Escape, backdrop, the X, Cancel. */
  requestClose: () => void
  discardOpen: boolean
  confirmDiscard: () => void
  cancelDiscard: () => void
}

/**
 * Routes every dismiss attempt through the dirty guard. When `dirty`, the first
 * attempt opens a discard confirmation instead of closing. Consumers pass one
 * boolean; the nested confirm is rendered by Modal/Sheet, so child forms never see it.
 */
export function useDismissGuard(dirty: boolean, onClose: () => void): DismissGuard {
  const [state, setState] = useState<GuardState>('idle')
  // Read state synchronously so the reducer stays pure and `onClose` runs exactly
  // once — a state updater may be invoked twice under StrictMode.
  const stateRef = useRef<GuardState>('idle')

  const dispatch = useCallback(
    (event: Parameters<typeof guardReducer>[1]) => {
      const result = guardReducer(stateRef.current, event)
      stateRef.current = result.state
      setState(result.state)
      if (result.effect === 'close') onClose()
    },
    [onClose],
  )

  return {
    requestClose: useCallback(() => dispatch({ type: 'requestClose', dirty }), [dispatch, dirty]),
    discardOpen: state === 'confirming',
    confirmDiscard: useCallback(() => dispatch({ type: 'confirmDiscard' }), [dispatch]),
    cancelDiscard: useCallback(() => dispatch({ type: 'cancelDiscard' }), [dispatch]),
  }
}
