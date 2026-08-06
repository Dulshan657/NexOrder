// Binding a named area's bins to its ZONE (mig 00096).
//
// 00090 gave an area a `meta.zoneProfileId`; this is what finally reads it.
//
// THE PROBLEM THIS SOLVES. A bin's zone is not a column. It is derived by
// prefix-matching the bin's materialized_path against kind='ZONE' rows — the
// LATERAL join in wie_putaway_candidates. Every drawn bin is parented at the
// warehouse ROOT, so that join has returned NULL for every bin on every site
// since it was written, and the whole zone subsystem (allowed_categories,
// priority_weight, max_utilization_pct, the zoneTag rule field) has never fired.
// Binding means RE-PARENTING: a new parent_id and a new materialized_path.
//
// THE RULE, once, for a unit — a flat bin, or a levelled rack's RACK PARENT:
//
//   area (by areaForRect) has a zoneProfileId   -> that profile's ZONE
//   else the placement's own zone_profile_id    -> that profile's ZONE
//   else                                        -> the warehouse root
//
// Erasing an area, shrinking it off a rack, or clearing its profile is NOT a
// special case — it is the third branch, reached by evaluating the same rule
// again. That is what makes the reverse free, and it is the half most likely to
// be missing in a design that thinks of binding as a one-way action.
//
// WHY THE AREA WINS over the placement's own zone_profile_id. The per-bin
// dropdown (PlacementInspector, RackWizard) predates areas and is invisible on
// the map; an area is the thing the operator drew, named and can see. The
// dropdown survives as the fallback for bins outside any area.
//
// CONTAINMENT IS NOT REDEFINED HERE. Which area a rack sits in is answered by
// areaForRect — the majority-of-cells vote with its `smallerName` tie-break —
// imported from locationNaming.ts, not restated. A second copy would let naming
// and binding disagree about the same rack, so `Chiller · Rack 7` could end up
// in the Bulk zone. There is exactly one containment rule in this codebase.
//
// Pure: no Deno, no I/O, no fetch (__tests__/wie/purity.test.ts). The find-or-
// create of the ZONE rows themselves is I/O and lives in _shared/zoneResolve.ts,
// which is why binding is two functions rather than one — zoneTargets says which
// profiles are wanted, the caller resolves them, planZoneBinding says what moves.

import { areaForRect, type AreaIndex, type NamedRect } from './locationNaming.ts'

/** A unit that can be bound: a flat bin, or a levelled rack's RACK parent.
 *  Never a SHELF — a level's zone is its rack's, and its path rides along. */
export interface BindingUnit extends NamedRect {
  /** Stable identity for grouping. `loc:<id>` server-side. */
  ref: string
  id: number
  /** The last segment of materialized_path. Never changes — it is the QR payload. */
  code: string
  /** As stored right now. */
  parentId: number | null
  /** As stored right now. */
  path: string
  /** The placement's own zone_profile_id: the pre-area fallback, not the winner. */
  ownZoneProfileId?: number | null
  /** SHELF children, whose paths must be rewritten whenever the rack moves. */
  levels?: ReadonlyArray<BindingLevel>
}

/** A SHELF row under a levelled rack. Its parent never changes; its path does. */
export interface BindingLevel {
  id: number
  code: string
  path: string
}

/** Where a unit's area says it belongs. */
export interface ZoneTarget {
  /** '' when the unit sits in no named area. */
  areaName: string
  /** The AREA's profile. null when the area carries none, or there is no area. */
  profileId: number | null
}

/** A resolved `kind='ZONE'` location. */
export interface ZoneRow {
  id: number
  path: string
}

/** The warehouse root — the destination when a unit belongs to no zone. */
export interface WarehouseRoot {
  id: number
  path: string
}

/** One row for wie_reparent_locations_tx. Snake_case: it is the RPC's recordset. */
export interface ReparentMove {
  id: number
  parent_id: number
  materialized_path: string
}

