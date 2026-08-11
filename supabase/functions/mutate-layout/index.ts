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
// Small per-level travel penalty (mig 00072) so lower levels stay preferred with
// no scoring change — the lowest level_index in a rack's template gets offset 0,
// each level above adds one step. Imported rather than redeclared: it had
// drifted to 0.3 here and in mutate-warehouse-location while the migration and
// the frontend used 0.5, so a same-rack level reported two different reach costs
// depending on which path built it.
import { ACCESS_OFFSET_STEP_M } from '../_shared/wie/levelGeometry.ts'
import { assertValidRoles, loadActiveRoleKeys } from '../_shared/levelRoleLookup.ts'
// Grid scale. MAX_GRID_CELLS is imported rather than restated so the zod caps
// below, the designer's refusal message and the rescale planner cannot drift
// apart about where the ceiling is.
import {
  MAX_GRID_CELLS,
  findOutOfBounds,
  planRescale,
  type ScaleItem,
} from '../_shared/wie/gridScale.ts'
// Friendly location names (mig 00094). The RULES are pure and shared with the
// browser, so the designer's preview of "Chiller · Rack 7" is this function's
// decision evaluated early; the I/O beside them is deliberately not in wie/,
// which is under the purity contract.
import {
  assignAutoNames,
  buildAreaIndex,
  composeName,
  type NamingUnit,
} from '../_shared/wie/locationNaming.ts'
import {
  applyNameWrites,
  loadAreaHighWater,
  loadLocationsForNaming,
  loadNameState,
  loadUnitNouns,
  nameWriteNeeded,
  type NameWrite,
} from '../_shared/locationNamingWrite.ts'
// Zone binding (mig 00096). Same split again: the rule is pure and shared, the
// find-or-create of the ZONE row and the batched re-parent are I/O beside it.
// resolveZone used to be defined inline here and is now shared, because
// mutate-warehouse-location binds too and two find-or-create implementations
// racing on one (warehouse, profile) pair is how you get two ZONE rows.
import {
  planZoneBinding,
  requiredProfileIds,
  zoneTargets,
  type BindingUnit,
} from '../_shared/wie/zoneBinding.ts'
import { applyReparents, makeZoneResolver, resolveZones } from '../_shared/zoneResolve.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']
const BIN_KINDS = ['ZONE', 'AISLE', 'RACK', 'BAY', 'SHELF', 'BIN'] as const

const createLayoutSchema = z.object({
  warehouse_id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  grid_width: z.number().int().positive().max(MAX_GRID_CELLS).optional(),
  grid_height: z.number().int().positive().max(MAX_GRID_CELLS).optional(),
  cell_size_m: z.number().positive().max(100).optional(),
  floor_count: z.number().int().positive().max(50).optional(),
})

// Layout HEADER edit (name / floor size / resolution / floors). Geometry moves as
// a consequence of a resolution change — see the update_layout handler.
const updateLayoutSchema = z.object({
  layout_id: z.number().int().positive(),
  name: z.string().min(1).max(120).optional(),
  grid_width: z.number().int().positive().max(MAX_GRID_CELLS).optional(),
  grid_height: z.number().int().positive().max(MAX_GRID_CELLS).optional(),
  cell_size_m: z.number().positive().max(100).optional(),
  floor_count: z.number().int().positive().max(50).optional(),
})

// One level of a leveled rack (mig 00072).
const levelSchema = z.object({
  level_index: z.number().int().positive(),
  // Validated at runtime against level_roles (mig 00081) — the vocabulary is
  // operator-managed, so a z.enum literal would reject a newly-created role.
  //
  // NULLISH IS LEGAL, and this schema used to say otherwise. `locations.level_role`
  // is nullable, NULL means "unconstrained" (every legacy bin), and
  // assertValidRoles explicitly documents that it skips null/undefined rather
  // than rejecting them. But `z.string().min(1)` made the field required and
  // non-empty, so the one representation of "unconstrained" the rest of the
  // system treats as valid was rejected at the door — as a bare
  // INVALID_INPUT/400, which supabase-js then flattened to "Edge Function
  // returned a non-2xx status code". The designer reaches this on any rack whose
  // level has no stored role: useLayoutEditorState's `load` maps a missing role to
  // '' deliberately (defaulting to 'pick' would silently claim a Pick Zone that
  // drives replenishment and allocation), and persistGeometry forwarded that ''
  // verbatim. Empty string is normalised to null below.
  role: z.string().max(32).nullish().transform((r) => (r && r.trim().length > 0 ? r : null)),
  // NULLISH, not optional — and this is the same class of bug the `role` comment
  // above describes, in the two fields right beside it. `.optional()` accepts
  // `undefined` and REJECTS `null`; the designer sends `l.capacitySlots ?? null`
  // because these columns are nullable and NULL is the honest wire value for
  // "no limit". Every drawable storage form whose level_template omits a weight
  // (SHELVING and COLD_ROOM both do, and NULL is what mig 00072 writes when the
  // form has no weight_capacity_kg) therefore failed EVERY save with a bare
  // "Invalid request body". mutate-warehouse-location, which validates this same
  // per-level payload, has always used `.nullable().optional()` — this schema
  // simply never got widened, and with `strict` off tsc cannot see the drift
  // (`number | null` assigns cleanly to `capacity_slots?: number`).
  //
  // Nothing downstream changes: every consumer reads `lvl.capacity_slots ??
  // <rack default>`, and `??` already treats null as absent, so a null level
  // inherits the storage form's default exactly as an omitted one does.
  capacity_slots: z.number().nonnegative().nullish(),
  slot_kind: z.enum(['pallet', 'carton']).nullish(),
  weight_capacity_kg: z.number().nonnegative().nullish(),
})

/**
 * One level of a rack that ALREADY EXISTS — i.e. a level carried on a placement
 * next to `location_id`, rather than inside `new_bin`.
 *
 * A levelled rack round-trips to the client as ONE placement whose
 * `location_id` is the RACK PARENT (the parent has no placement row of its own;
 * its SHELF children do). Without this schema there was no way to express "this
 * saved rack still has these levels", so the second save of any levelled rack
 * sent the parent alone — and save_geometry, being a full replace, wrote one
 * placement row on the RACK parent and then garbage-collected every SHELF level
 * as an unreferenced draft orphan. The levels, their roles and their capacities
 * were deleted, silently, by the act of saving twice.
 *
 * `location_id` is omitted for a level the operator just ADDED to a saved rack;
 * that one is created here the same way the new_bin branch creates its levels.
 */
