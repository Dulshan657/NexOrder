// The voice tools compute product movement against ctx.now. The services they
// mirror (services/productMovementService.ts) read the real clock, so this file
// proves the two agree: with the system clock set to ctx.now, the service's own
// answers are the ones velocity.ts gives. If someone changes a rule in one place,
// this fails.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getDeadStock,
  getRestockAlerts,
  getSlowMovers,
  getTopMovers,
} from '../../services/productMovementService'
import { deadStock, restockAlerts, slowMovers, topMovers, velocities } from '../../lib/voice/tools/velocity'
import { NOW, buildOrders, buildProducts } from './voiceFixtures'

afterEach(() => {
  vi.useRealTimers()
})

describe('velocity.ts agrees with productMovementService at the same instant', () => {
  const live = buildOrders().filter((o) => o.status !== 'cancelled')
  const products = buildProducts()

  function atNow<T>(read: () => T): T {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    try {
      return read()
    } finally {
      vi.useRealTimers()
    }
  }

  it('top movers', () => {
    const service = atNow(() => getTopMovers(live, products, 50))
    expect(topMovers(velocities(live, products, NOW))).toEqual(service)
  })

  it('slow movers', () => {
    const service = atNow(() => getSlowMovers(live, products, 50))
    expect(slowMovers(velocities(live, products, NOW))).toEqual(service)
  })

  it('dead stock', () => {
    const service = atNow(() => getDeadStock(live, products))
    expect(deadStock(velocities(live, products, NOW), NOW)).toEqual(service)
  })

  it.each([1, 14, 30, 60])('restock alerts at a lead time of %i days', (lead) => {
    const service = atNow(() => getRestockAlerts(live, products, lead))
    expect(restockAlerts(velocities(live, products, NOW), lead)).toEqual(service)
  })

  it('does not read the clock itself: the answer is the same whatever the system time is', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-01-01T00:00:00.000Z'))
    const later = topMovers(velocities(live, products, NOW))
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'))
    const earlier = topMovers(velocities(live, products, NOW))
    expect(later).toEqual(earlier)
    expect(later.length).toBeGreaterThan(0)
  })
})
