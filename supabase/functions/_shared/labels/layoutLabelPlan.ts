// Which labels a published layout needs, and which sheet of stock each prints on.
//
// PURE — no Deno, no I/O — so the generate-labels Edge Function and vitest run
// the identical module (same contract as _shared/wie/* and _shared/labelSheet.ts).
//
// Why a job is several PDFs rather than one: a bin sticker (63x34mm) and an
// aisle sign (99x67mm) come off different die-cut sheets. You cannot feed both
// through a printer in one pass, so "print everything this layout needs" has to
// resolve to one file per stock. The grouping is data, below.
//
// The row shape is what wie_layout_label_targets returns (mig 00084). Context is
// composed HERE rather than in SQL so the wording is unit-testable without a
// database, and so the level-role display name arrives as data — never compared
// to a literal (see the level-roles contract in _shared/wie/levelRoles.ts).

import type { SheetPresetName } from '../labelSheet.ts'

export type SheetGroup = 'wayfinding' | 'slots' | 'staging'

/** One row of wie_layout_label_targets, camelCased. */
export interface LabelTargetRow {
  locationId: number
  code: string
  kind: string
  name: string | null
  /** Name of the ancestor ZONE, or null above/outside one. */
  zoneName: string | null
  /** Code of the ancestor AISLE, or null above/outside one. */
  aisleCode: string | null
  /** level_roles.display_name for this level, already resolved. Null = legacy bin. */
  levelRoleName: string | null
  levelIndex: number | null
  labelPrinted: boolean
}

export interface PlannedLabel {
  locationId: number
  code: string
  context: string
}

export interface PlannedSheet {
  group: SheetGroup
  preset: SheetPresetName
  items: PlannedLabel[]
}

/**
 * Group order is print order: signs first, because they go up before anyone can
 * use the bin stickers underneath them.
 *
 * A levelled rack is `kind = 'RACK'` and mig 00072 DELETES its placement row —
 * its SHELF levels are the storable slots. So keying on kind alone is enough to
 * keep a container out of the slot sheet; there is no "has levels" flag to get
 * wrong. An unlevelled BIN or BAY is a placement in its own right and belongs in
 * `slots`, which is exactly what this table says.
 */
export const SHEET_GROUPS: ReadonlyArray<{
  group: SheetGroup
  preset: SheetPresetName
  kinds: readonly string[]
}> = [
  { group: 'wayfinding', preset: 'a4-8', kinds: ['ZONE', 'AISLE', 'RACK'] },
  { group: 'slots', preset: 'a4-24', kinds: ['BIN', 'SHELF', 'BAY'] },
  { group: 'staging', preset: 'a4-14', kinds: ['STAGING'] },
]

/** The sheet a location kind prints on, or null if it gets no sticker at all. */
export function groupForKind(kind: string | null | undefined): SheetGroup | null {
  if (!kind) return null
  const upper = kind.toUpperCase()
  return SHEET_GROUPS.find((g) => g.kinds.includes(upper))?.group ?? null
}

export function presetForGroup(group: SheetGroup): SheetPresetName {
  // Non-null by construction: every SheetGroup has a row above.
  return SHEET_GROUPS.find((g) => g.group === group)!.preset
}

/**
 * The second line of a label — where this thing sits and what it is for.
 *
 * A slot leads with its level role because that is what an operator is checking
 * when they are already standing at the right rack ("is this the pick zone or
 * the reserve above it?"). A sign leads with the hierarchy, because someone
 * reading it from across the floor is still navigating. That ordering also
 * decides what survives truncation on a 63x34mm sticker, which is the real
 * reason it is not just alphabetical.
 *
 * Pieces that merely restate the location's own identity are dropped: a zone
 * label reading "Chilled · Chilled" helps nobody.
 */
export function labelContext(row: LabelTargetRow): string {
  const upper = (row.kind ?? '').toUpperCase()
  const own = new Set(
    [row.name, row.code].filter((v): v is string => !!v).map((v) => v.toLowerCase()),
  )

  const zone = upper === 'ZONE' ? null : row.zoneName
  const aisle = upper === 'AISLE' ? null : row.aisleCode
  const role = row.levelRoleName

  const ordered =
    groupForKind(upper) === 'slots' ? [role, aisle, zone] : [zone, aisle, role]

  const seen = new Set<string>()
  const parts = ordered.filter((part): part is string => {
    if (!part) return false
    const key = part.toLowerCase()
    if (own.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (parts.length > 0) return parts.join(' · ')
  // Nothing situates it — fall back to its own name. Never the code: that is
  // already printed in large type directly above this line.
  return row.name ?? ''
}

/**
 * Split target rows into one sheet per stock, dropping empty groups.
 *
 * Input order is preserved within a group because the SQL orders by code, and a
 * sheet whose stickers peel off in code order is one an operator can walk a rack
 * with. Rows are deduplicated by location: the ancestor walk surfaces a shared
 * zone once per descendant branch, and nobody wants forty identical zone signs.
 */
export function planLabelJob(rows: readonly LabelTargetRow[]): PlannedSheet[] {
  const buckets = new Map<SheetGroup, PlannedLabel[]>()
  const seen = new Set<number>()

  for (const row of rows) {
    const group = groupForKind(row.kind)
    if (!group) continue
    if (seen.has(row.locationId)) continue
    seen.add(row.locationId)

    const items = buckets.get(group) ?? []
    items.push({ locationId: row.locationId, code: row.code, context: labelContext(row) })
    buckets.set(group, items)
  }

  return SHEET_GROUPS.filter((g) => (buckets.get(g.group)?.length ?? 0) > 0).map((g) => ({
    group: g.group,
    preset: g.preset,
    items: buckets.get(g.group)!,
  }))
}
