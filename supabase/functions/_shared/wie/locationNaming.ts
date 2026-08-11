// Friendly location names — composition, containment and numbering.
//
// Pure and IO-free, and it lives in _shared/wie/ so the Vite frontend imports the
// very module the Edge Function runs. The designer's preview of "this rack will
// be called Chiller · Rack 7" is therefore not a second implementation of the
// server's decision — it IS the server's decision, evaluated early. Same split as
// _shared/binCount.ts ↔ lib/binCount.ts and _shared/wie/replenPolicy.ts ↔
// lib/replenPolicy.ts. Never fork it.
//
// WHAT PROBLEM THIS SOLVES. A location code is `<WH>-B-<gridX>-<gridY>[-L<n>]`.
// The numbers are LAYOUT GRID COORDINATES. `NEXG-B-9-4-L4` is not aisle 9 bay 4,
// it is the cell at (9,4) — and there is no aisle or bay anywhere in the tree
// either: a drawn layout is Warehouse → [Zone] → Rack → Shelf. So the grouping an
// operator would actually say out loud has to come from somewhere, and the one
// place it already exists is the named `area` they painted over the racks (00090)
// — which until now nothing read.
//
// THE CODE IS NEVER TOUCHED. It is the QR payload, the scan identity, a
// materialized_path segment and the CSV `bin_code` column. This module composes
// display text and hands out numbers; it must never emit anything code-shaped.
//
// THE NUMBERING RULE, WHICH IS THE WHOLE THING.
// A number is assigned when a rack is first drawn and NEVER reassigned. Delete
// rack 3 and the next rack drawn is 6, not 3 — gaps are permanent. This is not
// tidiness lost, it is the only safe rule: a sign already screwed to the racking
// cannot be un-printed, and re-minting 3 puts two different racks under one name
// on the same floor. Everything below follows from it:
//
//   * a seq is handed out only where `nameSeq == null`, and it is always
//     `max(claimed) + 1` — gaps are never backfilled;
//   * which makes the whole pass monotonic, which is what makes it safe for the
//     server to recompute the client's answer rather than trust it;
//   * and a claim is held by the pool a unit CARRIES (`nameArea`), not the area
//     it currently sits in. Paint "Bulk" over `Chiller · Rack 1..5` and Chiller's
//     pool still knows those five numbers are spoken for. A geometry-derived pool
//     would find Chiller empty and mint a second live `Chiller · Rack 1`.
//
// POOLS ARE PER AREA NAME, ACROSS FLOORS. Two floors both painted "Chiller" share
// one 1..N run. Per-floor pools would put a `Chiller · Rack 1` on each floor,
// which is the exact ambiguity this feature exists to remove — and the fix for
// that (folding the floor into the name) would rewrite already-printed names the
// day a second floor is added. Note this is consistent with 00090's "an area's
// identity is its NAME, per floor": that is about region MERGING, which is a
// flood fill and genuinely cannot cross floors. A region is a per-floor blob; an
// area is the set of all blobs sharing a name.
//
// NOT USED BY BULK WAREHOUSES. A bulk site has no layout, no layout_objects and
// no areas — stock sits at the warehouse root. Nothing here is invoked for one,
// and lib/locationDisplay.ts falls back to the code. That is intended; do not
// "fix" it by inventing a name for a root.

/** The separator between name parts. Deliberately NOT '-', which is the code
 *  separator — a name and a code must never be mistakable for one another. */
export const NAME_SEP = ' · '

/** The word used for a numbered unit. A drawn cell is a bay/rack/bin depending
 *  on who you ask; "Rack" is what operators on this site say. The default, and
 *  what every unit got before nouns were derived at all. */
export const RACK_WORD = 'Rack'

/** …and what a marked-out spot on the slab is called instead. */
export const PALLET_WORD = 'Pallet'

/** The two fields of a storage form that decide a unit's noun. Camel-cased, so
 *  the Edge Functions map their snake_case rows before calling in — the same
 *  shape both runtimes already use for a form elsewhere. */
export interface NamingForm {
  isFloor?: boolean | null
  slotUnit?: string | null
}

