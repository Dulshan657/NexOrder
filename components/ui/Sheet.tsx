import { useId, type FormEvent, type ReactNode } from 'react'
import { Overlay } from './Overlay'
import { ConfirmDialog } from './ConfirmDialog'
import { DialogChrome, useDismissGuard } from './chrome'

// Right-hand slide-in panel; a bottom sheet on mobile. Same header/body/footer column
// as Modal, so it inherits the same overflow guarantee — and because it is pinned to
// the full viewport height rather than vertically centred, a tall form cannot clip
// its own header even in principle. Prefer this for long multi-section forms.

export type SheetWidth = 'md' | 'lg' | 'xl'

const WIDTH: Record<SheetWidth, string> = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
}

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  icon?: ReactNode
  description?: ReactNode
  width?: SheetWidth
  /** How the sheet presents below `sm`. */
  mobile?: 'bottom' | 'full'
  footer?: ReactNode
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  dirty?: boolean
  discardConfirm?: { title?: string; message?: string; confirmLabel?: string }
  dismissOnBackdrop?: boolean
  dismissOnEsc?: boolean
  onEntered?: () => void
  bodyClassName?: string
  children: ReactNode
}

export function Sheet({
  open,
  onClose,
  title,
  icon,
  description,
  width = 'lg',
  mobile = 'bottom',
  footer,
  onSubmit,
  dirty = false,
  discardConfirm,
  dismissOnBackdrop,
  dismissOnEsc,
  onEntered,
  bodyClassName,
  children,
}: SheetProps) {
  const titleId = useId()
  const guard = useDismissGuard(dirty, onClose)
  const guarded = !guard.discardOpen

  // Radius and slide direction flip at `sm:`, which Tailwind can't express here:
  // a `sm:` variant cannot be applied to a plain CSS class, and `sm:rounded-none`
  // colliding with `sm:rounded-l-2xl` is shorthand-vs-longhand roulette. `.ui-sheet-panel`
  // owns both in one deterministic media query (see index.css).
  const panelClassName =
    `bg-white shadow-elevated flex flex-col overflow-hidden w-full ${WIDTH[width]} ` +
    `ui-sheet-panel${mobile === 'full' ? ' ui-sheet-panel--full' : ''}`

  const chrome = (
    <DialogChrome
      titleId={titleId}
      title={title}
      icon={icon}
      description={description}
      footer={footer}
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
        containerClassName="flex justify-center items-end sm:justify-end sm:items-stretch bg-stone-900/60 backdrop-blur-sm ui-backdrop-in"
      >
        {onSubmit ? (
          <form
            onSubmit={onSubmit}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            className={panelClassName}
          >
            {chrome}
          </form>
        ) : (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
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
