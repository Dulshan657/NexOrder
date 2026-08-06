// Live area painting — packing, fingerprinting and the name cascade.
//
// Pure and IO-free, and it lives in _shared/wie/ so the Vite frontend imports the
// very module the Edge Function runs. That is not tidiness here, it is a
// correctness requirement twice over:
//
//   * the CONFLICT fingerprint must agree byte-for-byte between the browser that
//     computed `base_fingerprint` and the isolate that checks it, or every save
//     409s on a picture nobody changed; and
//   * the summary panel's "24 racks would be renamed" must be the server's
//     decision evaluated early, not a second implementation of it — the same
//     contract as _shared/binCount.ts ↔ lib/binCount.ts.
//
// Re-exported by lib/areaPaint.ts. Import from there in components; never reach
// into supabase/functions from a view.
//
// WHY A FULL REPLACE AND NOT A DIFF. `save_geometry` needs `area_renames` told to
// it because it is a blind full replace: "renamed Chiller to Cold Room" and
// "erased Chiller, painted Cold Room over the same cells" arrive as byte-identical
// geometry, and it has no before-picture to tell them apart. paint_areas reads the
// before-picture from the database, so the distinction is DERIVED rather than
// asserted — and the two cases produce the same plan, which is correct, because
// both mean "these racks are now in Cold Room". Do not port `pendingRenames` here.
//
// RUNS ARE A WIRE FORMAT ONLY. A 120x80 floor can hold thousands of 1x1 area
// cells and repeating the full object per cell is ~85 bytes against ~25 for a
// packed run. But STORAGE stays 1x1, enforced by wie_replace_layout_areas_tx
// (00095), because the designer's paint_cell removes the WHOLE object covering a
// cell — a stored 10-wide run would silently vanish the first time an operator
// repainted one cell of it.

import {
  areaForRect,
  areaNameOf,
  type AreaCellSource,
  type AreaIndex,
  type NamedUnit,
  type NamingUnit,
  assignAutoNames,
} from './locationNaming.ts'

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface AreaPaintCell {
  floor: number
  x: number
  y: number
}

/** A horizontal run of cells on one row. Wire format; never stored. */
export interface AreaPaintRun {
  floor: number
  y: number
  x: number
  len: number
}

/** One named area, folded from however many cell rows describe it. */
export interface AreaPaintSpec {
  name: string
  /** meta.zoneProfileId — INTENT and tint only. A bin's real zone still comes
   *  from materialized-path ancestry to a kind='ZONE' location; nothing reads
   *  this to decide putaway. See CLAUDE.md's named-areas section. */
  zoneProfileId: number | null
  cells: AreaPaintCell[]
}

// ── Cell helpers ────────────────────────────────────────────────────────────

const cellKey = (c: AreaPaintCell): string => `${c.floor}:${c.x}:${c.y}`

/** Reading order down the floor. Explicit comparator, never the default sort's
 *  string coercion — the two runtimes must agree on ordering exactly. */
function byCell(a: AreaPaintCell, b: AreaPaintCell): number {
  if (a.floor !== b.floor) return a.floor - b.floor
  if (a.y !== b.y) return a.y - b.y
  return a.x - b.x
}

function sortedUniqueCells(cells: readonly AreaPaintCell[]): AreaPaintCell[] {
  const seen = new Set<string>()
  const out: AreaPaintCell[] = []
  for (const c of cells) {
    const key = cellKey(c)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ floor: c.floor, x: c.x, y: c.y })
  }
  return out.sort(byCell)
}

/** Pack cells into horizontal runs. A painted area is blobby, so this compresses
 *  10-40x in practice. Deduplicates and canonicalises order on the way through. */
export function packAreaRuns(cells: readonly AreaPaintCell[]): AreaPaintRun[] {
  const sorted = sortedUniqueCells(cells)
  const runs: AreaPaintRun[] = []
  let current: AreaPaintRun | null = null
  for (const c of sorted) {
    if (current && current.floor === c.floor && current.y === c.y && current.x + current.len === c.x) {
      current.len += 1
      continue
    }
    current = { floor: c.floor, y: c.y, x: c.x, len: 1 }
    runs.push(current)
  }
  return runs
}

