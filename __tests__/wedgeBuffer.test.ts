// The only thing standing between a scanner gun and a person is the timing in
// `wedgeBuffer.ts`, and it has no other signal to work with. These tests drive
// it with plain objects — no DOM — so every branch is reachable directly.

import { describe, it, expect } from 'vitest'
import {
  emptyWedgeBuffer,
  feedWedgeKey,
  flushWedgeBuffer,
  wedgeBufferIsIdle,
  WEDGE_FLUSH_IDLE_MS,
  WEDGE_MAX_INTERKEY_MS,
  WEDGE_MAX_SCAN_LENGTH,
  WEDGE_MIN_SCAN_LENGTH,
  type WedgeBuffer,
  type WedgeKey,
  type WedgeOutcome,
} from '@/lib/scan/wedgeBuffer'

/** Feed a string one character at a time with a fixed gap between each. */
function type(
  text: string,
  gapMs: number,
  start = 1000,
  buffer: WedgeBuffer = emptyWedgeBuffer,
): { buffer: WedgeBuffer; at: number; outcomes: WedgeOutcome[] } {
  let at = start
  let current = buffer
  const outcomes: WedgeOutcome[] = []
  for (const ch of text) {
    const step = feedWedgeKey(current, { key: ch, timeStamp: at })
    current = step.next
    outcomes.push(step.outcome)
    at += gapMs
  }
  return { buffer: current, at, outcomes }
}

function press(buffer: WedgeBuffer, key: string, at: number, extra: Partial<WedgeKey> = {}) {
  return feedWedgeKey(buffer, { key, timeStamp: at, ...extra })
}

const GUN_GAP = 5
const HUMAN_GAP = 140

describe('feedWedgeKey — a gun burst', () => {
  it('commits a location code terminated by Enter', () => {
    const { buffer, at } = type('MAIN-F01-R05', GUN_GAP)
    const step = press(buffer, 'Enter', at)
    expect(step.outcome).toEqual({ action: 'commit', code: 'MAIN-F01-R05', via: 'enter' })
    expect(step.next).toEqual(emptyWedgeBuffer)
  })

  it('commits a code terminated by Tab — the suffix that used to be dropped entirely', () => {
    const { buffer, at } = type('HU-000242', GUN_GAP)
    const step = press(buffer, 'Tab', at)
    expect(step.outcome).toEqual({ action: 'commit', code: 'HU-000242', via: 'tab' })
  })

  it('keeps a run alive across the Shift that precedes every capital', () => {
    // A gun sending "Ab" emits Shift, A, b. Abandoning on Shift would break
    // every mixed-case code in the system.
    let buffer = emptyWedgeBuffer
    let at = 1000
    for (const key of ['Shift', 'A', 'Shift', 'B', 'C', 'D']) {
      const step = press(buffer, key, at)
      buffer = step.next
      if (key !== 'Shift') at += GUN_GAP
    }
    expect(press(buffer, 'Enter', at).outcome).toEqual({
      action: 'commit',
      code: 'ABCD',
      via: 'enter',
    })
  })

  it('does not treat a bare Shift as a character', () => {
    const step = press(emptyWedgeBuffer, 'Shift', 1000)
    expect(step.outcome).toEqual({ action: 'ignore' })
    expect(step.next).toEqual(emptyWedgeBuffer)
  })

  it('accepts a burst at the exact threshold', () => {
    const { buffer, at } = type('ABCDEF', WEDGE_MAX_INTERKEY_MS)
    expect(press(buffer, 'Enter', at).outcome).toMatchObject({ action: 'commit', code: 'ABCDEF' })
  })

  it('carries digits through Set-C-shaped codes unchanged', () => {
    const { buffer, at } = type('9312345678907', GUN_GAP)
    expect(press(buffer, 'Enter', at).outcome).toMatchObject({ code: '9312345678907' })
  })
})

