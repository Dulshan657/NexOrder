// mutate-layout Edge Function
//
// Admin-only authoring of warehouse LAYOUTS (the WIE spatial designer). Layouts
// are drafts until publish-layout promotes them. This function owns:
//   * create_layout   — a new empty draft (version = max+1 for the warehouse)
//   * clone_layout    — copy an existing layout's geometry into a new draft
//   * archive_layout  — retire a layout
//   * save_geometry   — full replace of a draft's placements + objects, creating
//                       locations rows for brand-new bins (is_active=false until
//                       publish activates them)
//
// Only drafts are writable. Direct writes to warehouse_layouts / layout_* /
// locations are RLS-blocked; this service-role function is the sole path.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']
const BIN_KINDS = ['ZONE', 'AISLE', 'RACK', 'BAY', 'SHELF', 'BIN'] as const
const LEVEL_ROLES = ['pick', 'reserve', 'bulk'] as const
// Small per-level travel penalty (mig 00072) so lower levels stay preferred
// with no scoring change — the lowest level_index in a rack's template gets
// offset 0, each level above adds one step. Must match the constant of the
// same name in mutate-warehouse-location/index.ts (which re-levels an
// already-published rack; this file only seeds brand-new ones).
const ACCESS_OFFSET_STEP_M = 0.3

const createLayoutSchema = z.object({
  warehouse_id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  grid_width: z.number().int().positive().max(200).optional(),
  grid_height: z.number().int().positive().max(200).optional(),
  cell_size_m: z.number().positive().max(100).optional(),
  floor_count: z.number().int().positive().max(50).optional(),
})

// One level of a leveled rack (mig 00072).
const levelSchema = z.object({
  level_index: z.number().int().positive(),
  role: z.enum(LEVEL_ROLES),
  capacity_slots: z.number().nonnegative().optional(),
  slot_kind: z.enum(['pallet', 'carton']).optional(),
  weight_capacity_kg: z.number().nonnegative().optional(),
})

const newBinSchema = z.object({
  parent_id: z.number().int().positive(),
  kind: z.enum(BIN_KINDS),
  code: z.string().min(1).max(48),
  name: z.string().min(1).max(120),
  capacity_slots: z.number().nonnegative().optional(),
  slot_kind: z.enum(['pallet', 'carton']).optional(),
  // Per-unit weight limit, kg (mig 00061); inherited from the storage form when omitted.
  weight_capacity_kg: z.number().nonnegative().optional(),
  // When set, the bin is parented under (creating if needed) the warehouse's ZONE
  // location for this profile, so it inherits the zone's semantics.
  zone_profile_id: z.number().int().positive().optional(),
  // Physical storage-unit type (mig 00056). Supplies capacity_slots/slot_kind
  // defaults server-side when the caller omits them.
  storage_type_id: z.number().int().positive().optional(),
  // Rack levels (mig 00072). When present, save_geometry creates the RACK
  // parent + one SHELF child + one co-located layout_placements row per
  // level, instead of a single flat BIN.
  levels: z.array(levelSchema).min(1).max(50).optional(),
}).refine((d) => !d.levels || d.kind === 'RACK', {
  message: 'levels is only valid when kind is RACK',
}).refine((d) => !d.levels || new Set(d.levels.map((l) => l.level_index)).size === d.levels.length, {
  message: 'level_index values must be unique',
})

const placementSchema = z.object({
  client_ref: z.string().min(1).max(64),
  location_id: z.number().int().positive().optional(),
  new_bin: newBinSchema.optional(),
  floor: z.number().int().nonnegative().default(0),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive().default(1),
  h: z.number().int().positive().default(1),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
}).refine((p) => p.location_id !== undefined || p.new_bin !== undefined, {
  message: 'placement needs either location_id or new_bin',
})