export function expandAreaRuns(runs: readonly AreaPaintRun[]): AreaPaintCell[] {
  const out: AreaPaintCell[] = []
  for (const run of runs) {
    const len = Math.max(0, Math.trunc(run.len))
    for (let i = 0; i < len; i++) out.push({ floor: run.floor, y: run.y, x: run.x + i })
  }
  return sortedUniqueCells(out)
}

// ── Folding layout_objects into specs ───────────────────────────────────────

/** meta.zoneProfileId, normalised. `undefined` and `null` are both "no profile" —
 *  the tint falls back to OBJECT_FILL.area. */
export function areaZoneProfileOf(object: Pick<AreaCellSource, 'meta'>): number | null {
  const raw = object.meta?.zoneProfileId
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw
}

/**
 * Fold whatever area rows a runtime is holding into one canonical spec per name.
 *
 * The SINGLE fold both surfaces use. EditorObject[] (the designer) and
 * LayoutObject[] (the live map) both satisfy AreaCellSource, so the live map's
 * working set and the designer's editor state provably reduce to the same
 * payload — which is what "two surfaces, one server path" actually means.
 *
 * Expands `w`/`h` defensively: storage is 1x1 today, but a row written before
 * that was enforced must still fold correctly rather than lose its tail.
 */
export function areaSpecsFromObjects(objects: readonly AreaCellSource[]): AreaPaintSpec[] {
  const byName = new Map<string, { zoneProfileId: number | null; cells: AreaPaintCell[] }>()
  for (const object of objects) {
    if (object.objectType !== 'area') continue
    const name = areaNameOf(object)
    if (!name) continue
    const entry = byName.get(name) ?? { zoneProfileId: null, cells: [] }
    const w = Math.max(1, object.w ?? 1)
    const h = Math.max(1, object.h ?? 1)
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        entry.cells.push({ floor: object.floor, x: object.x + dx, y: object.y + dy })
      }
    }
    byName.set(name, entry)
  }

  const specs: AreaPaintSpec[] = []
  for (const [name, entry] of byName) {
    const cells = sortedUniqueCells(entry.cells)
    // Every cell of one area shares its meta by construction, but take the
    // profile from the FIRST cell in canonical order rather than whichever row
    // the query happened to return, so the fold is deterministic even if a
    // partial write ever left them disagreeing.
    let zoneProfileId: number | null = null
    const first = cells[0]
    if (first) {
      for (const object of objects) {
        if (object.objectType !== 'area' || areaNameOf(object) !== name) continue
        const w = Math.max(1, object.w ?? 1)
        const h = Math.max(1, object.h ?? 1)
        if (first.floor !== object.floor) continue
        if (first.x < object.x || first.x >= object.x + w) continue
        if (first.y < object.y || first.y >= object.y + h) continue
        zoneProfileId = areaZoneProfileOf(object)
        break
      }
    }
    specs.push({ name, zoneProfileId, cells })
  }
  return specs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** The inverse: 1x1 area rows from specs. Used to build the after-index
 *  server-side and the canvas preview client-side, so both see the same picture
 *  the payload describes. */
export function areaObjectsFromSpecs(specs: readonly AreaPaintSpec[]): AreaCellSource[] {
  const out: AreaCellSource[] = []
  for (const spec of specs) {
    for (const cell of spec.cells) {
      out.push({
        objectType: 'area',
        floor: cell.floor,
        x: cell.x,
        y: cell.y,
        w: 1,
        h: 1,
        meta: { name: spec.name, zoneProfileId: spec.zoneProfileId },
      })
    }
  }
  return out
}

// ── Fingerprint ─────────────────────────────────────────────────────────────

/** FNV-1a, 32 bits, seeded. Math.imul keeps it exact in both runtimes; a plain
 *  `*` would lose precision past 2^53 and let the two disagree. */
