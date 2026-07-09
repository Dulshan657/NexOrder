import { Loader2 } from 'lucide-react'
import { Overlay } from './Overlay'

// A full-screen busy indicator, typically a <Suspense> fallback for a lazily loaded
// modal. It cannot be dismissed (there is nothing to dismiss yet) and does not trap
// focus, since it holds no controls and unmounts as soon as the real modal arrives.

export interface LoadingOverlayProps {
  label?: string
}

export function LoadingOverlay({ label = 'Loading…' }: LoadingOverlayProps) {
  return (
    <Overlay
      open
      onRequestClose={() => {}}
      dismissOnBackdrop={false}
      dismissOnEsc={false}
      trapFocus={false}
      containerClassName="flex items-center justify-center bg-stone-900/60 ui-backdrop-in"
    >
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-white" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </div>
    </Overlay>
  )
}
