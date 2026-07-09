import { useId, type ReactNode } from 'react'
import { Overlay } from './Overlay'
import { Button } from './Button'

// Built directly on Overlay rather than Modal: a confirm has no scrolling body, and
// Modal renders one of these for its discard guard — going through Modal would make
// the import cycle Modal -> ConfirmDialog -> Modal.
//
// Because it mounts after its parent it lands higher in the overlay stack, so it
// renders above and owns Escape. It also holds its own state, which is why the
// retro-apply confirm can now surface an error its (unmounted) parent used to swallow.

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()

  return (
    <Overlay
      open={open}
      onRequestClose={onCancel}
      // While the confirmed action is in flight there is nothing safe to cancel:
      // block Escape and backdrop dismissal, matching the disabled Cancel button.
      dismissOnBackdrop={!busy}
      dismissOnEsc={!busy}
      containerClassName="flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm ui-backdrop-in"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="po-modal-in bg-white rounded-xl shadow-elevated border border-stone-200 w-full max-w-sm p-6"
      >
        <h2 id={titleId} className="text-base font-display font-bold text-stone-900">
          {title}
        </h2>
        {message && <div className="mt-2 text-sm text-stone-600 leading-relaxed">{message}</div>}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
