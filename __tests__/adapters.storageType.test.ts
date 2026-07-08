import { describe, it, expect } from 'vitest'

import { toStorageType } from '../lib/adapters'

describe('toStorageType', () => {
  const row = {
    id: 3,
    code: 'PALLET_RACK',
    name: 'Pallet Rack',
    default_capacity_slots: 10,
    slot_unit: 'pallet' as const,
    attributes: { is_cold: false },
    is_active: true,
    sort_order: 10,
    created_at: '2026-07-01T00:00:00Z',
    levels: null,
    positions_per_level: null,
    weight_capacity_kg: null,
    length_cm: null,
    width_cm: null,
    height_cm: null,
    color: null,
    is_drawable: true,
  }

  it('maps snake_case → camelCase and coerces the numeric capacity', () => {
    expect(toStorageType(row)).toEqual({
      id: 3,
      code: 'PALLET_RACK',
      name: 'Pallet Rack',
      defaultCapacitySlots: 10,
      slotUnit: 'pallet',
      attributes: { is_cold: false },
      isActive: true,
      sortOrder: 10,
      levels: undefined,
      positionsPerLevel: undefined,
      weightCapacityKg: undefined,
      lengthCm: undefined,
      widthCm: undefined,
      heightCm: undefined,
      color: undefined,
      isDrawable: true,
    })
  })

  it('maps a null default_capacity_slots to undefined (uncounted)', () => {
    const t = toStorageType({ ...row, default_capacity_slots: null, slot_unit: 'uncounted' })
    expect(t.defaultCapacitySlots).toBeUndefined()
    expect(t.slotUnit).toBe('uncounted')
  })

  it('defaults attributes to an empty object when null', () => {
    const t = toStorageType({ ...row, attributes: null as unknown as Record<string, never> })
    expect(t.attributes).toEqual({})
  })

  it('maps the storage-forms capacity fields (levels × positions, weight, dims, color)', () => {
    const t = toStorageType({
      ...row,
      levels: 5,
      positions_per_level: 2,
      weight_capacity_kg: 1000,
      length_cm: 270,
      width_cm: 110,
      height_cm: 600,
      color: '#10b981',
      is_drawable: false,
    })
    expect(t).toMatchObject({
      levels: 5,
      positionsPerLevel: 2,
      weightCapacityKg: 1000,
      lengthCm: 270,
      widthCm: 110,
      heightCm: 600,
      color: '#10b981',
      isDrawable: false,
    })
  })
})
