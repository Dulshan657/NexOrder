// Server-side I/O for friendly location names (mig 00094).
//
// Deliberately OUTSIDE _shared/wie/: that directory is under the purity contract
// (__tests__/wie/purity.test.ts) and may not perform I/O. The rules live in the
// pure wie/locationNaming.ts, which both runtimes import; this is only where the
// data comes from and where it goes back, so that mutate-layout/index.ts (already
// ~1250 lines) and mutate-warehouse-location/index.ts stay readable.
//
// Same shape as _shared/levelRoleLookup.ts beside _shared/wie/levelRoles.ts.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'
import {
  type NamingUnit,
  type RestampUnit,
  restampNames,
  unitNoun,
} from './wie/locationNaming.ts'

/** supabase-js `.in()` list size. Matches the chunking used by the repoint read
 *  in mutate-layout and the location read in count-bin. */
const CHUNK = 200

/** The stored name state of one `locations` row. */
export interface StoredNaming {
  id: number
  name: string
  nameIsAuto: boolean
  nameSeq: number | null
  nameArea: string | null
  /** Which storage form this row wears — resolved to a NOUN (mig 00100) by
   *  `loadUnitNouns`. Null on a bin drawn before forms, which reads as "Rack". */
  storageTypeId: number | null
}

/**
 * storage_type_id -> the word a unit of that form is called (mig 00100).
 *
 * One small read, cached by the caller for the length of a request. The rule
 * itself is `unitNoun` in the pure module, so the designer's preview and this
 * agree by construction rather than by inspection.
 */
export async function loadUnitNouns(
  admin: SupabaseClient,
  ids: ReadonlyArray<number | null | undefined>,
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const unique = [...new Set(ids.filter((id): id is number => Number.isFinite(id as number) && (id as number) > 0))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from('storage_types')
      .select('id, is_floor, slot_unit')
      .in('id', unique.slice(i, i + CHUNK))
    // Fails CLOSED like every other read here: guessing "Rack" for a form we
    // could not read would restamp a floor pallet's name on the next save.
    if (error) throw new EdgeFunctionError('INTERNAL', `Could not read storage forms: ${error.message}`)
    for (const r of (data ?? []) as any[]) {
      out.set(Number(r.id), unitNoun({ isFloor: r.is_floor === true, slotUnit: r.slot_unit ?? null }))
    }
  }
  return out
}

/** One row to write back. Mirrors wie_rename_locations_tx's recordset. */
export interface NameWrite {
  id: number
  name: string
  name_seq: number | null
  name_area: string | null
  name_is_auto: boolean
}

function toStored(r: any): StoredNaming {
  return {
    id: Number(r.id),
    name: String(r.name ?? ''),
    nameIsAuto: r.name_is_auto === true,
    nameSeq: r.name_seq != null ? Number(r.name_seq) : null,
    nameArea: r.name_area ?? null,
    storageTypeId: r.storage_type_id != null ? Number(r.storage_type_id) : null,
  }
}

/**
 * The name state of every id given, keyed by id.
 *
 * Fails CLOSED. The server recomputes names from THIS rather than from the wire —
 * that is what protects a stale tab, and what makes recomputation safe rather
 * than merely redundant. Reading a partial picture would look like "these racks
 * have no numbers" and hand out numbers that are already on the floor.
 */
export async function loadNameState(
  admin: SupabaseClient,
  ids: readonly number[],
): Promise<Map<number, StoredNaming>> {
  const out = new Map<number, StoredNaming>()
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from('locations')
      .select('id, name, name_is_auto, name_seq, name_area, storage_type_id')
      .in('id', unique.slice(i, i + CHUNK))
    if (error) {
      throw new EdgeFunctionError('INTERNAL', `Could not read location names: ${error.message}`)
    }
    for (const row of (data ?? []) as any[]) {
      const stored = toStored(row)
      out.set(stored.id, stored)
    }
  }
  return out
}

/**
 * The highest rack number ever handed out in each area of this warehouse.
 *
 * Read from `locations`, not from the layout, and that is the whole point:
 * deleting a rack removes its placement row but NOT its location row —
 * publishing never retires a bin, and its barcode label is still on the racking. A
 * high-water mark derived only from the layout would offer that number to the
 * next rack drawn, putting two racks on one name.
 *
 * Fails CLOSED: handing out a duplicate number is exactly what this prevents.
 */
export async function loadAreaHighWater(
  admin: SupabaseClient,
  warehousePath: string,
): Promise<Map<string, number>> {
  return (await loadAreaSeqClaims(admin, warehousePath)).high
}

/** Every number in play in this warehouse, folded two ways. */
export interface AreaSeqClaims {
  /** Pool → the highest number ever handed out in it. */
  high: Map<string, number>
  /** Pool → every number currently live in it. */
  claims: Map<string, Set<number>>
}