/**
 * What to call a unit drawn with this form.
 *
 * "Bulk · Rack 3" is a lie about a pallet painted onto a concrete slab, and it
 * is what an operator standing in the bulk area reads off the map. A form that
 * is a FLOOR (mig 00100) and is denominated in PALLETS holds exactly one thing,
 * a pallet, so that is the word.
 *
 * Everything else stays "Rack", INCLUDING a floor denominated in cartons or in
 * nothing (MAIN_BULK_FLOOR, BULK_FLOOR). There is no better word for a
 * carton-counted floor block that would not be invented vocabulary, and — the
 * reason this is safe rather than merely arbitrary — no such unit is auto-named
 * anywhere today, so nothing is renamed by leaving them alone.
 *
 * A missing form also means "Rack": a bin drawn before storage forms existed
 * keeps the only name it has ever had.
 */
export function unitNoun(form?: NamingForm | null): string {
  return form?.isFloor === true && form.slotUnit === 'pallet' ? PALLET_WORD : RACK_WORD
}

/** Longest area name we accept. 60 + `${NAME_SEP}Rack 999${NAME_SEP}L99` = 76,
 *  comfortably inside the 120-char cap on `locations.name`. */
export const MAX_AREA_NAME = 60

// ── Containment ─────────────────────────────────────────────────────────────

/** A `layout_objects` row, as either runtime holds it. Only `object_type` ===
 *  'area' rows are read; everything else is ignored. */
export interface AreaCellSource {
  objectType: string
  floor: number
  x: number
  y: number
  w?: number | null
  h?: number | null
  meta?: Record<string, unknown> | null
}

/** Anything occupying grid cells: a placement, or a probe for a cell about to be
 *  painted. `w`/`h` default to 1. */
export interface NamedRect {
  floor: number
  x: number
  y: number
  w?: number | null
  h?: number | null
}

/** `floor:x:y` → area name. Rasterized; see buildAreaIndex. */
export type AreaIndex = ReadonlyMap<string, string>

function cellKey(floor: number, x: number, y: number): string {
  return `${floor}:${x}:${y}`
}

/** The operator's name on an area object, trimmed. '' when absent or blank —
 *  matching objectRegions.regionGroupKey, which groups unnamed cells together. */
export function areaNameOf(object: Pick<AreaCellSource, 'meta'>): string {
  const raw = object.meta?.name
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * Which of two areas wins a cell they both cover.
 *
 * Plain `<` on the raw string, never `localeCompare`: locale-dependent ordering
 * would let the browser and the Deno isolate disagree about a name, and the whole
 * point of this module is that they cannot.
 *
 * Overlap is not supposed to happen — `paint_cell` replaces — but a floor-plan
 * import or an overlap resolution can produce it, and a silent coin-toss between
 * two names is worse than an arbitrary but stable rule.
 */
function smallerName(a: string, b: string): string {
  return a < b ? a : b
}

/** Rasterize every named area object into a cell → name map. */
export function buildAreaIndex(objects: readonly AreaCellSource[]): AreaIndex {
  const index = new Map<string, string>()
  for (const object of objects) {
    if (object.objectType !== 'area') continue
    const name = areaNameOf(object)
    if (!name) continue
    const w = Math.max(1, object.w ?? 1)
    const h = Math.max(1, object.h ?? 1)
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const key = cellKey(object.floor, object.x + dx, object.y + dy)
        const existing = index.get(key)
        index.set(key, existing === undefined ? name : smallerName(existing, name))
      }
    }
  }
  return index
}

/**
 * The area covering one cell, by linear scan.
 *
 * The primitive form, for a single paint stroke — rasterizing a 2000-cell area on
 * every pointer move would be absurd. A test pins that this agrees with
 * buildAreaIndex cell-for-cell.
 */
export function areaNameAt(
  objects: readonly AreaCellSource[],
  floor: number,
  x: number,
  y: number,
): string {
  let found = ''
  for (const object of objects) {
    if (object.objectType !== 'area' || object.floor !== floor) continue
    const name = areaNameOf(object)
    if (!name) continue
    const w = Math.max(1, object.w ?? 1)
    const h = Math.max(1, object.h ?? 1)
    if (x < object.x || x >= object.x + w) continue
    if (y < object.y || y >= object.y + h) continue
    found = found === '' ? name : smallerName(found, name)
  }
  return found
}