describe('feedWedgeKey — a person at the keyboard', () => {
  it('does not commit ordinary typing followed by Enter', () => {
    const { buffer, at } = type('MAIN', HUMAN_GAP)
    // Every gap restarted the run, so only the final character survives.
    expect(buffer.chars).toEqual(['N'])
    expect(press(buffer, 'Enter', at).outcome).toEqual({ action: 'discard', reason: 'too-short' })
  })

  it('refuses a fast burst that is then terminated slowly', () => {
    // Four fast characters and a considered reach for Enter is a person, not a
    // gun: the terminator has to be part of the same burst.
    const { buffer, at } = type('ABCD', GUN_GAP)
    const step = press(buffer, 'Enter', at + 400)
    expect(step.outcome).toEqual({ action: 'discard', reason: 'too-short' })
  })

  it('rejects a gap one millisecond over the threshold', () => {
    const { buffer, at } = type('ABCD', WEDGE_MAX_INTERKEY_MS + 1)
    expect(buffer.chars).toEqual(['D'])
    expect(press(buffer, 'Enter', at).outcome).toEqual({ action: 'discard', reason: 'too-short' })
  })

  it('abandons the run on a modifier shortcut', () => {
    const { buffer, at } = type('ABCD', GUN_GAP)
    const step = press(buffer, 'c', at, { ctrlKey: true })
    expect(step.outcome).toEqual({ action: 'discard', reason: 'modifier' })
    expect(step.next).toEqual(emptyWedgeBuffer)
  })

  it('abandons on Cmd as well as Ctrl', () => {
    const { buffer, at } = type('ABCD', GUN_GAP)
    expect(press(buffer, 'v', at, { metaKey: true }).outcome).toMatchObject({ reason: 'modifier' })
  })

  it('still buffers AltGr characters — ctrl+alt is how Windows reports it', () => {
    const { buffer, at } = type('ABC', GUN_GAP)
    const step = press(buffer, 'E', at, { ctrlKey: true, altKey: true, altGraph: true })
    expect(step.outcome).toMatchObject({ action: 'buffered' })
    expect(step.next.chars).toEqual(['A', 'B', 'C', 'E'])
  })

  it('abandons on an editing or navigation key', () => {
    const { buffer, at } = type('ABCD', GUN_GAP)
    for (const key of ['Backspace', 'Escape', 'ArrowLeft', 'F5', 'Delete', 'Home']) {
      const step = press(buffer, key, at)
      expect(step.outcome).toEqual({ action: 'discard', reason: 'control-key' })
      expect(step.next).toEqual(emptyWedgeBuffer)
    }
  })

  it('discards a terminator pressed with nothing buffered', () => {
    expect(press(emptyWedgeBuffer, 'Enter', 1000).outcome).toEqual({
      action: 'discard',
      reason: 'too-short',
    })
  })
})

describe('feedWedgeKey — run boundaries', () => {
  it('restarts rather than discards after a slow gap, so a scan can follow typing', () => {
    const typed = type('hello', HUMAN_GAP)
    const scanned = type('MAIN-BLK-01', GUN_GAP, typed.at + 900, typed.buffer)
    expect(press(scanned.buffer, 'Enter', scanned.at).outcome).toMatchObject({
      action: 'commit',
      code: 'MAIN-BLK-01',
    })
  })

  it('keeps only the tail when a burst is interrupted mid-way', () => {
    const first = type('AB', GUN_GAP)
    const second = type('CD', GUN_GAP, first.at + 500, first.buffer)
    expect(second.buffer.chars).toEqual(['C', 'D'])
  })

  it('refuses a run one character below the minimum', () => {
    const short = 'X'.repeat(WEDGE_MIN_SCAN_LENGTH - 1)
    const { buffer, at } = type(short, GUN_GAP)
    expect(press(buffer, 'Enter', at).outcome).toEqual({ action: 'discard', reason: 'too-short' })
  })

  it('accepts a run at exactly the minimum', () => {
    const exact = 'Y'.repeat(WEDGE_MIN_SCAN_LENGTH)
    const { buffer, at } = type(exact, GUN_GAP)
    expect(press(buffer, 'Enter', at).outcome).toMatchObject({ action: 'commit', code: exact })
  })

  it('claims from the second character on, never the first', () => {
    // The first character of a run cannot be known to belong to a burst, and
    // swallowing it would break find-as-you-type and every keyboard shortcut.
    const first = press(emptyWedgeBuffer, 'M', 1000)
    expect(first.outcome).toEqual({ action: 'buffered', claim: false })
    const second = press(first.next, 'A', 1000 + GUN_GAP)
    expect(second.outcome).toEqual({ action: 'buffered', claim: true })
  })

  it('claims a mid-burst space, which would otherwise press a focused button', () => {
    const { buffer, at } = type('AB', GUN_GAP)
    expect(press(buffer, ' ', at).outcome).toEqual({ action: 'buffered', claim: true })
  })

  it('discards a run past the maximum rather than truncating it', () => {
    // Half a location code is a different, possibly real, location.
    const { buffer, at } = type('Z'.repeat(WEDGE_MAX_SCAN_LENGTH), GUN_GAP)
    expect(buffer.chars).toHaveLength(WEDGE_MAX_SCAN_LENGTH)
    const step = press(buffer, 'Z', at)
    expect(step.outcome).toEqual({ action: 'discard', reason: 'too-long' })
    expect(step.next).toEqual(emptyWedgeBuffer)
  })

  it('abandons on a character Code 128 Set B could never have printed', () => {
    const { buffer, at } = type('ABC', GUN_GAP)
    for (const key of ['é', 'Ω', '£']) {
      expect(press(buffer, key, at).outcome).toEqual({ action: 'discard', reason: 'non-ascii' })
    }
  })

  it('never mutates the buffer it is given', () => {
    const { buffer } = type('ABC', GUN_GAP)
    const snapshot = [...buffer.chars]
    press(buffer, 'D', 2000)
    expect(buffer.chars).toEqual(snapshot)
  })
})