/**
 * The high-water mark AND the full set of live numbers, from one query.
 *
 * The high-water mark alone is enough while an area can only be RENAMED: a rename
 * moves a whole pool at once, so the only numbers arriving in the target are the
 * ones leaving the source. Once an area BOUNDARY can move — which is what live
 * painting adds — a rack can be swept into a pool that already holds its number
 * while the incumbent stays put, and only the full set can catch that. See
 * NamingOptions.claimedInTarget.
 *
 * loadAreaHighWater is now a projection of this rather than a second reader, so
 * the two can never fold the same rows differently.
 *
 * Fails CLOSED: handing out a duplicate number is exactly what this prevents.
 */
export async function loadAreaSeqClaims(
  admin: SupabaseClient,
  warehousePath: string,
): Promise<AreaSeqClaims> {
  const { data, error } = await admin
    .from('locations')
    .select('name_area, name_seq')
    .not('name_seq', 'is', null)
    .or(`materialized_path.eq.${warehousePath},materialized_path.like.${warehousePath}/%`)
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not read area numbering: ${error.message}`)
  }
  const high = new Map<string, number>()
  const claims = new Map<string, Set<number>>()
  for (const row of (data ?? []) as any[]) {
    const seq = Number(row.name_seq)
    if (!Number.isFinite(seq)) continue
    const pool = String(row.name_area ?? '').trim()
    high.set(pool, Math.max(high.get(pool) ?? 0, seq))
    const bucket = claims.get(pool) ?? new Set<number>()
    bucket.add(seq)
    claims.set(pool, bucket)
  }
  return { high, claims }
}

/**
 * Apply a batch of name writes atomically.
 *
 * One statement, not N updates: renaming an area over a 189-bay warehouse is
 * 1134 rows (189 racks + 945 shelves), and as round trips that does not fit
 * inside the 20s fetch ceiling.
 *
 * `warehousePath` is passed through to the RPC's scope backstop. Every caller
 * has already checked that the ids sit under this warehouse, but those ids were
 * derived from client-supplied geometry and the UPDATE must not be the first
 * operation to take that on trust.
 */
export async function applyNameWrites(
  admin: SupabaseClient,
  warehousePath: string,
  rows: readonly NameWrite[],
): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await admin.rpc('wie_rename_locations_tx', {
    p_warehouse_path: warehousePath,
    p_rows: rows,
  })
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not apply the new names: ${error.message}`)
  }
  return Number(data ?? 0)
}

/**
 * Would writing this row change anything?
 *
 * The overwhelmingly common save is "geometry moved, names did not", so skipping
 * unchanged rows is what keeps an ordinary drag from rewriting a thousand rows.
 * Mirrors the `unchanged` guard mutate-layout already applies to rack levels.
 */
export function nameWriteNeeded(stored: StoredNaming | undefined, next: NameWrite): boolean {
  if (!stored) return true
  return (
    stored.name !== next.name ||
    stored.nameSeq !== next.name_seq ||
    (stored.nameArea ?? null) !== (next.name_area ?? null) ||
    stored.nameIsAuto !== next.name_is_auto
  )
}

// ── Restamping a form's units after its noun changed ────────────────────────
//
// The counterpart to the naming pass, for the case a naming pass cannot reach: a
// STORAGE FORM was edited, so every unit wearing it is now called the wrong
// thing, wherever it is and whatever layout it sits on. No geometry is involved
// and none is read — the pool and the number are stored columns, so the name
// rebuilds from the row itself (see restampNames).

/** supabase-js caps a select at 1000 rows. MAIN's biggest form is 189 bays and
 *  AMD_RACK is 17 racks + 85 levels, so one page is enough today — paging is
 *  here because "enough today" is how a silent truncation gets written. */
const PAGE = 1000

/** One `locations` row of the form being restamped. */
interface FormNamingRow {
  id: number
  kind: string
  parentId: number | null
  levelIndex: number | null
  name: string
  nameIsAuto: boolean
  nameSeq: number | null
  nameArea: string | null
  path: string
}

async function loadFormNamingRows(
  admin: SupabaseClient,
  storageTypeId: number,
): Promise<FormNamingRow[]> {
  const out: FormNamingRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('locations')
      .select('id, kind, parent_id, level_index, name, name_is_auto, name_seq, name_area, materialized_path')
      .eq('storage_type_id', storageTypeId)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new EdgeFunctionError('INTERNAL', `Could not read this form's units: ${error.message}`)
    const rows = (data ?? []) as any[]
    for (const r of rows) {
      out.push({
        id: Number(r.id),
        kind: String(r.kind),
        parentId: r.parent_id != null ? Number(r.parent_id) : null,
        levelIndex: r.level_index != null ? Number(r.level_index) : null,
        name: String(r.name ?? ''),
        nameIsAuto: r.name_is_auto === true,
        nameSeq: r.name_seq != null ? Number(r.name_seq) : null,
        nameArea: r.name_area ?? null,
        path: String(r.materialized_path ?? ''),
      })
    }
    if (rows.length < PAGE) return out
  }
}