export function areaNameAtIndexed(index: AreaIndex, floor: number, x: number, y: number): string {
  return index.get(cellKey(floor, x, y)) ?? ''
}

/**
 * The area a placement belongs to: whichever covers the most of its cells, ties
 * broken by the smaller name.
 *
 * Not theoretical — MAIN's bays are two cells wide, so a rack can genuinely
 * straddle the boundary between two painted areas.
 */
export function areaForRect(index: AreaIndex, rect: NamedRect): string {
  const w = Math.max(1, rect.w ?? 1)
  const h = Math.max(1, rect.h ?? 1)
  if (w === 1 && h === 1) return areaNameAtIndexed(index, rect.floor, rect.x, rect.y)

  const tally = new Map<string, number>()
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const name = areaNameAtIndexed(index, rect.floor, rect.x + dx, rect.y + dy)
      if (!name) continue
      tally.set(name, (tally.get(name) ?? 0) + 1)
    }
  }

  let best = ''
  let bestCount = 0
  for (const [name, count] of tally) {
    if (count > bestCount || (count === bestCount && best !== '' && name < best)) {
      best = name
      bestCount = count
    }
  }
  return best
}

// ── Composition ─────────────────────────────────────────────────────────────

/**
 * The stored name for a rack, or for one of its levels.
 *
 * A level's name is composed IN FULL rather than left to be joined with its
 * parent's at render time, because a pick task, a putaway stop and a replen stop
 * all point at the SHELF row directly and would otherwise each need a parent
 * lookup to say where the operator should stand.
 */
export function composeName(
  areaName: string,
  seq: number,
  levelIndex?: number | null,
  noun: string = RACK_WORD,
): string {
  const area = areaName.trim()
  const base = area ? `${area}${NAME_SEP}${noun} ${seq}` : `${noun} ${seq}`
  return levelIndex == null ? base : `${base}${NAME_SEP}L${levelIndex}`
}

// ── Noun drift ──────────────────────────────────────────────────────────────
//
// A unit's noun follows its FORM (unitNoun), and a form is operator-managed data
// that can be edited years after the units were drawn. When it is, every unit
// wearing it is suddenly called the wrong thing — `Bulk Storage · Rack 7` for a
// pallet on a slab. `assignAutoNames` already fixes that, but only for units a
// naming PASS reaches, and the only passes that run are `save_geometry` (drafts)
// and the opt-in area cascades (units whose area moved). On a published layout
// that is nothing at all, which is how `Quarantine · Rack 2` survived beside 22
// siblings reading `· Pallet`.
//
// This is the same recomposition with none of the assignment. NO NUMBER IS
// ISSUED and no pool is decided: `name_area` and `name_seq` are stored columns
// (00094) precisely so the name can be rebuilt from them, and a restamp changes
// the WORD and nothing else. That is what makes it safe on live racking whose
// labels are already printed — the printed thing is the CODE, and the code is
// untouched.

/** An auto-named unit, with the levels hanging off it, for a noun restamp. */
export interface RestampUnit {
  id: number
  /** The name stored today — a write is emitted only if it actually differs. */
  name: string
  nameArea: string | null
  nameSeq: number
  /** A levelled rack's SHELF rows. A level carries no number of its own: it is
   *  composed from its PARENT's pool plus its own index, exactly as
   *  mutate-layout composes one. Hand-named levels are filtered by the caller. */
  levels?: ReadonlyArray<{ id: number; name: string; levelIndex: number }>
}

/** One row to rewrite. `nameSeq`/`nameArea` are echoed back UNCHANGED so the
 *  write cannot quietly move a unit between pools. */
export interface RestampWrite {
  id: number
  name: string
  nameSeq: number | null
  nameArea: string | null
}

/**
 * Recompose every auto name for a new noun, and return only what changed.
 *
 * Emitting only differences is not an optimisation: a form edit that does not
 * move the noun (a colour, a weight limit) must write no names at all, or every
 * such save would churn `locations` and read as a rename in the audit log.
 */
