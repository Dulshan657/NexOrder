import { describe, it, expect } from 'vitest'
import type { RackLevel } from '../types'
import {
  levelCode,
  rackCodeFromLevels,
  applyTemplate,
  matchesTemplate,
  addLevel,
  removeLevel,
  setLevelRole,
  setLevelCapacity,
  totalCapacity,
  accessOffsetForLevel,
} from '../components/warehouse/levels/rackLevels'

const template: RackLevel[] = [
  { levelIndex: 1, role: 'pick', capacitySlots: 2 },
  { levelIndex: 2, role: 'pick', capacitySlots: 2 },
  { levelIndex: 3, role: 'pick', capacitySlots: 2 },
  { levelIndex: 4, role: 'pick', capacitySlots: 2 },
  { levelIndex: 5, role: 'bulk', capacitySlots: 4 },
]

describe('rackLevels', () => {
  describe('levelCode', () => {
    it('derives the -L<n> suffix', () => {
      expect(levelCode('MAIN-B-4-2', 1)).toBe('MAIN-B-4-2-L1')
      expect(levelCode('MAIN-B-4-2', 5)).toBe('MAIN-B-4-2-L5')
    })

    it('produces unique codes for every level of a rack', () => {
      const codes = [1, 2, 3, 4, 5].map((i) => levelCode('MAIN-B-4-2', i))
      expect(new Set(codes).size).toBe(codes.length)
    })
  })

  describe('rackCodeFromLevels', () => {
    it('strips the -L<n> suffix from the first coded level', () => {
      const levels = applyTemplate(template, 'MAIN-B-4-2')
      expect(rackCodeFromLevels(levels)).toBe('MAIN-B-4-2')
    })

    it('returns undefined when no level carries a code', () => {
      expect(rackCodeFromLevels(applyTemplate(template))).toBeUndefined()
    })
  })

  describe('applyTemplate', () => {
    it('builds a fresh RackLevel[] renumbered 1..N with derived codes', () => {
      const levels = applyTemplate(template, 'A-01')
      expect(levels).toHaveLength(5)
      expect(levels.map((l) => l.levelIndex)).toEqual([1, 2, 3, 4, 5])
      expect(levels.map((l) => l.code)).toEqual(['A-01-L1', 'A-01-L2', 'A-01-L3', 'A-01-L4', 'A-01-L5'])
      expect(levels.map((l) => l.role)).toEqual(['pick', 'pick', 'pick', 'pick', 'bulk'])
    })

    it('omits codes when no rackCode is given', () => {
      const levels = applyTemplate(template)
      expect(levels.every((l) => l.code === undefined)).toBe(true)
    })

    it('never mutates the input template', () => {
      const clone = template.map((l) => ({ ...l }))
      applyTemplate(template, 'A-01')
      expect(template).toEqual(clone)
    })

    it('drops any locationId from the template — a template application is always unsaved', () => {
      const withIds: RackLevel[] = template.map((l) => ({ ...l, locationId: 999 }))
      const levels = applyTemplate(withIds, 'A-01')
      expect(levels.every((l) => l.locationId === undefined)).toBe(true)
    })
  })

  describe('matchesTemplate', () => {
    it('is true when levels have the same role/capacity/weight/slotKind sequence', () => {
      const levels = applyTemplate(template, 'A-01')
      expect(matchesTemplate(levels, template)).toBe(true)
    })

    it('is false after a role override diverges from the template', () => {
      const levels = setLevelRole(applyTemplate(template, 'A-01'), 5, 'reserve')
      expect(matchesTemplate(levels, template)).toBe(false)
    })

    it('is false when the level count differs', () => {
      const levels = removeLevel(applyTemplate(template, 'A-01'), 5)
      expect(matchesTemplate(levels, template)).toBe(false)
    })

    it('is true (vacuously) when no template is given', () => {
      expect(matchesTemplate(applyTemplate(template, 'A-01'), undefined)).toBe(true)
    })
  })

  describe('addLevel', () => {
    it('appends a new top level, renumbered contiguously', () => {
      const levels = applyTemplate(template, 'A-01')
      const next = addLevel(levels, 'bulk')
      expect(next).toHaveLength(6)
      expect(next[5]).toMatchObject({ levelIndex: 6, code: 'A-01-L6' })
    })

    it('inherits capacity/weight/slotKind/role from the current top level', () => {
      const levels: RackLevel[] = [{ levelIndex: 1, role: 'reserve', capacitySlots: 3, weightCapacityKg: 500, slotKind: 'carton' }]
      const next = addLevel(levels, 'bulk')
      expect(next[1]).toMatchObject({ levelIndex: 2, role: 'reserve', capacitySlots: 3, weightCapacityKg: 500, slotKind: 'carton' })
    })

    it('uses the supplied fallback role on an empty rack', () => {
      const next = addLevel([], 'bulk')
      expect(next).toEqual([{ levelIndex: 1, role: 'bulk', capacitySlots: undefined, slotKind: undefined, weightCapacityKg: undefined }])
    })

    it('never mutates the input array', () => {
      const levels = applyTemplate(template, 'A-01')
      const clone = levels.map((l) => ({ ...l }))
      addLevel(levels, 'bulk')
      expect(levels).toEqual(clone)
    })
  })

  describe('removeLevel', () => {
    it('removes a level and renumbers the remainder contiguously from 1', () => {
      const levels = applyTemplate(template, 'A-01')
      const next = removeLevel(levels, 3)
      expect(next).toHaveLength(4)
      expect(next.map((l) => l.levelIndex)).toEqual([1, 2, 3, 4])
      // What used to be L4/L5 are now L3/L4, recoded to match.
      expect(next[2]).toMatchObject({ levelIndex: 3, code: 'A-01-L3', role: 'pick' })
      expect(next[3]).toMatchObject({ levelIndex: 4, code: 'A-01-L4', role: 'bulk' })
    })

    it('is a no-op (same reference) when the index does not exist', () => {
      const levels = applyTemplate(template, 'A-01')
      expect(removeLevel(levels, 99)).toBe(levels)
    })

    it('never mutates the input array', () => {
      const levels = applyTemplate(template, 'A-01')
      const clone = levels.map((l) => ({ ...l }))
      removeLevel(levels, 2)
      expect(levels).toEqual(clone)
    })
  })

  describe('setLevelRole', () => {
    it('updates only the targeted level', () => {
      const levels = applyTemplate(template, 'A-01')
      const next = setLevelRole(levels, 2, 'reserve')
      expect(next[1].role).toBe('reserve')
      expect(next[0].role).toBe('pick')
      expect(next[2].role).toBe('pick')
    })

    it('never mutates the input array', () => {
      const levels = applyTemplate(template, 'A-01')
      const clone = levels.map((l) => ({ ...l }))
      setLevelRole(levels, 1, 'bulk')
      expect(levels).toEqual(clone)
    })
  })

  describe('setLevelCapacity', () => {
    it('patches only the given keys on the targeted level', () => {
      const levels = applyTemplate(template, 'A-01')
      const next = setLevelCapacity(levels, 1, { capacitySlots: 9, weightCapacityKg: 200 })
      expect(next[0]).toMatchObject({ capacitySlots: 9, weightCapacityKg: 200, role: 'pick' })
      expect(next[1].capacitySlots).toBe(2)
    })

    it('never mutates the input array', () => {
      const levels = applyTemplate(template, 'A-01')
      const clone = levels.map((l) => ({ ...l }))
      setLevelCapacity(levels, 1, { capacitySlots: 100 })
      expect(levels).toEqual(clone)
    })
  })

  describe('totalCapacity', () => {
    it('sums every level capacity', () => {
      const levels = applyTemplate(template, 'A-01')
      expect(totalCapacity(levels)).toBe(2 + 2 + 2 + 2 + 4)
    })

    it('treats a level with no capacitySlots as 0', () => {
      const levels: RackLevel[] = [{ levelIndex: 1, role: 'pick' }, { levelIndex: 2, role: 'pick', capacitySlots: 5 }]
      expect(totalCapacity(levels)).toBe(5)
    })

    it('stays in sync with add/remove — the rollup invariant CapacityAdvisor relies on', () => {
      let levels = applyTemplate(template, 'A-01')
      const before = totalCapacity(levels)
      levels = addLevel(levels, 'bulk') // inherits the top level's capacity (4)
      expect(totalCapacity(levels)).toBe(before + 4)
      levels = removeLevel(levels, 1) // drops the first pick level (capacity 2)
      expect(totalCapacity(levels)).toBe(before + 4 - 2)
    })
  })

  describe('accessOffsetForLevel', () => {
    it('is 0 at L1 with no base offset', () => {
      expect(accessOffsetForLevel(1)).toBe(0)
    })

    it('ascends by 0.5m per level above L1', () => {
      expect(accessOffsetForLevel(1)).toBe(0)
      expect(accessOffsetForLevel(2)).toBe(0.5)
      expect(accessOffsetForLevel(3)).toBe(1)
      expect(accessOffsetForLevel(5)).toBe(2)
    })

    it('adds on top of a base offset', () => {
      expect(accessOffsetForLevel(1, 3)).toBe(3)
      expect(accessOffsetForLevel(3, 3)).toBe(4)
    })
  })
})
