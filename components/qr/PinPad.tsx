import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Delete } from 'lucide-react'

// The kitchen's PIN pad: masked dots, a big numeric keypad, and a hidden real
// input behind it.
//
// Built for a phone held in one gloved hand at a stainless-steel bench:
//   - keys are 56px tall (the 44px WCAG floor with room to spare) and
//     `touch-manipulation`, so a double-tap on a key never zooms the page;
//   - the OS keyboard is NEVER summoned. The visible keypad is the input. A real
//     keyboard would cover half of a 360x720 screen and push the keys we drew
//     behind it;
//   - a physical keyboard still works (digits, Backspace, Enter), for the desktop
//     and tablet case;
//   - the hidden `<input>` is the accessible way in: a screen-reader user tabs to
//     it and types, and it is where `aria-describedby` hangs. It is masked
//     (`type=password`) and told not to autofill -- this is a PIN, not a login.
//
// The pad never shows an attempt count and never clears itself on a failure the
// PARENT did not report: `onSubmit` resolving `false` means "that was wrong,
// empty the pad". Anything else (true, undefined) leaves it for the caller to
// unmount, which is what a successful unlock does.

export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 6

export interface PinPadProps {
  /** Resolve `false` to empty the pad (wrong PIN); anything else leaves it. */
  onSubmit: (pin: string) => Promise<boolean | void> | boolean | void
  /** An attempt is in flight: keys and the button are inert. */
  busy?: boolean
  /** The code is locked: keys and the button are inert. */
  disabled?: boolean
  /** The last failure, already worded for a person. Announced assertively. */
  error?: string | null
  minLength?: number
  maxLength?: number
  submitLabel?: string
  busyLabel?: string
  /** Accessible name of the hidden input and the keypad group. */
  label?: string
}

const DIGIT_ROWS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

const KEY_CLASS =
  'touch-target touch-manipulation btn-press flex h-14 items-center justify-center rounded-xl ' +
  'border border-stone-300 bg-white font-semibold text-stone-900 shadow-sm transition-colors ' +
  'hover:bg-stone-100 active:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-50 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2'

const onlyDigits = (value: string, max: number): string => value.replace(/\D/g, '').slice(0, max)

const isTypingTarget = (el: EventTarget | null, ownInput: HTMLInputElement | null): boolean => {
  if (!(el instanceof HTMLElement)) return false
  if (ownInput && el === ownInput) return true
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

const PinPad: React.FC<PinPadProps> = ({
  onSubmit,
  busy = false,
  disabled = false,
  error = null,
  minLength = PIN_MIN_LENGTH,
  maxLength = PIN_MAX_LENGTH,
  submitLabel = 'Unlock',
  busyLabel = 'Unlocking…',
  label = 'Staff PIN',
}) => {
  const [digits, setDigits] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const statusId = useId()
  const errorId = useId()

  const inert = busy || disabled
  const canSubmit = !inert && digits.length >= minLength

  const addDigit = useCallback(
    (d: string) => setDigits((prev) => (prev.length >= maxLength ? prev : prev + d)),
    [maxLength],
  )
  const backspace = useCallback(() => setDigits((prev) => prev.slice(0, -1)), [])
  const clear = useCallback(() => setDigits(''), [])

  const submit = useCallback(async () => {
    if (!canSubmit) return
    const result = await onSubmit(digits)
    if (result === false) setDigits('')
  }, [canSubmit, digits, onSubmit])

  // The window listener reads through refs so it subscribes once, not per keystroke.
  const submitRef = useRef(submit)
  const inertRef = useRef(inert)
  useEffect(() => {
    submitRef.current = submit
    inertRef.current = inert
  }, [submit, inert])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || inertRef.current) return
      // The hidden input (and any other field) handles its own typing.
      if (isTypingTarget(e.target, inputRef.current)) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        addDigit(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        backspace()
      } else if (e.key === 'Enter') {
        // On a focused button Enter already means "press it".
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return
        e.preventDefault()
        void submitRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addDigit, backspace])

  const count = digits.length
  const status = count === 0 ? 'No digits entered' : `${count} digit${count === 1 ? '' : 's'} entered`

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      noValidate
      className="w-full"
    >
      <input
        ref={inputRef}
        id={inputId}
        aria-label={`${label} (${minLength} to ${maxLength} digits)`}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        maxLength={maxLength}
        value={digits}
        disabled={inert}
        onChange={(e) => setDigits(onlyDigits(e.target.value, maxLength))}
        aria-describedby={error ? errorId : statusId}
        aria-invalid={error ? true : undefined}
        className="sr-only"
      />

      {/* Decorative: the count is announced through the status line instead. */}
      <div aria-hidden="true" className="mb-2 flex h-6 items-center justify-center gap-3">
        {Array.from({ length: maxLength }, (_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full border-2 transition-colors ${
              i < count ? 'border-stone-900 bg-stone-900' : 'border-stone-500 bg-transparent'
            }`}
          />
        ))}
      </div>
      <p id={statusId} aria-live="polite" className="sr-only">
        {status}
      </p>

      <div
        id={errorId}
        aria-live="assertive"
        aria-atomic="true"
        className="mb-4 min-h-[1.5rem] text-center text-sm font-medium text-red-700"
      >
        {error ?? ''}
      </div>

      <div role="group" aria-label={`${label} keypad`} className="mx-auto grid w-full max-w-[280px] grid-cols-3 gap-3">
        {DIGIT_ROWS.flat().map((d) => (
          <button key={d} type="button" disabled={inert} onClick={() => addDigit(d)} className={`${KEY_CLASS} text-xl`}>
            {d}
          </button>
        ))}
        <button
          type="button"
          disabled={inert || count === 0}
          onClick={clear}
          aria-label="Clear PIN"
          className={`${KEY_CLASS} text-sm`}
        >
          Clear
        </button>
        <button type="button" disabled={inert} onClick={() => addDigit('0')} className={`${KEY_CLASS} text-xl`}>
          0
        </button>
        <button
          type="button"
          disabled={inert || count === 0}
          onClick={backspace}
          aria-label="Delete last digit"
          className={KEY_CLASS}
        >
          <Delete className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="touch-target mx-auto mt-5 flex h-12 w-full max-w-[280px] items-center justify-center rounded-xl bg-nexgen-blue-dark px-4 text-base font-semibold text-white shadow-sm transition-colors btn-press hover:bg-nexgen-navy disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-nexgen-blue-dark focus-visible:ring-offset-2"
      >
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  )
}

export default PinPad
