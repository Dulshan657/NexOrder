// The field that goes inside the scan dock.
//
// Separate from the panel because the dock and the results are siblings, not
// parent and child — see `useStockLookup`'s header for why that matters.

import React from 'react'
import { ScanField } from '@/components/ui'
import { useWedgeScanner } from '@/lib/scan/useWedgeScanner'
import type { ScanVerdict } from '@/lib/scan/useScanFlash'

export interface LookupScanFieldProps {
  value: string
  onChange: (v: string) => void
  onScan: (raw: string) => void
  flash: ScanVerdict | null
}

export function LookupScanField({ value, onChange, onScan, flash }: LookupScanFieldProps) {
  // Desktop safety net ONLY, and worth saying plainly: on the RS35 under its
  // default Input Method mode this catches nothing — an Android IME types into
  // the focused editable and nowhere else, so with nothing focused there are no
  // characters to hear. That is exactly why the dock exists. It stands down
  // while focus is in an input, so it cannot double-commit against ScanField.
  useWedgeScanner({ active: true, onScan })

  return (
    <ScanField
      value={value}
      onChange={onChange}
      onScan={onScan}
      ariaLabel="Scan or type a product, bin or pallet code"
      placeholder="Scan a product, bin or pallet"
      cameraTitle="Scan a code"
      flash={flash}
      // NOT `compact`: that variant drops the camera button and the 44px floor,
      // which is a table-cell trade, not a dock one. This is the control a
      // gloved thumb aims at.
      //
      // `autoFocus` is load-bearing rather than a convenience. Under the RS35's
      // default Input Method mode the gun types into the focused editable and
      // nowhere else, so an unfocused field means a scan that silently does not
      // happen — the operator hears the beep and sees nothing. `index.html`'s
      // `interactive-widget=resizes-content` is what keeps the soft keyboard
      // from covering the dock it just opened.
      autoFocus
    />
  )
}

export default LookupScanField
