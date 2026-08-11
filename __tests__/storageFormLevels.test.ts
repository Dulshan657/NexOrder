import { describe, it, expect } from 'vitest'

import { levelRetroPatches } from '@/supabase/functions/_shared/storageFormLevels'

// The seeded "Rack" form (mig 00073): 4 levels, 24 carton slots and 1000 kg
// each, summing to the whole-rack 96 / 4000. It names no slot_kind, which is
// what every template written before mig 00098 looks like — those levels
// inherit the form's own slot_unit and must keep doing so.
const RACK_TEMPLATE = [
  { role: 'pick', capacity_slots: 24, weight_capacity_kg: 1000 },
  { role: 'pick', capacity_slots: 24, weight_capacity_kg: 1000 },
  { role: 'reserve', capacity_slots: 24, weight_capacity_kg: 1000 },
  { role: 'bulk', capacity_slots: 24, weight_capacity_kg: 1000 },
]

// Amadiya's bay (mig 00098): one rack, two slot units — carton pick-zone levels
// below, pallet positions above.
const MIXED_TEMPLATE = [
  { role: 'pick', capacity_slots: 36, slot_kind: 'carton', weight_capacity_kg: 1000 },
  { role: 'pick', capacity_slots: 36, slot_kind: 'carton', weight_capacity_kg: 1000 },
  { role: 'pick', capacity_slots: 36, slot_kind: 'carton', weight_capacity_kg: 1000 },
  { role: 'reserve', capacity_slots: 2, slot_kind: 'pallet', weight_capacity_kg: 1000 },
  { role: 'bulk', capacity_slots: 2, slot_kind: 'pallet', weight_capacity_kg: 1000 },
]

describe('levelRetroPatches', () => {
  it('resolves each level to its own share, never the whole-rack figure', () => {
    expect(levelRetroPatches(RACK_TEMPLATE, [1, 2, 3, 4])).toEqual([
      { levelIndex: 1, capacitySlots: 24, slotKind: null, weightCapacityKg: 1000 },
      { levelIndex: 2, capacitySlots: 24, slotKind: null, weightCapacityKg: 1000 },
      { levelIndex: 3, capacitySlots: 24, slotKind: null, weightCapacityKg: 1000 },
      { levelIndex: 4, capacitySlots: 24, slotKind: null, weightCapacityKg: 1000 },
    ])
  })

  it('carries a per-level slot_kind, so one rack can hold two slot units', () => {
    // The whole point of the column: without it every level of this bay would
    // inherit the form's single slot_unit, and a pallet position counted as
    // cartons reads 130 loose units against a limit of 2 (the mig 00078 bug).
    expect(levelRetroPatches(MIXED_TEMPLATE, [1, 4]).map((p) => p.slotKind)).toEqual(['carton', 'pallet'])
  })

  it('maps a slot_kind the column would reject to null, not through', () => {
    // locations.slot_kind CHECKs pallet/carton. A form's slot_unit also allows
    // 'each' and 'uncounted', and a hand-edited template could carry either.
    const template = [{ role: 'pick', slot_kind: 'each' }, { role: 'bulk', slot_kind: 'PALLET' }]
    expect(levelRetroPatches(template, [1, 2]).map((p) => p.slotKind)).toEqual([null, null])
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
      { levelIndex: 1, capacitySlots: null, slotKind: null, weightCapacityKg: null },
      { levelIndex: 2, capacitySlots: null, slotKind: null, weightCapacityKg: null },
    ])
  })

  it('coerces numeric strings, which jsonb numerics can arrive as', () => {
    const template = [{ role: 'pick', capacity_slots: '24', weight_capacity_kg: '1000' }]
    expect(levelRetroPatches(template, [1])).toEqual([
      { levelIndex: 1, capacitySlots: 24, slotKind: null, weightCapacityKg: 1000 },
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