/**
 * Rewrite every auto name of one storage form for a new noun.
 *
 * Returns how many rows changed — zero being the overwhelmingly common answer,
 * since most form edits (a colour, a weight limit) do not move the noun at all.
 *
 * Writes go through `wie_rename_locations_tx` like every other naming write, and
 * that RPC is scoped to ONE warehouse — while a form is a tenant-global
 * catalogue row whose units may stand in several. So the batch is grouped by
 * warehouse and applied per group: the scope backstop stays meaningful instead
 * of being handed a path that half the rows fail.
 */
export async function restampFormNames(
  admin: SupabaseClient,
  storageTypeId: number,
  noun: string,
): Promise<number> {
  const rows = await loadFormNamingRows(admin, storageTypeId)
  if (rows.length === 0) return 0

  // Levels first: a SHELF carries no number of its own, so it is composed from
  // its RACK parent. A hand-named level is dropped here rather than inside the
  // pure rule, which is the same order assignAutoNames applies its guards in.
  //
  // A level whose parent wears a DIFFERENT form is left alone, and that is
  // correct rather than a gap: a level is called what its rack is called
  // (mutate-layout composes it from the rack's noun), so it moves when the
  // rack's form moves and not when its own does.
  const levelsByParent = new Map<number, Array<{ id: number; name: string; levelIndex: number }>>()
  for (const r of rows) {
    if (r.kind !== 'SHELF' || !r.nameIsAuto || r.parentId == null || r.levelIndex == null) continue
    const bucket = levelsByParent.get(r.parentId) ?? []
    bucket.push({ id: r.id, name: r.name, levelIndex: r.levelIndex })
    levelsByParent.set(r.parentId, bucket)
  }

  const units: RestampUnit[] = rows
    .filter((r) => r.kind !== 'SHELF' && r.nameIsAuto && r.nameSeq != null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      nameArea: r.nameArea,
      nameSeq: r.nameSeq as number,
      levels: levelsByParent.get(r.id),
    }))

  const writes = restampNames(units, noun)
  if (writes.length === 0) return 0

  // The warehouse is the first segment of the materialized path — that IS the
  // root's own path (a root is `AMADIYA`, a bin under it `AMADIYA/…`).
  const pathById = new Map(rows.map((r) => [r.id, r.path]))
  const byWarehouse = new Map<string, NameWrite[]>()
  for (const w of writes) {
    const whPath = (pathById.get(w.id) ?? '').split('/')[0]
    if (!whPath) {
      throw new EdgeFunctionError('INTERNAL', `Location ${w.id} has no warehouse path and cannot be renamed safely`)
    }
    const bucket = byWarehouse.get(whPath) ?? []
    bucket.push({
      id: w.id,
      name: w.name,
      name_seq: w.nameSeq,
      name_area: w.nameArea,
      // Only auto rows reach here, and a restamp does not change provenance.
      name_is_auto: true,
    })
    byWarehouse.set(whPath, bucket)
  }

  let applied = 0
  for (const [whPath, batch] of byWarehouse) applied += await applyNameWrites(admin, whPath, batch)
  return applied
}

// ── Resolving a layout's nameable units ─────────────────────────────────────

/** What a naming pass needs to know about one `locations` row. */
export interface NamingLocation {
  id: number
  code: string
  name: string
  kind: string
  parentId: number | null
  levelIndex: number | null
  path: string
  nameIsAuto: boolean
  nameSeq: number | null
  nameArea: string | null
  /** The form this row wears; resolved to a noun by loadUnitNouns (mig 00100). */
  storageTypeId: number | null
}

/** Chunked read, keyed by id. `.in()` caps out around 200, and a 189-bay
 *  warehouse resolves 1134 rows. */
export async function loadLocationsForNaming(
  admin: SupabaseClient,
  ids: readonly number[],
): Promise<Map<number, NamingLocation>> {
  const out = new Map<number, NamingLocation>()
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from('locations')
      .select('id, code, name, kind, parent_id, level_index, materialized_path, name_is_auto, name_seq, name_area, storage_type_id')
      .in('id', unique.slice(i, i + CHUNK))
    if (error) throw new EdgeFunctionError('INTERNAL', `Could not read locations: ${error.message}`)
    for (const r of (data ?? []) as any[]) {
      out.set(Number(r.id), {
        id: Number(r.id),
        code: String(r.code),
        name: String(r.name ?? ''),
        kind: String(r.kind),
        parentId: r.parent_id != null ? Number(r.parent_id) : null,
        levelIndex: r.level_index != null ? Number(r.level_index) : null,
        path: String(r.materialized_path ?? ''),
        nameIsAuto: r.name_is_auto === true,
        nameSeq: r.name_seq != null ? Number(r.name_seq) : null,
        nameArea: r.name_area ?? null,
        storageTypeId: r.storage_type_id != null ? Number(r.storage_type_id) : null,
      })
    }
  }
  return out
}

