// The verdict, held just long enough for ScanField to react to it.
//
// The consumer is the only thing that knows whether a scan was any good — the
// field cannot tell a bin the task wanted from one three aisles away, and the
// gun's beep is identical for both. So the verdict travels back down as a prop,
// and this hook is the bookkeeping that makes a REPEATED verdict re-fire.
//
// Without the reset, scanning the wrong bin twice in a row would sound once:
// the prop would still read 'reject', ScanField's effect would not re-run, and
// the operator would take silence for acceptance. That is the exact failure
// this whole feedback path exists to remove, so it must not be reintroduced by
// the plumbing.

import { useCallback, useEffect, useRef, useState } from 'react'

export type ScanVerdict = 'ok' | 'reject'

/** Long enough for the effect to run and the ring to be seen; well under a scan cycle. */
const CLEAR_AFTER_MS = 500

export function useScanFlash(): {
  flash: ScanVerdict | null
  signal: (verdict: ScanVerdict) => void
} {
  const [flash, setFlash] = useState<ScanVerdict | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signal = useCallback((verdict: ScanVerdict) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    // Drop to null first so a second identical verdict is a real prop change
    // and not a no-op the effect never sees.
    setFlash(null)
    timerRef.current = setTimeout(() => {
      setFlash(verdict)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setFlash(null)
      }, CLEAR_AFTER_MS)
    }, 0)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  return { flash, signal }
}
