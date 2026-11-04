// The Admin Dashboard's period range must keep up with the clock while the page
// stays open. Since NX-0010 the comparison stops at "the same time of day", so a
// range worked out once, when the page opened, compared an afternoon's orders
// with "yesterday until 9 am" (gate NO-GO on 3e3befa).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDashboardRange } from '@/hooks/useDashboardRange'

// 09:00 on Tue 20 Oct 2026 in Sydney (AEDT, UTC+11).
const OPENED = new Date('2026-10-19T22:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(OPENED)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDashboardRange', () => {
  it('moves the comparison along while the dashboard stays open', () => {
    const { result } = renderHook(() => useDashboardRange('today'))
    expect(result.current.previous.to.toISOString()).toBe('2026-10-18T22:00:00.000Z') // Mon 09:00

    // Left open until 17:00.
    act(() => {
      vi.advanceTimersByTime(8 * 60 * 60 * 1000)
    })
    expect(result.current.previous.to.toISOString()).toBe('2026-10-19T06:00:00.000Z') // Mon 17:00
    expect(result.current.to.toISOString()).toBe('2026-10-20T12:59:59.999Z') // still the end of Tue
  })

  it('rolls over to the new day after midnight', () => {
    const { result } = renderHook(() => useDashboardRange('today'))
    act(() => {
      vi.advanceTimersByTime(16 * 60 * 60 * 1000) // 01:00 on Wed
    })
    expect(result.current.from.toISOString()).toBe('2026-10-20T13:00:00.000Z') // Wed 00:00
  })

  it('keeps the same range object between ticks within a minute', () => {
    const { result, rerender } = renderHook(() => useDashboardRange('this_month'))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
