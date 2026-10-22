// The level meter taps a stream for its loudness only. The model's voice already
// plays through the sheet's <audio> element, so an analyser wired on to the
// context's destination would play it a second time.

import { describe, expect, it, vi } from 'vitest'
import { createLevelMeter } from '@/lib/voice/audioLevel'

function fakeContext() {
  const destination = { id: 'destination' }
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 1,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(0.1)),
  }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const ctx = {
    destination,
    state: 'running',
    resume: vi.fn(async () => undefined),
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => source),
  }
  return { ctx: ctx as unknown as AudioContext, destination, analyser, source }
}

const STREAM = { id: 'stream' } as unknown as MediaStream

describe('createLevelMeter', () => {
  it('never connects to the destination and disconnects on close', () => {
    const { ctx, destination, analyser, source } = fakeContext()
    const meter = createLevelMeter(STREAM, ctx)!

    expect(source.connect).toHaveBeenCalledWith(analyser)
    expect(analyser.connect).not.toHaveBeenCalled()
    for (const call of source.connect.mock.calls) expect(call[0]).not.toBe(destination)

    const level = meter.read()
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThanOrEqual(1)

    meter.close()
    expect(source.disconnect).toHaveBeenCalled()
    expect(meter.read()).toBe(0)
  })

  it('returns null where there is no audio context', () => {
    expect(createLevelMeter(STREAM, null)).toBeNull()
  })

  it('resumes a suspended context', () => {
    const { ctx } = fakeContext()
    ;(ctx as unknown as { state: string }).state = 'suspended'
    createLevelMeter(STREAM, ctx)
    expect((ctx as unknown as { resume: ReturnType<typeof vi.fn> }).resume).toHaveBeenCalled()
  })
})