export function restampNames(units: readonly RestampUnit[], noun: string): RestampWrite[] {
  const out: RestampWrite[] = []
  for (const unit of units) {
    const area = unit.nameArea ?? ''
    const name = composeName(area, unit.nameSeq, null, noun)
    if (name !== unit.name) {
      out.push({ id: unit.id, name, nameSeq: unit.nameSeq, nameArea: unit.nameArea })
    }
    for (const level of unit.levels ?? []) {
      const levelName = composeName(area, unit.nameSeq, level.levelIndex, noun)
      if (levelName !== level.name) {
        // A level's stored `name_seq` is null and its `name_area` is the rack's
        // — mutate-layout's own level write, restated so the two agree.
        out.push({ id: level.id, name: levelName, nameSeq: null, nameArea: unit.nameArea })
      }
    }
  }
  return out
}

/** Trim, collapse runs of whitespace, and cap. What the server stores and what
 *  the designer previews must agree byte-for-byte, so both call this. */
export function sanitizeAreaName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_AREA_NAME)
}

/**
 * The same rules MINUS the trailing trim, for a controlled text input.
 *
 * sanitizeAreaName cannot be applied per keystroke: it trims, so the space in
 * "Cold Storage" is deleted the instant it is typed and the operator gets
 * "ColdStorage" with no way to fix it. Verified in a real browser — the field
 * simply refuses spaces.
 *
 * Leading whitespace is still dropped (a name cannot start with a space) and the
 * cap still applies, so the only difference is a space the operator is currently
 * typing THROUGH. That is safe because nothing stores this value: every paint
 * path runs the real sanitizeAreaName before writing a cell, and the server runs
 * it again on receipt. The byte-for-byte contract is unaffected.
 */
export function sanitizeAreaNameInput(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/^\s+/, '').slice(0, MAX_AREA_NAME)
}

/**
 * Why an area name is unusable, or null when it is fine. For the input's inline
 * hint — the server validates the same things.
 *
 * `·` is rejected because it is the part separator: "Cold · Dry" composes to
 * `Cold · Dry · Rack 7`, which no code parses (nothing ever reads a name back)
 * but which a human cannot tell from a three-level path.
 */
export function areaNameIssue(raw: string): string | null {
  const name = sanitizeAreaName(raw)
  if (!name) return 'Give the area a name.'
  if (name.includes('·')) return 'Names cannot contain “·” — it separates the parts of a location name.'
  if (raw.trim().length > MAX_AREA_NAME) return `Keep it to ${MAX_AREA_NAME} characters.`
  return null
}

/**
 * True when a name tells the operator nothing the code does not.
 *
 * This is what stops the ~1100 rows on a warehouse that predates this feature
 * from displaying `Bin 9,4` as a headline. It is a HEURISTIC and knows it: it
 * matches the two legacy generators exactly and nothing else, so it deliberately
 * does NOT match `Rack 12`, which is a legitimate name for a rack drawn outside
 * any area.
 */
export function isUninformativeName(name: string | null | undefined, code: string): boolean {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return true

  const upperCode = (code ?? '').trim().toUpperCase()
  const upperName = trimmed.toUpperCase()
  if (upperCode && upperName === upperCode) return true

  // A name that CONTAINS the whole code adds nothing over it, and is actively
  // worse on a canvas: `Bin WIEDEMO-Z1-AL-R1-B3` elides to "Bin WI…" — identical
  // for every bin on the floor — where the bare code keeps its discriminating
  // tail ("…R1-B3"). This is the seeded shape on WIE-DEMO and MAIN, so it is the
  // common case, not an edge one.
  if (upperCode && upperName.includes(upperCode)) return true

  // The two generators the layout designer has used since 00027.
  if (/^Bin \d+,\d+$/.test(trimmed)) return true
  if (/^Level \d+$/.test(trimmed)) return true
  return false
}

// ── Assignment ──────────────────────────────────────────────────────────────