export interface LayoutNamingUnits {
  units: NamingUnit[]
  locById: Map<number, NamingLocation>
  levelsByParent: Map<number, Array<{ id: number; levelIndex: number }>>
  unitGeometry: Map<number, { floor: number; x: number; y: number; w: number; h: number }>
}

/**
 * Every nameable unit on a layout, with its geometry and its levels.
 *
 * THE JOIN, since there is no FK between an area and a bin. An area is
 * `layout_objects` geometry; a bin is a `locations` row. The only thing connecting
 * them is that both describe the same grid cells on the same layout, and
 * `layout_placements` is what says which cells a bin occupies. The geometric
 * intersection is then done in TypeScript, not SQL, for the same reason
 * proposeHomeBins is JS: a SQL formulation would have to restate the
 * majority-of-cells rule and its tie-break, which is a second copy of a decision
 * that already has exactly one.
 *
 * Shared by `rename_area` and `paint_areas` — the plumbing is identical and the
 * two must resolve the same units, or a preview and a paint would disagree about
 * what is even in the area.
 */
export async function loadLayoutNamingUnits(
  admin: SupabaseClient,
  layoutId: number,
  warehousePath: string,
): Promise<LayoutNamingUnits> {
  const { data: placementRows, error: plErr } = await admin
    .from('layout_placements')
    .select('location_id, floor, x, y, w, h')
    .eq('layout_id', layoutId)
  if (plErr) throw new EdgeFunctionError('INTERNAL', `Could not read placements: ${plErr.message}`)
  const placements = (placementRows ?? []) as any[]

  // Every placement's location, plus every rack PARENT: a levelled rack holds no
  // placement row of its own — its SHELF levels do — so rolling up to the parent
  // is what makes a rack nameable at all.
  const placementIds = [...new Set(placements.map((p) => Number(p.location_id)))]
  const locById = await loadLocationsForNaming(admin, placementIds)
  const parentIds = [...new Set(
    [...locById.values()]
      .filter((l) => l.kind === 'SHELF' && l.parentId != null)
      .map((l) => l.parentId as number),
  )].filter((id) => !locById.has(id))
  for (const [id, row] of await loadLocationsForNaming(admin, parentIds)) locById.set(id, row)

  // Scope check. Every id above came from client-supplied geometry, and an UPDATE
  // must not be the first operation to take that on trust — the same guard
  // mutate-layout applies to a repoint.
  for (const loc of locById.values()) {
    if (loc.path !== warehousePath && !loc.path.startsWith(`${warehousePath}/`)) {
      throw new EdgeFunctionError('INVALID_INPUT', 'A placement resolved outside this warehouse')
    }
  }

  const levelsByParent = new Map<number, Array<{ id: number; levelIndex: number }>>()
  const unitGeometry = new Map<number, { floor: number; x: number; y: number; w: number; h: number }>()
  for (const p of placements) {
    const loc = locById.get(Number(p.location_id))
    if (!loc) continue
    const geo = { floor: Number(p.floor), x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }
    if (loc.kind === 'SHELF' && loc.parentId != null) {
      const bucket = levelsByParent.get(loc.parentId) ?? []
      bucket.push({ id: loc.id, levelIndex: loc.levelIndex ?? bucket.length + 1 })
      levelsByParent.set(loc.parentId, bucket)
      // Levels are co-located; any of them gives the rack its geometry.
      if (!unitGeometry.has(loc.parentId)) unitGeometry.set(loc.parentId, geo)
    } else {
      unitGeometry.set(loc.id, geo)
    }
  }

  // A unit's noun follows its OWN form (mig 00100), so a floor pallet standing
  // beside a rack keeps its word through an area rename.
  const nounByForm = await loadUnitNouns(
    admin,
    [...unitGeometry.keys()].map((id) => locById.get(id)?.storageTypeId),
  )

  const units: NamingUnit[] = [...unitGeometry.entries()].map(([id, geo]) => {
    const loc = locById.get(id)!
    return {
      ref: `loc:${id}`,
      ...geo,
      name: loc.name,
      nameIsAuto: loc.nameIsAuto,
      nameSeq: loc.nameSeq,
      nameArea: loc.nameArea,
      levelIndexes: (levelsByParent.get(id) ?? []).map((l) => l.levelIndex),
      noun: loc.storageTypeId != null ? nounByForm.get(loc.storageTypeId) : undefined,
    }
  })

  return { units, locById, levelsByParent, unitGeometry }
}
