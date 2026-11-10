// The scan-gun keyboard, as the operator meets it, with no knowledge of how
// the gun is recognised: a fresh device, a first scan, then the keyboard
// button. Deliberately imports nothing but ScanField, so on code without the
// feature it fails by ASSERTION (no button, keyboard not held down) rather
// than by a missing module — see docs/claude/briefs.md, "Proven-by-absence".

import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { ScanField } from '@/components/ui/ScanField'

function Host({ onScan }: { onScan: (raw: string) => void }) {
  const [value, setValue] = useState('')
  return <ScanField ariaLabel="Scan" value={value} onChange={setValue} onScan={onScan} />
}

const field = () => screen.getByLabelText('Scan') as HTMLInputElement
const keyboardButton = () => screen.queryByRole('button', { name: /keyboard/i })

beforeEach(() => {
  vi.useFakeTimers()
  let clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const advance = vi.advanceTimersByTime.bind(vi)
  vi.advanceTimersByTime = ((ms: number) => { clock += ms; return advance(ms) }) as any
  try { localStorage.clear() } catch { /* storage unavailable */ }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ScanField scan-gun journey', () => {
  it('a gun scan holds the keyboard down, the button brings it up, a typed code puts it away', () => {
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    // A gun burst ending in Enter.
    const code = 'MAIN-F01-R05'
    for (let i = 1; i <= code.length; i++) {
      fireEvent.change(field(), { target: { value: code.slice(0, i) } })
      act(() => { vi.advanceTimersByTime(5) })
    }
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onScan).toHaveBeenLastCalledWith(code)

    // Now known to be a gun: keyboard down, button offered.
    expect(field().getAttribute('inputmode')).toBe('none')
    const button = keyboardButton()
    expect(button).not.toBeNull()

    // Torn label: bring the keyboard up and type.
    fireEvent.click(button!)
    expect(field().getAttribute('inputmode')).toBe('text')
    fireEvent.change(field(), { target: { value: 'B' } })
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.change(field(), { target: { value: 'B2' } })
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(onScan).toHaveBeenLastCalledWith('B2')
    expect(field().getAttribute('inputmode')).toBe('none')
  })
})