const objectSchema = z.object({
  object_type: z.enum(['wall', 'dock', 'walkway', 'obstacle', 'label', 'lift', 'conveyor', 'staging']),
  floor: z.number().int().nonnegative().default(0),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive().default(1),
  h: z.number().int().positive().default(1),
  meta: z.record(z.unknown()).optional(),
  staging_location_id: z.number().int().positive().optional(),
  // Present on a 'staging' object when its STAGING location doesn't exist yet;
  // save_geometry find-or-creates it and fills in staging_location_id.
  new_staging: z.object({
    code: z.string().min(1).max(48),
    name: z.string().min(1).max(120),
  }).optional(),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_layout'), data: createLayoutSchema }),
  z.object({ action: z.literal('clone_layout'), layout_id: z.number().int().positive(), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal('archive_layout'), layout_id: z.number().int().positive() }),
  z.object({ action: z.literal('delete_layout'), layout_id: z.number().int().positive() }),
  z.object({
    action: z.literal('save_geometry'),
    layout_id: z.number().int().positive(),
    placements: z.array(placementSchema).max(5000),
    objects: z.array(objectSchema).max(20000),
  }),
])

async function getLayout(admin: any, layoutId: number): Promise<any> {
  const { data, error } = await admin.from('warehouse_layouts').select('*').eq('id', layoutId).single()
  if (error || !data) throw new EdgeFunctionError('NOT_FOUND', `Layout ${layoutId} not found`)
  return data
}