/** One numberable thing: a flat BIN, or a RACK parent plus its level indexes. */
export interface NamingUnit extends NamedRect {
  /** Stable identity for the caller to match the result back. `clientRef` in the
   *  designer, `loc:<id>` server-side. */
  ref: string
  /** The name the row carries today, if any — used only to report `restamped`. */
  name?: string | null
  /** May an area rename restamp this? False = a human typed the name. */
  nameIsAuto: boolean
  /** The number already claimed, or null for something never numbered. */
  nameSeq: number | null
  /** The pool that number was drawn from. NOT derived from geometry. */
  nameArea: string | null
  /** 1-based level indexes, for a levelled rack. Empty/absent for a flat bin. */
  levelIndexes?: readonly number[]
  /**
   * What this unit is CALLED — `unitNoun` of its own storage form (mig 00100).
   *
   * Per unit, not per pass: two units in one area can carry different forms, and
   * a floor pallet standing beside a rack must not be renamed to match it. It
   * follows the unit's FORM, so the only names this ever rewrites are those of
   * units whose form actually changed — which is a deliberate act, and
   * restamping then is the point.
   *
   * Absent = RACK_WORD, which is what every unit composed before this existed.
   */
  noun?: string
}

export interface NamingOptions {
  /** An area rename — the only thing that ever rewrites an existing name. */
  rename?: { from: string; to: string }
  /** Restamp hand-named rows too. The operator's explicit opt-in. */
  includeCustom?: boolean
  /**
   * Pool → the highest number ever handed out in it, INCLUDING rows that are no
   * longer in this layout.
   *
   * Load-bearing, and the units alone cannot supply it. Delete a saved rack and
   * its placement row goes, but its `locations` row survives — publishing never
   * retires a bin, and its QR label is still on the racking. Derive the pool
   * from the units and that number looks free, so the next rack drawn takes it
   * and two racks on the same floor answer to one name. The caller loads this
   * from the warehouse: MAX(name_seq) per name_area over `locations`.
   *
   * A rack drawn and deleted before any save leaves no claim here, and that is
   * correct — nothing was ever printed, so the number really is free.
   */
  minSeq?: ReadonlyMap<string, number>
  /**
   * Numbers already live in `rename.to`, held by rows THIS PASS WILL NOT REWRITE.
   *
   * A unit swept into `to` whose number appears here takes a FRESH one instead of
   * keeping it. Its printed label is wrong either way the moment the area
   * boundary moved under it, and keeping the number would put two racks in `to`
   * under one name — the exact thing the numbering rule exists to prevent.
   *
   * Absent means nothing can collide, which is true for a plain RENAME: renaming
   * moves a whole pool at once, so the only numbers arriving in `to` are the ones
   * leaving `from`, and the high-water fold above already reconciles those. It is
   * NOT true once an area BOUNDARY can move, which is what live painting adds:
   * `Bulk · Rack 3` swept into a Chiller that already holds `Chiller · Rack 3` is
   * an ordinary act, not an edge case. planAreaCascade supplies this per group.
   */
  claimedInTarget?: ReadonlySet<number>
}

export interface NamedUnit {
  ref: string
  areaName: string
  /** null for a hand-named unit, which holds no claim on any pool. */
  seq: number | null
  /** The noun this unit was composed with — echoed back so a caller composing a
   *  LEVEL name later (mutate-layout, mutate-warehouse-location) uses the same
   *  word as its rack, rather than silently falling back to the default. */
  noun: string
  name: string
  /** levelIndex → composed name. Empty for a flat bin, and empty for a
   *  hand-named rack — see `isAuto`. */
  levelNames: Record<number, string>
  /** This pass handed out the number (it had none before). */
  assigned: boolean
  /** The composed name differs from the one the unit carried. */
  restamped: boolean
  /**
   * false = this unit is hand-named and this pass did not touch it. The caller
   * must write nothing for it: its `name` is echoed back unchanged and its
   * `levelNames` are empty.
   *
   * Note this is the RACK's provenance. A levelled rack's SHELF rows carry their
   * own `name_is_auto`, so a caller writing level names must still check each
   * one — an operator can hand-name a single level.
   */
  isAuto: boolean
}

