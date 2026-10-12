// A PIN input with a show/hide toggle. The manager is typing someone else's PIN,
// often with a colleague standing nearby, so it starts hidden.

import { useState } from 'react'
import { Field, Input } from '@/components/ui'
import { QR_PIN_MAX_LENGTH, sanitizePinInput } from '@/lib/qr/pinForm'

export interface QrPinFieldProps {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  onBlur?: () => void
  /** Shown under the field in red. */
  error?: string | null
  helper?: string
  autoFocus?: boolean
}

export default function QrPinField({ id, label, value, onChange, onBlur, error, helper, autoFocus }: QrPinFieldProps) {
  const [shown, setShown] = useState(false)

  return (
    <Field label={label} htmlFor={id} error={error ?? undefined} helper={helper}>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={shown ? 'text' : 'password'}
          inputMode="numeric"
          autoComplete="off"
          // Opt out of password managers: this is a PIN the manager chose for someone
          // else, and must not end up saved in the manager's own vault.
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          autoFocus={autoFocus}
          maxLength={QR_PIN_MAX_LENGTH}
          value={value}
          invalid={Boolean(error)}
          onChange={(e) => onChange(sanitizePinInput(e.target.value))}
          onBlur={onBlur}
          className="pr-16"
        />
        <button
          type="button"
          aria-pressed={shown}
          aria-label={shown ? 'Hide PIN' : 'Show PIN'}
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-nexgen-blue-dark hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark rounded-r-lg"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
    </Field>
  )
}
