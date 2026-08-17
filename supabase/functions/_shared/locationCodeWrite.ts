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
 * Pool → the highest number handed out in it, within this warehouse, EXCLUDING the
 * rows this sweep is about to rewrite.
 *
 * Mirrors `loadAreaSeqClaims` and is scoped the same way, but the exclusion is the
 * part that matters and it is not optional. A sweep's start is derived as
 * high-water + 1 so two sweeps over adjacent aisles do not both mint 01. Counting
 * the selection's OWN rows in that high-water makes re-running the identical sweep
 * start where the last one finished — the second pass renumbers 01..06 to 07..12
 * and the operator's "did that work?" click has silently moved every code. Verified
 * on dev before this argument was written.
 *
 * "Continue past what is already there" has to mean what is already there AND
 * STAYING. With the selection excluded, re-running is a no-op, which is the
 * idempotence the pure planner promises and the server has to preserve.
 *
 * A deleted bin's `locations` row survives (publishing never retires a bin), so its
 * claim survives with it — the same property loadAreaHighWater relies on.
 *
 * Fails CLOSED: offering a number that is already live is exactly what this stops.
 */
export async function loadCodeHighWater(
  admin: SupabaseClient,
  warehousePath: string,
  excludeIds: readonly number[] = [],
): Promise<Map<string, number>> {
  const { data, error } = await admin
    .from('locations')
    .select('id, code_block, code_seq')
    .not('code_seq', 'is', null)
    .or(`materialized_path.eq.${warehousePath},materialized_path.like.${warehousePath}/%`)
  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Could not read code numbering: ${error.message}`)
  }
  const excluded = new Set(excludeIds)
  const high = new Map<string, number>()
  for (const row of (data ?? []) as any[]) {
    if (excluded.has(Number(row.id))) continue
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
  /** Which corner of a block is 1-1 (mig 00108). `'nw'` on every pre-existing row
   *  by column default, which is the historical ascending walk. */
  origin: string
}

export async function loadCodePattern(
  admin: SupabaseClient,
  warehouseId: number,
): Promise<StoredCodePattern | null> {
  const { data, error } = await admin
    .from('warehouse_code_patterns')
    .select('template, default_block, start_at, fill_order, origin')
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
    origin: String(row.origin ?? 'nw'),
  }
}

// ───────────────────────────────────────── sweep history / revert (mig 00108) ──

/**
 * One row of a recorded sweep — everything needed to put it back.
 *
 * `prevBlock`/`prevSeq` are the PROVENANCE the row carried before, not the one it
 * was given. Restoring the code alone would leave `code_block`/`code_seq` still
 * claiming the sweep happened, which would then feed the next sweep's high-water
 * mark and quietly renumber the block after it.
 */
export interface SweptRow {
  id: number
  from: string
  to: string
  prevBlock: string | null
  prevSeq: number | null
}

export interface RecordedSweep {
  id: number
  block: string
  rows: SweptRow[]
}

/** Flatten a plan's writes (and their level rows) into the recorded shape. */
export function sweptRowsFrom(
  writes: readonly RecodeWrite[],
  prevProvenance: ReadonlyMap<number, { block: string | null; seq: number | null }>,
): SweptRow[] {
  const rows: SweptRow[] = []
  for (const w of writes) {
    const prev = prevProvenance.get(w.id)
    rows.push({
      id: w.id, from: w.from, to: w.to,
      prevBlock: prev?.block ?? null, prevSeq: prev?.seq ?? null,
    })
    // A level's provenance is always null (see buildRecodeRows), so there is
    // nothing to remember for it beyond its code.
    for (const l of w.levels) {
      rows.push({ id: l.id, from: l.from, to: l.to, prevBlock: null, prevSeq: null })
    }
  }
  return rows
}

/**
 * Record an applied sweep so it can be reverted after a reload.
 *
 * Deliberately NOT fatal. The sweep itself has already committed by the time this
 * runs, and failing the request afterwards would report a write that did happen as
 * an error — far worse than losing the undo affordance. The caller reports whether
 * the record was kept, and the panel only offers Revert when it was.
 */
export async function recordSweep(
  admin: SupabaseClient,
  input: {
    warehouseId: number
    block: string
    template: string
    origin: string
    order: string
    rows: SweptRow[]
    actorId: string
  },
): Promise<boolean> {
  const { error } = await admin.from('location_code_sweeps').insert({
    warehouse_id: input.warehouseId,
    block: input.block,
    template: input.template,
    origin: input.origin,
    fill_order: input.order,
    rows: input.rows,
    swept_by: input.actorId,
  })
  return !error
}

/** The newest un-reverted sweep for a site, or null. Only ever ONE is offered —
 *  reverting an older sweep would collide with every newer one, and resolving that
 *  is a worse tool than saying "sweep it again". */
export async function loadLatestSweep(
  admin: SupabaseClient,
  warehouseId: number,
): Promise<RecordedSweep | null> {
  const { data, error } = await admin
    .from('location_code_sweeps')
    .select('id, block, rows')
    .eq('warehouse_id', warehouseId)
    .is('reverted_at', null)
    .order('swept_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new EdgeFunctionError('INTERNAL', `Could not read the sweep history: ${error.message}`)
  if (!data) return null
  const row = data as { id: number; block: string; rows: SweptRow[] }
  return { id: row.id, block: row.block, rows: row.rows ?? [] }
}

/**
 * Rebuild the write rows that put a sweep back.
 *
 * Every path is composed from the row's CURRENT parent, exactly as
 * `buildRecodeRows` does and for the same reason — on MAIN, 378 rows carry a
 * `-X<id>` suffix in the code that never reached the path, so patching the last
 * segment is not a safe shortcut. A revert moves nothing, so parentage is unchanged
 * and the parent's own path is still correct.
 */
export function buildRevertRows(
  rows: readonly SweptRow[],
  locById: ReadonlyMap<number, NamingLocation>,
  parentPathById: ReadonlyMap<number, string>,
): RecodeRow[] {
  return rows.map((r) => {
    const loc = locById.get(r.id)
    if (!loc) throw new EdgeFunctionError('CONFLICT', `Location ${r.id} no longer exists`)
    // The compare-and-swap of a revert: if the row does not still carry the code
    // this sweep gave it, something else has moved it since and putting the old one
    // back would silently discard that work.
    if (loc.code !== r.to) {
      throw new EdgeFunctionError(
        'CONFLICT',
        `${loc.code} has been recoded again since this sweep; it can no longer be reverted`,
      )
    }
    const parentPath = loc.parentId != null ? parentPathById.get(loc.parentId) : undefined
    if (!parentPath) {
      throw new EdgeFunctionError('INVALID_INPUT', `Location ${loc.code} has no resolvable parent`)
    }
    return {
      id: r.id,
      code: r.from,
      materialized_path: `${parentPath}/${r.from}`,
      code_block: r.prevBlock,
      code_seq: r.prevSeq,
    }
  })
}

/** Mark a sweep reverted so it is never offered twice. */
export async function markSweepReverted(
  admin: SupabaseClient,
  sweepId: number,
  actorId: string,
): Promise<void> {
  const { error } = await admin
    .from('location_code_sweeps')
    .update({ reverted_at: new Date().toISOString(), reverted_by: actorId })
    .eq('id', sweepId)
  if (error) throw new EdgeFunctionError('INTERNAL', error.message)
}