/** What one area contributes, for the preview. */
export interface AreaBindingSummary {
  areaName: string
  profileId: number | null
  zoneId: number | null
  /** Units sitting in this area. */
  units: number
  /** Of which actually move. */
  moved: number
  /** Location ids of the units in this area — for the stocked-category warning. */
  unitIds: number[]
}

export interface ZoneBindingPlan {
  /** Ready for the RPC. Units and their levels, sorted by id for determinism. */
  moves: ReparentMove[]
  /** Units that move (excludes the SHELF rows riding along). */
  units: number
  /** SHELF rows whose path was rewritten. */
  levels: number
  /** Units returning to the warehouse root (unbound). */
  toRoot: number
  /** Units already in the right place. */
  unchanged: number
  byArea: AreaBindingSummary[]
  /** A few human-readable moves, for the preview. */
  examples: Array<{ code: string; from: string; to: string }>
}

const MAX_EXAMPLES = 5

/**
 * Which zone profile does each unit want?
 *
 * Pure and zone-free on purpose: it runs BEFORE any ZONE row exists, so the
 * caller can collect the distinct profile ids and find-or-create exactly those.
 * Resolving a zone per unit would create rows for profiles nothing ends up using.
 *
 * `profileByArea` maps an area NAME to its `meta.zoneProfileId`. Areas are keyed
 * by name across the whole site (00094's pools work the same way), so an area
 * painted on two floors is one entry.
 */
export function zoneTargets(
  units: readonly BindingUnit[],
  areaIndex: AreaIndex,
  profileByArea: ReadonlyMap<string, number | null>,
): Map<string, ZoneTarget> {
  const out = new Map<string, ZoneTarget>()
  for (const unit of units) {
    const areaName = areaForRect(areaIndex, unit)
    out.set(unit.ref, {
      areaName,
      profileId: areaName ? profileByArea.get(areaName) ?? null : null,
    })
  }
  return out
}

/** Every profile id `zoneTargets` asked for, deduped — what to find-or-create. */
export function requiredProfileIds(
  units: readonly BindingUnit[],
  targets: ReadonlyMap<string, ZoneTarget>,
): number[] {
  const ids = new Set<number>()
  for (const unit of units) {
    const profileId = resolveProfileId(unit, targets.get(unit.ref))
    if (profileId != null) ids.add(profileId)
  }
  return [...ids].sort((a, b) => a - b)
}

/** The rule's first two branches. Exported for the tests to pin directly. */
export function resolveProfileId(
  unit: BindingUnit,
  target: ZoneTarget | undefined,
): number | null {
  const fromArea = target?.profileId ?? null
  if (fromArea != null) return fromArea
  return unit.ownZoneProfileId ?? null
}

/**
 * What actually moves.
 *
 * Emits a move ONLY when parent_id or the path genuinely differs — the same
 * discipline as nameWriteNeeded, and the reason an ordinary geometry drag
 * rewrites nothing. It is also what makes the plan idempotent: replaying a
 * settled site yields zero moves, which is the only real proof the rule is total.
 *
 * A unit's levels are checked INDEPENDENTLY of the unit. A rack already in the
 * right place can still have a level whose path drifted (a level added while the
 * rack sat elsewhere, or a half-applied earlier batch), and skipping the levels
 * because the parent looked settled is exactly how a tree ends up with a row
 * that the LATERAL cannot see and the Locations tree can.
 */
