// mutate-warehouse-location Edge Function
//
// Admin/Manager CRUD for the storage TREE inside a racked warehouse — the
// ZONE / BIN / SHELF locations under a WAREHOUSE row (mig 00036/00039). Admins
// build whatever depth they want. materialized_path is computed server-side from
// the parent so it always stays consistent. A node holding stock cannot be
// deactivated. Direct writes to `locations` are RLS-blocked.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
// Small per-level travel penalty (mig 00072) so lower levels stay preferred with
// no scoring change — L(lowest index) keeps its existing offset, each level
// above adds one step. Imported rather than redeclared: it had drifted to 0.3
// here and in mutate-layout while the migration and the frontend used 0.5, so a
// same-rack level reported two different reach costs depending on which path
// built it — invisible until replenishment routing started pricing a pull.
import { ACCESS_OFFSET_STEP_M } from '../_shared/wie/levelGeometry.ts'
import { assertValidRoles, loadActiveRoleKeys } from '../_shared/levelRoleLookup.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']
const NODE_KINDS = ['ZONE', 'BIN', 'SHELF'] as const

const createSchema = z.object({
  parent_id: z.number().int().positive(),
  kind: z.enum(NODE_KINDS),
  code: z.string().min(1).max(48),
  name: z.string().min(1).max(120),
  capacity_slots: z.number().nonnegative().optional(),
  slot_kind: z.enum(['pallet', 'carton']).optional(),
})

const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    capacity_slots: z.number().nonnegative().nullable().optional(),
    slot_kind: z.enum(['pallet', 'carton']).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' })

// Re-level an already-published rack without a re-publish (mig 00072). Each
// entry is one level; an existing level_index missing from the array is
// REMOVED (guarded against stock below), one present but new is ADDED.
const setLevelsSchema = z.object({
  level_index: z.number().int().positive(),
  // Validated at runtime against level_roles (mig 00081) — the vocabulary is
  // operator-managed, so a z.enum literal here would reject a role an admin had
  // just created.
  role: z.string().min(1).max(32),
  capacity_slots: z.number().nonnegative().nullable().optional(),
  weight_capacity_kg: z.number().nonnegative().nullable().optional(),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema }),
  z.object({ action: z.literal('update'), id: z.number().int().positive(), data: updateSchema }),
  z.object({ action: z.literal('deactivate'), id: z.number().int().positive() }),
  z.object({ action: z.literal('set_levels'), id: z.number().int().positive(), levels: z.array(setLevelsSchema).min(1).max(50) }),
  // First-time conversion of a flat BIN into a levelled RACK. Separate from
  // set_levels because it is the only action that MOVES LIVE STOCK (onto L1).
  z.object({
    action: z.literal('convert_to_levels'),
    id: z.number().int().positive(),
    layout_id: z.number().int().positive(),
    levels: z.array(setLevelsSchema).min(1).max(50),
  }),
])

/** The WAREHOUSE root id for a node (walks up the tree). */
async function rootWarehouse(admin: any, locationId: number): Promise<{ id: number; location_type: string | null } | null> {
  let cur = locationId
  for (let i = 0; i < 12; i++) {
    const { data } = await admin.from('locations').select('id, parent_id, kind, location_type').eq('id', cur).single()
    if (!data) return null
    if ((data as any).kind === 'WAREHOUSE') return { id: (data as any).id, location_type: (data as any).location_type }
    if ((data as any).parent_id == null) return null
    cur = (data as any).parent_id
  }
  return null
}