describe('idle flush — the suffix-less gun', () => {
  it('reports idle only once the quiet window has fully elapsed', () => {
    const { buffer, at } = type('MAIN-C01-B01', GUN_GAP)
    const last = at - GUN_GAP
    expect(wedgeBufferIsIdle(buffer, last + WEDGE_FLUSH_IDLE_MS - 1)).toBe(false)
    expect(wedgeBufferIsIdle(buffer, last + WEDGE_FLUSH_IDLE_MS)).toBe(true)
  })

  it('never reports an empty buffer as idle', () => {
    expect(wedgeBufferIsIdle(emptyWedgeBuffer, 10_000)).toBe(false)
  })

  it('commits the buffered code with no terminator at all', () => {
    const { buffer } = type('WIEDEMO-Z1-AL-R1-B5', GUN_GAP)
    const step = flushWedgeBuffer(buffer)
    expect(step.outcome).toEqual({
      action: 'commit',
      code: 'WIEDEMO-Z1-AL-R1-B5',
      via: 'idle',
    })
    expect(step.next).toEqual(emptyWedgeBuffer)
  })

  it('discards a too-short buffer on flush rather than committing a stray keypress', () => {
    const { buffer } = type('X', GUN_GAP)
    expect(flushWedgeBuffer(buffer).outcome).toEqual({ action: 'discard', reason: 'too-short' })
  })

  it('does nothing when there is nothing to flush', () => {
    const step = flushWedgeBuffer(emptyWedgeBuffer)
    expect(step.outcome).toEqual({ action: 'ignore' })
    expect(step.next).toBe(emptyWedgeBuffer)
  })

  it('leaves the idle window comfortably clear of a live burst', () => {
    // If these ever cross, the flush could fire in the middle of a scan and
    // commit half a code.
    expect(WEDGE_FLUSH_IDLE_MS).toBeGreaterThan(WEDGE_MAX_INTERKEY_MS)
  })
})

describe('real codes from the demo site', () => {
  const CODES = [
    'MAIN',
    'MAIN-F01-R05',
    'MAIN-BLK-01',
    'WIEDEMO-Z1-AR-R1-B15-L1',
    'E2ERACKLVL-B-0-0-L5',
    'HU-000235',
    'V2F-MINCE-001',
    'AYM-CHL-001',
    'ACT-DEL-SPLIT',
    '9312345678907',
  ]

  it('round-trips every one of them through a gun burst', () => {
    for (const code of CODES) {
      const { buffer, at } = type(code, GUN_GAP)
      expect(press(buffer, 'Enter', at).outcome).toEqual({
        action: 'commit',
        code,
        via: 'enter',
      })
    }
  })

  it('round-trips every one of them through an idle flush', () => {
    for (const code of CODES) {
      const { buffer } = type(code, GUN_GAP)
      expect(flushWedgeBuffer(buffer).outcome).toMatchObject({ action: 'commit', code })
    }
  })

  it('refuses every one of them when typed at human speed', () => {
    for (const code of CODES) {
      const { buffer, at } = type(code, HUMAN_GAP)
      expect(press(buffer, 'Enter', at).outcome).toMatchObject({ action: 'discard' })
    }
  })
})