export function planZoneBinding(
  units: readonly BindingUnit[],
  targets: ReadonlyMap<string, ZoneTarget>,
  zonesByProfile: ReadonlyMap<number, ZoneRow>,
  warehouse: WarehouseRoot,
): ZoneBindingPlan {
  const moves: ReparentMove[] = []
  const examples: Array<{ code: string; from: string; to: string }> = []
  const areas = new Map<string, AreaBindingSummary>()
  let unitMoves = 0
  let levelMoves = 0
  let toRoot = 0
  let unchanged = 0

  for (const unit of units) {
    const target = targets.get(unit.ref)
    const areaName = target?.areaName ?? ''
    const profileId = resolveProfileId(unit, target)

    let destination: WarehouseRoot | ZoneRow
    if (profileId == null) {
      destination = warehouse
    } else {
      const zone = zonesByProfile.get(profileId)
      if (!zone) {
        // A caller bug, and the one failure mode worth being loud about: falling
        // back to the root here would silently UNBIND a bin the operator just
        // asked to bind, and the symptom would surface much later as putaway
        // ignoring a zone that the map still draws.
        throw new Error(`No zone resolved for profile ${profileId} (unit ${unit.ref})`)
      }
      destination = zone
    }

    const nextPath = `${destination.path}/${unit.code}`
    const settled = unit.parentId === destination.id && unit.path === nextPath

    if (settled) {
      unchanged++
    } else {
      moves.push({ id: unit.id, parent_id: destination.id, materialized_path: nextPath })
      unitMoves++
      if (profileId == null) toRoot++
      if (examples.length < MAX_EXAMPLES) {
        examples.push({ code: unit.code, from: unit.path, to: nextPath })
      }
    }

    // Levels, always — see the note above.
    for (const level of unit.levels ?? []) {
      const nextLevelPath = `${nextPath}/${level.code}`
      if (level.path === nextLevelPath) continue
      moves.push({ id: level.id, parent_id: unit.id, materialized_path: nextLevelPath })
      levelMoves++
    }

    // byArea describes AREAS, so it reports the AREA's profile — not the resolved
    // one, which may have come from a bin's own dropdown. Without this the ''
    // bucket (bins in no area at all) would inherit whichever fallback profile
    // its first member happened to carry, and categoryConflicts would then warn
    // about "the area called ''".
    const areaProfileId = target?.profileId ?? null
    const summary = areas.get(areaName) ?? {
      areaName,
      profileId: areaProfileId,
      zoneId: areaProfileId == null ? null : zonesByProfile.get(areaProfileId)?.id ?? null,
      units: 0,
      moved: 0,
      unitIds: [],
    }
    summary.units++
    summary.unitIds.push(unit.id)
    if (!settled) summary.moved++
    areas.set(areaName, summary)
  }

  return {
    // Sorted so the RPC payload — and therefore the audit trail — is stable
    // regardless of the order the caller happened to resolve placements in.
    moves: moves.sort((a, b) => a.id - b.id),
    units: unitMoves,
    levels: levelMoves,
    toRoot,
    unchanged,
    byArea: [...areas.values()].sort((a, b) => (a.areaName < b.areaName ? -1 : a.areaName > b.areaName ? 1 : 0)),
    examples,
  }
}

/**
 * Areas whose profile would refuse stock the bins already hold.
 *
 * `zone_profiles.allowed_categories` is a HARD allow-list in the putaway engine,
 * and binding turns it on for the first time — a bin that gains a zone can become
 * un-selectable while still holding the very stock the zone excludes.
 *
 * This WARNS and never blocks, for the reason the setup checklist's guardrails
 * warn: refusing would not move the pallets off the rack, it would only stop the
 * operator recording where they are.
 */
export function categoryConflicts(
  plan: ZoneBindingPlan,
  allowedByProfile: ReadonlyMap<number, readonly string[] | null>,
  categoriesByLocation: ReadonlyMap<number, readonly string[]>,
): Array<{ areaName: string; profileId: number; bins: number; categories: string[] }> {
  const out: Array<{ areaName: string; profileId: number; bins: number; categories: string[] }> = []
  for (const area of plan.byArea) {
    if (area.profileId == null) continue
    const allowed = allowedByProfile.get(area.profileId)
    // null / absent = "any category", which can never conflict.
    if (!allowed || allowed.length === 0) continue
    const allowedSet = new Set(allowed)
    const offending = new Set<string>()
    let bins = 0
    for (const id of area.unitIds) {
      const held = categoriesByLocation.get(id) ?? []
      const bad = held.filter((c) => !allowedSet.has(c))
      if (bad.length === 0) continue
      bins++
      for (const c of bad) offending.add(c)
    }
    if (bins > 0) {
      out.push({
        areaName: area.areaName,
        profileId: area.profileId,
        bins,
        categories: [...offending].sort(),
      })
    }
  }
  return out
}