function requireDraft(layout: any): void {
  if (layout.status !== 'draft') {
    throw new EdgeFunctionError('CONFLICT', `Layout is ${layout.status}; only drafts can be edited`)
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-layout:${auth.userId}`, { windowMs: 60_000, max: 120 })
    if (!rl.ok) throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    const input = parsed.data

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // ── create_layout ────────────────────────────────────────────────────────
    if (input.action === 'create_layout') {
      const { data: wh, error: whErr } = await admin
        .from('locations').select('id, kind').eq('id', input.data.warehouse_id).single()
      if (whErr || !wh || (wh as any).kind !== 'WAREHOUSE') {
        throw new EdgeFunctionError('INVALID_INPUT', 'warehouse_id must reference a WAREHOUSE location')
      }
      const { data: maxRow } = await admin
        .from('warehouse_layouts').select('version').eq('warehouse_id', input.data.warehouse_id)
        .order('version', { ascending: false }).limit(1).maybeSingle()
      const nextVersion = ((maxRow as any)?.version ?? 0) + 1

      const { data: created, error } = await admin.from('warehouse_layouts').insert({
        warehouse_id: input.data.warehouse_id,
        name: input.data.name,
        version: nextVersion,
        grid_width: input.data.grid_width ?? 60,
        grid_height: input.data.grid_height ?? 40,
        cell_size_m: input.data.cell_size_m ?? 1.0,
        floor_count: input.data.floor_count ?? 1,
        created_by: auth.userId,
      } as any).select().single()
      if (error || !created) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to create layout')

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'warehouse_layouts',
        resourceId: String((created as any).id), after: created as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, layout: created }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── clone_layout ─────────────────────────────────────────────────────────
    if (input.action === 'clone_layout') {
      const source = await getLayout(admin, input.layout_id)
      const { data: maxRow } = await admin
        .from('warehouse_layouts').select('version').eq('warehouse_id', source.warehouse_id)
        .order('version', { ascending: false }).limit(1).maybeSingle()
      const nextVersion = ((maxRow as any)?.version ?? 0) + 1

      const { data: clone, error: cErr } = await admin.from('warehouse_layouts').insert({
        warehouse_id: source.warehouse_id, name: input.name, version: nextVersion, cloned_from: source.id,
        grid_width: source.grid_width, grid_height: source.grid_height, cell_size_m: source.cell_size_m,
        floor_count: source.floor_count, created_by: auth.userId,
      } as any).select().single()
      if (cErr || !clone) throw new EdgeFunctionError('INTERNAL', cErr?.message ?? 'Failed to clone layout')

      // Copy geometry (placements + objects); the graph is rebuilt at publish.
      const { data: placements } = await admin.from('layout_placements').select('*').eq('layout_id', source.id)
      const { data: objects } = await admin.from('layout_objects').select('*').eq('layout_id', source.id)
      if (placements && placements.length > 0) {
        await admin.from('layout_placements').insert(
          (placements as any[]).map((p) => ({
            layout_id: (clone as any).id, location_id: p.location_id, floor: p.floor,
            x: p.x, y: p.y, w: p.w, h: p.h, rotation: p.rotation,
          })),
        )
      }
      if (objects && objects.length > 0) {
        await admin.from('layout_objects').insert(
          (objects as any[]).map((o) => ({
            layout_id: (clone as any).id, object_type: o.object_type, floor: o.floor,
            x: o.x, y: o.y, w: o.w, h: o.h, meta: o.meta, staging_location_id: o.staging_location_id,
          })),
        )
      }
      return new Response(JSON.stringify({ ok: true, layout: clone }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── archive_layout ───────────────────────────────────────────────────────
    if (input.action === 'archive_layout') {
      const layout = await getLayout(admin, input.layout_id)
      const { data: updated, error } = await admin.from('warehouse_layouts')
        .update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', layout.id).select().single()
      if (error || !updated) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to archive layout')

      // If this was the warehouse's active layout, detach it so recommend-putaway
      // stops serving from an archived layout (the warehouse reverts to legacy/bulk
      // putaway until another layout is published).
      const { data: whRow } = await admin.from('locations')
        .select('active_layout_id').eq('id', layout.warehouse_id).single()
      if ((whRow as any)?.active_layout_id === layout.id) {
        await admin.from('locations')
          .update({ active_layout_id: null, location_type: 'bulk' }).eq('id', layout.warehouse_id)
      }
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'warehouse_layouts',
        resourceId: String(layout.id), before: layout, after: updated as Record<string, unknown>,
        metadata: { archived: true },
      })
      return new Response(JSON.stringify({ ok: true, layout: updated }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── delete_layout ────────────────────────────────────────────────────────
    // Hard-delete a draft or archived layout (never a published one — archive it
    // first). FK-safe teardown of the layout's graph + geometry, then GC of the
    // draft-only locations this layout created (unstocked + not placed elsewhere).
    if (input.action === 'delete_layout') {
      const layout = await getLayout(admin, input.layout_id)
      if (layout.status === 'published') {
        throw new EdgeFunctionError('CONFLICT', 'Archive a published layout before deleting it')
      }

      // Defensive: if this warehouse still points at the layout, detach first so
      // no active pointer dangles (archived layouts are already detached).
      const { data: whRow } = await admin.from('locations')
        .select('active_layout_id').eq('id', layout.warehouse_id).single()
      if ((whRow as any)?.active_layout_id === layout.id) {
        await admin.from('locations')
          .update({ active_layout_id: null, location_type: 'bulk' }).eq('id', layout.warehouse_id)
      }

      // Children first, FK-safe (placements carry graph_node_id → drop them before
      // graph_nodes). Analytics + routing graph + geometry are all layout-scoped.
      for (const table of [
        'wie_location_traffic',
        'wie_simulations',
        'layout_travel_distances',
        'layout_graph_edges',
        'layout_placements',
        'layout_graph_nodes',
        'layout_objects',
      ]) {
        const { error } = await admin.from(table).delete().eq('layout_id', layout.id)
        if (error) throw new EdgeFunctionError('INTERNAL', `Failed to delete ${table}: ${error.message}`)
      }

      // GC the draft-only bins this layout created — skip anything stocked or still
      // placed in another layout (same rule as save_geometry's orphan sweep).
      // DEEPEST FIRST: a levelled rack (mig 00072) is a RACK parent with SHELF
      // children that reference it via parent_id. Deleting the parent before its
      // children trips that self-referential FK; since the delete error used to
      // go unchecked, the parent silently survived as an orphan squatting its
      // globally-unique code. Ordering by materialized_path length descending
      // deletes children before parents, and we now surface a genuine failure.
      const { data: created } = await admin.from('locations')
        .select('id, materialized_path').eq('created_in_layout_id', layout.id).eq('is_active', false)
      const createdDeepestFirst = [...((created ?? []) as any[])].sort(
        (a, b) => (b.materialized_path?.length ?? 0) - (a.materialized_path?.length ?? 0),
      )
      for (const loc of createdDeepestFirst) {
        const { data: bal } = await admin.from('inventory_balances').select('id').eq('location_id', loc.id).limit(1)
        if (bal && bal.length > 0) continue
        const { data: elsewhere } = await admin.from('layout_placements').select('id').eq('location_id', loc.id).limit(1)
        if (elsewhere && elsewhere.length > 0) continue
        // This layout's own layout_objects rows were already deleted above (the
        // FK-safe teardown loop), so any remaining staging_location_id reference
        // here belongs to ANOTHER layout (e.g. clone_layout copied the link) —
        // skip explicitly instead of letting the FK silently fail the delete.
        const { data: stagingElsewhere } = await admin.from('layout_objects')
          .select('id').eq('staging_location_id', loc.id).limit(1)
        if (stagingElsewhere && stagingElsewhere.length > 0) continue
        const { error: locDelErr } = await admin.from('locations').delete().eq('id', loc.id)
        // A leftover child pointing here (deleted later in this same pass) is the
        // one benign FK case; anything else is a real orphan bug we want to see.
        if (locDelErr && !/foreign key/i.test(locDelErr.message)) {
          throw new EdgeFunctionError('INTERNAL', `Failed to GC location ${loc.id}: ${locDelErr.message}`)
        }
      }

      const { error: delErr } = await admin.from('warehouse_layouts').delete().eq('id', layout.id)
      if (delErr) throw new EdgeFunctionError('INTERNAL', `Failed to delete layout: ${delErr.message}`)

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'delete', resource: 'warehouse_layouts',
        resourceId: String(layout.id), before: layout, after: null,
        metadata: { status: layout.status },
      })
      return new Response(JSON.stringify({ ok: true, layout_id: layout.id }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── save_geometry ────────────────────────────────────────────────────────
    const layout = await getLayout(admin, input.layout_id)
    requireDraft(layout)

    // new_staging only makes sense on a 'staging' object — the schema alone
    // can't express a cross-field constraint like this, so guard it explicitly
    // before any writes happen.
    for (const o of input.objects) {
      if (o.new_staging && o.object_type !== 'staging') {
        throw new EdgeFunctionError('INVALID_INPUT', "new_staging is only valid on a 'staging' object")
      }
    }

    const { data: whRow, error: whErr } = await admin.from('locations')
      .select('materialized_path, code').eq('id', layout.warehouse_id).single()
    if (whErr || !whRow) throw new EdgeFunctionError('INTERNAL', 'Could not load the layout\'s warehouse')
    const whPath = (whRow as any).materialized_path as string
    const whCode = (whRow as any).code as string

    // Find-or-create the warehouse's ZONE location for a given profile so bins can
    // inherit zone semantics through the materialized-path ancestry.
    const zoneCache = new Map<number, { id: number; path: string }>()
    const resolveZone = async (profileId: number): Promise<{ id: number; path: string }> => {
      const cached = zoneCache.get(profileId)
      if (cached) return cached
      // Scoped find — kind + profile + this warehouse's subtree (used for both the
      // initial lookup and the race-recovery re-read, so we never adopt a stray row).
      const findZone = () => admin.from('locations')
        .select('id, materialized_path')
        .eq('kind', 'ZONE').eq('zone_profile_id', profileId)
        .like('materialized_path', `${whPath}/%`).limit(1).maybeSingle()

      const { data: existing } = await findZone()
      if (existing) {
        const z = { id: (existing as any).id, path: (existing as any).materialized_path }
        zoneCache.set(profileId, z)
        return z
      }
      const { data: profile, error: profErr } = await admin.from('zone_profiles').select('name').eq('id', profileId).single()
      if (profErr || !profile) throw new EdgeFunctionError('INVALID_INPUT', `Unknown zone profile ${profileId}`)
      const zoneCode = `${whCode}-Z${profileId}`
      const { data: created, error } = await admin.from('locations').insert({
        parent_id: layout.warehouse_id, kind: 'ZONE', code: zoneCode,
        name: (profile as any).name ?? `Zone ${profileId}`,
        materialized_path: `${whPath}/${zoneCode}`, zone_profile_id: profileId, is_active: true,
      } as any).select('id, materialized_path').single()
      if (error || !created) {
        // Lost a race — re-run the SCOPED find (not a by-code read, which could
        // otherwise adopt an unrelated location that happens to share the code).
        const { data: reread } = await findZone()
        if (!reread) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to create zone')
        const z = { id: (reread as any).id, path: (reread as any).materialized_path }
        zoneCache.set(profileId, z)
        return z
      }
      const z = { id: (created as any).id, path: (created as any).materialized_path }
      zoneCache.set(profileId, z)
      return z
    }

    // Storage-type defaults: when a new bin names a storage_type_id but omits
    // capacity/slot, inherit them from the type. Only pallet/carton map onto
    // slot_kind (its CHECK); each/uncounted leave it NULL.
    const storageTypeCache = new Map<number, { defaultCapacitySlots: number | null; slotUnit: string; weightCapacityKg: number | null }>()
    const resolveStorageDefaults = async (id: number) => {
      const cached = storageTypeCache.get(id)
      if (cached) return cached
      const { data, error } = await admin.from('storage_types')
        .select('default_capacity_slots, slot_unit, weight_capacity_kg').eq('id', id).single()
      if (error || !data) throw new EdgeFunctionError('INVALID_INPUT', `Unknown storage type ${id}`)
      const st = {
        defaultCapacitySlots: (data as any).default_capacity_slots ?? null,
        slotUnit: (data as any).slot_unit as string,
        weightCapacityKg: (data as any).weight_capacity_kg ?? null,
      }
      storageTypeCache.set(id, st)
      return st
    }

    // Create locations for brand-new bins, mapping client_ref -> location_id.
    const refToLocation = new Map<string, number>()
    // Leveled racks (mig 00072): client_ref -> { levelIndex -> SHELF location id }.
    // The RACK parent's own id lives in refToLocation above; it has no
    // placement row of its own (the load-bearing decision — see the plan doc).
    const refToLevelLocations = new Map<string, Record<number, number>>()
    for (const p of input.placements) {
      if (p.location_id !== undefined) {
        refToLocation.set(p.client_ref, p.location_id)
        continue
      }
      const nb = p.new_bin!

      // Resolve effective capacity/slot/weight from the storage type when omitted.
      let capacitySlots: number | null = nb.capacity_slots ?? null
      let slotKind: string | null = nb.slot_kind ?? null
      let weightCapacityKg: number | null = nb.weight_capacity_kg ?? null
      if (nb.storage_type_id) {
        const st = await resolveStorageDefaults(nb.storage_type_id)
        if (capacitySlots == null) capacitySlots = st.defaultCapacitySlots
        if (slotKind == null && (st.slotUnit === 'pallet' || st.slotUnit === 'carton')) slotKind = st.slotUnit
        if (weightCapacityKg == null) weightCapacityKg = st.weightCapacityKg
      }
      // Resolve the bin's parent: a zone (if assigned) else the given parent.
      let parentId = nb.parent_id
      let parentPath: string
      if (nb.zone_profile_id) {
        const zone = await resolveZone(nb.zone_profile_id)
        parentId = zone.id
        parentPath = zone.path
      } else {
        const { data: parent, error: pErr } = await admin
          .from('locations').select('materialized_path').eq('id', nb.parent_id).single()
        if (pErr || !parent) throw new EdgeFunctionError('INVALID_INPUT', `Parent ${nb.parent_id} not found for new bin`)
        parentPath = (parent as any).materialized_path as string
      }
      if (whPath && parentPath !== whPath && !parentPath.startsWith(`${whPath}/`)) {
        throw new EdgeFunctionError('INVALID_INPUT', 'New bins must sit inside this layout\'s warehouse')
      }

      if (nb.levels && nb.levels.length > 0) {
        // Leveled rack: one RACK parent (no placement row of its own) + one
        // SHELF child + one co-located layout_placements row per level.
        const { data: createdRack, error: rackErr } = await admin.from('locations').insert({
          parent_id: parentId, kind: 'RACK', code: nb.code, name: nb.name,
          materialized_path: `${parentPath}/${nb.code}`,
          storage_type_id: nb.storage_type_id ?? null,
          is_active: false, created_in_layout_id: layout.id,
        } as any).select('id').single()
        if (rackErr || !createdRack) {
          if (rackErr?.code === '23505') throw new EdgeFunctionError('CONFLICT', `Location code "${nb.code}" already exists`)
          throw new EdgeFunctionError('INTERNAL', rackErr?.message ?? 'Failed to create rack')
        }
        const rackId = (createdRack as any).id as number
        refToLocation.set(p.client_ref, rackId)

        const levelIds: Record<number, number> = {}
        for (const lvl of nb.levels) {
          const levelCode = `${nb.code}-L${lvl.level_index}`
          const { data: createdLevel, error: lvlErr } = await admin.from('locations').insert({
            parent_id: rackId, kind: 'SHELF', code: levelCode, name: `Level ${lvl.level_index}`,
            materialized_path: `${parentPath}/${nb.code}/${levelCode}`,
            level_role: lvl.role, level_index: lvl.level_index,
            capacity_slots: lvl.capacity_slots ?? capacitySlots,
            slot_kind: lvl.slot_kind ?? slotKind,
            weight_capacity_kg: lvl.weight_capacity_kg ?? weightCapacityKg,
            storage_type_id: nb.storage_type_id ?? null,
            is_active: false, created_in_layout_id: layout.id,
          } as any).select('id').single()
          if (lvlErr || !createdLevel) {
            if (lvlErr?.code === '23505') throw new EdgeFunctionError('CONFLICT', `Level code "${levelCode}" already exists`)
            throw new EdgeFunctionError('INTERNAL', lvlErr?.message ?? `Failed to create level ${lvl.level_index}`)
          }
          levelIds[lvl.level_index] = (createdLevel as any).id
        }
        refToLevelLocations.set(p.client_ref, levelIds)
        continue
      }

      const { data: created, error: cErr } = await admin.from('locations').insert({
        parent_id: parentId, kind: nb.kind, code: nb.code, name: nb.name,
        materialized_path: `${parentPath}/${nb.code}`,
        capacity_slots: capacitySlots, slot_kind: slotKind, weight_capacity_kg: weightCapacityKg,
        storage_type_id: nb.storage_type_id ?? null,
        is_active: false, created_in_layout_id: layout.id,
      } as any).select('id').single()
      if (cErr || !created) {
        // A prior draft-created orphan (erase→redraw at the same cell reuses the
        // deterministic code, and a partial earlier save can leave rows behind).
        // Adopt & refresh it instead of dead-ending every retry with a conflict.
        if (cErr?.code === '23505') {
          const { data: prior } = await admin.from('locations')
            .select('id, created_in_layout_id, is_active').eq('code', nb.code).maybeSingle()
          if (prior && (prior as any).created_in_layout_id === layout.id && !(prior as any).is_active) {
            await admin.from('locations').update({
              parent_id: parentId, kind: nb.kind, name: nb.name,
              materialized_path: `${parentPath}/${nb.code}`,
              capacity_slots: capacitySlots, slot_kind: slotKind, weight_capacity_kg: weightCapacityKg,
              storage_type_id: nb.storage_type_id ?? null,
            } as any).eq('id', (prior as any).id)
            refToLocation.set(p.client_ref, (prior as any).id)
            continue
          }
          throw new EdgeFunctionError('CONFLICT', `Location code "${nb.code}" already exists`)
        }
        throw new EdgeFunctionError('INTERNAL', cErr?.message ?? 'Failed to create bin')
      }
      refToLocation.set(p.client_ref, (created as any).id)
    }

    // Reject duplicate bins BEFORE the destructive replace — a UNIQUE(layout_id,
    // location_id) violation mid-insert would otherwise leave the draft empty.
    const resolvedIds = input.placements.map((p) => refToLocation.get(p.client_ref)!)
    if (new Set(resolvedIds).size !== resolvedIds.length) {
      throw new EdgeFunctionError('INVALID_INPUT', 'A bin appears twice in the layout')
    }

    // Full replace of this layout's geometry.
    await admin.from('layout_placements').delete().eq('layout_id', layout.id)
    await admin.from('layout_objects').delete().eq('layout_id', layout.id)

    // One row per placement — EXCEPT a brand-new leveled rack, which fans out
    // to one co-located row per level (the RACK parent itself gets none).
    // Access-offset ladder: the rack's lowest level_index gets offset 0, each
    // level above adds ACCESS_OFFSET_STEP_M, so the engine already prefers
    // reachable/lower levels with no scoring change.
    const placementRows: any[] = []
    for (const p of input.placements) {
      const levelIds = refToLevelLocations.get(p.client_ref)
      if (levelIds) {
        const indices = Object.keys(levelIds).map(Number).sort((a, b) => a - b)
        const baseIndex = indices[0]
        for (const idx of indices) {
          placementRows.push({
            layout_id: layout.id, location_id: levelIds[idx], floor: p.floor,
            x: p.x, y: p.y, w: p.w, h: p.h, rotation: p.rotation,
            level_index: idx, access_offset_m: ACCESS_OFFSET_STEP_M * (idx - baseIndex),
          })
        }
        continue
      }
      placementRows.push({
        layout_id: layout.id, location_id: refToLocation.get(p.client_ref)!, floor: p.floor,
        x: p.x, y: p.y, w: p.w, h: p.h, rotation: p.rotation,
      })
    }
    if (placementRows.length > 0) {
      const { error } = await admin.from('layout_placements').insert(placementRows as any)
      if (error) throw new EdgeFunctionError('INTERNAL', `Failed to save placements: ${error.message}`)
    }
    // ── Resolve new_staging objects → STAGING locations ──────────────────────
    // A floor-plan import (or manual draw) tags at most one distinct 'staging'
    // object with new_staging: { code, name } per save. Dedupe by code, then
    // find-or-create a STAGING location per code, reusing the same 23505
    // adopt-or-conflict pattern as new_bin above.
    const stagingByCode = new Map<string, { code: string; name: string }>()
    for (const o of input.objects) {
      if (o.new_staging) stagingByCode.set(o.new_staging.code, o.new_staging)
    }
    const stagingCodeToLocation = new Map<string, number>()
    for (const [code, ns] of stagingByCode) {
      const { data: created, error: sErr } = await admin.from('locations').insert({
        parent_id: layout.warehouse_id, kind: 'STAGING', code, name: ns.name,
        materialized_path: `${whPath}/${code}`, is_active: false, created_in_layout_id: layout.id,
      } as any).select('id').single()
      if (created && !sErr) {
        stagingCodeToLocation.set(code, (created as any).id)
        continue
      }
      if (sErr?.code === '23505') {
        const { data: prior } = await admin.from('locations')
          .select('id, kind, created_in_layout_id, is_active, materialized_path').eq('code', code).maybeSingle()
        const inThisWarehouse = !!prior && ((prior as any).materialized_path as string).startsWith(`${whPath}/`)
        // Adopt only a STAGING location in this warehouse that some layout
        // created (never a hand-made or foreign-warehouse location); otherwise
        // the code genuinely collides and we must error.
        if (prior && (prior as any).kind === 'STAGING' && (prior as any).created_in_layout_id !== null && inThisWarehouse) {
          if (!(prior as any).is_active) {
            await admin.from('locations').update({ name: ns.name } as any).eq('id', (prior as any).id)
          }
          stagingCodeToLocation.set(code, (prior as any).id)
          continue
        }
        throw new EdgeFunctionError('CONFLICT', `Location code "${code}" already exists`)
      }
      throw new EdgeFunctionError('INTERNAL', sErr?.message ?? 'Failed to create staging location')
    }
    // Single-S&R assumption: distinct staging locations resolved this save.
    const resolvedStagingIds = new Set(stagingCodeToLocation.values())
    const singleStagingId = resolvedStagingIds.size === 1 ? [...resolvedStagingIds][0] : null

    const objectRows = input.objects.map((o) => {
      const explicitStagingId = o.new_staging
        ? stagingCodeToLocation.get(o.new_staging.code) ?? null
        : (o.staging_location_id ?? null)
      // Dock backfill: if exactly one staging location was resolved in this
      // save, wire it to every dock lacking an explicit link. Most warehouses
      // have a single Shipping & Receiving staging area, so this saves the
      // operator from manually linking every dock; multi-staging layouts must
      // wire dock -> staging links by hand via the object inspector.
      const stagingLocationId = explicitStagingId ?? (
        o.object_type === 'dock' && singleStagingId !== null ? singleStagingId : null
      )
      return {
        layout_id: layout.id, object_type: o.object_type, floor: o.floor,
        x: o.x, y: o.y, w: o.w, h: o.h, meta: o.meta ?? {}, staging_location_id: stagingLocationId,
      }
    })
    if (objectRows.length > 0) {
      const { error } = await admin.from('layout_objects').insert(objectRows as any)
      if (error) throw new EdgeFunctionError('INTERNAL', `Failed to save objects: ${error.message}`)
    }

    // Garbage-collect draft-created bins/staging locations no longer referenced
    // (and never stocked). Keep-set = placed bin ids ∪ this save's resolved
    // staging_location_ids (a staging location isn't a placement, so it needs
    // its own keep entry). Also skip any bin still referenced by a placement,
    // or any staging location still referenced by an object's
    // staging_location_id, in ANOTHER layout (e.g. clone_layout copied the
    // link) — deleting it would cascade-delete that layout's reference too.
    const placedIds = new Set(refToLocation.values())
    for (const levelIds of refToLevelLocations.values()) {
      for (const id of Object.values(levelIds)) placedIds.add(id)
    }
    const stagingIdsThisSave = new Set(
      objectRows.map((o) => o.staging_location_id).filter((id): id is number => id !== null),
    )
    const keepIds = new Set<number>([...placedIds, ...stagingIdsThisSave])
    const { data: orphans } = await admin.from('locations')
      .select('id').eq('created_in_layout_id', layout.id).eq('is_active', false)
    for (const o of (orphans ?? []) as any[]) {
      if (keepIds.has(o.id)) continue
      const { data: bal } = await admin.from('inventory_balances').select('id').eq('location_id', o.id).limit(1)
      if (bal && bal.length > 0) continue
      const { data: elsewhere } = await admin.from('layout_placements')
        .select('id').eq('location_id', o.id).neq('layout_id', layout.id).limit(1)
      if (elsewhere && elsewhere.length > 0) continue
      const { data: stagingElsewhere } = await admin.from('layout_objects')
        .select('id').eq('staging_location_id', o.id).neq('layout_id', layout.id).limit(1)
      if (stagingElsewhere && stagingElsewhere.length > 0) continue
      await admin.from('locations').delete().eq('id', o.id)
    }

    await admin.from('warehouse_layouts').update({ updated_at: new Date().toISOString() }).eq('id', layout.id)

    const refMap = [...refToLocation.entries()].map(([client_ref, location_id]) => {
      const levelIds = refToLevelLocations.get(client_ref)
      return levelIds ? { client_ref, location_id, level_location_ids: levelIds } : { client_ref, location_id }
    })
    return new Response(JSON.stringify({ ok: true, layout_id: layout.id, ref_map: refMap }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
