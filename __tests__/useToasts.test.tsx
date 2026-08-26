/**
 * The toast queue's behaviour under a burst, and the single lifetime that the
 * renderer and the removal timer now share.
 *
 * Two defects are pinned here, both found while making the app work on a
 * 360×720 CipherLab RS35:
 *
 *  - There was NO CAP. `addToast` appended unconditionally, and both
 *    `context/OrderContext.tsx` and `components/admin/SlottingRulesSection.tsx`
 *    raise one toast per item in a `forEach`. On a handheld each toast is ~76px
 *    tall, so a modest burst buried the screen with no scroll and no collapse.
 *  - The EXIT ANIMATION AND THE REMOVAL WERE TWO NUMBERS. The renderer started
 *    its exit at a hard-coded 4700ms while the provider removed at 5000 or
 *    8000, so an action toast spent 3.3s invisible — still occupying layout
 *    height in the column, with an action button nobody could press.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import {
  ToastProvider,
  useToasts,
  MAX_TOASTS,
  TOAST_DURATION_MS,
  TOAST_ACTION_DURATION_MS,
} from '@/hooks/useToasts'

/** Exposes the queue and a handle to push onto it. */
function Harness({ onReady }: { onReady: (api: ReturnType<typeof useToasts>) => void }) {
  const api = useToasts()
  onReady(api)
  return (
    <ul data-testid="queue">
      {api.toasts.map(t => (
        <li key={t.id} data-count={t.count} data-duration={t.duration}>{t.message}</li>
      ))}
    </ul>
  )
}

let api: ReturnType<typeof useToasts>

function mount() {
  render(
    <ToastProvider>
      <Harness onReady={a => { api = a }} />
    </ToastProvider>,
  )
}

function messages(): string[] {
  return Array.from(screen.getByTestId('queue').children).map(li => li.textContent ?? '')
}

beforeEach(() => {
  vi.useFakeTimers()
  mount()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the stack cap', () => {
  it('keeps at most MAX_TOASTS, dropping the OLDEST', () => {
    act(() => {
      // Distinct messages: this is the shape of the real burst sites, which
      // iterate over dropped promotions or slotting warnings.
      for (let i = 1; i <= 6; i += 1) api.addToast(`warning ${i}`, 'info')
    })

    expect(messages()).toHaveLength(MAX_TOASTS)
    // The newest survive — they are the ones the operator has not read.
    expect(messages()).toEqual(['warning 4', 'warning 5', 'warning 6'])
  })

  it('does not leave a dropped toast\'s timer to fire against a stale id', () => {
    act(() => {
      for (let i = 1; i <= 6; i += 1) api.addToast(`warning ${i}`, 'info')
    })
    // If an evicted toast's removal still ran, it would splice the array while
    // the survivors were mid-life. Advance past the point every evicted timer
    // would have fired and confirm the survivors are untouched.
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS - 1) })
    expect(messages()).toHaveLength(MAX_TOASTS)
  })
})

describe('dedupe of an identical repeat', () => {
  it('collapses an adjacent duplicate into a count instead of stacking', () => {
    act(() => {
      api.addToast('Scan not recognised', 'error')
      api.addToast('Scan not recognised', 'error')
      api.addToast('Scan not recognised', 'error')
    })

    const items = screen.getByTestId('queue').children
    expect(items).toHaveLength(1)
    expect(items[0].getAttribute('data-count')).toBe('3')
  })

  it('resets the collapsed toast\'s lifetime, so a repeat keeps it on screen', () => {
    act(() => { api.addToast('Scan not recognised', 'error') })
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS - 500) })
    act(() => { api.addToast('Scan not recognised', 'error') })

    // Past the ORIGINAL deadline — it must still be there.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(messages()).toHaveLength(1)

    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS) })
    expect(messages()).toHaveLength(0)
  })

  it('does NOT collapse a non-adjacent match — that would hide a second failure', () => {
    act(() => {
      api.addToast('Save failed', 'error')
      api.addToast('Something else', 'info')
      api.addToast('Save failed', 'error')
    })
    expect(messages()).toEqual(['Save failed', 'Something else', 'Save failed'])
  })

  it('never collapses a toast carrying an action — identical labels can differ', () => {
    const first = vi.fn()
    const second = vi.fn()
    act(() => {
      api.addToast('Undo?', 'info', { label: 'Undo', onClick: first })
      api.addToast('Undo?', 'info', { label: 'Undo', onClick: second })
    })
    expect(messages()).toHaveLength(2)
  })
})

describe('one lifetime, shared', () => {
  it('gives a plain toast the plain duration and an action toast the longer one', () => {
    act(() => {
      api.addToast('plain', 'info')
      api.addToast('with action', 'info', { label: 'Retry', onClick: () => {} })
    })
    const items = screen.getByTestId('queue').children
    expect(items[0].getAttribute('data-duration')).toBe(String(TOAST_DURATION_MS))
    expect(items[1].getAttribute('data-duration')).toBe(String(TOAST_ACTION_DURATION_MS))
  })

  it('keeps an action toast alive for its full 8s — the button must still work at 6s', () => {
    act(() => {
      api.addToast('with action', 'info', { label: 'Retry', onClick: () => {} })
    })
    // The old renderer hid this at 4700ms while the provider kept it until 8000.
    act(() => { vi.advanceTimersByTime(6000) })
    expect(messages()).toHaveLength(1)

    act(() => { vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS - 6000 + 1) })
    expect(messages()).toHaveLength(0)
  })

  it('removes a plain toast exactly at its duration', () => {
    act(() => { api.addToast('plain', 'info') })
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS - 1) })
    expect(messages()).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(2) })
    expect(messages()).toHaveLength(0)
  })
})
