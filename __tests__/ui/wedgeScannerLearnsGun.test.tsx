// NX-0044: a scan caught by the page-level wedge listener teaches the app that
// this device is a scan gun, exactly as a scan into a ScanField already does.
//
// On Receive Stock focus is often NOT in the scan box (a quantity cell, a date,
// or nothing at all), so on a gun whose model is not on the allow-list the only
// scans the app ever saw went through useWedgeScanner — and it never learned,
// leaving Android's soft keyboard up over half the screen.

import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { ScanField } from '@/components/ui/ScanField'
import { useWedgeScanner } from '@/lib/scan/useWedgeScanner'
import { resetScanGunForTests } from '@/lib/scan/scanGunDevice'

function Surface({ onScan }: { onScan: (code: string) => void }) {
  const [value, setValue] = useState('')
  useWedgeScanner({ active: true, onScan })
  return <ScanField ariaLabel="Scan" value={value} onChange={setValue} />
}

const keyboardButton = () => screen.queryByRole('button', { name: /keyboard/i })

/** A keydown at the document with a controlled timeStamp. */
function key(k: string, at: number) {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'timeStamp', { value: at })
  act(() => { document.dispatchEvent(event) })
}

function typeAt(text: string, startAt: number, gapMs: number): number {
  let at = startAt
  for (const ch of text) {
    key(ch, at)
    at += gapMs
  }
  return at
}

beforeEach(() => {
  resetScanGunForTests()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetScanGunForTests()
})

describe('useWedgeScanner and the scan gun', () => {
  it('a machine-speed scan outside the box marks the device as a gun', () => {
    const onScan = vi.fn()
    render(<Surface onScan={onScan} />)
    expect(keyboardButton()).toBeNull()

    const end = typeAt('4792082500139', 1000, 5)
    key('Enter', end)

    expect(onScan).toHaveBeenCalledWith('4792082500139')
    expect(keyboardButton()).not.toBeNull()
    expect((screen.getByLabelText('Scan') as HTMLInputElement).getAttribute('inputmode')).toBe('none')
  })

  it('a person typing outside the box does not', () => {
    const onScan = vi.fn()
    render(<Surface onScan={onScan} />)

    const end = typeAt('4792', 1000, 300)
    key('Enter', end + 300)

    expect(onScan).not.toHaveBeenCalled()
    expect(keyboardButton()).toBeNull()
  })
})
