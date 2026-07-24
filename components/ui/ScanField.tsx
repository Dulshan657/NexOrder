// One code input, three ways in — the single touch point every scanning
// workflow reuses.
//
//   1. Typing, for when a label is torn or the camera won't focus.
//   2. A keyboard-wedge scanner gun, which types the code and presses Enter.
//      This needs no code at all beyond handling Enter — which is why the gun
//      path costs nothing and is supported everywhere for free.
//   3. The device camera, opened on demand into a Sheet.
//
// The camera is deliberately behind a button rather than always-on: opening a
// camera without an explicit tap burns battery, trips iOS's gesture
// requirement, and looks alarming on a shared tablet.

import { useId, useRef, useState } from 'react'
import { Camera, ScanLine, X } from 'lucide-react'
import { Sheet } from './Sheet'
import { inputClass } from './Field'
import { isCameraScanAvailable, useBarcodeScanner } from '@/lib/scan/useBarcodeScanner'

export interface ScanFieldProps {
  value: string
  onChange: (value: string) => void
  /**
   * A code was committed — camera decode, Enter key, or wedge gun. Distinct
   * from onChange, which fires per keystroke: only onScan means "the operator
   * is telling you this is the whole code".
   */
  onScan?: (raw: string) => void
  label?: string
  placeholder?: string
  helper?: string
  error?: string
  disabled?: boolean
  autoFocus?: boolean
  /** Heading shown above the camera preview. */
  cameraTitle?: string
  /** Keep the camera open after a hit, for scanning several items in a row. */
  continuous?: boolean
  className?: string
}

export function ScanField({
  value,
  onChange,
  onScan,
  label,
  placeholder = 'Scan or type a code',
  helper,
  error,
  disabled,
  autoFocus,
  cameraTitle = 'Scan a code',
  continuous = false,
  className = '',
}: ScanFieldProps) {
  const inputId = useId()
  const [cameraOpen, setCameraOpen] = useState(false)
  const [lastHit, setLastHit] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cameraAvailable = isCameraScanAvailable()

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    onChange(trimmed)
    onScan?.(trimmed)
  }

  const { videoRef, state, error: cameraError, resetRepeatGuard } = useBarcodeScanner({
    active: cameraOpen,
    onDecode: (raw) => {
      commit(raw)
      setLastHit(raw)
      if (!continuous) setCameraOpen(false)
    },
  })

  const openCamera = () => {
    setLastHit(null)
    resetRepeatGuard()
    setCameraOpen(true)
  }

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="block text-xs font-semibold text-stone-600 mb-1.5">
          {label}
        </label>
      )}

      <div className="flex items-stretch gap-2">
        <div className="relative flex-1 min-w-0">
          <ScanLine
            className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id={inputId}
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // A wedge gun's terminating Enter must never submit the
              // surrounding form — it means "code finished", not "save".
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(value)
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={`${inputClass(!!error)} pl-9 font-mono`}
            aria-invalid={error ? true : undefined}
          />
        </div>

        {cameraAvailable && (
          <button
            type="button"
            onClick={openCamera}
            disabled={disabled}
            // 44px min touch target: this button gets pressed with a gloved
            // thumb at a rack face, not a mouse.
            className="shrink-0 inline-flex items-center justify-center gap-1.5 min-w-[44px] px-3 rounded-lg border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 btn-press disabled:opacity-40"
            aria-label="Scan with camera"
          >
            <Camera className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {error ? (
        <p className="text-xs text-red-600 mt-1.5" role="alert">
          {error}
        </p>
      ) : helper ? (
        <p className="text-xs text-stone-400 mt-1.5">{helper}</p>
      ) : null}

      <Sheet
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        width="md"
        mobile="bottom"
        icon={<Camera className="w-5 h-5 text-nexgen-blue" />}
        title={cameraTitle}
        description="Hold the label steady inside the frame."
        footer={({ requestClose }) => (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={requestClose}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-stone-200 text-stone-600 btn-press"
            >
              <X className="w-4 h-4" aria-hidden="true" /> Close
            </button>
            {continuous && lastHit && (
              <span className="text-xs text-emerald-700 font-mono truncate">Last: {lastHit}</span>
            )}
          </div>
        )}
      >
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden bg-stone-900 aspect-[4/3]">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              aria-label="Camera preview"
            />
            {/* Reticle: purely a framing aid, the decoder reads the whole frame. */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-3/5 aspect-square rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            {state !== 'scanning' && (
              <div className="absolute inset-0 flex items-center justify-center bg-stone-900/70 px-6 text-center">
                <p className="text-sm text-white/90">
                  {state === 'error' ? cameraError : 'Starting the camera…'}
                </p>
              </div>
            )}
          </div>

          {state === 'error' && (
            <p className="text-xs text-stone-500">
              Close this and type the code instead — every scan field accepts a typed code.
            </p>
          )}
        </div>
      </Sheet>
    </div>
  )
}
