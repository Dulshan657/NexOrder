// When the Nex mark shimmers on its own: a few times while the page is new, then
// never again until someone hovers or taps it. Reduced motion gets none of it.

import { describe, expect, it } from 'vitest'
import { IDLE_WINDOW_MS, shimmerSchedule } from '@/components/voice/markCadence'

describe('markCadence', () => {
  it('shimmers five times in the first 30 seconds, then rests', () => {
    const at = shimmerSchedule(false)
    expect(at).toEqual([1700, 8000, 15000, 22000, 29000])
    expect(IDLE_WINDOW_MS).toBe(30000)
    for (const t of at) expect(t).toBeLessThan(IDLE_WINDOW_MS)
  })

  it('schedules nothing under reduced motion', () => {
    expect(shimmerSchedule(true)).toEqual([])
  })
})