async function nodeHasStock(admin: any, locationId: number): Promise<boolean> {
  const { data } = await admin.from('inventory_balances').select('id').gt('on_hand', 0).eq('location_id', locationId).limit(1)
  return !!(data && data.length > 0)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-warehouse-location:${auth.userId}`, {
      windowMs: 60_000,
      max: 30,
    })
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }
    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    if (input.action === 'create') {
      const { data: parent, error: pErr } = await admin
        .from('locations')
        .select('id, materialized_path, is_active')
        .eq('id', input.data.parent_id)
        .single()
      if (pErr || !parent) throw new EdgeFunctionError('NOT_FOUND', 'Parent location not found')

      const root = await rootWarehouse(admin, input.data.parent_id)
      if (!root) throw new EdgeFunctionError('INVALID_INPUT', 'Parent is not inside a warehouse')
      if (root.location_type !== 'racked') {
        throw new EdgeFunctionError('CONFLICT', 'Storage bins can only be added to a racked warehouse')
      }

      const row = {
        parent_id: input.data.parent_id,
        kind: input.data.kind,
        code: input.data.code,
        name: input.data.name,
        materialized_path: `${(parent as any).materialized_path}/${input.data.code}`,
        capacity_slots: input.data.capacity_slots ?? null,
        slot_kind: input.data.slot_kind ?? null,
        is_active: true,
      }
      const { data: created, error } = await admin.from('locations').insert(row as any).select().single()
      if (error || !created) {
        if (error?.code === '23505') throw new EdgeFunctionError('CONFLICT', `Code "${input.data.code}" already exists`)
        throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to create location')
      }
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'locations',
        resourceId: String((created as any).id), after: created as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, location: created }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── convert_to_levels ────────────────────────────────────────────────────
    // Turn a flat BIN into a levelled RACK for the first time. Everything real
    // happens inside wie_convert_rack_to_levels_tx (mig 00072) so the location
    // rewrite, the placement fan-out and the stock move to L1 are ONE atomic
    // transaction — this handler only authenticates, validates and audits.
    // The RPC itself re-checks kind='BIN' and "no level children yet" under a
    // row lock, so a double-submit fails cleanly rather than double-converting.
    if (input.action === 'convert_to_levels') {
      const dupIndex = new Set(input.levels.map((l) => l.level_index))
      if (dupIndex.size !== input.levels.length) {
        throw new EdgeFunctionError('INVALID_INPUT', 'level_index values must be unique')
      }
      // wie_convert_rack_to_levels_tx re-checks this and raises
      // INVALID_LEVEL_ROLE, but it does so mid-transaction after locking the
      // rack. Checking first gives the same refusal without taking the lock.
      assertValidRoles(input.levels.map((l) => l.role), await loadActiveRoleKeys(admin))
      // The RPC takes levels as an ascending L1..Ln array, positionally.
      const ordered = [...input.levels].sort((a, b) => a.level_index - b.level_index)

      const { data: before } = await admin.from('locations')
        .select('id, kind, code, name, capacity_slots').eq('id', input.id).maybeSingle()
      if (!before) throw new EdgeFunctionError('NOT_FOUND', `Location ${input.id} not found`)

      const { data: result, error: rpcErr } = await admin.rpc('wie_convert_rack_to_levels_tx', {
        p_location_id: input.id,
        p_layout_id: input.layout_id,
        p_levels: ordered.map((l) => ({
          role: l.role,
          capacity_slots: l.capacity_slots ?? null,
          weight_capacity_kg: l.weight_capacity_kg ?? null,
        })),
        p_actor: auth.userId,
      })
      if (rpcErr) {
        // The RPC raises P0001 with an ALREADY_CONVERTED / NOT_PLACED / INVALID_*
        // prefix; surface it verbatim so the operator sees WHY, not "failed".
        throw new EdgeFunctionError('CONFLICT', rpcErr.message)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.id),
        before: before as Record<string, unknown>,
        after: result as Record<string, unknown>,
        metadata: { convert_to_levels: true, layout_id: input.layout_id, levels: ordered.length },
      })

      return new Response(JSON.stringify({ ok: true, result }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── set_levels ───────────────────────────────────────────────────────────
    // Re-level an already-PUBLISHED rack in place — no draft, no re-publish.
    // Converting a plain (non-levelled) BIN into a levelled RACK for the first
    // time is the genuinely risky step (wie_convert_rack_to_levels_tx, mig
    // 00072) and is deliberately NOT this action's job; this only reconfigures
    // a rack that already has levels.
    if (input.action === 'set_levels') {
      const dupIndex = new Set(input.levels.map((l) => l.level_index))
      if (dupIndex.size !== input.levels.length) {
        throw new EdgeFunctionError('INVALID_INPUT', 'level_index values must be unique')
      }
      // Fails closed. The FK on locations.level_role would also refuse a bogus
      // key, but mid-loop and with an unreadable message — and it cannot check
      // is_active, which this does.
      assertValidRoles(input.levels.map((l) => l.role), await loadActiveRoleKeys(admin))

      const { data: rack, error: rackErr } = await admin.from('locations')
        .select('id, kind, code, materialized_path, is_active')
        .eq('id', input.id).single()
      if (rackErr || !rack) throw new EdgeFunctionError('NOT_FOUND', `Location ${input.id} not found`)
      if ((rack as any).kind !== 'RACK') {
        throw new EdgeFunctionError('INVALID_INPUT', 'set_levels only applies to a RACK location')
      }

      const { data: existingRows, error: existErr } = await admin.from('locations')
        .select('id, level_index, level_role, capacity_slots, weight_capacity_kg, code, is_active')
        .eq('parent_id', input.id).eq('kind', 'SHELF').not('level_index', 'is', null)
      if (existErr) throw new EdgeFunctionError('INTERNAL', existErr.message)
      const existingLevels = (existingRows ?? []) as any[]
      if (existingLevels.length === 0) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'This rack has no levels yet — convert it to a levelled rack before re-levelling it',
        )
      }
      const existingByIndex = new Map<number, any>(existingLevels.map((l) => [l.level_index as number, l]))
      const desiredByIndex = new Map(input.levels.map((l) => [l.level_index, l]))

      // Refuse to remove a level that still holds stock (mirrors the
      // STOCK_IN_REMOVED_BIN guard style in wie_publish_layout_tx, mig 00045).
      const toRemove = existingLevels.filter((l) => l.is_active && !desiredByIndex.has(l.level_index as number))
      for (const lvl of toRemove) {
        const { data: bal } = await admin.from('inventory_balances')
          .select('id').gt('on_hand', 0).eq('location_id', lvl.id).limit(1)
        if (bal && bal.length > 0) {
          throw new EdgeFunctionError(
            'CONFLICT',
            `Level ${lvl.level_index} (${lvl.code}) still holds stock — move it out before removing this level`,
          )
        }
      }

      // New levels need a co-located layout_placements row so the engine can
      // see them immediately — sourced from any sibling level's placement
      // (every level of a rack shares the same floor/x/y by construction).
      const root = await rootWarehouse(admin, input.id)
      if (!root) throw new EdgeFunctionError('INVALID_INPUT', 'Rack is not inside a warehouse')
      const { data: whRow } = await admin.from('locations').select('active_layout_id').eq('id', root.id).single()
      const layoutId = (whRow as any)?.active_layout_id as number | null
      if (!layoutId) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'This rack is not on a published layout — edit its levels in the Layout Designer instead',
        )
      }
      const { data: templateRows } = await admin.from('layout_placements')
        .select('floor, x, y, w, h, rotation, graph_node_id, access_offset_m, level_index')
        .eq('layout_id', layoutId).in('location_id', existingLevels.map((l) => l.id))
        .order('level_index', { ascending: true }).limit(1)
      const template = (templateRows ?? [])[0] as any

      const added: number[] = []
      const updated: number[] = []
      for (const [idx, desired] of desiredByIndex) {
        const cur = existingByIndex.get(idx)
        if (cur) {
          const { error } = await admin.from('locations').update({
            level_role: desired.role,
            capacity_slots: desired.capacity_slots ?? null,
            weight_capacity_kg: desired.weight_capacity_kg ?? null,
            is_active: true,
          } as any).eq('id', cur.id)
          if (error) throw new EdgeFunctionError('INTERNAL', `Failed to update level ${idx}: ${error.message}`)
          updated.push(idx)
          continue
        }
        const code = `${(rack as any).code}-L${idx}`
        const { data: newLoc, error: insErr } = await admin.from('locations').insert({
          parent_id: input.id, kind: 'SHELF', code, name: `Level ${idx}`,
          materialized_path: `${(rack as any).materialized_path}/${code}`,
          level_role: desired.role, level_index: idx,
          capacity_slots: desired.capacity_slots ?? null,
          weight_capacity_kg: desired.weight_capacity_kg ?? null,
          is_active: true,
        } as any).select('id').single()
        if (insErr || !newLoc) {
          if (insErr?.code === '23505') throw new EdgeFunctionError('CONFLICT', `Level code "${code}" already exists`)
          throw new EdgeFunctionError('INTERNAL', insErr?.message ?? `Failed to create level ${idx}`)
        }
        added.push(idx)
        if (template) {
          const baseIdx = (template.level_index as number) ?? idx
          const baseOffset = Number(template.access_offset_m) || 0
          const { error: plErr } = await admin.from('layout_placements').insert({
            layout_id: layoutId, location_id: (newLoc as any).id,
            floor: template.floor, x: template.x, y: template.y, w: template.w, h: template.h,
            rotation: template.rotation, graph_node_id: template.graph_node_id,
            access_offset_m: baseOffset + ACCESS_OFFSET_STEP_M * (idx - baseIdx),
            level_index: idx,
          } as any)
          if (plErr) {
            throw new EdgeFunctionError('INTERNAL', `Level ${idx} was created but its placement failed: ${plErr.message}`)
          }
        }
      }

      // Deactivate (never hard-delete) removed levels — inventory_movements
      // history and any lingering layout_placements row must stay FK-valid.
      const removed: number[] = []
      for (const lvl of toRemove) {
        const { error } = await admin.from('locations').update({ is_active: false } as any).eq('id', lvl.id)
        if (error) throw new EdgeFunctionError('INTERNAL', `Failed to remove level ${lvl.level_index}: ${error.message}`)
        removed.push(lvl.level_index as number)
      }

      const { data: finalRows } = await admin.from('locations')
        .select('id, level_index, level_role, capacity_slots, weight_capacity_kg, code, is_active')
        .eq('parent_id', input.id).eq('kind', 'SHELF').not('level_index', 'is', null)
        .order('level_index', { ascending: true })

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.id),
        before: existingLevels as unknown as Record<string, unknown>,
        after: (finalRows ?? []) as unknown as Record<string, unknown>,
        metadata: { set_levels: true, added, updated, removed },
      })

      return new Response(JSON.stringify({ ok: true, rack_id: input.id, levels: finalRows ?? [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: existing, error: fErr } = await admin.from('locations').select('*').eq('id', input.id).single()
    if (fErr || !existing) throw new EdgeFunctionError('NOT_FOUND', `Location ${input.id} not found`)
    if ((existing as any).kind === 'WAREHOUSE') {
      throw new EdgeFunctionError('INVALID_INPUT', 'Use mutate-warehouse for WAREHOUSE rows')
    }

    if (input.action === 'update') {
      const { data: updated, error } = await admin.from('locations').update(input.data as any).eq('id', input.id).select().single()
      if (error || !updated) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to update location')
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.id), before: existing as Record<string, unknown>, after: updated as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, location: updated }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // deactivate
    if (await nodeHasStock(admin, input.id)) {
      throw new EdgeFunctionError('CONFLICT', 'Cannot deactivate a bin that still holds stock — move it out first')
    }
    const { data: deactivated, error } = await admin.from('locations').update({ is_active: false }).eq('id', input.id).select().single()
    if (error || !deactivated) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to deactivate location')
    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
      resourceId: String(input.id), before: existing as Record<string, unknown>, after: deactivated as Record<string, unknown>,
      metadata: { deactivated: true },
    })
    return new Response(JSON.stringify({ ok: true, location: deactivated }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
