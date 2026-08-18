// The registry exists to stop ONE bug: a scan on Receive Stock being handled
// twice — once usefully by the surface, once by the app-wide fallback saying it
// went nowhere. Everything below is a property that bug depends on.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  activeWedgeConsumerCount,
  hasActiveWedgeConsumer,
  registerWedgeConsumer,
  resetWedgeConsumers,
  subscribeWedgeConsumers,
} from '@/lib/scan/wedgeRegistry'

beforeEach(() => {
  resetWedgeConsumers()
})

describe('claiming wedge capture', () => {
  it('is unclaimed until a surface says otherwise', () => {
    expect(hasActiveWedgeConsumer()).toBe(false)
  })

  it('is claimed while one surface holds it', () => {
    const release = registerWedgeConsumer()
    expect(hasActiveWedgeConsumer()).toBe(true)
    release()
    expect(hasActiveWedgeConsumer()).toBe(false)
  })

  it('stays claimed while ANY surface still holds it', () => {
    // Two scanning surfaces can legitimately be mounted at once — a putaway
    // finder behind an open sheet, say. The fallback must stay down until the
    // last one leaves, not the first.
    const a = registerWedgeConsumer()
    const b = registerWedgeConsumer()
    expect(activeWedgeConsumerCount()).toBe(2)

    a()
    expect(hasActiveWedgeConsumer()).toBe(true)

    b()
    expect(hasActiveWedgeConsumer()).toBe(false)
  })

  it('ignores a release called twice', () => {
    // StrictMode runs effect cleanups twice in development. A second release
    // driving the count negative would leave the fallback permanently muted —
    // silently, and only in the build nobody ships.
    const release = registerWedgeConsumer()
    release()
    release()
    release()
    expect(activeWedgeConsumerCount()).toBe(0)
    expect(hasActiveWedgeConsumer()).toBe(false)
  })

  it('gives each claim its own independent release', () => {
    const a = registerWedgeConsumer()
    const b = registerWedgeConsumer()
    a()
    a()
    a()
    // b's claim survives a's over-release.
    expect(activeWedgeConsumerCount()).toBe(1)
    b()
    expect(activeWedgeConsumerCount()).toBe(0)
  })
})

describe('subscriptions', () => {
  it('notifies on claim and on release', () => {
    const seen = vi.fn()
    subscribeWedgeConsumers(seen)

    const release = registerWedgeConsumer()
    expect(seen).toHaveBeenCalledTimes(1)

    release()
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('stops notifying once unsubscribed', () => {
    const seen = vi.fn()
    const unsubscribe = subscribeWedgeConsumers(seen)
    unsubscribe()

    registerWedgeConsumer()
    expect(seen).not.toHaveBeenCalled()
  })

  it('reads the NEW value from inside the notification', () => {
    // useSyncExternalStore calls the snapshot immediately after being told.
    // If the count were updated after notifying, the fallback would render one
    // state behind and keep its listener mounted through the whole first scan.
    const seenAt: boolean[] = []
    subscribeWedgeConsumers(() => seenAt.push(hasActiveWedgeConsumer()))

    const release = registerWedgeConsumer()
    release()

    expect(seenAt).toEqual([true, false])
  })

  it('tells every subscriber even if one throws', () => {
    const second = vi.fn()
    subscribeWedgeConsumers(() => {
      throw new Error('a broken subscriber')
    })
    subscribeWedgeConsumers(second)

    expect(() => registerWedgeConsumer()).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('survives a subscriber that unsubscribes itself while being notified', () => {
    const other = vi.fn()
    const unsubscribe = subscribeWedgeConsumers(() => unsubscribe())
    subscribeWedgeConsumers(other)

    expect(() => registerWedgeConsumer()).not.toThrow()
    expect(other).toHaveBeenCalledTimes(1)
  })
})
