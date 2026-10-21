// How long to wait before trying again, in words a person hears.
//
// The burst limit's window is an hour, and "try again in 3600s" is a number to do
// arithmetic on. Minutes from 90 seconds up (rounded), seconds below that.

import { describe, expect, it } from 'vitest'
import { describeRetryAfter } from '../../supabase/functions/_shared/voice/retryAfter'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS

describe('describeRetryAfter', () => {
  it('says about N minutes for a long wait', () => {
    expect(describeRetryAfter(60 * MINUTE_MS)).toBe('about 60 minutes')
    expect(describeRetryAfter(42 * MINUTE_MS + 20 * SECOND_MS)).toBe('about 42 minutes')
    expect(describeRetryAfter(42 * MINUTE_MS + 40 * SECOND_MS)).toBe('about 43 minutes')
  })

  it('switches to minutes at 90 seconds', () => {
    expect(describeRetryAfter(90 * SECOND_MS)).toBe('about 2 minutes')
    expect(describeRetryAfter(89 * SECOND_MS)).toBe('89 seconds')
  })

  it('rounds seconds up, so it never says zero', () => {
    expect(describeRetryAfter(59_001)).toBe('60 seconds')
    expect(describeRetryAfter(1)).toBe('1 second')
    expect(describeRetryAfter(0)).toBe('1 second')
  })

  it('treats a nonsense wait as one second rather than printing NaN', () => {
    expect(describeRetryAfter(Number.NaN)).toBe('1 second')
    expect(describeRetryAfter(-5)).toBe('1 second')
  })
})
