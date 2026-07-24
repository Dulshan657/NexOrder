// Pure helpers for rack-level configuration (mig 00072). No React, no I/O — every
// function takes a `RackLevel[]` and returns a brand-new array; the input is never
// mutated. Convention: the array is ordered bottom-first (index 0 = L1), matching
// `RackLevelEditor`'s documented prop contract. The editor renders it top-first.

import type { LevelRole, RackLevel } from '@/types'

/** `<rack-code>-L<n>`, e.g. `levelCode('MAIN-B-4-2', 2)` -> `'MAIN-B-4-2-L2'`. */
export function levelCode(rackCode: string, levelIndex: number): string {
  return `${rackCode}-L${levelIndex}`
}

/** Extracts the rack code a level's own `code` was derived from (the `-L<n>`
 *  suffix stripped), so callers can re-derive sibling codes without threading
 *  the rack code through separately. Returns undefined if no level carries a
 *  recognisable code (e.g. a template with no codes assigned yet). */
export function rackCodeFromLevels(levels: RackLevel[]): string | undefined {
  const withCode = levels.find((l) => l.code)
  if (!withCode?.code) return undefined
  const match = withCode.code.match(/^(.*)-L\d+$/)
  return match ? match[1] : undefined
}

/** Renumbers `levelIndex` 1..N by array position (bottom-first) and, when
 *  `rackCode` is given, recomputes every `code` to match. Locations that were
 *  already saved (`locationId` set) keep that id — renumbering is a client-side
 *  reindex, not a re-creation. */
function renumber(levels: RackLevel[], rackCode?: string): RackLevel[] {
  return levels.map((level, i) => {
    const levelIndex = i + 1
    return {
      ...level,
      levelIndex,
      code: rackCode ? levelCode(rackCode, levelIndex) : level.code,
    }
  })
}

/** Builds a fresh `RackLevel[]` from a storage form's standard template (or
 *  another rack's levels used as a template). Strips any `locationId` — this is
 *  always a new, unsaved level layout — and renumbers/recodes for `rackCode`. */
export function applyTemplate(template: RackLevel[], rackCode?: string): RackLevel[] {
  const fresh = template.map((level, i) => ({
    levelIndex: i + 1,
    role: level.role,
    capacitySlots: level.capacitySlots,
    slotKind: level.slotKind,
    weightCapacityKg: level.weightCapacityKg,
    code: rackCode ? levelCode(rackCode, i + 1) : undefined,
  }))
  return fresh
}

/** True when `levels` has the same role/capacity/weight/slotKind sequence as
 *  `template` (length included). Ignores `code` and `locationId` — those are
 *  per-rack identity, not part of "is this the standard layout". Used to decide
 *  whether to show the "reset to form standard" action. */
export function matchesTemplate(levels: RackLevel[], template?: RackLevel[]): boolean {
  if (!template) return true
  if (levels.length !== template.length) return false
  return levels.every((level, i) => {
    const t = template[i]
    return (
      level.role === t.role &&
      level.capacitySlots === t.capacitySlots &&
      level.slotKind === t.slotKind &&
      level.weightCapacityKg === t.weightCapacityKg
    )
  })
}

/** Appends a new top level. Inherits capacity/weight/slotKind from the current
 *  topmost level (if any) so a rack that's "5 pick levels" grows another pick
 *  level, not a blank one; role defaults to `'bulk'` when there's nothing to
 *  inherit from (a sensible default for an overflow level added to an empty rack). */
export function addLevel(levels: RackLevel[]): RackLevel[] {
  const top = levels[levels.length - 1]
  const added: RackLevel = {
    levelIndex: levels.length + 1,
    role: top?.role ?? 'bulk',
    capacitySlots: top?.capacitySlots,
    slotKind: top?.slotKind,
    weightCapacityKg: top?.weightCapacityKg,
  }
  return renumber([...levels, added], rackCodeFromLevels(levels))
}

/** Removes one level by its current `levelIndex` and renumbers the remainder
 *  contiguously from 1. A no-op (returns the same reference) if the index isn't
 *  found, so callers can call it unconditionally. */
export function removeLevel(levels: RackLevel[], levelIndex: number): RackLevel[] {
  if (!levels.some((l) => l.levelIndex === levelIndex)) return levels
  const rackCode = rackCodeFromLevels(levels)
  return renumber(
    levels.filter((l) => l.levelIndex !== levelIndex),
    rackCode,
  )
}

/** Sets one level's role, leaving every other field untouched. */
export function setLevelRole(levels: RackLevel[], levelIndex: number, role: LevelRole): RackLevel[] {
  const rackCode = rackCodeFromLevels(levels)
  return renumber(
    levels.map((l) => (l.levelIndex === levelIndex ? { ...l, role } : l)),
    rackCode,
  )
}

/** Sets one level's capacity/weight (only the keys present in `patch` change). */
export function setLevelCapacity(
  levels: RackLevel[],
  levelIndex: number,
  patch: Partial<Pick<RackLevel, 'capacitySlots' | 'slotKind' | 'weightCapacityKg'>>,
): RackLevel[] {
  const rackCode = rackCodeFromLevels(levels)
  return renumber(
    levels.map((l) => (l.levelIndex === levelIndex ? { ...l, ...patch } : l)),
    rackCode,
  )
}

/** Sum of every level's `capacitySlots` (undefined treated as 0). This invariant
 *  matters: the designer's CapacityAdvisor sums placement capacity, so a rack's
 *  total capacity must equal the sum of its levels' capacities. */
export function totalCapacity(levels: RackLevel[]): number {
  return levels.reduce((sum, l) => sum + (l.capacitySlots ?? 0), 0)
}

/** Vertical reach cost for a level: ascending, +0.5m per level above L1. Rides
 *  on the existing `layout_placements.access_offset_m` column, so the engine
 *  already prefers reachable levels with no scoring change. */
export function accessOffsetForLevel(levelIndex: number, baseOffsetM = 0): number {
  return baseOffsetM + Math.max(0, levelIndex - 1) * 0.5
}
