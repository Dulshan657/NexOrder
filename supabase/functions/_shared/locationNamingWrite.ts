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
import { type NamingUnit } from './wie/locationNaming.ts'

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
      .select('id, name, name_is_auto, name_seq, name_area')
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
 * publishing never retires a bin, and its QR label is still on the racking. A
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
      .select('id, code, name, kind, parent_id, level_index, materialized_path, name_is_auto, name_seq, name_area')
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
    }
  })

  return { units, locById, levelsByParent, unitGeometry }
}
