import { describe, it, expect } from 'vitest'
import { filterCandidates } from '../../supabase/functions/_shared/wie/scoring'
import { DEFAULT_WEIGHTS } from '../../supabase/functions/_shared/wie/types'
import type { CandidateBin, PutawayRequest, SkuProfile } from '../../supabase/functions/_shared/wie/types'

function sku(weightKg: number | null): SkuProfile {
  return {
    productId: 1, code: 'S1', name: 'S', sizeFactor: 1, weightKg, category: null,
    hazardClass: null, tempMin: null, tempMax: null, handlingType: null, stackable: null, velocityClass: null,
  }
}

function bin(o: Partial<CandidateBin> = {}): CandidateBin {
  return {
    locationId: 1, code: 'B1', zoneId: null, zoneTag: null, capacitySlots: 100, usedSlots: 0,
    weightCapacityKg: null, usedWeightKg: 0, graphNodeId: 1, accessOffsetM: 0, hasSameProduct: false,
    distanceFromDockM: 10, zoneType: null, zonePriorityWeight: null, zoneAllowedCategories: null,
    zoneMaxUtilizationPct: null, occupantCategories: [], pickVisits30d: 0, ...o,
  }
}

function req(candidates: CandidateBin[], s: SkuProfile, quantity: number): PutawayRequest {
  return { layoutId: 1, warehouseId: 1, sku: s, quantity, candidates, rules: [], compatibility: [], weights: DEFAULT_WEIGHTS }
}

describe('filterCandidates — weight gate', () => {
  it('rejects a bin that would exceed its weight limit', () => {
    const f = filterCandidates(req([bin({ weightCapacityKg: 50 })], sku(10), 6)) // 6 × 10 = 60 > 50
    expect(f.valid).toHaveLength(0)
    expect(f.hardFilters.some((h) => h.code === 'weight')).toBe(true)
  })

  it('accepts a bin exactly at its weight limit', () => {
    expect(filterCandidates(req([bin({ weightCapacityKg: 50 })], sku(10), 5)).valid).toHaveLength(1) // 50 == 50
  })

  it('fails open when the bin has no weight limit', () => {
    expect(filterCandidates(req([bin({ weightCapacityKg: null })], sku(1000), 100)).valid).toHaveLength(1)
  })

  it('fails open when the SKU has no weight on file', () => {
    expect(filterCandidates(req([bin({ weightCapacityKg: 5 })], sku(null), 100)).valid).toHaveLength(1)
  })

  it('accounts for weight already in the bin', () => {
    const f = filterCandidates(req([bin({ weightCapacityKg: 50, usedWeightKg: 45 })], sku(10), 1)) // 45 + 10 > 50
    expect(f.valid).toHaveLength(0)
  })
})
