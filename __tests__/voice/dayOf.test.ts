// dayOf turns a stored timestamp into the Sydney calendar day Nex speaks. It was
// a UTC `slice(0, 10)` until NX-0008, which never threw; the Sydney version goes
// through Intl, which throws RangeError on an invalid date. A malformed or empty
// timestamp must still give "no date" (null), never take a tool call down.

import { describe, expect, it } from 'vitest'
import { dayOf } from '../../lib/voice/tools/common'

describe('dayOf', () => {
  it('gives the Sydney day, not the UTC one', () => {
    // 22:30 UTC on 9 Oct is 09:30 on 10 Oct in Sydney (AEDT).
    expect(dayOf('2026-10-09T22:30:00.000Z')).toBe('2026-10-10')
  })

  it('keeps a plain calendar date as that date', () => {
    expect(dayOf('2026-11-02')).toBe('2026-11-02')
  })

  it('answers null, never throws, for a missing or malformed timestamp', () => {
    expect(dayOf(null)).toBeNull()
    expect(dayOf(undefined)).toBeNull()
    expect(dayOf('')).toBeNull()
    expect(() => dayOf('not a date')).not.toThrow()
    expect(dayOf('not a date')).toBeNull()
  })
})
