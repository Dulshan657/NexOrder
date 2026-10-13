import React from 'react'
import { ConfirmDialog } from '@/components/ui'

// The soft low-stock warning a kitchen (QR Staff) is shown when it submits an
// order that may be short. See `lib/qr/mayBeShort.ts` for the test and
// `hooks/useShortStockGuard.tsx` for when this appears.
//
// NAMES ONLY. A kitchen has no Stock tab and is not meant to learn how much is on
// the shelf; the approver adjusts the order with the real numbers in front of
// them. So there is no quantity anywhere in this copy, and `shortStockCopy` takes
// nothing but names so it could not state one if it tried.
//
// "Send anyway" is the primary action: the warning is advice, not a gate. The
// quiet way out (Escape, backdrop, "Change order") sends nothing.

export interface ShortStockCopy {
  title: string
  message: string
}

export function shortStockCopy(names: readonly string[]): ShortStockCopy {
  const title = 'Some items may be short'
  if (names.length === 1) {
    return { title, message: `${names[0]} may be short. Send anyway — your manager will adjust it.` }
  }
  return {
    title,
    message: `These items may be short: ${names.join(', ')}. Send anyway — your manager will adjust them.`,
  }
}

export interface ShortStockConfirmProps {
  /** The products that may be short, by name. Never a count of stock. */
  names: readonly string[]
  onSendAnyway: () => void
  /** Close and send nothing: back to the order. */
  onChangeOrder: () => void
}

const ShortStockConfirm: React.FC<ShortStockConfirmProps> = ({ names, onSendAnyway, onChangeOrder }) => {
  const { title, message } = shortStockCopy(names)
  return (
    <ConfirmDialog
      open
      title={title}
      message={message}
      confirmLabel="Send anyway"
      cancelLabel="Change order"
      tone="primary"
      onConfirm={onSendAnyway}
      onCancel={onChangeOrder}
    />
  )
}

export default ShortStockConfirm
