import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useQrDecisionToasts } from '@/hooks/useQrDecisionToasts'
import type { AppNotification } from '@/types'

// A kitchen phone is often left on Order home. When the approver decides, the
// phone says so at once -- ONCE per decision, and never for one that was already
// in the bell when the app opened (those are old news, and a list that loads a
// moment after mount must not be mistaken for a burst of new ones).

const note = (over: Partial<AppNotification> & Pick<AppNotification, 'id' | 'type'>): AppNotification => ({
  message: 'm',
  timestamp: '2026-10-13T00:00:00Z',
  read: false,
  ...over,
})
const approved = (id: string) => note({ id, type: 'qr_order_approved' })
const rejected = (id: string, reason = 'Out of season') =>
  note({ id, type: 'qr_order_rejected', metadata: { reason } })

type Args = Parameters<typeof useQrDecisionToasts>[0]

function mount(initial: Partial<Args> = {}) {
  const addToast = vi.fn()
  const props: Args = { enabled: true, notifications: [], addToast, ...initial }
  const view = renderHook((p: Args) => useQrDecisionToasts(p), { initialProps: props })
  const update = (next: Partial<Args>) => view.rerender({ ...props, ...next })
  return { addToast, update, ...view }
}

afterEach(cleanup)

describe('useQrDecisionToasts', () => {
  it('toasts an approval that arrives after mount', () => {
    const { addToast, update } = mount()
    update({ notifications: [approved('a1')] })

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith('Your order was approved', 'success')
  })

  it('toasts a rejection with the reason, as an error', () => {
    const { addToast, update } = mount()
    update({ notifications: [rejected('r1', 'Too much')] })

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith('Your order was not approved — Too much', 'error')
  })

  it('stays quiet about decisions that were already there at mount', () => {
    const { addToast, update } = mount({ notifications: [approved('old-a'), rejected('old-r')] })
    update({ notifications: [approved('old-a'), rejected('old-r')] })

    expect(addToast).not.toHaveBeenCalled()
  })

  it('toasts only the new one when an old one is already in the list', () => {
    const { addToast, update } = mount({ notifications: [approved('old')] })
    update({ notifications: [rejected('fresh'), approved('old')] })

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith('Your order was not approved — Out of season', 'error')
  })

  it('toasts each decision once, however many times the list refreshes', () => {
    const { addToast, update } = mount()
    update({ notifications: [approved('a1')] })
    update({ notifications: [approved('a1')] })
    update({ notifications: [{ ...approved('a1'), read: true }] })
    update({ notifications: [approved('a1'), rejected('r1')] })

    expect(addToast).toHaveBeenCalledTimes(2)
  })

  it('does not toast a decision again after it leaves the list and comes back', () => {
    const { addToast, update } = mount()
    update({ notifications: [approved('a1')] })
    update({ notifications: [] })
    update({ notifications: [approved('a1')] })

    expect(addToast).toHaveBeenCalledTimes(1)
  })

  it('ignores every other kind of notification', () => {
    const { addToast, update } = mount()
    update({
      notifications: [
        note({ id: 'o', type: 'order_status' }),
        note({ id: 'p', type: 'qr_order_pending' }),
        note({ id: 'l', type: 'qr_code_locked' }),
      ],
    })

    expect(addToast).not.toHaveBeenCalled()
  })

  it('does nothing when it is not enabled (every role but kitchen staff)', () => {
    const { addToast, update } = mount({ enabled: false })
    update({ notifications: [approved('a1'), rejected('r1')] })

    expect(addToast).not.toHaveBeenCalled()
  })

  it('treats the list that is still loading as not-yet-known, not as "empty so everything is new"', () => {
    // First render: the notifications query is in flight, the list is the empty default.
    const { addToast, update } = mount({ ready: false, notifications: [] })
    // It lands, carrying last week's decisions.
    update({ ready: true, notifications: [approved('old-a'), rejected('old-r')] })
    expect(addToast).not.toHaveBeenCalled()

    // ...and a decision made after that is still caught.
    update({ ready: true, notifications: [approved('new'), approved('old-a'), rejected('old-r')] })
    expect(addToast).toHaveBeenCalledTimes(1)
  })

  it('does not re-baseline when the list fails to refresh and later recovers', () => {
    const { addToast, update } = mount({ ready: true, notifications: [approved('old')] })
    update({ ready: false, notifications: [approved('old')] })
    update({ ready: true, notifications: [rejected('while-away'), approved('old')] })

    // It happened while the person was looking at the screen: tell them.
    expect(addToast).toHaveBeenCalledTimes(1)
  })

  it('begins watching when it becomes enabled, taking the then-current list as the baseline', () => {
    const { addToast, update } = mount({ enabled: false, notifications: [approved('old')] })
    update({ enabled: true, notifications: [approved('old')] })
    expect(addToast).not.toHaveBeenCalled()

    update({ enabled: true, notifications: [rejected('new'), approved('old')] })
    expect(addToast).toHaveBeenCalledTimes(1)
  })

  it('uses the latest addToast without re-announcing anything', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { update } = mount({ addToast: first, notifications: [] })
    update({ addToast: second, notifications: [approved('a1')] })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
