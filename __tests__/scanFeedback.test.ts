// Feedback must never break a scan, and on a handheld the buzz is the channel
// that actually lands. Node has no AudioContext and no navigator.vibrate, which
// makes it the honest environment for the "degrade silently" half.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  areScanHapticsMuted,
  isScanSoundMuted,
  playScanAccept,
  playScanReject,
  playScanStray,
  prefersReducedMotion,
  primeScanAudio,
  setScanHapticsMuted,
  setScanSoundMuted,
} from '@/lib/scan/scanFeedback'

/** Minimal localStorage, since node has none. */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

let vibrate: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
  vibrate = vi.fn(() => true)
  // navigator exists in node 24 but has no vibrate; define it rather than spy.
  Object.defineProperty(globalThis.navigator, 'vibrate', {
    value: vibrate,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis.navigator as any).vibrate
})

describe('haptics', () => {
  it('buzzes once on accept and in a distinct pattern on reject', () => {
    playScanAccept()
    expect(vibrate).toHaveBeenCalledTimes(1)
    const accept = vibrate.mock.calls[0][0]

    vibrate.mockClear()
    playScanReject()
    const reject = vibrate.mock.calls[0][0]

    // Different in SHAPE, not just duration — a wrist cannot judge length
    // precisely but can tell one buzz from several.
    expect(Array.isArray(accept)).toBe(false)
    expect(Array.isArray(reject)).toBe(true)
    expect((reject as number[]).length).toBeGreaterThan(1)
  })

  it('uses a third pattern for a stray scan', () => {
    playScanStray()
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('is NOT silenced by the audio mute', () => {
    // The room that wants silence is exactly the room that still wants the
    // buzz. Two channels, two switches.
    setScanSoundMuted(true)
    expect(isScanSoundMuted()).toBe(true)

    playScanAccept()
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('respects its own mute', () => {
    setScanHapticsMuted(true)
    expect(areScanHapticsMuted()).toBe(true)

    playScanAccept()
    playScanReject()
    expect(vibrate).not.toHaveBeenCalled()

    setScanHapticsMuted(false)
    playScanAccept()
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('does not throw where the device cannot vibrate', () => {
    delete (globalThis.navigator as any).vibrate
    expect(() => { playScanAccept(); playScanReject() }).not.toThrow()
  })

  it('does not throw when vibrate itself throws', () => {
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: () => { throw new Error('blocked by intervention') },
      configurable: true,
    })
    expect(() => playScanAccept()).not.toThrow()
  })
})

describe('degrading without a DOM', () => {
  it('plays silently when there is no AudioContext at all', () => {
    expect(() => { playScanAccept(); playScanReject(); playScanStray() }).not.toThrow()
  })

  it('primes without throwing', () => {
    expect(() => primeScanAudio()).not.toThrow()
  })

  it('reports no reduced-motion preference when matchMedia is absent', () => {
    expect(prefersReducedMotion()).toBe(false)
  })

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    } as unknown as Storage)

    expect(isScanSoundMuted()).toBe(false)
    expect(areScanHapticsMuted()).toBe(false)
    expect(() => setScanSoundMuted(true)).not.toThrow()
    expect(() => setScanHapticsMuted(true)).not.toThrow()
    expect(() => playScanAccept()).not.toThrow()
  })
})
