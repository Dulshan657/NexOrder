// Which labels a published layout needs, and which sheet of stock each prints on.
//
// PURE — no Deno, no I/O — so the generate-labels Edge Function and vitest run
// the identical module (same contract as _shared/wie/* and _shared/labelSheet.ts).
//
// Why a job is several PDFs rather than one: a bin sticker (99x38mm) and an
// aisle sign (99x68mm) come off different die-cut sheets. You cannot feed both
// through a printer in one pass, so "print everything this layout needs" has to
// resolve to one file per stock. The grouping is data, below.
//
// Slots print on the 99x38mm sheet rather than the cheaper 63x34mm one because
// a 13-character location code encodes to 0.31mm bars at that size and 0.48mm
// at this one. The cost is real -- 945 slots is 68 sheets instead of 40 -- and
// it buys a symbol that survives a scuffed sticker. `_shared/labels/sizing.ts`
// is where that judgement is made and is the only file holding a threshold.
//
// The row shape is what wie_layout_label_targets returns (mig 00084). Context is
// composed HERE rather than in SQL so the wording is unit-testable without a
// database, and so the level-role display name arrives as data — never compared
// to a literal (see the level-roles contract in _shared/wie/levelRoles.ts).

import type { SheetPresetName } from '../labelSheet.ts'
// Same predicate the screens use, so a name the UI refuses to show as a
// headline is never printed on a sticker either.
import { isUninformativeName } from '../wie/locationNaming.ts'

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
  { group: 'slots', preset: 'a4-14', kinds: ['BIN', 'SHELF', 'BAY'] },
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

/** A site's saved stock choice per sheet group (mig 00106). Sparse: absent = default. */
export type LabelPresetPrefs = Partial<Record<SheetGroup, SheetPresetName | null>>

/**
 * The stock a group actually prints on: the site's saved preference, else the
 * built-in default.
 *
 * One line, and it still earns its own function — the browser shows this in the
 * job preview and generate-labels renders with it, and if the two ever
 * disagreed the operator would be told one sheet size and handed another.
 */
export function resolvePreset(group: SheetGroup, prefs?: LabelPresetPrefs): SheetPresetName {
  return prefs?.[group] ?? presetForGroup(group)
}

/**
 * The most a 63×34 mm sticker's context line holds at a legible size.
 *
 * `labelArtwork` already shrinks the context to MIN_CONTEXT_FONT_SIZE (5 pt) and
 * then ellipsizes — SILENTLY. That is fine for one part too many and terrible
 * for the case a long area name creates, where the level role at the end is what
 * gets eaten. Dropping a whole part, in a stated order, makes it a decision
 * rather than a font-shrink accident.
 */
export const MAX_CONTEXT_CHARS = 36

/**
 * The second line of a label — where this thing sits and what it is for.
 *
 * A SLOT now leads with its own NAME (mig 00094): "Chiller · Rack 7 · L2" is
 * the string the operator reads on the pick list, and a sticker that does not
 * repeat it forces them to translate between two vocabularies while holding a
 * carton. The level role follows, because that is the next question once you
 * are at the right rack ("pick zone, or the reserve above it?").
 *
 * A SIGN still leads with the hierarchy — someone reading a rack sign from
 * across the floor is navigating, not confirming.
 *
 * The order also decides what survives truncation, which is the real reason it
 * is not alphabetical: parts are dropped from the END until the line fits.
 *
 * Pieces that merely restate the location's own identity are dropped: a zone
 * label reading "Chilled · Chilled" helps nobody.
 */
export function labelContext(row: LabelTargetRow): string {
  const upper = (row.kind ?? '').toUpperCase()
  const isSlot = groupForKind(upper) === 'slots'

  // A name worth printing. `Bin 9,4` and `Level 4` are the pre-00094 generated
  // names — they repeat the coordinate the code already carries — so they are
  // not printed as context, exactly as before.
  const ownName = isSlot && !isUninformativeName(row.name, row.code ?? '') ? row.name : null

  // When the name IS being printed, only the code may filter a part out. Leaving
  // the name in this set would make it filter itself.
  const own = new Set(
    [ownName ? null : row.name, row.code]
      .filter((v): v is string => !!v)
      .map((v) => v.toLowerCase()),
  )

  const zone = upper === 'ZONE' ? null : row.zoneName
  const aisle = upper === 'AISLE' ? null : row.aisleCode
  const role = row.levelRoleName

  const ordered = isSlot ? [ownName, role, aisle, zone] : [zone, aisle, role]

  const seen = new Set<string>()
  const parts = ordered.filter((part): part is string => {
    if (!part) return false
    const key = part.toLowerCase()
    if (own.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Drop from the END until it fits — never mid-word, and never below one part.
  while (parts.length > 1 && parts.join(' · ').length > MAX_CONTEXT_CHARS) parts.pop()

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
