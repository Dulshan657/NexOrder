// The app-wide UI primitives. Every overlay in NexOrder goes through Modal or Sheet;
// `scripts/check-overlays.mjs` fails CI on a raw `fixed inset-0` outside this folder.

export { Modal, type ModalProps, type ModalSize, type OverlayApi } from './Modal'
export { Sheet, type SheetProps, type SheetWidth } from './Sheet'
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog'
export { LoadingOverlay, type LoadingOverlayProps } from './LoadingOverlay'
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button'
export {
  Field,
  Input,
  NumberInput,
  Select,
  Textarea,
  inputClass,
  type FieldProps,
  type InputProps,
  type SelectProps,
  type TextareaProps,
} from './Field'
export { Toggle, type ToggleProps } from './Toggle'
export { ScanField, type ScanFieldProps } from './ScanField'
export { default as CreatableSelect, type CreatableSelectProps } from './CreatableSelect'
