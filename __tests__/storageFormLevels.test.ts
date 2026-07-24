import { describe, it, expect } from 'vitest'

import { levelRetroPatches } from '@/supabase/functions/_shared/storageFormLevels'

// The seeded "Rack" form (mig 00073): 4 levels, 24 carton slots and 1000 kg
// each, summing to the whole-rack 96 / 4000.
const RACK_TEMPLATE = [
  { role: 'pick', capacity_slots: 24, weight_capacity_kg: 1000 },
  { role: 'pick', capacity_slots: 24, weight_capacity_kg: 1000 },
  { role: 'reserve', capacity_slots: 24, weight_capacity_kg: 1000 },
  { role: 'bulk', capacity_slots: 24, weight_capacity_kg: 1000 },
]

describe('levelRetroPatches', () => {
  it('resolves each level to its own share, never the whole-rack figure', () => {
    expect(levelRetroPatches(RACK_TEMPLATE, [1, 2, 3, 4])).toEqual([
      { levelIndex: 1, capacitySlots: 24, weightCapacityKg: 1000 },
      { levelIndex: 2, capacitySlots: 24, weightCapacityKg: 1000 },
      { levelIndex: 3, capacitySlots: 24, weightCapacityKg: 1000 },
      { levelIndex: 4, capacitySlots: 24, weightCapacityKg: 1000 },
    ])
  })

  it('sums back to the whole-rack totals (the CapacityAdvisor invariant)', () => {
    const patches = levelRetroPatches(RACK_TEMPLATE, [1, 2, 3, 4])
    expect(patches.reduce((sum, p) => sum + (p.capacitySlots ?? 0), 0)).toBe(96)
    expect(patches.reduce((sum, p) => sum + (p.weightCapacityKg ?? 0), 0)).toBe(4000)
  })

  it('omits a level_index beyond the template — not described by the standard', () => {
    // A rack given a 5th level as a per-rack override keeps it untouched.
    const patches = levelRetroPatches(RACK_TEMPLATE, [1, 5])
    expect(patches.map((p) => p.levelIndex)).toEqual([1])
  })

  it('ignores out-of-range and non-integer indices', () => {
    expect(levelRetroPatches(RACK_TEMPLATE, [0, -1, 1.5])).toEqual([])
  })

  it('dedupes and sorts the indices it is given', () => {
    // Several racks share the same level_index values; each needs one update.
    const patches = levelRetroPatches(RACK_TEMPLATE, [3, 1, 3, 1, 2])
    expect(patches.map((p) => p.levelIndex)).toEqual([1, 2, 3])
  })

  it('maps an absent or null per-level capacity to null (uncapped), not a fallback', () => {
    const template = [
      { role: 'pick', capacity_slots: null, weight_capacity_kg: null },
      { role: 'bulk' },
    ]
    expect(levelRetroPatches(template, [1, 2])).toEqual([
      { levelIndex: 1, capacitySlots: null, weightCapacityKg: null },
      { levelIndex: 2, capacitySlots: null, weightCapacityKg: null },
    ])
  })

  it('coerces numeric strings, which jsonb numerics can arrive as', () => {
    const template = [{ role: 'pick', capacity_slots: '24', weight_capacity_kg: '1000' }]
    expect(levelRetroPatches(template, [1])).toEqual([
      { levelIndex: 1, capacitySlots: 24, weightCapacityKg: 1000 },
    ])
  })

  it('returns nothing for a missing, empty or non-array template', () => {
    expect(levelRetroPatches(null, [1, 2])).toEqual([])
    expect(levelRetroPatches(undefined, [1, 2])).toEqual([])
    expect(levelRetroPatches([], [1, 2])).toEqual([])
    expect(levelRetroPatches({ role: 'pick' }, [1])).toEqual([])
  })

  it('returns nothing when no levels exist to patch', () => {
    expect(levelRetroPatches(RACK_TEMPLATE, [])).toEqual([])
  })
})
