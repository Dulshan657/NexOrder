// ScanField under an Android IME, which is the CipherLab RS35's DEFAULT mode.
//
// ReaderConfig → Data Output → Keyboard Emulation ships as "Input Method". Under
// it Chrome reports every keydown as `key: 'Unidentified'` / `keyCode 229` and
// delivers the real text only as `input` events. The character timing therefore
// lives in `noteArrival` (driven by onChange), not in onKeyDown — these tests
// are what stop it drifting back.
//
// The other half is the duplicated-terminator guard: `Auto Enter` offers
// `CRLF Character`, and a committed value is left SELECTED rather than cleared,
// so without the guard a CR+LF pair commits the same code twice. On Receive
// Stock that adds the product line twice.

import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { ScanField } from '@/components/ui/ScanField'
import { WEDGE_FLUSH_IDLE_MS } from '@/lib/scan/wedgeBuffer'

/** Minimal controlled host, mirroring how every real consumer wires the field. */
function Host({ onScan }: { onScan: (raw: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <ScanField ariaLabel="Scan" value={value} onChange={setValue} onScan={onScan} />
  )
}

function field(): HTMLInputElement {
  return screen.getByLabelText('Scan') as HTMLInputElement
}

/**
 * Type a string the way an IME does: no useful keydown, one `input` event per
 * character, at a fixed pace.
 */
function imeType(text: string, gapMs: number) {
  const input = field()
  for (let i = 1; i <= text.length; i++) {
    // What Chrome actually reports for IME-composed input.
    fireEvent.keyDown(input, { key: 'Unidentified', keyCode: 229 })
    fireEvent.change(input, { target: { value: text.slice(0, i) } })
    act(() => { vi.advanceTimersByTime(gapMs) })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  // noteArrival falls back to performance.now() when a synthetic event reports
  // timeStamp 0, which is exactly what fireEvent produces.
  let clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.spyOn(globalThis, 'setTimeout')
  const advance = vi.advanceTimersByTime.bind(vi)
  vi.advanceTimersByTime = ((ms: number) => { clock += ms; return advance(ms) }) as any
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ScanField under IME-mode keyboard emulation', () => {
  it('commits a machine-speed burst with NO terminator at all', () => {
    // The no-suffix gun. Every keydown is Unidentified, so this can only work if
    // the timing is measured from onChange.
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    imeType('MAIN-F01-R05', 5)
    expect(onScan).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(WEDGE_FLUSH_IDLE_MS + 20) })
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith('MAIN-F01-R05')
  })

  it('does NOT self-commit the same characters typed at human pace', () => {
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    imeType('MAIN-F01-R05', 140)
    act(() => { vi.advanceTimersByTime(WEDGE_FLUSH_IDLE_MS + 500) })
    expect(onScan).not.toHaveBeenCalled()
  })

  it('treats a whole code arriving in one event as machine input', () => {
    // An IME committing the entire scan at once — the strongest signal there is
    // in this mode, and indistinguishable from a paste, which is fine.
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    fireEvent.keyDown(field(), { key: 'Unidentified', keyCode: 229 })
    fireEvent.change(field(), { target: { value: 'HU-000242' } })
    act(() => { vi.advanceTimersByTime(WEDGE_FLUSH_IDLE_MS + 20) })

    expect(onScan).toHaveBeenCalledWith('HU-000242')
  })

  it('still commits on Enter when the IME does send a real terminator', () => {
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    imeType('AYM-COC-001', 5)
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onScan).toHaveBeenCalledWith('AYM-COC-001')
  })
})

describe('duplicated terminator', () => {
  it('commits ONCE for a CRLF pair', () => {
    // ReaderConfig's `CRLF Character` option. Without the guard this fires
    // twice, and on Receive Stock that is two product lines for one carton.
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    imeType('9312000000012', 5)
    fireEvent.keyDown(field(), { key: 'Enter' })
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(onScan).toHaveBeenCalledTimes(1)
  })

  it('does not swallow a deliberate re-scan of the same code', () => {
    // The window is 250ms, sized only for a terminator pair. An operator
    // scanning the same bin twice — which is normal on a count — must land both.
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    imeType('MAIN-BLK-01', 5)
    fireEvent.keyDown(field(), { key: 'Enter' })

    act(() => { vi.advanceTimersByTime(1200) })

    fireEvent.change(field(), { target: { value: 'MAIN-BLK-01' } })
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(onScan).toHaveBeenCalledTimes(2)
  })

  it('never blocks a DIFFERENT code arriving immediately after', () => {
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    imeType('MAIN-F01-L08', 5)
    fireEvent.keyDown(field(), { key: 'Enter' })
    fireEvent.change(field(), { target: { value: 'MAIN-F01-R05' } })
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(onScan).toHaveBeenCalledTimes(2)
    expect(onScan).toHaveBeenLastCalledWith('MAIN-F01-R05')
  })
})
