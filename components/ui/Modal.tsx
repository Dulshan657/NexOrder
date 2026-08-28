import { useId, type FormEvent, type ReactNode } from 'react'
import { Overlay } from './Overlay'
import { ConfirmDialog } from './ConfirmDialog'
import { DialogChrome, useDismissGuard } from './chrome'

// Centered dialog. Use for confirms, quick edits and forms that comfortably fit.
// Reach for <Sheet> when a form has many sections.

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full'

const SIZE: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  full: 'max-w-6xl',
}

/** Passed to a function-form `footer` so a Cancel button dismisses through the dirty
 *  guard rather than bypassing it by calling `onClose` directly. */
export interface OverlayApi {
  requestClose: () => void
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  icon?: ReactNode
  description?: ReactNode
  size?: ModalSize
  /** Rendered in the sticky footer, so action buttons never scroll out of reach. */
  footer?: ReactNode | ((api: OverlayApi) => ReactNode)
  /** When set the panel element becomes a <form>. Do not also wrap <Modal> in a form. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  /** Unsaved edits: dismissing prompts to discard rather than closing outright. */
  dirty?: boolean
  discardConfirm?: { title?: string; message?: string; confirmLabel?: string }
  dismissOnBackdrop?: boolean
  dismissOnEsc?: boolean
  onEntered?: () => void
  bodyClassName?: string
  children: ReactNode
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  description,
  size = 'lg',
  footer,
  onSubmit,
  dirty = false,
  discardConfirm,
  dismissOnBackdrop,
  dismissOnEsc,
  onEntered,
  bodyClassName,
  children,
}: ModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const guard = useDismissGuard(dirty, onClose)

  // While the discard confirm is up it is topmost, so it owns Escape; suppressing
  // the parent's handlers here keeps a backdrop click from re-triggering the guard.
  const guarded = !guard.discardOpen

  // `svh`, not `vh`. `vh` is the LARGE viewport -- the height the page would
  // have with the browser's URL bar retracted -- and on a handheld it never
  // retracts here, because the shell is `overflow-hidden` and `document.body`
  // never scrolls. At 90vh on a 360x720 device the panel was 648px inside a
  // 664px VISIBLE area, i.e. flush to the millimetre, and `sm:p-6` on the
  // backdrop pushed it over. The footer is `shrink-0` outside the scrolling
  // body by design, so what overflowed was the row carrying Save. (F36)
  const panelClassName =
    `po-modal-in bg-white rounded-xl shadow-elevated border border-stone-200 ` +
    `w-full ${SIZE[size]} max-h-[90svh] flex flex-col overflow-hidden`

  const chrome = (
    <DialogChrome
      titleId={titleId}
      descriptionId={descriptionId}
      title={title}
      icon={icon}
      description={description}
      footer={typeof footer === 'function' ? footer({ requestClose: guard.requestClose }) : footer}
      bodyClassName={bodyClassName}
      onRequestClose={guard.requestClose}
    >
      {children}
    </DialogChrome>
  )

  return (
    <>
      <Overlay
        open={open}
        onRequestClose={guard.requestClose}
        dismissOnBackdrop={guarded && dismissOnBackdrop !== false}
        dismissOnEsc={guarded && dismissOnEsc !== false}
        onEntered={onEntered}
        containerClassName="flex items-center justify-center p-4 sm:p-6 bg-stone-900/60 backdrop-blur-sm ui-backdrop-in"
      >
        {onSubmit ? (
          <form
            onSubmit={onSubmit}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descriptionId : undefined}
            className={panelClassName}
          >
            {chrome}
          </form>
        ) : (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descriptionId : undefined}
            className={panelClassName}
          >
            {chrome}
          </div>
        )}
      </Overlay>

      <ConfirmDialog
        open={guard.discardOpen}
        title={discardConfirm?.title ?? 'Discard changes?'}
        message={discardConfirm?.message ?? 'Your unsaved changes will be lost.'}
        confirmLabel={discardConfirm?.confirmLabel ?? 'Discard'}
        tone="danger"
        onConfirm={guard.confirmDiscard}
        onCancel={guard.cancelDiscard}
      />
    </>
  )
}
