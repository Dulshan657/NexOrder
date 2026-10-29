import { describe, expect, it } from 'vitest'
import { STICK_THRESHOLD_PX, isNearBottom } from '@/components/voice/transcriptScroll'

// jsdom has no layout, so the stick-to-bottom decision is a pure function of the
// three numbers the browser reports, tested here directly.
describe('isNearBottom', () => {
  it('is true exactly at the bottom', () => {
    expect(isNearBottom(1000, 600, 400)).toBe(true)
  })

  it('is true within the threshold of the bottom', () => {
    expect(isNearBottom(1000, 600 - STICK_THRESHOLD_PX, 400)).toBe(true)
  })

  it('is false once the reader has scrolled further up than the threshold', () => {
    expect(isNearBottom(1000, 600 - STICK_THRESHOLD_PX - 1, 400)).toBe(false)
    expect(isNearBottom(1000, 0, 400)).toBe(false)
  })

  it('is true when the content does not overflow at all', () => {
    expect(isNearBottom(300, 0, 400)).toBe(true)
  })

  it('takes a custom threshold', () => {
    expect(isNearBottom(1000, 590, 400, 5)).toBe(false)
    expect(isNearBottom(1000, 596, 400, 5)).toBe(true)
  })

  it('uses 48 px by default', () => {
    expect(STICK_THRESHOLD_PX).toBe(48)
  })
})