export interface NamingResult {
  units: NamedUnit[]
  /** Pool → highest number claimed once this pass is done. Drives the toolbar's
   *  "next rack will be 8" and the fill wizard's preview. */
  highWater: ReadonlyMap<string, number>
}

/** Stable, caller-order-independent ordering: reading order down the floor. */
function byPosition(a: NamingUnit, b: NamingUnit): number {
  if (a.floor !== b.floor) return a.floor - b.floor
  if (a.y !== b.y) return a.y - b.y
  if (a.x !== b.x) return a.x - b.x
  return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0
}

const poolOf = (unit: NamingUnit): string => (unit.nameArea ?? '').trim()

/**
 * Highest number claimed in each pool.
 *
 * Every claim counts, whatever its `nameIsAuto` — honouring a number we are not
 * allowed to rewrite is the safe direction. (In practice a custom row has no
 * seq: renaming by hand clears it.)
 */
function highWaterOf(
  units: readonly NamingUnit[],
  minSeq?: ReadonlyMap<string, number>,
): Map<string, number> {
  // Seed from the warehouse's own record first — a number handed out to a rack
  // that has since left this layout is still spoken for. See NamingOptions.minSeq.
  const high = new Map<string, number>(minSeq ? [...minSeq] : [])
  for (const unit of units) {
    if (unit.nameSeq == null) continue
    const pool = poolOf(unit)
    high.set(pool, Math.max(high.get(pool) ?? 0, unit.nameSeq))
  }
  return high
}

/**
 * Compose a name for every unit, handing out numbers where one is missing.
 *
 * Two things and only two things write a name:
 *   1. a unit with no number gets the next one in its pool, and
 *   2. a unit selected by `rename` is relabelled into the new pool, KEEPING its
 *      number.
 * Everything else comes back exactly as it went in. That is why the server can
 * safely recompute the client's answer instead of trusting it: recomputation is
 * a no-op unless the client's inputs were stale, which is precisely when you
 * want the server to win.
 */
export function assignAutoNames(
  units: readonly NamingUnit[],
  areaIndex: AreaIndex,
  options: NamingOptions = {},
): NamingResult {
  const rename = options.rename
    ? { from: options.rename.from.trim(), to: options.rename.to.trim() }
    : undefined
  const includeCustom = options.includeCustom === true

  const sorted = [...units].sort(byPosition)
  const highWater = highWaterOf(sorted, options.minSeq)

  // A rename folds the old pool's claims into the new one, so a number that was
  // live as `Chiller · Rack 4` cannot come back as `Cold Room · Rack 4` on a
  // different rack.
  if (rename && rename.from !== rename.to) {
    const from = highWater.get(rename.from)
    if (from != null) {
      highWater.set(rename.to, Math.max(highWater.get(rename.to) ?? 0, from))
    }
  }

  const out: NamedUnit[] = []

  for (const unit of sorted) {
    const carried = poolOf(unit)

    // Is this unit swept up by the rename? Membership is geometric and read from
    // the POST-rename objects, so there is no pre-image to reconstruct.
    const inRenameTarget =
      rename !== undefined &&
      rename.from !== rename.to &&
      areaForRect(areaIndex, unit) === rename.to

    // A hand-named unit is untouchable, and this guard has to come FIRST: such a
    // unit has no `nameSeq` (renaming by hand clears it), so without it the unit
    // would look brand new, be handed a number and a composed name, and silently
    // destroy the name someone typed. `includeCustom` widens this and ONLY this,
    // and only inside a rename — it is the operator ticking "also rename these"
    // in a dialog that has already shown them what will change.
    if (!unit.nameIsAuto && !(includeCustom && inRenameTarget)) {
      out.push({
        ref: unit.ref,
        areaName: carried,
        seq: unit.nameSeq,
        noun: unit.noun ?? RACK_WORD,
        name: unit.name ?? '',
        levelNames: {},
        assigned: false,
        restamped: false,
        isAuto: false,
      })
      continue
    }

    const renamed = inRenameTarget

    let areaName: string
    let seq: number
    let assigned = false

    if (renamed) {
      areaName = rename!.to
      // Keep the number when it came from either side of the rename; a rack
      // adopted from somewhere else takes a fresh one above the high-water mark
      // rather than colliding with a number already on the floor.
      //
      // `claimedInTarget` is the second half of that guarantee, and it only bites
      // when an area BOUNDARY moved rather than a whole pool being renamed: the
      // number is inherited from `from`, but an untouched incumbent in `to`
      // already answers to it. See NamingOptions.claimedInTarget.
      if (
        unit.nameSeq != null &&
        (carried === rename!.from || carried === rename!.to) &&
        !options.claimedInTarget?.has(unit.nameSeq)
      ) {
        seq = unit.nameSeq
      } else {
        seq = (highWater.get(areaName) ?? 0) + 1
        highWater.set(areaName, seq)
        assigned = true
      }
    } else if (unit.nameSeq != null) {
      // Already numbered and not being renamed: untouched. Note the pool is the
      // one it CARRIES — repainting a different area over it does not restamp it
      // and does not release its claim.
      areaName = carried
      seq = unit.nameSeq
    } else {
      // Brand new. This is the only place geometry decides the pool.
      areaName = areaForRect(areaIndex, unit)
      seq = (highWater.get(areaName) ?? 0) + 1
      highWater.set(areaName, seq)
      assigned = true
    }

    // The unit's OWN noun, from its own storage form. Never the pass's, and
    // never its neighbours' — see NamingUnit.noun.
    const noun = unit.noun ?? RACK_WORD
    const name = composeName(areaName, seq, null, noun)
    const levelNames: Record<number, string> = {}
    for (const levelIndex of unit.levelIndexes ?? []) {
      levelNames[levelIndex] = composeName(areaName, seq, levelIndex, noun)
    }

    out.push({
      ref: unit.ref,
      areaName,
      seq,
      noun,
      name,
      levelNames,
      assigned,
      restamped: unit.name != null && unit.name !== name,
      isAuto: true,
    })
  }

  return { units: out, highWater }
}