function fnv1a(input: string, seed: number): number {
  let h = seed
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A stable stamp of the area picture, for optimistic concurrency.
 *
 * Computed over the CANONICAL fold, so it is independent of row order, of how the
 * cells were split across rows, and of duplicate rows describing the same cell —
 * two clients rendering the same picture must produce the same stamp or every
 * save fails on a conflict that does not exist.
 *
 * Deliberately not crypto.subtle: that is async, and the two runtimes' digests
 * would have to be reconciled for no benefit. A collision here costs a missed
 * conflict warning, not a security hole — but a bare cell COUNT would not do,
 * since repainting the same number of cells under a different name has the same
 * count and is exactly the change worth catching. Two seeds, 64 bits.
 */
export function areaCellsFingerprint(objects: readonly AreaCellSource[]): string {
  const specs = areaSpecsFromObjects(objects)
  const parts: string[] = []
  for (const spec of specs) {
    for (const cell of spec.cells) {
      parts.push(`${cell.floor}:${cell.x}:${cell.y}:${spec.name}:${spec.zoneProfileId ?? ''}`)
    }
  }
  parts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const joined = parts.join('\n')
  const a = fnv1a(joined, 0x811c9dc5)
  const b = fnv1a(joined, 0x9e3779b9)
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

// ── Geometry diff, for the summary panel and the audit row ──────────────────

export interface AreaGeometryDelta {
  created: string[]
  erased: string[]
  /** Names whose cell SET changed. Counting alone would miss a pure move. */
  resized: Array<{ name: string; before: number; after: number; added: number; removed: number }>
  /** Names whose zone profile changed. */
  reprofiled: Array<{ name: string; before: number | null; after: number | null }>
  cellsAfter: number
  /** True when nothing about the area picture changed. */
  unchanged: boolean
}

export function diffAreas(
  before: readonly AreaCellSource[],
  after: readonly AreaCellSource[],
): AreaGeometryDelta {
  const beforeSpecs = new Map(areaSpecsFromObjects(before).map((s) => [s.name, s]))
  const afterSpecs = new Map(areaSpecsFromObjects(after).map((s) => [s.name, s]))

  const created: string[] = []
  const erased: string[] = []
  const resized: AreaGeometryDelta['resized'] = []
  const reprofiled: AreaGeometryDelta['reprofiled'] = []

  for (const [name, spec] of afterSpecs) {
    const prev = beforeSpecs.get(name)
    if (!prev) {
      created.push(name)
      continue
    }
    const prevKeys = new Set(prev.cells.map(cellKey))
    const nextKeys = new Set(spec.cells.map(cellKey))
    let added = 0
    let removed = 0
    for (const key of nextKeys) if (!prevKeys.has(key)) added++
    for (const key of prevKeys) if (!nextKeys.has(key)) removed++
    if (added > 0 || removed > 0) {
      resized.push({ name, before: prev.cells.length, after: spec.cells.length, added, removed })
    }
    if (prev.zoneProfileId !== spec.zoneProfileId) {
      reprofiled.push({ name, before: prev.zoneProfileId, after: spec.zoneProfileId })
    }
  }
  for (const name of beforeSpecs.keys()) if (!afterSpecs.has(name)) erased.push(name)

  created.sort()
  erased.sort()
  let cellsAfter = 0
  for (const spec of afterSpecs.values()) cellsAfter += spec.cells.length

  return {
    created,
    erased,
    resized,
    reprofiled,
    cellsAfter,
    unchanged:
      created.length === 0 && erased.length === 0 && resized.length === 0 && reprofiled.length === 0,
  }
}

// ── The cascade ─────────────────────────────────────────────────────────────

export interface AreaCascadeOptions {
  /** Restamp hand-named rows too. The operator's explicit opt-in. */
  includeCustom?: boolean
  /** Pool → highest number ever handed out, warehouse-wide. From loadAreaSeqClaims. */
  minSeq?: ReadonlyMap<string, number>
  /** Pool → every number currently live in it, warehouse-wide. From loadAreaSeqClaims. */
  claims?: ReadonlyMap<string, ReadonlySet<number>>
}

export interface AreaCascadePlan {
  /** Decided naming, keyed by NamingUnit.ref, for every unit whose area MOVED.
   *  A unit absent from this map must not be written — that is what makes
   *  replaying an unchanged payload produce zero writes. */
  decided: Map<string, NamedUnit>
  /** Units left alone because the pool they carry already disagreed with the area
   *  they sat in BEFORE this paint. */
  skippedForeign: number
  /** Units this pass would have taken but for a hand-typed name. */
  skippedCustom: number
  highWater: ReadonlyMap<string, number>
}

/** `from`/`to` pair key. NUL-joined so an area name containing the separator
 *  cannot forge a different pair. */
const groupKey = (from: string, to: string): string => `${from} ${to}`

/**
 * Which units changed area, and what they should now be called.
 *
 * The one genuinely new decision in live painting. Everything it decides is
 * decided BY assignAutoNames — this only works out which units moved, in which
 * direction, and feeds each direction through as a rename.
 *
 * BOTH SPEC'D DIRECTIONS FALL OUT WITH NO SPECIAL CASE:
 *   adopt a prefix   ''        -> 'Chiller'   `Rack 7`            -> `Chiller · Rack 7`
 *   strip a prefix   'Chiller' -> ''          `Chiller · Rack 7`  -> `Rack 7`
 *   move a boundary  'Bulk'    -> 'Chiller'   `Bulk · Rack 3`     -> `Chiller · Rack 3` or fresh
 * The number is KEPT in every direction where it safely can be — it is on a
 * sticker already screwed to the racking.
 *
 * WHY GROUPS ARE THREADED RATHER THAN RUN INDEPENDENTLY. Each group is a separate
 * assignAutoNames call (its `rename.to` membership test would otherwise sweep up
 * units from other groups), which loses the two things one call gives for free:
 * a shared high-water mark, and the knowledge of which numbers have already
 * landed in a pool. Both are threaded through explicitly below. Without the
 * second, `Bulk · Rack 3` and `Cold · Rack 3` both moving into Chiller would both
 * keep 3.
 */
export function planAreaCascade(
  units: readonly NamingUnit[],
  before: AreaIndex,
  after: AreaIndex,
  options: AreaCascadeOptions = {},
): AreaCascadePlan {
  const includeCustom = options.includeCustom === true

  const groups = new Map<string, { from: string; to: string; members: NamingUnit[] }>()
  let skippedForeign = 0

  for (const unit of units) {
    const beforeArea = areaForRect(before, unit)
    const afterArea = areaForRect(after, unit)
    if (beforeArea === afterArea) continue

    // A unit whose carried pool already disagreed with where it sat was painted
    // over at some earlier point and the operator declined the cascade then. Its
    // prefix was already inconsistent; this paint did not make it so, and
    // silently repairing it would rewrite a name nobody asked about. Report it.
    // A unit with no number yet carries '' and is always a candidate.
    if (unit.nameSeq != null && (unit.nameArea ?? '').trim() !== beforeArea) {
      skippedForeign++
      continue
    }

    const key = groupKey(beforeArea, afterArea)
    const group = groups.get(key) ?? { from: beforeArea, to: afterArea, members: [] }
    group.members.push(unit)
    groups.set(key, group)
  }

  // Deterministic order, so two runtimes planning the same paint agree on which
  // group mints first and therefore on every number handed out.
  const ordered = [...groups.values()].sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0,
  )

  const highWater = new Map<string, number>(options.minSeq ? [...options.minSeq] : [])
  const landed = new Map<string, Set<number>>()
  const decided = new Map<string, NamedUnit>()

  for (const group of ordered) {
    const claimed = new Set<number>(options.claims?.get(group.to) ?? [])
    for (const seq of landed.get(group.to) ?? []) claimed.add(seq)

    const result = assignAutoNames(group.members, after, {
      rename: { from: group.from, to: group.to },
      includeCustom,
      minSeq: highWater,
      claimedInTarget: claimed,
    })

    const landedHere = landed.get(group.to) ?? new Set<number>()
    for (const named of result.units) {
      decided.set(named.ref, named)
      if (named.isAuto && named.seq != null) landedHere.add(named.seq)
    }
    landed.set(group.to, landedHere)

    for (const [pool, seq] of result.highWater) {
      highWater.set(pool, Math.max(highWater.get(pool) ?? 0, seq))
    }
  }

  let skippedCustom = 0
  for (const named of decided.values()) if (!named.isAuto) skippedCustom++

  return { decided, skippedForeign, skippedCustom, highWater }
}