const existingLevelSchema = z.object({
  location_id: z.number().int().positive().optional(),
  level_index: z.number().int().positive(),
  role: z.string().max(32).nullish().transform((r) => (r && r.trim().length > 0 ? r : null)),
  capacity_slots: z.number().nonnegative().nullish(),
  slot_kind: z.enum(['pallet', 'carton']).nullish(),
  weight_capacity_kg: z.number().nonnegative().nullish(),
})

const newBinSchema = z.object({
  parent_id: z.number().int().positive(),
  kind: z.enum(BIN_KINDS),
  code: z.string().min(1).max(48),
  name: z.string().min(1).max(120),
  // Nullish rather than optional for the same reason as levelSchema's copies of
  // these fields: the columns are nullable, `?? null` below already folds null
  // into "inherit from the storage form", and a caller that spells "no limit" as
  // null must not get a 400 for it.
  capacity_slots: z.number().nonnegative().nullish(),
  slot_kind: z.enum(['pallet', 'carton']).nullish(),
  // Per-unit weight limit, kg (mig 00061); inherited from the storage form when omitted.
  weight_capacity_kg: z.number().nonnegative().nullish(),
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
  // Name provenance (mig 00094). `.nullish()` on the seq because the column is
  // nullable and null is the honest wire value for "never numbered" — the
  // `.optional()`-rejects-null trap that broke every Shelving rack save.
  //
  // The server RECOMPUTES all three rather than trusting them; they are here so
  // it has something to recompute FROM for a bin it has never seen. The one
  // exception is `name_is_auto: false`, which is respected verbatim: the operator
  // typed a name in the inspector before the first save, and no rule may
  // overwrite that.
  name_seq: z.number().int().positive().nullish(),
  name_area: z.string().max(60).nullish(),
  name_is_auto: z.boolean().optional(),
}).refine((d) => !d.levels || d.kind === 'RACK', {
  message: 'levels is only valid when kind is RACK',
}).refine((d) => !d.levels || new Set(d.levels.map((l) => l.level_index)).size === d.levels.length, {
  message: 'level_index values must be unique',
})

const placementSchema = z.object({
  client_ref: z.string().min(1).max(64),
  location_id: z.number().int().positive().optional(),
  new_bin: newBinSchema.optional(),
  // The levels of an EXISTING rack (see existingLevelSchema). A brand-new rack
  // carries its levels inside `new_bin` instead — the two are mutually exclusive
  // because a placement is either an existing location or a request to make one.
  levels: z.array(existingLevelSchema).min(1).max(50).optional(),
  // Re-point an ALREADY-SAVED bin at a storage form (mig 00056). A new bin
  // carries this inside `new_bin`; without it here, repainting a saved cell with
  // a different form was silently dropped on save.
  //
  // `.nullish()`, not `.optional()`: `locations.storage_type_id` is nullable and
  // null is the honest wire value for "no form". Absent means "don't touch it",
  // which is what keeps an older bundle's payload from clearing the column.
  storage_type_id: z.number().int().positive().nullish(),
  floor: z.number().int().nonnegative().default(0),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive().default(1),
  h: z.number().int().positive().default(1),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
}).refine((p) => p.location_id !== undefined || p.new_bin !== undefined, {
  message: 'placement needs either location_id or new_bin',
}).refine((p) => !p.levels || p.location_id !== undefined, {
  message: 'levels on a placement requires location_id (a new rack carries levels in new_bin)',
}).refine((p) => !p.levels || new Set(p.levels.map((l) => l.level_index)).size === p.levels.length, {
  message: 'level_index values must be unique',
})

const objectSchema = z.object({
  // 'area' (mig 00090) — an operator-named region wash. Its identity and zone
  // profile ride in `meta` ({ name, zoneProfileId }), so no new column.
  object_type: z.enum(['wall', 'dock', 'walkway', 'obstacle', 'label', 'lift', 'conveyor', 'staging', 'area']),
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
  z.object({ action: z.literal('update_layout'), data: updateLayoutSchema }),
  z.object({ action: z.literal('clone_layout'), layout_id: z.number().int().positive(), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal('archive_layout'), layout_id: z.number().int().positive() }),
  z.object({ action: z.literal('delete_layout'), layout_id: z.number().int().positive() }),
  z.object({
    action: z.literal('save_geometry'),
    layout_id: z.number().int().positive(),
    placements: z.array(placementSchema).max(5000),
    objects: z.array(objectSchema).max(20000),
    // Area renames since the last save, oldest first (mig 00094).
    //
    // This has to be told, not inferred: save_geometry is a FULL REPLACE, so
    // "renamed Chiller to Cold Room" and "erased Chiller, painted Cold Room"
    // arrive as byte-identical geometry. Without this the bins inside a renamed
    // area would keep the old name and the map would disagree with every pick
    // list.
    area_renames: z.array(z.object({
      from: z.string().min(1).max(60),
      to: z.string().min(1).max(60),
    })).max(50).optional(),
  }),
])

/**
 * Failure details that NAME THE FIELD, as `{ issues: [{ path, message }] }`.
 *
 * This used to be `error.flatten()`, which collapses every nested path onto its
 * top-level key — so a null deep inside `placements[14].new_bin.levels[0]`
 * reported as `{ placements: ['Expected number, received null'] }` and the
 * operator was told only "Invalid request body". The path is the whole diagnosis;
 * capped at 10 issues so a 5000-placement payload can't return a wall of text.
 */
