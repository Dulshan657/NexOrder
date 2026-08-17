// The I/O half of operator-controlled location codes (mig 00107).
//
// Deliberately OUTSIDE _shared/wie/: everything in there is under the purity
// contract (__tests__/wie/purity.test.ts) so the browser can import it, and this
// file talks to supabase-js. Same split, and the same reason, as
// locationNamingWrite.ts sitting beside _shared/wie/locationNaming.ts.
//
// The decisions all live next door in _shared/wie/codePattern.ts. This file only
// fetches what that needs and writes what it decided.

// Pinned to 2.103.0 to match every other _shared I/O module and the client
// index.ts constructs. A different minor makes SupabaseClient a structurally
// incompatible type (its `supabaseUrl` is protected), and since supabase/functions
// is excluded from `tsc`, `deno check` is the only thing that catches it.
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'
import {
  levelCodeFor,
  type RecodeWrite,
} from './wie/codePattern.ts'
import type { NamingLocation } from './locationNamingWrite.ts'

/** `.in()` caps out around 200, and a 189-bay warehouse resolves 1134 rows. */
const CHUNK = 200

/**
 * Every code in the database, folded to lower case, mapped to the id that owns it.
 *
 * GLOBAL, not warehouse-scoped, because `locations.code` is globally unique — a
 * warehouse-scoped read would let a sweep on one site mint a code another site
 * already holds and only find out from a `23505` with no useful message.
 *
 * INACTIVE ROWS INCLUDED. `deactivate` sets `is_active = false` and publishing
 * never retires a bin, so a deactivated row still owns its code and colliding with
 * one is still a collision.
 *
 * Folded to lower because `normalizeScan` uppercases: two codes differing only in
 * case are distinct to the UNIQUE constraint and identical to the scan resolver,
 * which never guesses. `idx_locations_code_lower` (00074) serves this.
 */
export async function loadTakenCodes(admin: SupabaseClient): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('locations')
      .select('id, code')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new EdgeFunctionError('INTERNAL', `Could not read location codes: ${error.message}`)
    const rows = (data ?? []) as any[]
    for (const r of rows) out.set(String(r.code).toLowerCase(), Number(r.id))
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * Pool → the highest number handed out in it, within this warehouse.
 *
 * Mirrors `loadAreaSeqClaims`, and scoped the same way. Unlike the naming pass this
 * needs only the high-water mark: a code pool has no boundary that can move a
 * number between pools behind the operator's back, because the block is typed at
 * the moment of the sweep rather than derived from geometry. That is one of the
 * things `{block}` buys over `{area}`.
 *
 * Fails CLOSED: offering a number that is already live is exactly what this stops.
 */
