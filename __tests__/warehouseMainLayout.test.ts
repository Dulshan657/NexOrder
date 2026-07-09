import { describe, it, expect } from 'vitest'

import { buildMainLayout, cellsOf, GRID, CANDIDATE_LIMIT } from '../warehouse-main/layout.mjs'
import { classifyAbc, demandByProduct } from '../warehouse-main/velocity.mjs'
import { evaluatePublishReadiness } from '../supabase/functions/_shared/wie/publishReadiness'
import { autoConnectLayout } from '../supabase/functions/_shared/wie/autoConnect'

const CFG = {
  warehouseId: 1,
  zoneProfiles: { fast: 1, slow: 5, bulk: 3, overflow: 6, cold: 99 },
  storageTypes: { palletBay: 10, shelfBay: 11, coldBay: 12, bulkFloor: 13 },
}

const layout = () => buildMainLayout(CFG)

describe('buildMainLayout — geometry', () => {
  it('emits 189 bays split across the five zones', () => {
    const { placements } = layout()
    expect(placements).toHaveLength(189)

    const byZone = (id: number) => placements.filter((p) => p.new_bin.zone_profile_id === id).length
    expect(byZone(CFG.zoneProfiles.fast)).toBe(104)
    expect(byZone(CFG.zoneProfiles.slow)).toBe(52)
    expect(byZone(CFG.zoneProfiles.overflow)).toBe(13)
    expect(byZone(CFG.zoneProfiles.bulk)).toBe(8)
    expect(byZone(CFG.zoneProfiles.cold)).toBe(12)
  })

  it('stays under the putaway candidate ceiling', () => {
    // putawayTasks.ts calls wie_putaway_candidates with p_limit: 200, ordered by
    // dock distance. More bays than that and the farthest — the cold room — would
    // never be offered to the engine, stranding Plant-Based stock at the root.
    expect(layout().placements.length).toBeLessThanOrEqual(CANDIDATE_LIMIT)
  })

  it('gives every bay a unique code', () => {
    const codes = layout().placements.map((p) => p.new_bin.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('never reuses a legacy MAIN-B-x-y code', () => {
    const codes = layout().placements.map((p) => p.new_bin.code)
    expect(codes.filter((c) => /^MAIN-B-\d+-\d+$/.test(c))).toEqual([])
  })

  it('keeps rack bays 2x1 and bulk blocks 4x2', () => {
    for (const p of layout().placements) {
      const isBulk = p.new_bin.storage_type_id === CFG.storageTypes.bulkFloor
      expect([p.w, p.h]).toEqual(isBulk ? [4, 2] : [2, 1])
    }
  })

  it('places every bay inside the perimeter walls', () => {
    for (const p of layout().placements) {
      expect(p.x).toBeGreaterThanOrEqual(1)
      expect(p.y).toBeGreaterThanOrEqual(1)
      expect(p.x + p.w).toBeLessThanOrEqual(GRID.width - 1)
      expect(p.y + p.h).toBeLessThanOrEqual(GRID.height - 1)
    }
  })

  it('never overlaps two bays', () => {
    const seen = new Set<string>()
    for (const p of layout().placements) {
      for (const cell of cellsOf(p)) {
        expect(seen.has(cell)).toBe(false)
        seen.add(cell)
      }
    }
  })

  it('never places a bay on a wall', () => {
    const { placements, objects } = layout()
    const walls = new Set(objects.filter((o) => o.object_type === 'wall').flatMap(cellsOf))
    for (const p of placements) {
      for (const cell of cellsOf(p)) expect(walls.has(cell)).toBe(false)
    }
  })

  it('leaves the cold-room doorway open', () => {
    const walls = new Set(layout().objects.filter((o) => o.object_type === 'wall').flatMap(cellsOf))
    expect(walls.has('0:7:26')).toBe(false)
    expect(walls.has('0:8:26')).toBe(false)
    // ...and walls it in on either side of the door.
    expect(walls.has('0:6:26')).toBe(true)
    expect(walls.has('0:9:26')).toBe(true)
  })
})

describe('buildMainLayout — engine publish gates', () => {
  // These are the exact four checks publish-layout enforces server-side. If this
  // test fails the seed would be rejected at publish time.
  const readiness = () => {
    const { placements, objects, cellSizeM } = layout()
    return evaluatePublishReadiness({
      objects: objects.map((o) => ({ objectType: o.object_type, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h })),
      placements: placements.map((p) => ({ id: p.client_ref, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
      cellSizeM,
    })
  }

  it('passes all four publish checks with no auto-connect repair needed', () => {
    const result = readiness()
    expect(result.unreachableIds).toEqual([])
    expect(result.ready).toBe(true)
  })

  it('needs no walkway repair — autoConnect is a no-op', () => {
    const { placements, objects, gridWidth, gridHeight, floors } = layout()
    const repaired = autoConnectLayout({
      objects: objects.map((o) => ({ objectType: o.object_type, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h })),
      placements: placements.map((p) => ({ id: p.client_ref, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h })),
      gridWidth,
      gridHeight,
      floors,
    })
    expect(repaired.stillUnreachable).toEqual([])
    expect(repaired.changed).toBe(false)
  })
})

describe('classifyAbc', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ productId: i + 1, demand: n - i }))

  it('splits 100 SKUs 20/30/50', () => {
    const out = classifyAbc(rows(100))
    const count = (c: string) => out.filter((r) => r.velocityClass === c).length
    expect([count('A'), count('B'), count('C')]).toEqual([20, 30, 50])
  })

  it('ranks by descending demand', () => {
    const out = classifyAbc([
      { productId: 7, demand: 5 },
      { productId: 3, demand: 90 },
      { productId: 9, demand: 40 },
    ])
    expect(out.map((r) => r.productId)).toEqual([3, 9, 7])
  })

  it('breaks demand ties by productId so runs are reproducible', () => {
    const out = classifyAbc([
      { productId: 5, demand: 10 },
      { productId: 2, demand: 10 },
    ])
    expect(out.map((r) => r.productId)).toEqual([2, 5])
  })

  it('never calls a zero-demand SKU fast, even in a tiny catalogue', () => {
    const out = classifyAbc([{ productId: 1, demand: 0 }, { productId: 2, demand: 0 }])
    expect(out.every((r) => r.velocityClass === 'C')).toBe(true)
  })
})

describe('demandByProduct', () => {
  it('sums quantities and keeps never-ordered SKUs at zero', () => {
    const out = demandByProduct(
      [{ product_id: 1, quantity: 4 }, { product_id: 1, quantity: 6 }, { product_id: 2, quantity: 3 }],
      [1, 2, 3],
    )
    expect(out).toEqual([
      { productId: 1, demand: 10 },
      { productId: 2, demand: 3 },
      { productId: 3, demand: 0 },
    ])
  })

  it('ignores order lines for products outside the catalogue', () => {
    const out = demandByProduct([{ product_id: 99, quantity: 5 }], [1])
    expect(out).toEqual([{ productId: 1, demand: 0 }])
  })
})
