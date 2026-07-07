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
})