function validationIssues(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}

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
    if (!parsed.success) throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', validationIssues(parsed.error))
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

    // ── update_layout ────────────────────────────────────────────────────────
    //
    // The layout HEADER: its name, the building's real dimensions (as a grid),
    // the drawing resolution, and the floor count.
    //
    // THIS IS THE ONE ACTION THAT DOES NOT CALL requireDraft. Every other edit
    // here writes geometry, which is a draft-only activity. A header edit is
    // different: an operator who mis-measured the building only finds out after
    // the layout is live, and the alternative — clone, redraw, republish —
    // throws away the floor plan to fix a number. Moving layout_placements /
    // layout_objects rows on a published layout is safe because they carry no
    // inventory (`locations` does, and is untouched here); what a published
    // layout's rescale DOES invalidate is the graph frozen at publish
    // (layout_graph_edges.weight_m, layout_travel_distances.distance_m,
    // layout_placements.access_offset_m), which stays stale until a republish.
    // That is surfaced, not silently repaired — see needsRepublish in adapters.
    if (input.action === 'update_layout') {
      const d = input.data
      const layout = await getLayout(admin, d.layout_id)
      if (layout.status === 'archived') {
        throw new EdgeFunctionError('CONFLICT', 'Layout is archived; restore or clone it before editing')
      }

      const fromCellM = Number(layout.cell_size_m)
      const toCellM = d.cell_size_m ?? fromCellM
      // Both sides are NUMERIC(6,2) round-trips, so a direct compare is exact.
      const resolutionChanged = toCellM !== fromCellM

      const { data: pRows, error: pErr } = await admin.from('layout_placements')
        .select('id, location_id, floor, x, y, w, h').eq('layout_id', layout.id).order('id')
      if (pErr) throw new EdgeFunctionError('INTERNAL', `Could not read placements: ${pErr.message}`)
      const { data: oRows, error: oErr } = await admin.from('layout_objects')
        .select('id, object_type, floor, x, y, w, h').eq('layout_id', layout.id).order('id')
      if (oErr) throw new EdgeFunctionError('INTERNAL', `Could not read objects: ${oErr.message}`)

      const placementRowsIn = (pRows ?? []) as Array<{ id: number; location_id: number; floor: number; x: number; y: number; w: number; h: number }>
      const objectRowsIn = (oRows ?? []) as Array<{ id: number; object_type: string; floor: number; x: number; y: number; w: number; h: number }>

      // Name the offenders by their location CODE. "Rack A-03 doesn't divide" is
      // something an operator can walk to; "placement 4172" is not.
      const codeById = new Map<number, string>()
      const locIds = [...new Set(placementRowsIn.map((r) => r.location_id))]
      for (let i = 0; i < locIds.length; i += 200) {
        const { data } = await admin.from('locations').select('id, code').in('id', locIds.slice(i, i + 200))
        for (const row of (data ?? []) as Array<{ id: number; code: string }>) codeById.set(row.id, row.code)
      }

      const placementItems: ScaleItem[] = placementRowsIn.map((r) => ({
        label: codeById.get(r.location_id) ?? `location ${r.location_id}`,
        x: r.x, y: r.y, w: r.w, h: r.h,
      }))
      const objectItems: ScaleItem[] = objectRowsIn.map((r) => ({
        label: `${r.object_type} at (${r.x},${r.y})`,
        x: r.x, y: r.y, w: r.w, h: r.h,
      }))

      let gridWidth = d.grid_width ?? layout.grid_width
      let gridHeight = d.grid_height ?? layout.grid_height
      let scaledPlacements: Array<{ id: number; x: number; y: number; w: number; h: number }> | null = null
      let scaledObjects: Array<{ id: number; x: number; y: number; w: number; h: number }> | null = null

      if (resolutionChanged) {
        // planRescale is the SAME function LayoutPropertiesModal runs to preview
        // this edit (_shared/wie/gridScale.ts, imported by both runtimes). If the
        // preview said "×2, nothing refused" then so does this call.
        const plan = planRescale({
          placements: placementItems,
          objects: objectItems,
          fromCellM,
          toCellM,
          gridWidth: layout.grid_width,
          gridHeight: layout.grid_height,
          toGridWidth: d.grid_width,
          toGridHeight: d.grid_height,
        })
        if (plan.ok === false) {
          throw new EdgeFunctionError('CONFLICT', plan.detail, { reason: plan.reason, offenders: plan.offenders })
        }
        gridWidth = plan.gridWidth
        gridHeight = plan.gridHeight
        // planRescale preserves input order, which is what lets these zip back
        // onto their rows by index without threading ids through the pure module.
        scaledPlacements = plan.placements.map((it, i) => ({ id: placementRowsIn[i].id, x: it.x, y: it.y, w: it.w, h: it.h }))
        scaledObjects = plan.objects.map((it, i) => ({ id: objectRowsIn[i].id, x: it.x, y: it.y, w: it.w, h: it.h }))
      } else if (gridWidth !== layout.grid_width || gridHeight !== layout.grid_height) {
        // Floor resized at an unchanged resolution: nothing moves, but a shrink
        // can strand a bin outside the plan. A stranded bin is a real location
        // that may hold stock, so it is never relocated or dropped for them.
        const outside = findOutOfBounds([...placementItems, ...objectItems], { gridWidth, gridHeight })
        if (outside.length > 0) {
          throw new EdgeFunctionError(
            'CONFLICT',
            `A ${gridWidth} x ${gridHeight} grid would leave these outside the floor: ${outside.slice(0, 6).join(', ')}` +
              `${outside.length > 6 ? ` and ${outside.length - 6} more` : ''}. Move or remove them first.`,
            { reason: 'out_of_bounds', offenders: outside },
          )
        }
      }

      // Same class of problem, one axis over: dropping a floor strands whatever
      // was drawn on it.
      const floorCount = d.floor_count ?? layout.floor_count
      const usedFloors = [...new Set([...placementRowsIn, ...objectRowsIn].map((r) => r.floor))].filter((f) => f >= floorCount)
      if (usedFloors.length > 0) {
        throw new EdgeFunctionError(
          'CONFLICT',
          `${floorCount} floor${floorCount === 1 ? '' : 's'} would strand everything drawn on floor ${usedFloors.sort((a, b) => a - b).join(', ')}. Clear those floors first.`,
          { reason: 'floors_in_use', offenders: usedFloors.map(String) },
        )
      }

      const { data: updated, error: upErr } = await admin.rpc('wie_update_layout_tx', {
        p_layout_id: layout.id,
        p_header: {
          name: d.name,
          cell_size_m: toCellM,
          grid_width: gridWidth,
          grid_height: gridHeight,
          floor_count: floorCount,
        },
        p_placements: scaledPlacements,
        p_objects: scaledObjects,
      } as any)
      if (upErr || !updated) throw new EdgeFunctionError('INTERNAL', upErr?.message ?? 'Failed to update layout')

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'warehouse_layouts',
        resourceId: String(layout.id), before: layout, after: updated as Record<string, unknown>,
        metadata: {
          rescaled: resolutionChanged,
          from_cell_size_m: fromCellM,
          to_cell_size_m: toCellM,
          moved_placements: scaledPlacements?.length ?? 0,
          moved_objects: scaledObjects?.length ?? 0,
        },
      })
      return new Response(JSON.stringify({ ok: true, layout: updated }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    // Level roles are operator-managed (mig 00081), so they are validated here
    // rather than by a z.enum. Checked BEFORE the destructive geometry replace
    // below: an FK violation partway through would leave the draft empty.
    // Both level sources: a brand-new rack's `new_bin.levels` AND an existing
    // rack's `levels`. Only the first was checked, so a role edited on a saved
    // rack reached the UPDATE unvalidated and surfaced as a raw FK violation.
    const draftedRoles = input.placements.flatMap((p) => [
      ...(p.new_bin?.levels ?? []).map((l) => l.role),
      ...(p.levels ?? []).map((l) => l.role),
    ])
    if (draftedRoles.length > 0) {
      assertValidRoles(draftedRoles, await loadActiveRoleKeys(admin))
    }

    const { data: whRow, error: whErr } = await admin.from('locations')
      .select('materialized_path, code').eq('id', layout.warehouse_id).single()
    if (whErr || !whRow) throw new EdgeFunctionError('INTERNAL', 'Could not load the layout\'s warehouse')
    const whPath = (whRow as any).materialized_path as string
    const whCode = (whRow as any).code as string

    // Find-or-create the warehouse's ZONE location for a given profile so bins can
    // inherit zone semantics through the materialized-path ancestry. Shared with
    // mutate-warehouse-location as of mig 00096 — see _shared/zoneResolve.ts.
    const resolveZone = makeZoneResolver(admin, {
      id: layout.warehouse_id, path: whPath, code: whCode,
    })

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

    /**
     * Adopt a draft-created orphan location carrying this code, refreshing its
     * fields, and return its id — or null when the code belongs to something we
     * must NOT touch.
     *
     * The new-bin loop below is NOT transactional: every insert is its own round
     * trip, so a failure partway through leaves every earlier insert COMMITTED.
     * Those rows are `is_active = false, created_in_layout_id = <this layout>` —
     * reservations, not yet real locations. On the operator's retry the same
     * deterministic codes come back (`<warehouse>-B-<x>-<y>`, and `<code>-L<n>`
     * for levels), so a bare 23505 → CONFLICT dead-ends EVERY retry, permanently.
     *
     * The flat-bin branch has adopted since day one. The LEVELLED-RACK branch did
     * not — which is why one failed save of a levelled rack was fatal, and every
     * drawable levelled storage form (Pallet Rack, Shelving, Cold Room, Rack) goes
     * down that branch. Both branches now share this one implementation so they
     * cannot drift apart again.
     *
     * Returns null for an ACTIVE location, a hand-made one (`created_in_layout_id`
     * null), or one another layout created — adopting any of those would hijack
     * real inventory.
     */
    const adoptDraftOrphan = async (
      code: string,
      patch: Record<string, unknown>,
    ): Promise<number | null> => {
      const { data: prior } = await admin.from('locations')
        .select('id, created_in_layout_id, is_active').eq('code', code).maybeSingle()
      if (!prior) return null
      const row = prior as { id: number; created_in_layout_id: number | null; is_active: boolean }
      if (row.created_in_layout_id !== layout.id || row.is_active) return null
      const { error } = await admin.from('locations').update(patch as any).eq('id', row.id)
      if (error) return null
      return row.id
    }

    // ── Existing levelled racks ──────────────────────────────────────────────
    // Pre-read every existing placement's SHELF level children in ONE chunked
    // query rather than one query per placement: save_geometry accepts up to
    // 5000 placements and functions.invoke is bounded by a 20s fetch ceiling, so
    // a per-placement round trip would time out on a real DC layout long before
    // it returned. `.in()` rides in the URL, hence the chunking.
    interface LevelRow {
      id: number
      parent_id: number
      code: string
      level_index: number
      level_role: string | null
      capacity_slots: number | string | null
      slot_kind: string | null
      weight_capacity_kg: number | string | null
    }
    const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
    const chunked = <T,>(items: T[], size: number): T[][] => {
      const out: T[][] = []
      for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
      return out
    }

    const existingIds = [...new Set(
      input.placements.map((p) => p.location_id).filter((id): id is number => id !== undefined),
    )]
    const levelsByRack = new Map<number, LevelRow[]>()
    for (const chunk of chunked(existingIds, 200)) {
      const { data, error } = await admin.from('locations')
        .select('id, parent_id, code, level_index, level_role, capacity_slots, slot_kind, weight_capacity_kg')
        .in('parent_id', chunk).eq('kind', 'SHELF').not('level_index', 'is', null)
      if (error) throw new EdgeFunctionError('INTERNAL', `Could not read rack levels: ${error.message}`)
      for (const row of (data ?? []) as LevelRow[]) {
        const bucket = levelsByRack.get(row.parent_id)
        if (bucket) bucket.push(row)
        else levelsByRack.set(row.parent_id, [row])
      }
    }
    for (const rows of levelsByRack.values()) rows.sort((a, b) => a.level_index - b.level_index)

    // The rack rows themselves, needed only to create/re-default a level.
    interface RackRow {
      id: number
      kind: string
      code: string
      materialized_path: string
      storage_type_id: number | null
      capacity_slots: number | string | null
      slot_kind: string | null
      weight_capacity_kg: number | string | null
    }
    const rackRows = new Map<number, RackRow>()
    const idsWithLevelEdits = [...new Set(
      input.placements.filter((p) => p.levels).map((p) => p.location_id!),
    )]
    for (const chunk of chunked(idsWithLevelEdits, 200)) {
      const { data, error } = await admin.from('locations')
        .select('id, kind, code, materialized_path, storage_type_id, capacity_slots, slot_kind, weight_capacity_kg')
        .in('id', chunk)
      if (error) throw new EdgeFunctionError('INTERNAL', `Could not read racks: ${error.message}`)
      for (const row of (data ?? []) as RackRow[]) rackRows.set(row.id, row)
    }

    /**
     * Resolve `{ level_index -> SHELF location id }` for an EXISTING placement,
     * applying whatever per-level edits the client sent. Returns null when the
     * placement isn't a levelled rack (a flat bin), which leaves that path
     * byte-identical to before.
     *
     * The `edits === undefined` branch is a SAFETY NET, not a nicety: a client
     * that doesn't send `levels` — an older bundle still being served between the
     * function deploy and the frontend deploy, or a stale tab — otherwise saved
     * the rack PARENT as the placement, and the orphan sweep below then deleted
     * every level as unreferenced. Deriving the levels from the database instead
     * makes that flattening unreachable regardless of what the client sends.
     */
    const resolveExistingRackLevels = async (
      rackId: number,
      edits: Array<z.infer<typeof existingLevelSchema>> | undefined,
    ): Promise<Record<number, number> | null> => {
      const current = levelsByRack.get(rackId) ?? []
      if (!edits) {
        if (current.length === 0) return null
        const ids: Record<number, number> = {}
        for (const row of current) ids[row.level_index] = row.id
        return ids
      }

      const rack = rackRows.get(rackId)
      if (!rack) throw new EdgeFunctionError('INVALID_INPUT', `Placement location ${rackId} not found`)
      if (rack.kind !== 'RACK') {
        throw new EdgeFunctionError('INVALID_INPUT', `Location ${rackId} is a ${rack.kind}, not a RACK; it cannot carry levels`)
      }
      // Defaults a null level field inherits, exactly as the new-rack branch
      // resolves them — so "no limit" on a level means the same thing whether the
      // rack was created this save or ten saves ago.
      let capacityDefault = num(rack.capacity_slots)
      let slotDefault = rack.slot_kind
      let weightDefault = num(rack.weight_capacity_kg)
      if (rack.storage_type_id) {
        const st = await resolveStorageDefaults(rack.storage_type_id)
        if (capacityDefault == null) capacityDefault = st.defaultCapacitySlots
        if (slotDefault == null && (st.slotUnit === 'pallet' || st.slotUnit === 'carton')) slotDefault = st.slotUnit
        if (weightDefault == null) weightDefault = st.weightCapacityKg
      }

      const byId = new Map(current.map((r) => [r.id, r]))
      const ids: Record<number, number> = {}
      for (const lvl of edits) {
        const desired = {
          level_role: lvl.role,
          capacity_slots: lvl.capacity_slots ?? capacityDefault,
          slot_kind: lvl.slot_kind ?? slotDefault,
          weight_capacity_kg: lvl.weight_capacity_kg ?? weightDefault,
        }
        if (lvl.location_id !== undefined) {
          const row = byId.get(lvl.location_id)
          // Never take a client's word for which location a level is. Without
          // this, a crafted payload could re-role or re-capacity any SHELF in the
          // database through a layout the caller happens to be allowed to edit.
          if (!row) {
            throw new EdgeFunctionError('INVALID_INPUT', `Location ${lvl.location_id} is not a level of rack ${rack.code}`)
          }
          const unchanged = row.level_role === desired.level_role
            && num(row.capacity_slots) === desired.capacity_slots
            && (row.slot_kind ?? null) === (desired.slot_kind ?? null)
            && num(row.weight_capacity_kg) === desired.weight_capacity_kg
            && row.level_index === lvl.level_index
          // Skip the write when nothing moved. The overwhelmingly common save is
          // "geometry changed, levels didn't", and 945 no-op UPDATEs (a 189-bay
          // DC at 5 levels) would blow the invoke timeout for no effect.
          if (!unchanged) {
            const { error } = await admin.from('locations')
              .update({ ...desired, level_index: lvl.level_index } as any).eq('id', row.id)
            if (error) throw new EdgeFunctionError('INTERNAL', `Failed to update level ${lvl.level_index}: ${error.message}`)
          }
          ids[lvl.level_index] = row.id
          continue
        }
        // A level the operator ADDED to a saved rack: create it under the rack,
        // reusing the insert-or-adopt dance so a failed earlier save can't
        // permanently dead-end every retry on its own leftover row.
        const newCode = `${rack.code}-L${lvl.level_index}`
        const payload = {
          parent_id: rackId, kind: 'SHELF', code: newCode, name: `Level ${lvl.level_index}`,
          materialized_path: `${rack.materialized_path}/${newCode}`,
          level_index: lvl.level_index, storage_type_id: rack.storage_type_id ?? null,
          ...desired,
        }
        const { data: created, error: insErr } = await admin.from('locations')
          .insert({ ...payload, is_active: false, created_in_layout_id: layout.id } as any)
          .select('id').single()
        if (created && !insErr) {
          ids[lvl.level_index] = (created as any).id
          continue
        }
        if (insErr?.code !== '23505') {
          throw new EdgeFunctionError('INTERNAL', insErr?.message ?? `Failed to create level ${lvl.level_index}`)
        }
        const adopted = await adoptDraftOrphan(newCode, payload)
        if (adopted === null) throw new EdgeFunctionError('CONFLICT', `Level code "${newCode}" already exists`)
        ids[lvl.level_index] = adopted
      }
      // A level's `code` is derived from its index once, at creation, and never
      // rewritten (codes are globally unique, so renumbering them in place would
      // collide mid-swap). Delete a MIDDLE level and the survivors' indexes shift
      // while their codes don't — after which adding a level can pick a `-L<n>`
      // code that another surviving level still owns, and adopt it. Catch that
      // here: two indexes resolving to one location would violate UNIQUE(layout_id,
      // location_id) on the insert BELOW the destructive delete, leaving the draft
      // empty. Failing now costs the operator a reload instead of their layout.
      const resolved = Object.values(ids)
      if (new Set(resolved).size !== resolved.length) {
        throw new EdgeFunctionError(
          'CONFLICT',
          `Rack ${rack.code}'s levels no longer line up with their codes — reload the layout and re-apply the level change`,
        )
      }
      return ids
    }

    // ── Friendly names (mig 00094) ────────────────────────────────────────────
    //
    // THE SERVER RECOMPUTES; IT DOES NOT TRUST THE WIRE. Existing placements take
    // their provenance from the DATABASE, so a stale tab — or the window between
    // this function deploying and the frontend deploying — cannot mint a rack
    // number that is already on the floor. This is the same second path
    // resolveExistingRackLevels exists to provide for levels.
    //
    // Recomputation is safe rather than merely redundant because assignAutoNames
    // is monotonic: it only ever hands out a number where there is none, and only
    // ever rewrites a name when explicitly told to by `area_renames`. Both sides
    // run the identical pure module, so in the normal case this is a no-op that
    // confirms the designer's preview.
    const namingExistingIds = input.placements
      .filter((p) => p.location_id !== undefined)
      .map((p) => p.location_id!)
    const storedNames = await loadNameState(admin, namingExistingIds)
    // Numbers already spoken for ANYWHERE in this warehouse, including on racks
    // that have since left the layout. Without this, deleting a rack and drawing
    // another would re-mint its number onto a second rack while the first one's
    // label is still on the racking.
    const areaHighWater = whPath ? await loadAreaHighWater(admin, whPath) : new Map<string, number>()
    const areaCellSources = input.objects.map((o) => ({
      objectType: o.object_type, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
      meta: o.meta ?? null,
    }))
    const areaIndex = buildAreaIndex(areaCellSources)

    // Area NAME -> its zone profile (mig 00096). Areas are keyed by name across
    // the site, so an area painted on two floors is one entry; a later cell wins
    // a disagreement, which cannot arise from the designer (paint_cell replaces)
    // and only matters for imported geometry.
    const profileByArea = new Map<string, number | null>()
    for (const o of areaCellSources) {
      if (o.objectType !== 'area') continue
      const name = typeof o.meta?.name === 'string' ? o.meta.name.trim() : ''
      if (!name) continue
      const raw = (o.meta as any)?.zoneProfileId
      profileByArea.set(name, typeof raw === 'number' ? raw : null)
    }

    /** The zone profile a placement should be parented under: its area's, else
     *  its own dropdown value, else none. The pure rule, applied to one row —
     *  planZoneBinding applies the identical one to the rows already stored. */
    const resolveNewBinProfile = (p: (typeof input.placements)[number]): number | null => {
      const targets = zoneTargets(
        [{
          ref: p.client_ref, id: 0, code: '', parentId: null, path: '',
          floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h,
          ownZoneProfileId: p.new_bin?.zone_profile_id ?? null,
        }],
        areaIndex,
        profileByArea,
      )
      const fromArea = targets.get(p.client_ref)?.profileId ?? null
      return fromArea ?? p.new_bin?.zone_profile_id ?? null
    }
    // What each unit is CALLED (mig 00100) — from its own storage form: the one
    // the client sent for a new bin, the one already stored for an existing one.
    const namingNouns = await loadUnitNouns(
      admin,
      input.placements.map((p) => (
        p.new_bin?.storage_type_id
        ?? (p.location_id !== undefined ? storedNames.get(p.location_id)?.storageTypeId : null)
      )),
    )
    let namingUnits: NamingUnit[] = input.placements.map((p) => {
      const stored = p.location_id !== undefined ? storedNames.get(p.location_id) : undefined
      const formId = p.new_bin?.storage_type_id ?? stored?.storageTypeId ?? null
      return {
        ref: p.client_ref,
        floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h,
        noun: formId != null ? namingNouns.get(formId) : undefined,
        name: stored?.name ?? p.new_bin?.name ?? null,
        // A brand-new bin the operator already named in the inspector arrives
        // with name_is_auto:false and is stored verbatim — nothing may overwrite
        // a name a human typed.
        nameIsAuto: stored ? stored.nameIsAuto : p.new_bin?.name_is_auto !== false,
        // null for a new bin: the SERVER assigns the number, not the client.
        nameSeq: stored ? stored.nameSeq : null,
        nameArea: stored ? stored.nameArea : null,
        levelIndexes: p.new_bin?.levels?.map((l) => l.level_index)
          ?? p.levels?.map((l) => l.level_index),
      }
    })
    let naming = assignAutoNames(namingUnits, areaIndex, { minSeq: areaHighWater })
    // Renames apply IN ORDER, each over the result of the last. The client has
    // already coalesced A→B→C into A→C, so by the time this runs there is no
    // intermediate name left on the floor for a stale entry to match.
    for (const rename of input.area_renames ?? []) {
      const previous = new Map(naming.units.map((u) => [u.ref, u]))
      namingUnits = namingUnits.map((u) => {
        const n = previous.get(u.ref)
        return n ? { ...u, name: n.name, nameSeq: n.seq, nameArea: n.areaName, nameIsAuto: n.isAuto } : u
      })
      naming = assignAutoNames(namingUnits, areaIndex, { rename, minSeq: areaHighWater })
    }
    const namedByRef = new Map(naming.units.map((u) => [u.ref, u]))

    /** A level's stored name. Falls back to the pre-00094 `Level N` when the rack
     *  is hand-named or unnumbered — a composed level name would then be lying
     *  about which rack it belongs to. */
    const levelNameFor = (ref: string, levelIndex: number): string => {
      const named = namedByRef.get(ref)
      // `named.noun`, so a level is called what its rack is called — recomposing
      // with the default would name L1 of a floor pallet after a rack.
      return named && named.isAuto && named.seq != null
        ? composeName(named.areaName, named.seq, levelIndex, named.noun)
        : `Level ${levelIndex}`
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
        const levelIds = await resolveExistingRackLevels(p.location_id, p.levels)
        if (levelIds) refToLevelLocations.set(p.client_ref, levelIds)
        continue
      }
      const nb = p.new_bin!
      // The name the server decided on. `|| nb.name` covers a hand-named bin,
      // whose unit is echoed back verbatim rather than recomposed.
      const named = namedByRef.get(p.client_ref)
      const binName = (named?.name || nb.name).slice(0, 120)
      const binNaming = {
        name_is_auto: named?.isAuto === true,
        name_seq: named?.isAuto ? named.seq : null,
        name_area: named?.isAuto ? (named.areaName || null) : null,
      }

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
      //
      // The AREA the bin was drawn inside wins over the per-bin zone dropdown
      // (mig 00096). The dropdown predates areas and is invisible on the map; an
      // area is the thing the operator drew, named and can see. Applying the rule
      // HERE rather than re-parenting afterwards means a newly drawn bin lands in
      // its zone on the first write — the binding pass below is then only ever
      // about locations that already existed.
      const areaProfileId = resolveNewBinProfile(p)
      let parentId = nb.parent_id
      let parentPath: string
      if (areaProfileId != null) {
        const zone = await resolveZone(areaProfileId)
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
          parent_id: parentId, kind: 'RACK', code: nb.code, name: binName,
          materialized_path: `${parentPath}/${nb.code}`,
          storage_type_id: nb.storage_type_id ?? null,
          ...binNaming,
          is_active: false, created_in_layout_id: layout.id,
        } as any).select('id').single()
        let rackId: number
        if (rackErr || !createdRack) {
          if (rackErr?.code !== '23505') {
            throw new EdgeFunctionError('INTERNAL', rackErr?.message ?? 'Failed to create rack')
          }
          // The adopt path must carry the naming too, or an erase-then-redraw at
          // the same cell revives the old row with its stale name.
          const adopted = await adoptDraftOrphan(nb.code, {
            parent_id: parentId, kind: 'RACK', name: binName,
            materialized_path: `${parentPath}/${nb.code}`,
            storage_type_id: nb.storage_type_id ?? null,
            ...binNaming,
          })
          if (adopted === null) {
            throw new EdgeFunctionError('CONFLICT', `Location code "${nb.code}" already exists`)
          }
          rackId = adopted
        } else {
          rackId = (createdRack as any).id as number
        }
        refToLocation.set(p.client_ref, rackId)

        const levelIds: Record<number, number> = {}
        for (const lvl of nb.levels) {
          const levelCode = `${nb.code}-L${lvl.level_index}`
          // A level's name is composed IN FULL ("Chiller · Rack 7 · L2") because
          // a pick task, a putaway stop and a replen stop all point at the SHELF
          // row directly and would otherwise each need a parent lookup to say
          // where the operator should stand. `name_seq` stays NULL: the number
          // belongs to the RACK, and a level composes from it plus level_index.
          const levelName = levelNameFor(p.client_ref, lvl.level_index)
          const levelNaming = {
            name_is_auto: binNaming.name_is_auto,
            name_seq: null,
            name_area: binNaming.name_area,
          }
          const { data: createdLevel, error: lvlErr } = await admin.from('locations').insert({
            parent_id: rackId, kind: 'SHELF', code: levelCode, name: levelName,
            materialized_path: `${parentPath}/${nb.code}/${levelCode}`,
            ...levelNaming,
            level_role: lvl.role, level_index: lvl.level_index,
            capacity_slots: lvl.capacity_slots ?? capacitySlots,
            slot_kind: lvl.slot_kind ?? slotKind,
            weight_capacity_kg: lvl.weight_capacity_kg ?? weightCapacityKg,
            storage_type_id: nb.storage_type_id ?? null,
            is_active: false, created_in_layout_id: layout.id,
          } as any).select('id').single()
          if (lvlErr || !createdLevel) {
            if (lvlErr?.code !== '23505') {
              throw new EdgeFunctionError('INTERNAL', lvlErr?.message ?? `Failed to create level ${lvl.level_index}`)
            }
            // Re-setting parent_id is deliberate: it re-anchors a surviving level
            // row even if the RACK row's identity changed between attempts.
            const adopted = await adoptDraftOrphan(levelCode, {
              parent_id: rackId, kind: 'SHELF', name: levelName,
              materialized_path: `${parentPath}/${nb.code}/${levelCode}`,
              ...levelNaming,
              level_role: lvl.role, level_index: lvl.level_index,
              capacity_slots: lvl.capacity_slots ?? capacitySlots,
              slot_kind: lvl.slot_kind ?? slotKind,
              weight_capacity_kg: lvl.weight_capacity_kg ?? weightCapacityKg,
              storage_type_id: nb.storage_type_id ?? null,
            })
            if (adopted === null) {
              throw new EdgeFunctionError('CONFLICT', `Level code "${levelCode}" already exists`)
            }
            levelIds[lvl.level_index] = adopted
            continue
          }
          levelIds[lvl.level_index] = (createdLevel as any).id
        }
        refToLevelLocations.set(p.client_ref, levelIds)
        continue
      }

      const { data: created, error: cErr } = await admin.from('locations').insert({
        parent_id: parentId, kind: nb.kind, code: nb.code, name: binName,
        materialized_path: `${parentPath}/${nb.code}`,
        capacity_slots: capacitySlots, slot_kind: slotKind, weight_capacity_kg: weightCapacityKg,
        storage_type_id: nb.storage_type_id ?? null,
        ...binNaming,
        is_active: false, created_in_layout_id: layout.id,
      } as any).select('id').single()
      if (cErr || !created) {
        // A prior draft-created orphan (erase→redraw at the same cell reuses the
        // deterministic code, and a partial earlier save can leave rows behind).
        // Adopt & refresh it instead of dead-ending every retry with a conflict.
        if (cErr?.code !== '23505') {
          throw new EdgeFunctionError('INTERNAL', cErr?.message ?? 'Failed to create bin')
        }
        const adopted = await adoptDraftOrphan(nb.code, {
          parent_id: parentId, kind: nb.kind, name: binName,
          materialized_path: `${parentPath}/${nb.code}`,
          capacity_slots: capacitySlots, slot_kind: slotKind, weight_capacity_kg: weightCapacityKg,
          storage_type_id: nb.storage_type_id ?? null,
          ...binNaming,
        })
        if (adopted === null) {
          throw new EdgeFunctionError('CONFLICT', `Location code "${nb.code}" already exists`)
        }
        refToLocation.set(p.client_ref, adopted)
        continue
      }
      refToLocation.set(p.client_ref, (created as any).id)
    }

    // ── Re-point saved bins at their storage form ─────────────────────────────
    //
    // `storage_type_id` used to travel only inside `new_bin`, i.e. only at
    // creation. Repainting an already-saved cell with a different form showed the
    // new colour in the designer (which reads it straight from editor state) and
    // was dropped on save, so the Warehouse tab kept the old colour forever and
    // the two canvases disagreed about the same cell.
    //
    // Only the form ID moves. capacity_slots / slot_kind / weight_capacity_kg are
    // deliberately NOT re-derived from the new form: they are per-bin facts an
    // operator may have tuned, and silently resizing a bin that holds stock is how
    // you drive `available` negative. mutate-storage-type's explicit retro-apply
    // is the sanctioned path for changing those.
    const repoints = input.placements.filter(
      (p) => p.location_id !== undefined && p.storage_type_id !== undefined,
    )
    if (repoints.length > 0) {
      const repointIds = [...new Set(repoints.map((p) => p.location_id!))]
      const currentById = new Map<number, { path: string; storageTypeId: number | null }>()
      for (const chunk of chunked(repointIds, 200)) {
        const { data, error } = await admin.from('locations')
          .select('id, materialized_path, storage_type_id').in('id', chunk)
        if (error) throw new EdgeFunctionError('INTERNAL', `Could not read bins: ${error.message}`)
        for (const row of (data ?? []) as Array<{ id: number; materialized_path: string; storage_type_id: number | null }>) {
          currentById.set(row.id, { path: row.materialized_path, storageTypeId: row.storage_type_id ?? null })
        }
      }
      for (const p of repoints) {
        const row = currentById.get(p.location_id!)
        if (!row) throw new EdgeFunctionError('INVALID_INPUT', `Placement location ${p.location_id} not found`)
        // Scope the write to this layout's warehouse. An EXISTING placement's
        // location_id is otherwise unvalidated here (only new bins check their
        // parent against whPath), and an UPDATE driven by a client-supplied id
        // must not be the first operation to take that id on trust.
        if (whPath && row.path !== whPath && !row.path.startsWith(`${whPath}/`)) {
          throw new EdgeFunctionError('INVALID_INPUT', 'A placement must sit inside this layout\'s warehouse')
        }
        const next = p.storage_type_id ?? null
        if (row.storageTypeId === next) continue
        // A levelled rack is COLOURED from its parent but its SHELF children carry
        // the form too (see the new_bin branch above) — move both, or the rack and
        // its levels disagree about what they are.
        const levelIds = refToLevelLocations.get(p.client_ref)
        const ids = [p.location_id!, ...(levelIds ? Object.values(levelIds) : [])]
        const { error } = await admin.from('locations')
          .update({ storage_type_id: next } as any).in('id', ids)
        if (error) throw new EdgeFunctionError('INTERNAL', `Could not update storage form: ${error.message}`)
      }
    }

    // ── Restamp names on rows that already existed (mig 00094) ───────────────
    //
    // New rows were inserted with their names above; this is the other half —
    // an area rename reaching bins that are already in the database, which is the
    // whole point of `area_renames`.
    //
    // A levelled rack's SHELF children are restamped too. They carry their OWN
    // `name_is_auto`, so a level someone hand-named survives even when its rack
    // is renamed around it.
    {
      const existingPlacements = input.placements.filter((p) => p.location_id !== undefined)
      const levelIdsToCheck: number[] = []
      for (const p of existingPlacements) {
        const levels = refToLevelLocations.get(p.client_ref)
        if (levels) levelIdsToCheck.push(...Object.values(levels))
      }
      const storedLevelNames = await loadNameState(admin, levelIdsToCheck)

      const nameWrites: NameWrite[] = []
      for (const p of existingPlacements) {
        const named = namedByRef.get(p.client_ref)
        // isAuto false = hand-named, and assignAutoNames echoed it back untouched.
        // Nothing to write, and nothing that MAY be written.
        if (!named || !named.isAuto || named.seq == null) continue

        const rackWrite: NameWrite = {
          id: p.location_id!,
          name: named.name,
          name_seq: named.seq,
          name_area: named.areaName || null,
          name_is_auto: true,
        }
        if (nameWriteNeeded(storedNames.get(p.location_id!), rackWrite)) nameWrites.push(rackWrite)

        const levels = refToLevelLocations.get(p.client_ref)
        if (!levels) continue
        for (const [levelIndex, levelId] of Object.entries(levels)) {
          const stored = storedLevelNames.get(levelId)
          if (stored && !stored.nameIsAuto) continue
          const levelWrite: NameWrite = {
            id: levelId,
            name: composeName(named.areaName, named.seq, Number(levelIndex), named.noun),
            name_seq: null,
            name_area: named.areaName || null,
            name_is_auto: true,
          }
          if (nameWriteNeeded(stored, levelWrite)) nameWrites.push(levelWrite)
        }
      }

      // whPath is this layout's warehouse path; the RPC re-checks every row
      // against it, because these ids came from client-supplied geometry.
      if (nameWrites.length > 0 && whPath) {
        await applyNameWrites(admin, whPath, nameWrites)
      }
    }

    // ── Bind existing bins to their area's ZONE (mig 00096) ──────────────────
    //
    // New bins were already inserted under the right parent above, so this is the
    // other half: locations that already existed and whose area — or whose area's
    // profile — has changed since they were drawn. Painting "Chiller" over racks
    // that are already in the database is the whole point.
    //
    // Runs BEFORE the destructive geometry replace for the same reason the
    // duplicate checks below do: a failure here must leave the draft intact.
    // Re-parenting touches no placement row, so the two are independent.
    if (whPath) {
      const existing = input.placements.filter((p) => p.location_id !== undefined)
      const levelIdsByRef = new Map<string, number[]>()
      for (const p of existing) {
        const levels = refToLevelLocations.get(p.client_ref)
        if (levels) levelIdsByRef.set(p.client_ref, Object.values(levels))
      }
      const wanted = [
        ...existing.map((p) => p.location_id!),
        ...[...levelIdsByRef.values()].flat(),
      ]
      const locById = await loadLocationsForNaming(admin, wanted)

      const bindingUnits: BindingUnit[] = []
      for (const p of existing) {
        const loc = locById.get(p.location_id!)
        // A placement whose location vanished under us. The naming pass above
        // skips it the same way; the geometry replace will fail loudly if it
        // matters.
        if (!loc) continue
        bindingUnits.push({
          ref: p.client_ref,
          id: loc.id,
          code: loc.code,
          parentId: loc.parentId,
          path: loc.path,
          floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h,
          // The stored bin carries no zone_profile_id of its own (nothing writes
          // it on a bin), so the per-placement dropdown is the only fallback and
          // it only ever arrives on a NEW bin. An existing bin therefore follows
          // its area, or returns to the root.
          ownZoneProfileId: null,
          levels: (levelIdsByRef.get(p.client_ref) ?? [])
            .map((id) => locById.get(id))
            .filter((l): l is NonNullable<typeof l> => !!l)
            .map((l) => ({ id: l.id, code: l.code, path: l.path })),
        })
      }

      if (bindingUnits.length > 0) {
        const targets = zoneTargets(bindingUnits, areaIndex, profileByArea)
        const zones = await resolveZones(resolveZone, requiredProfileIds(bindingUnits, targets))
        const plan = planZoneBinding(bindingUnits, targets, zones, {
          id: layout.warehouse_id, path: whPath,
        })
        await applyReparents(admin, whPath, plan.moves)
      }
    }

    // Reject duplicate bins BEFORE the destructive replace — a UNIQUE(layout_id,
    // location_id) violation mid-insert would otherwise leave the draft empty.
    const resolvedIds = input.placements.map((p) => refToLocation.get(p.client_ref)!)
    if (new Set(resolvedIds).size !== resolvedIds.length) {
      throw new EdgeFunctionError('INVALID_INPUT', 'A bin appears twice in the layout')
    }
    // Same check for the ids that actually become placement rows: a levelled rack
    // contributes its LEVELS, not itself, so a level shared between two racks (or
    // a rack drawn twice) is invisible to the check above and would only surface
    // as that same post-delete unique violation.
    const placedLevelIds = [...refToLevelLocations.values()].flatMap((m) => Object.values(m))
    if (new Set(placedLevelIds).size !== placedLevelIds.length) {
      throw new EdgeFunctionError('INVALID_INPUT', 'A rack level appears twice in the layout')
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
      // Hand back the name the server actually decided on (mig 00094), so
      // `mark_saved` can correct a stale tab's guess in place instead of leaving
      // the two disagreeing until the next reload. Omitted for a hand-named bin,
      // which the server never recomposes.
      const named = namedByRef.get(client_ref)
      const naming = named && named.isAuto && named.seq != null
        ? { name: named.name, name_seq: named.seq, name_area: named.areaName || null }
        : {}
      return levelIds
        ? { client_ref, location_id, level_location_ids: levelIds, ...naming }
        : { client_ref, location_id, ...naming }
    })
    return new Response(JSON.stringify({ ok: true, layout_id: layout.id, ref_map: refMap }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
