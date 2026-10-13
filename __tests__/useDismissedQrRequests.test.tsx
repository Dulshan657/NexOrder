import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { clearDismissedMemory } from '@/lib/qr/dismissedRequests'
import { useDismissedQrRequests } from '@/hooks/useDismissedQrRequests'

// The Order home card and Order history's "Edit and resend" are two instances of
// this hook, never mounted together. Dismissing in one must show in the other --
// including on a phone whose browser blocks localStorage, which is where it used to
// come back after navigating.

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  clearDismissedMemory()
})

describe('useDismissedQrRequests', () => {
  it('starts empty and remembers what is dismissed', () => {
    const { result } = renderHook(() => useDismissedQrRequests('u1'))
    expect(result.current.dismissed).toEqual([])

    act(() => result.current.dismiss('r1'))
    expect(result.current.dismissed).toEqual(['r1'])
  })

  describe('with localStorage blocked', () => {
    beforeEach(() => {
      const boom = () => {
        throw new Error('SecurityError')
      }
      vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
    })

    it('a dismissal made in one instance is there when the next one mounts (the card does not come back)', () => {
      const home = renderHook(() => useDismissedQrRequests('u1'))
      act(() => home.result.current.dismiss('r1'))
      home.unmount()

      const history = renderHook(() => useDismissedQrRequests('u1'))
      expect(history.result.current.dismissed).toEqual(['r1'])
    })

    it('resending from history clears the home card: what history dismisses, home then reads', () => {
      const history = renderHook(() => useDismissedQrRequests('u1'))
      act(() => history.result.current.dismiss('r9'))
      history.unmount()

      const home = renderHook(() => useDismissedQrRequests('u1'))
      expect(home.result.current.dismissed).toContain('r9')
    })

    it('keeps one login\'s dismissals from another\'s', () => {
      const sam = renderHook(() => useDismissedQrRequests('sam'))
      act(() => sam.result.current.dismiss('r1'))
      sam.unmount()

      const ana = renderHook(() => useDismissedQrRequests('ana'))
      expect(ana.result.current.dismissed).toEqual([])
    })
  })

  it('reads its own list again when the login changes', () => {
    const { result, rerender } = renderHook(({ id }) => useDismissedQrRequests(id), { initialProps: { id: 'sam' } })
    act(() => result.current.dismiss('r1'))

    rerender({ id: 'ana' })
    expect(result.current.dismissed).toEqual([])

    rerender({ id: 'sam' })
    expect(result.current.dismissed).toEqual(['r1'])
  })
})
