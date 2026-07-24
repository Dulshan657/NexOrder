// Camera barcode/QR scanning, one hook, two engines.
//
// Chrome on Android ships a native `BarcodeDetector` that decodes QR and EAN in
// C++ for free. Safari/iOS ships nothing. Rather than pick one, this
// feature-detects and falls back to @zxing/browser, which is **dynamically
// imported** so its ~300 KB never enters the main bundle for the majority of
// the app that never scans anything.
//
// Both engines are hidden behind one `FrameDecoder` interface and this hook owns
// the MediaStream in both cases (zxing's own decodeFromVideoDevice would open a
// second stream it controls, which is how you end up with two camera tracks and
// an LED that stays on after the sheet closes).

import { useCallback, useEffect, useRef, useState } from 'react'

export type ScannerState = 'idle' | 'starting' | 'scanning' | 'error'

/** Formats worth decoding here: our own QR labels plus retail/carton barcodes. */
const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] as const

/** How long the same code is ignored after a hit. One label sits in frame for
 *  many consecutive frames; without this a single scan fires ~5×/second. */
const DEFAULT_REPEAT_DELAY_MS = 1500

/** Gap between decode attempts. Fast enough to feel instant, slow enough that
 *  the zxing canvas path doesn't peg a mid-range phone's CPU. */
const FRAME_INTERVAL_MS = 180

interface FrameDecoder {
  detect: (video: HTMLVideoElement) => Promise<string[]>
  dispose: () => void
}

/** True when this browser can even attempt a camera scan. */
export function isCameraScanAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

async function createDecoder(): Promise<FrameDecoder> {
  const NativeDetector = (globalThis as any).BarcodeDetector

  if (NativeDetector) {
    try {
      // Passing an unsupported format makes the constructor throw, so ask first
      // and request only the intersection.
      const supported: string[] = (await NativeDetector.getSupportedFormats?.()) ?? []
      const formats = FORMATS.filter((f) => supported.includes(f))
      if (formats.length > 0) {
        const detector = new NativeDetector({ formats })
        return {
          detect: async (video) => {
            const found = await detector.detect(video)
            return (found ?? []).map((b: any) => b?.rawValue).filter(Boolean)
          },
          dispose: () => {},
        }
      }
    } catch {
      // Fall through to zxing — a broken native detector is not worth debugging
      // on someone else's device when we have a working fallback.
    }
  }

  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const reader = new BrowserMultiFormatReader()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  return {
    detect: async (video) => {
      if (!ctx || !video.videoWidth || !video.videoHeight) return []
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        const result = reader.decodeFromCanvas(canvas)
        const text = result?.getText()
        return text ? [text] : []
      } catch {
        // zxing throws NotFoundException on every frame that holds no code —
        // i.e. almost all of them. Not an error condition.
        return []
      }
    },
    dispose: () => canvas.remove(),
  }
}

function describeCameraError(err: unknown): string {
  const name = (err as { name?: string })?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Allow camera access for this site, then try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera found on this device. You can still type the code.'
    case 'NotReadableError':
      return 'The camera is in use by another app. Close it and try again.'
    case 'OverconstrainedError':
      return 'No suitable camera on this device. You can still type the code.'
    default:
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        return 'Camera scanning needs a secure (https) connection.'
      }
      return err instanceof Error ? err.message : 'Could not start the camera.'
  }
}

export interface UseBarcodeScannerOptions {
  /** Camera runs only while this is true. Flip it false to release the device. */
  active: boolean
  onDecode: (raw: string) => void
  repeatDelayMs?: number
}

export interface UseBarcodeScannerResult {
  /** Structural, not React.RefObject: this repo ships no @types/react, so the
   *  React namespace does not exist at type level (see CLAUDE.md). */
  videoRef: { current: HTMLVideoElement | null }
  state: ScannerState
  error: string | null
  /** Clears the repeat-suppression window so the same label can be re-scanned. */
  resetRepeatGuard: () => void
}

export function useBarcodeScanner({
  active,
  onDecode,
  repeatDelayMs = DEFAULT_REPEAT_DELAY_MS,
}: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [state, setState] = useState<ScannerState>('idle')
  const [error, setError] = useState<string | null>(null)

  // onDecode is almost always an inline arrow from the caller. Holding it in a
  // ref keeps it out of the effect's dependency list, so a parent re-render
  // cannot tear down and reopen the camera mid-scan.
  const onDecodeRef = useRef(onDecode)
  useEffect(() => {
    onDecodeRef.current = onDecode
  }, [onDecode])

  const lastHitRef = useRef<{ code: string; at: number } | null>(null)

  const resetRepeatGuard = useCallback(() => {
    lastHitRef.current = null
  }, [])

  useEffect(() => {
    if (!active) {
      setState('idle')
      setError(null)
      return
    }

    // `cancelled` guards every await boundary below: the sheet can close (or the
    // component unmount) while getUserMedia or the dynamic import is still in
    // flight, and resuming afterwards would attach a live stream to a detached
    // video element and leak the track.
    let cancelled = false
    let stream: MediaStream | null = null
    let decoder: FrameDecoder | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const stop = () => {
      if (timer) clearTimeout(timer)
      timer = null
      decoder?.dispose()
      decoder = null
      for (const track of stream?.getTracks() ?? []) track.stop()
      stream = null
      const video = videoRef.current
      if (video) video.srcObject = null
    }

    const tick = async () => {
      if (cancelled || !decoder) return
      const video = videoRef.current
      if (video && video.readyState >= 2) {
        try {
          const codes = await decoder.detect(video)
          if (cancelled) return
          const code = codes.find(Boolean)
          if (code) {
            const now = Date.now()
            const last = lastHitRef.current
            const isRepeat = last && last.code === code && now - last.at < repeatDelayMs
            if (!isRepeat) {
              lastHitRef.current = { code, at: now }
              onDecodeRef.current(code)
            }
          }
        } catch {
          // A single bad frame is not a reason to kill the session.
        }
      }
      if (!cancelled) timer = setTimeout(tick, FRAME_INTERVAL_MS)
    }

    const start = async () => {
      setState('starting')
      setError(null)
      try {
        if (!isCameraScanAvailable()) {
          throw new Error('This browser cannot open a camera. You can still type the code.')
        }
        // `environment` = rear camera. `ideal`, not `exact`, so a laptop with
        // only a front camera still works instead of OverconstrainedError.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) return stop()

        const video = videoRef.current
        if (!video) return stop()
        video.srcObject = stream
        // Required by iOS Safari, which otherwise takes the video fullscreen.
        video.setAttribute('playsinline', 'true')
        video.muted = true
        await video.play()
        if (cancelled) return stop()

        decoder = await createDecoder()
        if (cancelled) return stop()

        setState('scanning')
        void tick()
      } catch (err) {
        if (cancelled) return stop()
        stop()
        setError(describeCameraError(err))
        setState('error')
      }
    }

    void start()

    return () => {
      cancelled = true
      stop()
    }
  }, [active, repeatDelayMs])

  return { videoRef, state, error, resetRepeatGuard }
}
