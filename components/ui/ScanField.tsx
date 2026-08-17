// One code input, three ways in — the single touch point every scanning
// workflow reuses.
//
//   1. Typing, for when a label is torn or the camera won't focus.
//   2. A keyboard-wedge scanner gun, which types the code and then sends a
//      suffix. See below — this used to be assumed free and is not.
//   3. The device camera, opened on demand into a Sheet.
//
// The camera is deliberately behind a button rather than always-on: opening a
// camera without an explicit tap burns battery, trips iOS's gesture
// requirement, and looks alarming on a shared tablet.
//
// ── THE GUN PATH IS NOT FREE, AND THREE THINGS ARE LOAD-BEARING ─────────────
//
// This file used to carry a comment claiming a wedge gun "needs no code at all
// beyond handling Enter". That held only for a gun configured exactly one way,
// held by someone whose focus was already in the box. All three of the
// following are cases a real gun on a real desktop hits immediately:
//
//   * SUFFIX. Enter is the common default, but Tab is a factory default on
//     plenty of models and some ship with no suffix at all. Tab is handled here
//     alongside Enter; the no-suffix gun is handled by the idle flush, which
//     commits a fast run once it goes quiet.
//   * FOCUS. A committed scan refocuses the input, so the next scan lands
//     without a mouse. Without it every scan after the first needs a click, and
//     the characters of the one after that go to the body and vanish. The wider
//     recovery — a scan fired when nothing at all is focused — is
//     `lib/scan/useWedgeScanner.ts`.
//   * VERDICT. The gun's own beep means "I decoded a barcode", never "the app
//     accepted it". It sounds identical for the right bin and the wrong one, so
//     the app has to answer in its own voice.

import { useEffect, useId, useRef, useState } from 'react'
import { Camera, ScanLine, X } from 'lucide-react'
import { Sheet } from './Sheet'
import { inputClass } from './Field'
import { isCameraScanAvailable, useBarcodeScanner } from '@/lib/scan/useBarcodeScanner'
import { playScanAccept, playScanReject, prefersReducedMotion } from '@/lib/scan/scanFeedback'
import { WEDGE_FLUSH_IDLE_MS, WEDGE_MAX_INTERKEY_MS, WEDGE_MIN_SCAN_LENGTH } from '@/lib/scan/wedgeBuffer'

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
  /**
   * Return focus to the input after a commit and select what is in it, so the
   * next scan overwrites without a mouse. Default true.
   */
  refocusAfterScan?: boolean
  /**
   * Let a machine-speed Tab terminate a code. Default true. Pass false on a
   * long desk form, where swallowing Tab is an accessibility regression for a
   * gain nobody there needs.
   */
  tabCommits?: boolean
  /**
   * The CONSUMER's verdict on the last scan, which is the only place that knows
   * it. Drives a border pulse and the accept/reject tone.
   */
  flash?: 'ok' | 'reject' | null
  /** `<datalist>` id, for surfaces that offer a suggestion list. */
  listId?: string
  /** Table-cell variant: no camera button, tighter padding, no label row. */
  compact?: boolean
}

/**
 * The verdict as a border colour.
 *
 * Static ring rather than a keyframe animation, and the transition is dropped
 * under reduced motion — but the RING ITSELF always renders. Reduced motion
 * means less movement, not less information: for an operator who is deaf, or
 * who has muted the tones, or who is wearing ear defenders, this is the only
 * channel carrying the answer.
 */
function pulseClass(pulse: 'ok' | 'reject' | null): string {
  if (!pulse) return ''
  const ring = pulse === 'ok' ? 'ring-2 ring-emerald-400' : 'ring-2 ring-red-400'
  return prefersReducedMotion() ? ring : `${ring} transition-shadow duration-150`
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
  refocusAfterScan = true,
  tabCommits = true,
  flash = null,
  listId,
  compact = false,
}: ScanFieldProps) {
  const inputId = useId()
  const [cameraOpen, setCameraOpen] = useState(false)
  const [lastHit, setLastHit] = useState<string | null>(null)
  const [pulse, setPulse] = useState<'ok' | 'reject' | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cameraAvailable = isCameraScanAvailable() && !compact

  // Timing of the operator's own keystrokes in THIS field, used only to decide
  // whether a Tab was sent by a gun or pressed by a person, and to spot a gun
  // with no suffix at all. Refs, not state: a 13-character burst must not
  // re-render the page 13 times.
  const lastKeyAtRef = useRef(0)
  const machineRunRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const clearIdle = () => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    clearIdle()
    machineRunRef.current = false
    onChange(trimmed)
    onScan?.(trimmed)
    if (refocusAfterScan) {
      // Select rather than clear: the field cannot know whether the consumer
      // intends to keep the value, and a selected value is overwritten by the
      // next scan either way.
      inputRef.current?.focus()
      inputRef.current?.select()
    }
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

  // Focus comes back here when the camera closes. Sheet's focus trap restores
  // to the button that opened it; this runs after that and wins, so the next
  // scan does not need a click.
  const closeCamera = () => {
    setCameraOpen(false)
    if (refocusAfterScan) requestAnimationFrame(() => inputRef.current?.focus())
  }

  // The consumer decided. Pulse the border and say so out loud — the gun's own
  // beep sounds identical for a bin the task wanted and one three aisles away.
  useEffect(() => {
    if (!flash) return
    setPulse(flash)
    if (flash === 'ok') playScanAccept()
    else playScanReject()
    const timer = setTimeout(() => setPulse(null), 450)
    return () => clearTimeout(timer)
  }, [flash])

  useEffect(() => clearIdle, [])

  return (
    <div className={className}>
      {label && !compact && (
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
                return
              }

              if (e.key === 'Tab') {
                // Tab is a factory-default suffix on plenty of guns, and it used
                // to be dropped entirely. Only swallow it when the run that
                // preceded it was machine-speed, so a person tabbing out of the
                // field is never trapped. Shift+Tab is always a person.
                if (tabCommits && !e.shiftKey && machineRunRef.current
                    && value.trim().length >= WEDGE_MIN_SCAN_LENGTH) {
                  e.preventDefault()
                  commit(value)
                }
                return
              }

              if (e.key.length !== 1) return

              const gap = e.timeStamp - lastKeyAtRef.current
              machineRunRef.current = lastKeyAtRef.current > 0 && gap <= WEDGE_MAX_INTERKEY_MS
              lastKeyAtRef.current = e.timeStamp

              // The gun with no suffix at all: once the burst goes quiet, the
              // run is the code. Only ever armed for a machine-speed run, so
              // ordinary typing never self-commits.
              clearIdle()
              if (machineRunRef.current) {
                idleTimerRef.current = setTimeout(() => {
                  idleTimerRef.current = null
                  if (machineRunRef.current
                      && valueRef.current.trim().length >= WEDGE_MIN_SCAN_LENGTH) {
                    commit(valueRef.current)
                  }
                }, WEDGE_FLUSH_IDLE_MS)
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            list={listId}
            data-scan-field=""
            className={`${inputClass(!!error)} pl-9 font-mono ${compact ? 'py-1.5' : ''} ${pulseClass(pulse)}`}
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
        onClose={closeCamera}
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