/**
 * The number the next rack drawn in `areaName` will get.
 *
 * Shares highWaterOf with assignAutoNames rather than restating it, so a single
 * paint stroke and a full save can never disagree about what comes next.
 */
export function nextSeqForArea(
  existing: readonly NamingUnit[],
  areaName: string,
  minSeq?: ReadonlyMap<string, number>,
): number {
  return (highWaterOf(existing, minSeq).get(areaName.trim()) ?? 0) + 1
}

/**
 * The highest number ever handed out per pool, from raw `locations` rows.
 *
 * Pure, so both runtimes build it the same way: the server from a query over the
 * warehouse, the designer from the locations list it already has cached. Rows
 * with no number, or a hand-typed name, hold no claim.
 */
export function highWaterFromRows(
  rows: ReadonlyArray<{ nameArea?: string | null; nameSeq?: number | null; nameIsAuto?: boolean | null }>,
): Map<string, number> {
  const high = new Map<string, number>()
  for (const row of rows) {
    if (row.nameSeq == null) continue
    const pool = (row.nameArea ?? '').trim()
    high.set(pool, Math.max(high.get(pool) ?? 0, row.nameSeq))
  }
  return high
}

/** Human summary of what a fill is about to mint, e.g.
 *  "Chiller 1–24, Bulk 25–40". For the wizard's confirm, which otherwise closes
 *  over numbers the operator never sees. */
export function describeSeqRanges(assigned: readonly NamedUnit[]): string {
  const ranges = new Map<string, { min: number; max: number }>()
  for (const unit of assigned) {
    if (!unit.assigned || unit.seq == null) continue
    const key = unit.areaName || 'Unnamed area'
    const range = ranges.get(key)
    if (!range) ranges.set(key, { min: unit.seq, max: unit.seq })
    else {
      range.min = Math.min(range.min, unit.seq)
      range.max = Math.max(range.max, unit.seq)
    }
  }
  return Array.from(ranges)
    .map(([name, r]) => `${name} ${r.min === r.max ? r.min : `${r.min}–${r.max}`}`)
    .join(', ')
}
