// ScanField keeps the soft keyboard down on the scan gun.
//
// On the CipherLab RS35 the scan box holds focus permanently (autoFocus plus
// the refocus after every commit), so Android kept the on-screen keyboard up
// over half the screen while the gun did all the input. On the gun the box now
// renders `inputmode="none"` and a keyboard button brings the keyboard up on
// demand. Anywhere else — phone, tablet, desktop — nothing changes and there is
// no button.

import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { ScanField, type ScanFieldProps } from '@/components/ui/ScanField'
import { WEDGE_FLUSH_IDLE_MS } from '@/lib/scan/wedgeBuffer'
import {
  markScanGun,
  resetScanGunForTests,
  isScanGunModel,
} from '@/lib/scan/scanGunDevice'

function Host(props: Partial<ScanFieldProps> & { onScan?: (raw: string) => void }) {
  const [value, setValue] = useState('')
  return <ScanField ariaLabel="Scan" value={value} onChange={setValue} {...props} />
}

const field = () => screen.getByLabelText('Scan') as HTMLInputElement
const keyboardButton = () => screen.queryByRole('button', { name: /keyboard/i })

/** A wedge burst: one change event per character, machine-fast. */
function burst(text: string, gapMs = 5) {
  for (let i = 1; i <= text.length; i++) {
    fireEvent.change(field(), { target: { value: text.slice(0, i) } })
    act(() => { vi.advanceTimersByTime(gapMs) })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  let clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const advance = vi.advanceTimersByTime.bind(vi)
  vi.advanceTimersByTime = ((ms: number) => { clock += ms; return advance(ms) }) as any
  resetScanGunForTests()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetScanGunForTests()
})

describe('ScanField off the scan gun', () => {
  it('leaves the keyboard alone and shows no keyboard button', () => {
    render(<Host />)
    expect(field().getAttribute('inputmode')).toBeNull()
    expect(keyboardButton()).toBeNull()
  })
})

describe('ScanField on the scan gun', () => {
  beforeEach(() => { act(() => markScanGun()) })

  it('keeps the keyboard down by default', () => {
    render(<Host />)
    expect(field().getAttribute('inputmode')).toBe('none')
  })

  it('the keyboard button brings it up, and again puts it away', () => {
    render(<Host />)
    const button = keyboardButton()!
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(field().getAttribute('inputmode')).toBe('text')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(field())

    fireEvent.click(button)
    expect(field().getAttribute('inputmode')).toBe('none')
  })

  it('a committed code puts the keyboard away again', () => {
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)
    fireEvent.click(keyboardButton()!)
    fireEvent.change(field(), { target: { value: 'A' } })
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.change(field(), { target: { value: 'AB' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onScan).toHaveBeenCalledWith('AB')
    expect(field().getAttribute('inputmode')).toBe('none')
  })

  it('leaving the box puts the keyboard away', () => {
    render(<Host />)
    fireEvent.click(keyboardButton()!)
    fireEvent.blur(field())
    expect(field().getAttribute('inputmode')).toBe('none')
  })

  it('still commits Enter, Tab and suffix-less scans with the keyboard down', () => {
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)

    burst('MAIN-F01-R05')
    fireEvent.keyDown(field(), { key: 'Enter' })
    act(() => { vi.advanceTimersByTime(400) })

    burst('MAIN-F01-R06')
    fireEvent.keyDown(field(), { key: 'Tab' })
    act(() => { vi.advanceTimersByTime(400) })

    burst('MAIN-F01-R07')
    act(() => { vi.advanceTimersByTime(WEDGE_FLUSH_IDLE_MS + 20) })

    expect(onScan.mock.calls.map((c) => c[0])).toEqual([
      'MAIN-F01-R05', 'MAIN-F01-R06', 'MAIN-F01-R07',
    ])
  })

  it("softKeyboard='auto' opts a desk form out", () => {
    render(<Host softKeyboard="auto" />)
    expect(field().getAttribute('inputmode')).toBeNull()
    expect(keyboardButton()).toBeNull()
  })

  it('compact table cells are opted out', () => {
    render(<Host compact />)
    expect(field().getAttribute('inputmode')).toBeNull()
    expect(keyboardButton()).toBeNull()
  })
})

describe('recognising the scan gun', () => {
  it('learns the device is a gun from a machine-speed scan', () => {
    const onScan = vi.fn()
    render(<Host onScan={onScan} />)
    expect(keyboardButton()).toBeNull()

    burst('MAIN-F01-R05')
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(keyboardButton()).not.toBeNull()
    expect(field().getAttribute('inputmode')).toBe('none')
  })

  it('does not learn it from a person typing and pressing Enter', () => {
    render(<Host />)
    fireEvent.change(field(), { target: { value: 'A' } })
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.change(field(), { target: { value: 'AB' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(keyboardButton()).toBeNull()
  })

  it('remembers it across a reload', () => {
    act(() => markScanGun())
    resetScanGunForTests({ keepStorage: true })
    render(<Host />)
    expect(keyboardButton()).not.toBeNull()
  })

  it.each([
    ['RS35', true],
    ['CipherLab RS35', true],
    ['RS36', true],
    ['Pixel 7', false],
    ['SM-G991B', false],
    ['', false],
  ])('model %j is a gun: %s', (model, expected) => {
    expect(isScanGunModel(model)).toBe(expected)
  })
})