export async function loadCodeHighWater(
  admin: SupabaseClient,
  warehousePath: string,
): Promise<Map<string, number>> {
  const { data, error } = await admin
    .from('locations')
    .select('code_block, code_seq')
    .not('code_seq', 'is', null)
    .or(`materialized_path.eq.${warehousePath},materialized_path.like.${warehousePath}/%`)
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not read code numbering: ${error.message}`)
  }
  const high = new Map<string, number>()
  for (const row of (data ?? []) as any[]) {
    const seq = Number(row.code_seq)
    if (!Number.isFinite(seq)) continue
    const pool = String(row.code_block ?? '').trim()
    high.set(pool, Math.max(high.get(pool) ?? 0, seq))
  }
  return high
}

/** Which of these locations currently hold stock. Informational only — stock is
 *  keyed by location id, so it follows the row through a recode. A picker holding
 *  a paper list will still be surprised, which is why the preview says so. */
export async function loadStockedLocations(
  admin: SupabaseClient,
  ids: readonly number[],
): Promise<Set<number>> {
  const out = new Set<number>()
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from('inventory_balances')
      .select('location_id')
      .gt('on_hand', 0)
      .in('location_id', unique.slice(i, i + CHUNK))
    if (error) throw new EdgeFunctionError('INTERNAL', `Could not read stock: ${error.message}`)
    for (const r of (data ?? []) as any[]) out.add(Number(r.location_id))
  }
  return out
}

/** One row of the RPC payload. */
export interface RecodeRow {
  id: number
  code: string
  materialized_path: string
  code_block: string | null
  code_seq: number | null
}

/**
 * Turn the pure planner's writes into RPC rows, composing every new path.
 *
 * A path is ALWAYS `parent.materialized_path + '/' + code`, rebuilt from the
 * parent rather than patched by swapping the old path's last segment. That is not
 * pedantry: on the demo's MAIN, 378 rows carry a `-X<id>` de-duplication suffix in
 * their code that was never written into their path, so the last segment is NOT
 * the code and a swap-the-suffix approach would produce garbage. Rebuilding also
 * means a recode quietly REPAIRS such a row, and the RPC's third guard refuses the
 * batch if it ever fails to.
 *
 * A level's path is composed from its rack's NEW path, not from the database: the
 * rack is moving in the same batch, and a SHELF's path is never read back from its
 * parent (mig 00096's lesson).
 */
export function buildRecodeRows(
  writes: readonly RecodeWrite[],
  locById: ReadonlyMap<number, NamingLocation>,
  parentPathById: ReadonlyMap<number, string>,
): RecodeRow[] {
  const rows: RecodeRow[] = []
  for (const write of writes) {
    const loc = locById.get(write.id)
    if (!loc) throw new EdgeFunctionError('INTERNAL', `Location ${write.id} vanished mid-plan`)
    const parentPath = loc.parentId != null ? parentPathById.get(loc.parentId) : undefined
    if (!parentPath) {
      throw new EdgeFunctionError('INVALID_INPUT', `Location ${loc.code} has no resolvable parent`)
    }
    const newPath = `${parentPath}/${write.to}`
    rows.push({
      id: write.id,
      code: write.to,
      materialized_path: newPath,
      code_block: write.codeBlock,
      code_seq: write.seq,
    })

    for (const level of write.levels) {
      rows.push({
        id: level.id,
        code: level.to,
        // Composed from the rack's NEW path — the rack is moving in this very batch.
        materialized_path: `${newPath}/${levelCodeFor(write.to, level.levelIndex)}`,
        // A level's number is its level index, not a pool draw. Stamping the rack's
        // block on it would make the high-water read count each rack once per level.
        code_block: null,
        code_seq: null,
      })
    }
  }
  return rows
}

/** Load the `materialized_path` of every parent the writes reference. */
export async function loadParentPaths(
  admin: SupabaseClient,
  parentIds: readonly number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const unique = [...new Set(parentIds.filter((id) => Number.isFinite(id) && id > 0))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from('locations')
      .select('id, materialized_path')
      .in('id', unique.slice(i, i + CHUNK))
    if (error) throw new EdgeFunctionError('INTERNAL', `Could not read parent paths: ${error.message}`)
    for (const r of (data ?? []) as any[]) out.set(Number(r.id), String(r.materialized_path ?? ''))
  }
  return out
}

/**
 * Apply a batch of code writes atomically.
 *
 * One statement, not N updates: a 189-bay sweep is 1134 rows and as round trips
 * that does not fit inside the 20s fetch ceiling. `warehousePath` feeds the RPC's
 * three scope guards — every id here was derived from client-supplied geometry, and
 * the UPDATE must not be the first operation to take that on trust.
 */
export async function applyRecodeWrites(
  admin: SupabaseClient,
  warehousePath: string,
  rows: readonly RecodeRow[],
): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await admin.rpc('wie_recode_locations_tx', {
    p_warehouse_path: warehousePath,
    p_rows: rows,
  })
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not apply the new codes: ${error.message}`)
  }
  return Number(data ?? 0)
}

/** The stored pattern for a warehouse, or null when it is on the built-in default.
 *  No row IS the answer, not a missing one — see mig 00107. */
export interface StoredCodePattern {
  template: string
  defaultBlock: string
  start: number
  order: string
}

export async function loadCodePattern(
  admin: SupabaseClient,
  warehouseId: number,
): Promise<StoredCodePattern | null> {
  const { data, error } = await admin
    .from('warehouse_code_patterns')
    .select('template, default_block, start_at, fill_order')
    .eq('warehouse_id', warehouseId)
    .maybeSingle()
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not read the code pattern: ${error.message}`)
  }
  if (!data) return null
  const row = data as any
  return {
    template: String(row.template),
    defaultBlock: String(row.default_block),
    start: Number(row.start_at),
    order: String(row.fill_order),
  }
}
