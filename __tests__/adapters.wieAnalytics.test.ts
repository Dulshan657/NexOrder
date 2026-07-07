import { describe, it, expect } from 'vitest'

import { toWieProductVelocity, toWieLocationTraffic } from '../lib/adapters'

describe('toWieProductVelocity', () => {
  const row = {
    warehouse_id: 7,
    product_id: 42,
    picks_7d: 3,
    picks_30d: 18,
    picks_90d: 40,
    qty_30d: 220,
    velocity_class: 'A' as const,
    computed_at: '2026-07-01T00:00:00Z',
  }

  it('maps snake_case → camelCase and coerces numerics', () => {
    const v = toWieProductVelocity(row)
    expect(v).toEqual({
      warehouseId: 7,
      productId: 42,
      picks7d: 3,
      picks30d: 18,
      picks90d: 40,
      qty30d: 220,
      velocityClass: 'A',
    })
  })

  it('maps a null velocity_class to undefined (unclassified product)', () => {
    const v = toWieProductVelocity({ ...row, velocity_class: null })
    expect(v.velocityClass).toBeUndefined()
  })
})

describe('toWieLocationTraffic', () => {
  it('maps the per-node pick-visit row', () => {
    const t = toWieLocationTraffic({
      layout_id: 5,
      graph_node_id: 91,
      pick_visits_30d: 27,
      computed_at: '2026-07-01T00:00:00Z',
    })
    expect(t).toEqual({ layoutId: 5, graphNodeId: 91, pickVisits30d: 27 })
  })
})
