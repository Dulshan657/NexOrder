// Pure helpers for rack-level configuration (mig 00072). No React, no I/O — every
// function takes a `RackLevel[]` and returns a brand-new array; the input is never
// mutated. Convention: the array is ordered bottom-first (index 0 = L1), matching
// `RackLevelEditor`'s documented prop contract. The editor renders it top-first.

import type { LevelRole, RackLevel } from '@/types'
import { levelCodeFor } from '@/lib/codePattern'

/** `<rack-code>-L<n>`, e.g. `levelCode('MAIN-B-4-2', 2)` -> `'MAIN-B-4-2-L2'`.
 *
 *  Re-exported from the pure shared module rather than defined here: the recode
 *  sweep derives level codes from a rack's NEW code and the server does the same,
 *  so a second copy of this one line would eventually leave a rack and its levels
 *  under two different code families. Same rule as `scanNormalize.ts`. */
export const levelCode = levelCodeFor

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
 *  level, not a blank one.
 *
 *  `fallbackRole` is used only when there is nothing to inherit from (an empty
 *  rack). It is a parameter rather than the old hardcoded `'bulk'` because the
 *  role vocabulary is operator-managed since mig 00081 — a literal here would
 *  write a key that may have been renamed or retired. Callers pass
 *  `defaultRoleKey(roles)`. */
export function addLevel(levels: RackLevel[], fallbackRole: LevelRole): RackLevel[] {
  const top = levels[levels.length - 1]
  const added: RackLevel = {
    levelIndex: levels.length + 1,
    role: top?.role ?? fallbackRole,
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

/** Sets one level's capacity/slot kind/weight (only the keys present in `patch`
 *  change; a key present as `undefined` CLEARS it, which is how the editor
 *  spells "inherit the storage form's default"). */
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

/** Vertical reach cost for a level: ascending, one step per level above L1.
 *  Rides on the existing `layout_placements.access_offset_m` column, so the
 *  engine already prefers reachable levels with no scoring change.
 *
 *  Re-exported from the shared engine module rather than reimplemented — this
 *  file and the migration used 0.5 while two Edge Functions used 0.3, and
 *  replenishment routing reads this value to price a pull. */
export { accessOffsetForLevel } from '@/supabase/functions/_shared/wie/levelGeometry'
