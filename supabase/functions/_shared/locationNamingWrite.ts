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
  const { data, error } = await admin
    .from('locations')
    .select('name_area, name_seq')
    .not('name_seq', 'is', null)
    .or(`materialized_path.eq.${warehousePath},materialized_path.like.${warehousePath}/%`)
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not read area numbering: ${error.message}`)
  }
  const high = new Map<string, number>()
  for (const row of (data ?? []) as any[]) {
    const seq = Number(row.name_seq)
    if (!Number.isFinite(seq)) continue
    const pool = String(row.name_area ?? '').trim()
    high.set(pool, Math.max(high.get(pool) ?? 0, seq))
  }
  return high
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
