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
// Friendly names (mig 00094). The rules are pure and shared with the browser, so
// the rename dialog's preview IS this function's decision evaluated early.
import {
  MAX_AREA_NAME,
  NAME_SEP,
  areaForRect,
  areaNameIssue,
  assignAutoNames,
  buildAreaIndex,
  composeName,
  sanitizeAreaName,
} from '../_shared/wie/locationNaming.ts'
// Live area painting (mig 00095). Pure, and shared with the browser for two
// reasons that both bite: the CONFLICT fingerprint must agree byte-for-byte, and
// the summary panel's counts must BE this function's decision evaluated early.
import {
  areaCellsFingerprint,
  areaObjectsFromSpecs,
  diffAreas,
  expandAreaRuns,
  planAreaCascade,
  type AreaPaintSpec,
} from '../_shared/wie/areaPaint.ts'
// Floor signs (mig 00097). Same fold, same packing, same fingerprint as areas —
// deliberately delegated rather than reimplemented — but NO cascade and NO
// binding, which is the whole distinction between a sign and an area.
import {
  MAX_SIGN_NAME,
  diffSigns,
  expandSignRuns,
  sanitizeSignName,
  signCellsFingerprint,
  signNameIssue,
  signObjectsFromSpecs,
  type SignSpec,
} from '../_shared/wie/signPaint.ts'
import {
  applyNameWrites,
  loadAreaSeqClaims,
  loadLayoutNamingUnits,
  nameWriteNeeded,
  type NameWrite,
} from '../_shared/locationNamingWrite.ts'
// Operator-controlled codes (mig 00107). Pure planner + I/O beside it, the same
// split as naming — the marquee's preview IS this function's dry_run.
import {
  BUILTIN_PATTERN,
  DEFAULT_ORIGIN,
  MAX_BLOCK_LENGTH,
  planRecode,
  sanitizeBlock,
  solveBlockFraming,
  templateIssue,
  type CodeOrder,
  type CodeOrigin,
  type RecodeUnit,
} from '../_shared/wie/codePattern.ts'
import {
  applyRecodeWrites,
  buildRevertRows,
  loadLatestSweep,
  markSweepReverted,
  recordSweep,
  sweptRowsFrom,
  buildRecodeRows,
  loadCodeHighWater,
  loadCodePattern,
  loadParentPaths,
  loadStockedLocations,
  loadTakenCodes,
} from '../_shared/locationCodeWrite.ts'
// Zone binding (mig 00096) — what finally reads an area's meta.zoneProfileId.
// Pure rule + I/O beside it, the same split as naming. resolveZone is shared with
// mutate-layout: two find-or-create implementations racing on one
// (warehouse, profile) pair would leave two ZONE rows and a LATERAL that picks
// whichever happens to have the longer path.
import {
  categoryConflicts,
  planZoneBinding,
  requiredProfileIds,
  zoneTargets,
  type BindingUnit,
  type ZoneBindingPlan,
} from '../_shared/wie/zoneBinding.ts'
import {
  applyReparents,
  loadAllowedCategories,
  loadStockedCategories,
  makeZoneResolver,
  resolveZones,
} from '../_shared/zoneResolve.ts'
import { requireModule } from '../_shared/modules.ts'

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

// ── Friendly names (mig 00094) ───────────────────────────────────────────────
//
// WHY THESE LIVE HERE AND NOT ON mutate-layout. An area is a `layout_objects`
// row, which the lockdown table assigns to mutate-layout — but that function is
// Admin-only and gates BEFORE parsing the body, so widening one action would
// mean reordering auth across every action in it. Meanwhile the surface an
// operator renames from is the Warehouse MAP, which Managers use, and this
// function is already Admin+Manager, already owns `locations.name`, and already
// writes `layout_placements` (see set_levels). The precedent is established
// rather than invented. CLAUDE.md's lockdown table records the exception.
//
// The rename changes DISPLAY TEXT only. No geometry moves, no stock moves, no
// routing changes, and — critically — no code changes.
const renameAreaSchema = z.object({
  action: z.literal('rename_area'),
  warehouse_id: z.number().int().positive(),
  from: z.string().min(1).max(60),
  to: z.string().min(1).max(60),
  zone_profile_id: z.number().int().positive().nullish(),
  /** Restamp hand-named bins too — the operator ticking "also rename these" in
   *  a dialog that has already shown them exactly what will change. */
  include_custom: z.boolean().optional(),
  /** Compute and report, write nothing. One action with a flag rather than a
   *  separate preview action, which is what guarantees the preview and the
   *  write run identical code. */
  dry_run: z.boolean().optional(),
})

// Rename a levelled rack and, optionally, its levels in one round trip. A
// client-side loop of N `update` calls would burn N of the 30/min budget and
// produce N audit rows for what the operator did once.
const renameRackSchema = z.object({
  action: z.literal('rename_rack'),
  id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  include_levels: z.boolean().optional(),
})

// ── paint_areas (mig 00095) ──────────────────────────────────────────────────
//
// Paint, reshape, re-tint and erase named areas ON A LIVE WAREHOUSE. Same
// reasoning as rename_area for why it lives on this function rather than
// mutate-layout, plus one more: an `area` row is INERT in routing
// (buildWalkableCells adds only walkway/dock/lift/staging and subtracts only
// wall/conveyor), so unlike every other kind of geometry it cannot invalidate
// anything publishing froze. That is what makes editing one on a published layout
// safe at all, and why this must not bump warehouse_layouts.updated_at.
//
// FULL REPLACE, NOT A DIFF, and this is the load-bearing design choice. The
// server reads the before-picture from the database, so "renamed Chiller to Cold
// Room" and "erased Chiller, painted Cold Room over the same cells" are DERIVED
// as the same plan rather than needing to be told apart — which is correct,
// because both mean "these racks are now in Cold Room". This is exactly the
// ambiguity `save_geometry` needs `area_renames` to resolve; do not port that
// field here.
const areaRunSchema = z.object({
  floor: z.number().int().min(0).max(15),
  y: z.number().int().min(0).max(4095),
  x: z.number().int().min(0).max(4095),
  len: z.number().int().min(1).max(4096),
})

const paintAreaSchema = z.object({
  name: z.string().min(1).max(MAX_AREA_NAME),
  // .nullish(), never .optional(): meta.zoneProfileId is genuinely nullable and
  // `null` is the honest wire value for "cleared". With `strict` off, `.optional()`
  // would accept the type and reject the value at runtime — the trap that made
  // every Shelving/Cold Room rack save fail with a bare "Invalid request body".
  zone_profile_id: z.number().int().positive().nullish(),
  /** Horizontal runs. A wire format only — storage is 1x1, enforced by the RPC. */
  runs: z.array(areaRunSchema).min(1).max(4000),
})

const paintAreasSchema = z.object({
  action: z.literal('paint_areas'),
  warehouse_id: z.number().int().positive(),
  /** The layout the client was looking at. Refused when it is no longer the
   *  warehouse's active_layout_id — a publish landed under the operator's tab. */
  layout_id: z.number().int().positive(),
  /** areaCellsFingerprint over the rows the client rendered from. Refused on
   *  mismatch, which is the whole concurrency story: two operators painting at
   *  once, or a preview confirmed after someone else saved. */
  base_fingerprint: z.string().min(1).max(64),
  /** The COMPLETE replacement set, ALL FLOORS. An area omitted here is erased;
   *  `[]` erases every area on the site. */
  areas: z.array(paintAreaSchema).max(64),
  /** Opt-in. Absent = geometry only, and not one locations.name is touched. */
  cascade_names: z.boolean().optional(),
  include_custom: z.boolean().optional(),
  dry_run: z.boolean().optional(),
})

// ── paint_labels (mig 00097) ─────────────────────────────────────────────────
//
// Place, reshape and erase FLOOR SIGNS on a live warehouse — the plain text an
// operator reads on the map ("Inbound Staging"). Backed by `object_type =
// 'label'`, legal since 00045 but until now authorable only on a draft, because
// save_geometry was its only writer and it calls requireDraft.
//
// A SIGN IS NOT AN AREA, and every difference below follows from that. An area
// renames the bins standing on it (00094) and re-parents them under a ZONE
// (00096); a sign touches no `locations` row at all. So this action has NO
// cascade_names, NO include_custom, and runs NO binding pass. Do not add them
// later "for symmetry" with paint_areas — the asymmetry is the feature, and it
// is what makes a sign safe to hand to anyone who can read the map.
//
// It shares everything else with paint_areas because those parts are genuinely
// the same problem: a FULL REPLACE (the server reads the before-picture, so a
// rename and an erase-then-repaint derive to the same plan), a fingerprint for
// concurrency, run-length packing on the wire only, and dry_run on the real
// action rather than a separate preview endpoint.
const paintSignSchema = z.object({
  name: z.string().min(1).max(MAX_SIGN_NAME),
  /** Horizontal runs. A wire format only — storage is 1x1, enforced by the RPC. */
  runs: z.array(areaRunSchema).min(1).max(4000),
})

const paintLabelsSchema = z.object({
  action: z.literal('paint_labels'),
  warehouse_id: z.number().int().positive(),
  /** The layout the client was looking at. Refused when it is no longer the
   *  warehouse's active_layout_id — a publish landed under the operator's tab. */
  layout_id: z.number().int().positive(),
  /** signCellsFingerprint over the rows the client rendered from. Its own stamp,
   *  never the area one: the two pictures move independently and sharing a
   *  fingerprint would make an area paint 409 a sign save. */
  base_fingerprint: z.string().min(1).max(64),
  /** The COMPLETE replacement set, ALL FLOORS. A sign omitted here is erased;
   *  `[]` erases every sign on the site. */
  signs: z.array(paintSignSchema).max(64),
  dry_run: z.boolean().optional(),
})

// ── bind_zones (mig 00096) ───────────────────────────────────────────────────
//
// Re-parent every drawn bin under the ZONE its area names, and every bin whose
// area no longer names one back to the warehouse root.
//
// paint_areas and save_geometry already bind as a side effect, so this action is
// not how binding normally happens. It exists for the site that was painted
// BEFORE 00096 shipped: MAIN carries 189 racks and 945 shelves under areas that
// have never been bound to anything, and the alternative to this button is
// telling an operator to re-paint an area they already painted correctly.
//
// It is also the only surface that previews a re-parent before it happens, which
// is why it is the documented way to bind a large site: `dry_run` reports the
// exact count, which areas contribute it, and — the part worth reading — which
// areas carry a zone profile whose allowed_categories would refuse stock those
// bins already hold.
const bindZonesSchema = z.object({
  action: z.literal('bind_zones'),
  warehouse_id: z.number().int().positive(),
  dry_run: z.boolean().optional(),
})

// ── recode_locations (mig 00107) ─────────────────────────────────────────────
//
// Rewrite the CODE of a marquee-selected block of bins, from a pattern and a block
// the operator typed. The one action in this function that touches
// `locations.code`, which until 00107 nothing could touch at all.
//
// STALENESS IS A PER-ROW COMPARE-AND-SWAP, NOT A FINGERPRINT. paint_areas needs
// `base_fingerprint` because areas live in layout_objects and NOTHING moves a
// timestamp when they change — there is no other signal. Here the code IS the thing
// being rewritten and the client already knows every code it is about to overwrite,
// so `expected_code` per row is strictly better: it invalidates one rack rather than
// the whole sweep, there is no shared hash that has to agree byte-for-byte across
// two runtimes, and it composes with idempotence — a re-run whose expectations match
// the NEW codes is a no-op rather than a conflict.
const recodeSchema = z.object({
  action: z.literal('recode_locations'),
  warehouse_id: z.number().int().positive(),
  units: z.array(z.object({
    location_id: z.number().int().positive(),
    expected_code: z.string().min(1).max(48),
  })).min(1).max(500),
  block: z.string().min(1).max(MAX_BLOCK_LENGTH),
  start_at: z.number().int().min(1).max(9999).nullish(),
  // This sweep only. Deliberately separate from the stored pattern, exactly as
  // `presetOverride` is separate from `preset` in layoutLabelPlan: a field carrying
  // a default cannot say whether the caller meant it.
  template_override: z.string().min(1).max(64).nullish(),
  order: z.enum(['row', 'column', 'serpentine-row', 'serpentine-column']).nullish(),
  // Which corner of the painted block is 1-1. Only meaningful to a template that
  // carries {row}/{col} or a counter, which is exactly what `usedTokens` decides on
  // the client before the control is even rendered.
  origin: z.enum(['nw', 'ne', 'sw', 'se']).nullish(),
  // Opt in to relaying the WHOLE block rather than appending to it. Off by default:
  // growing a block must never renumber bins whose stickers are already on the
  // racking, so the default answer to drift is a refusal, not a silent rewrite.
  renumber_block: z.boolean().optional(),
  dry_run: z.boolean().optional(),
})

// ── revert_code_sweep (mig 00108) ────────────────────────────────────────────
//
// Put the most recent sweep back. Only the newest un-reverted one is reachable:
// reverting an older sweep would collide with every newer one, and resolving that
// is a worse tool than saying "sweep it again". No `sweep_id` for the same reason —
// there is exactly one answer, and letting the client name it would only create a
// way to ask for the wrong one.
const revertSweepSchema = z.object({
  action: z.literal('revert_code_sweep'),
  warehouse_id: z.number().int().positive(),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema }),
  paintAreasSchema,
  paintLabelsSchema,
  bindZonesSchema,
  recodeSchema,
  revertSweepSchema,
  z.object({ action: z.literal('update'), id: z.number().int().positive(), data: updateSchema }),
  renameAreaSchema,
  renameRackSchema,
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

// NamingLocation / loadLocationsForNaming / the whole placements → locations →
// rack-parent rollup now live in _shared/locationNamingWrite.ts as
// loadLayoutNamingUnits: rename_area and paint_areas must resolve the SAME units
// or a preview and a paint would disagree about what is even in the area.

/** zod's flatten() collapses a nested path to its top-level key, so a bad
 *  `areas.2.runs.412.x` would reach the operator as a bare "Invalid request
 *  body". Attach the issue paths instead; the client renders them via
 *  describeValidationIssues. Same helper as count-bin and mutate-product-home-bin. */
function validationIssues(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}

async function nodeHasStock(admin: any, locationId: number): Promise<boolean> {
  const { data } = await admin.from('inventory_balances').select('id').gt('on_hand', 0).eq('location_id', locationId).limit(1)
  return !!(data && data.length > 0)
}

/** An area's grid cells as this function holds them, from either `layout_objects`
 *  or a paint payload. Structurally what buildAreaIndex and zoneBinding want. */
interface AreaObject {
  objectType: string
  floor: number
  x: number
  y: number
  w: number
  h: number
  meta: Record<string, unknown> | null
}

/** Area NAME → its zone profile. Areas are keyed by name across the whole site
 *  (00094's pools work the same way), so one painted on two floors is one entry. */
function profilesByArea(objects: readonly AreaObject[]): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const o of objects) {
    if (o.objectType !== 'area') continue
    const name = typeof o.meta?.name === 'string' ? o.meta.name.trim() : ''
    if (!name) continue
    const raw = (o.meta as any)?.zoneProfileId
    out.set(name, typeof raw === 'number' ? raw : null)
  }
  return out
}

interface ZoneBindingContext {
  plan: ZoneBindingPlan
  /** rack/bin id → the location ids that can actually hold stock for it. A
   *  levelled rack holds none itself; its SHELF rows do. */
  stockIdsByUnit: Map<number, number[]>
}

/**
 * The zone-binding plan for a whole site, given the areas it will have.
 *
 * Shared by paint_areas, rename_area and bind_zones — all three ask the same
 * question ("given these areas, where should every bin be parented") and must
 * answer it identically, or a preview and the write that follows it would
 * disagree. Exactly the reason loadLayoutNamingUnits is shared.
 *
 * `areaObjects` is the AFTER picture: the caller passes what the areas will be
 * once its own change lands, never what they are now.
 */
async function buildZoneBindingPlan(
  admin: any,
  warehouse: { id: number; path: string; code: string },
  layoutId: number,
  areaObjects: readonly AreaObject[],
): Promise<ZoneBindingContext> {
  const { units, locById, levelsByParent } = await loadLayoutNamingUnits(admin, layoutId, warehouse.path)

  const stockIdsByUnit = new Map<number, number[]>()
  const bindingUnits: BindingUnit[] = []
  for (const u of units) {
    const id = Number(u.ref.slice(4))
    const loc = locById.get(id)
    if (!loc) continue
    const levels = (levelsByParent.get(id) ?? [])
      .map((l) => locById.get(l.id))
      .filter((l): l is NonNullable<typeof l> => !!l)
    bindingUnits.push({
      ref: u.ref,
      id,
      code: loc.code,
      parentId: loc.parentId,
      path: loc.path,
      floor: u.floor, x: u.x, y: u.y, w: u.w, h: u.h,
      // A stored bin carries no zone_profile_id of its own — nothing writes that
      // column on a bin — so an existing bin follows its area or returns to the
      // root. The per-placement dropdown only ever reaches a NEW bin, in
      // mutate-layout.
      ownZoneProfileId: null,
      levels: levels.map((l) => ({ id: l.id, code: l.code, path: l.path })),
    })
    stockIdsByUnit.set(id, levels.length > 0 ? levels.map((l) => l.id) : [id])
  }

  const targets = zoneTargets(bindingUnits, buildAreaIndex(areaObjects), profilesByArea(areaObjects))
  const resolveZone = makeZoneResolver(admin, warehouse)
  const zones = await resolveZones(resolveZone, requiredProfileIds(bindingUnits, targets))
  const plan = planZoneBinding(bindingUnits, targets, zones, { id: warehouse.id, path: warehouse.path })

  return { plan, stockIdsByUnit }
}

/**
 * Areas whose profile would refuse stock their bins already hold.
 *
 * WARNS, never blocks — refusing would not move the pallets off the rack, it
 * would only stop the operator recording where they are. Same temperament as the
 * warehouse setup checklist's three guardrails.
 */
async function zoneCategoryWarnings(
  admin: any,
  ctx: ZoneBindingContext,
): Promise<Array<{ areaName: string; profileId: number; bins: number; categories: string[] }>> {
  const profileIds = ctx.plan.byArea
    .map((a) => a.profileId)
    .filter((id): id is number => id != null)
  if (profileIds.length === 0) return []

  const allowed = await loadAllowedCategories(admin, profileIds)
  // Nothing to warn about if every profile in play allows everything — skip the
  // stock read entirely, which is the common case.
  const constrained = [...allowed.values()].some((list) => list && list.length > 0)
  if (!constrained) return []

  const stockIds = [...ctx.stockIdsByUnit.values()].flat()
  const byLocation = await loadStockedCategories(admin, stockIds)
  // Roll a levelled rack's SHELF categories up onto the rack, which is the unit
  // the plan and the areas both speak in.
  const byUnit = new Map<number, string[]>()
  for (const [unitId, ids] of ctx.stockIdsByUnit) {
    const merged = new Set<string>()
    for (const id of ids) for (const c of byLocation.get(id) ?? []) merged.add(c)
    if (merged.size > 0) byUnit.set(unitId, [...merged])
  }
  return categoryConflicts(ctx.plan, allowed, byUnit)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
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
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', validationIssues(parsed.error))
    }
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

    // ── paint_areas (mig 00095) ──────────────────────────────────────────────
    if (input.action === 'paint_areas') {
      // Its own bucket, deliberately NOT shared with :area:. One call replaces
      // every area on the site and can rename 1100+ rows, but more importantly a
      // burst of paint saves must not lock the operator out of rename_area —
      // fixing a spelling is the cheap remedy when a paint went wrong.
      const paintRl = await checkRateLimit(`mutate-warehouse-location:paint:${auth.userId}`, {
        windowMs: 60_000,
        max: 10,
      })
      if (!paintRl.ok) {
        throw new EdgeFunctionError(
          'TOO_MANY_REQUESTS',
          `Rate limit exceeded; try again in ${Math.ceil(paintRl.resetMs / 1000)}s`,
        )
      }

      // 1. The warehouse, its path, and its published layout.
      const { data: whRow } = await admin.from('locations')
        .select('id, kind, code, materialized_path, location_type, active_layout_id')
        .eq('id', input.warehouse_id).maybeSingle()
      if (!whRow || (whRow as any).kind !== 'WAREHOUSE') {
        throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
      }
      const whPath = (whRow as any).materialized_path as string
      // Needed to derive a ZONE's code when binding find-or-creates one (00096).
      const whCode = (whRow as any).code as string
      const layoutId = (whRow as any).active_layout_id as number | null
      if ((whRow as any).location_type !== 'racked' || !layoutId) {
        throw new EdgeFunctionError('CONFLICT', 'This site has no published layout, so it has no areas to paint')
      }
      // A publish landed while the operator was painting. Their working set
      // describes a layout that is no longer live; applying it would move areas
      // onto a floor plan they never saw.
      if (layoutId !== input.layout_id) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'This site’s published layout changed while you were painting. Reload the map and repaint.',
        )
      }

      const { data: layoutRow } = await admin.from('warehouse_layouts')
        .select('id, grid_width, grid_height, floor_count').eq('id', layoutId).maybeSingle()
      if (!layoutRow) throw new EdgeFunctionError('NOT_FOUND', 'Published layout not found')
      const gridW = Number((layoutRow as any).grid_width)
      const gridH = Number((layoutRow as any).grid_height)
      const floors = Number((layoutRow as any).floor_count)

      // 2. Validate the payload into canonical specs.
      const specs: AreaPaintSpec[] = []
      const seenNames = new Set<string>()
      for (const area of input.areas) {
        const issue = areaNameIssue(area.name)
        if (issue) throw new EdgeFunctionError('INVALID_INPUT', issue)
        const name = sanitizeAreaName(area.name)
        // Two entries sanitizing to one name would give the cascade no defined
        // target — "which of these is Chiller" has no answer.
        if (seenNames.has(name)) {
          throw new EdgeFunctionError('INVALID_INPUT', `“${name}” is listed twice`)
        }
        seenNames.add(name)
        specs.push({ name, zoneProfileId: area.zone_profile_id ?? null, cells: expandAreaRuns(area.runs) })
      }

      // Bounds, and a cell may belong to one area only. buildAreaIndex resolves an
      // overlap by taking the smaller name, but that is a RECOVERY rule for
      // imported geometry — silently applying it to an explicit paint would put
      // an operator's label somewhere they did not put it. Name the offender.
      const claimedBy = new Map<string, string>()
      for (const spec of specs) {
        for (const cell of spec.cells) {
          if (cell.floor < 0 || cell.floor >= floors || cell.x < 0 || cell.x >= gridW || cell.y < 0 || cell.y >= gridH) {
            throw new EdgeFunctionError(
              'INVALID_INPUT',
              `“${spec.name}” covers a cell (floor ${cell.floor}, ${cell.x}, ${cell.y}) outside this layout’s ${gridW} × ${gridH} grid`,
            )
          }
          const key = `${cell.floor}:${cell.x}:${cell.y}`
          const owner = claimedBy.get(key)
          if (owner !== undefined && owner !== spec.name) {
            throw new EdgeFunctionError(
              'INVALID_INPUT',
              `Cell (floor ${cell.floor}, ${cell.x}, ${cell.y}) is painted as both “${owner}” and “${spec.name}”`,
            )
          }
          claimedBy.set(key, spec.name)
        }
      }

      // meta is JSONB with no FK, so nothing else would ever catch a bogus
      // profile id — the map would just draw the fallback tint forever.
      const profileIds = [...new Set(specs.map((s) => s.zoneProfileId).filter((id): id is number => id != null))]
      if (profileIds.length > 0) {
        const { data: profileRows, error: profErr } = await admin.from('zone_profiles')
          .select('id').in('id', profileIds)
        if (profErr) throw new EdgeFunctionError('INTERNAL', `Could not read zone profiles: ${profErr.message}`)
        const known = new Set((profileRows ?? []).map((r: any) => Number(r.id)))
        const missing = profileIds.filter((id) => !known.has(id))
        if (missing.length > 0) {
          throw new EdgeFunctionError('INVALID_INPUT', `Unknown zone profile ${missing.join(', ')}`)
        }
      }

      // 3. The before-picture — needed for the diff and the cascade anyway, so
      //    the conflict check is free.
      const { data: objectRows, error: objErr } = await admin.from('layout_objects')
        .select('id, object_type, floor, x, y, w, h, meta')
        .eq('layout_id', layoutId).eq('object_type', 'area')
      if (objErr) throw new EdgeFunctionError('INTERNAL', `Could not read areas: ${objErr.message}`)
      const beforeObjects = ((objectRows ?? []) as any[]).map((o) => ({
        objectType: String(o.object_type), floor: Number(o.floor), x: Number(o.x), y: Number(o.y),
        w: Number(o.w), h: Number(o.h), meta: o.meta ?? null,
      }))

      const serverFingerprint = areaCellsFingerprint(beforeObjects)
      if (serverFingerprint !== input.base_fingerprint) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Someone else changed this site’s areas while you were painting. Reload the map and repaint.',
        )
      }

      const afterObjects = areaObjectsFromSpecs(specs)
      const delta = diffAreas(beforeObjects, afterObjects)

      // No publish-readiness re-check, deliberately. An `area` row is inert in
      // buildWalkableCells, so running the gates here could only ever fail for
      // something the operator did not do.

      // 4. The cascade, only when asked for.
      const includeCustom = input.include_custom === true
      const writes: NameWrite[] = []
      const examples: Array<{ code: string; from: string; to: string }> = []
      let skippedCustom = 0
      let skippedForeign = 0

      if (input.cascade_names) {
        const beforeIndex = buildAreaIndex(beforeObjects)
        const afterIndex = buildAreaIndex(afterObjects)
        const { units, locById, levelsByParent } = await loadLayoutNamingUnits(admin, layoutId, whPath)
        const { high, claims } = await loadAreaSeqClaims(admin, whPath)
        const plan = planAreaCascade(units, beforeIndex, afterIndex, { includeCustom, minSeq: high, claims })
        skippedCustom = plan.skippedCustom
        skippedForeign = plan.skippedForeign

        for (const named of plan.decided.values()) {
          const id = Number(named.ref.slice(4))
          const loc = locById.get(id)
          if (!loc) continue
          // A hand-named rack is echoed back untouched; the plan has already
          // counted it as skippedCustom.
          if (!named.isAuto || named.seq == null) continue

          const rackWrite: NameWrite = {
            id, name: named.name, name_seq: named.seq,
            name_area: named.areaName || null, name_is_auto: true,
          }
          // nameWriteNeeded rather than a bare name comparison: a row whose name
          // is already right but whose name_area/name_seq drifted must still be
          // repaired, or its pool claim stays wrong forever.
          if (nameWriteNeeded(loc, rackWrite)) {
            writes.push(rackWrite)
            if (examples.length < 5) examples.push({ code: loc.code, from: loc.name, to: named.name })
          }

          for (const lvl of levelsByParent.get(id) ?? []) {
            const levelLoc = locById.get(lvl.id)
            // A level carries its OWN provenance, so one an operator hand-named
            // survives its rack being renamed around it.
            if (!levelLoc || (!levelLoc.nameIsAuto && !includeCustom)) continue
            const levelWrite: NameWrite = {
              // `named.noun` so a level is called what its rack is called
              // (mig 00100) — the default would rename it back to "Rack".
              id: lvl.id, name: composeName(named.areaName, named.seq, lvl.levelIndex, named.noun),
              name_seq: null, name_area: named.areaName || null, name_is_auto: true,
            }
            if (nameWriteNeeded(levelLoc, levelWrite)) writes.push(levelWrite)
          }
        }
      }

      const rackCount = writes.filter((w) => w.name_seq != null).length
      const levelCount = writes.length - rackCount

      // 4b. Zone binding (mig 00096). Computed from the AFTER picture, always —
      //     this is not opt-in the way the name cascade is. A name is the
      //     operator's vocabulary and rewriting it is a judgement call; parentage
      //     is the mechanical consequence of where they just said the area is,
      //     and leaving it stale would mean the map draws a cold zone that
      //     putaway does not believe in.
      const binding = await buildZoneBindingPlan(
        admin,
        { id: input.warehouse_id, path: whPath, code: whCode },
        layoutId,
        afterObjects.map((o) => ({
          objectType: o.objectType, floor: o.floor, x: o.x, y: o.y,
          w: o.w ?? 1, h: o.h ?? 1, meta: o.meta ?? null,
        })),
      )
      const categoryWarnings = await zoneCategoryWarnings(admin, binding)

      // 5. dry_run returns HERE — before any write and before the audit — which
      //    is what guarantees the previewed count is the count that moves.
      if (input.dry_run) {
        return new Response(JSON.stringify({
          ok: true,
          fingerprint: serverFingerprint,
          preview: {
            created: delta.created,
            erased: delta.erased,
            resized: delta.resized,
            reprofiled: delta.reprofiled,
            cellsAfter: delta.cellsAfter,
            unchanged: delta.unchanged,
            willRename: writes.length,
            racks: rackCount,
            levels: levelCount,
            skippedCustom,
            skippedForeign,
            examples,
            willBind: binding.plan.units,
            bindLevels: binding.plan.levels,
            unbind: binding.plan.toRoot,
            categoryWarnings,
          },
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // 6. Geometry first, then names. One transaction for the replace — two
      //    supabase-js statements are not a transaction, and delete-first would
      //    leave a live warehouse with every area gone if the insert failed.
      const rows = afterObjects.map((o) => ({ floor: o.floor, x: o.x, y: o.y, meta: o.meta }))
      const { data: insertedRaw, error: replaceErr } = await admin.rpc('wie_replace_layout_areas_tx', {
        p_layout_id: layoutId,
        p_rows: rows,
      })
      if (replaceErr) {
        throw new EdgeFunctionError('INTERNAL', `Could not save the areas: ${replaceErr.message}`)
      }
      const inserted = Number(insertedRaw ?? 0)
      if (inserted !== rows.length) {
        throw new EdgeFunctionError('INTERNAL', `Saved ${inserted} of ${rows.length} area cells`)
      }

      // Names second and separately: a geometry failure must leave names alone,
      // and a name failure after the geometry landed is recoverable by pressing
      // Save again — planAreaCascade is idempotent and nameWriteNeeded skips
      // no-ops, so the retry writes exactly what the first attempt missed.
      const renamed = await applyNameWrites(admin, whPath, writes)

      // Parentage third, on the same terms and for the same reason (mig 00096).
      // planZoneBinding is idempotent too, so a failure here is recoverable by
      // pressing Save again — and unlike the names, leaving it unapplied is
      // visible: the area draws its tint while putaway still ignores the zone.
      const bound = await applyReparents(admin, whPath, binding.plan.moves)

      // Deliberately NOT touching warehouse_layouts.updated_at. `needsRepublish`
      // is derived from `updated_at > published_at`, and an area contributes no
      // graph node, no edge weight and no access_offset_m — demanding a routing
      // rebuild because somebody labelled a corner would be a lie. It is also why
      // the stale-draft warning compares fingerprints and not timestamps: there
      // is no timestamp that moves when areas change.

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.warehouse_id),
        metadata: {
          area_paint: true, layout_id: layoutId,
          created: delta.created, erased: delta.erased,
          resized: delta.resized, reprofiled: delta.reprofiled,
          areas_after: specs.length, cells_after: delta.cellsAfter,
          cascade_names: input.cascade_names === true, include_custom: includeCustom,
          renamed, racks: rackCount, levels: levelCount,
          skipped_custom: skippedCustom, skipped_foreign: skippedForeign,
          bound, bind_units: binding.plan.units, bind_levels: binding.plan.levels,
          unbind: binding.plan.toRoot, category_warnings: categoryWarnings.length,
        },
      })

      return new Response(JSON.stringify({
        ok: true,
        fingerprint: areaCellsFingerprint(afterObjects),
        cells: inserted,
        areas: specs.length,
        renamed, racks: rackCount, levels: levelCount,
        skippedCustom, skippedForeign,
        bound, boundUnits: binding.plan.units, boundLevels: binding.plan.levels,
        unbound: binding.plan.toRoot, categoryWarnings,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── paint_labels (mig 00097) ─────────────────────────────────────────────
    if (input.action === 'paint_labels') {
      // Its own bucket, deliberately NOT shared with :paint: or :area:. Signage
      // is the cheap, safe edit an operator makes repeatedly while walking the
      // floor, and a burst of it must not lock them out of the two actions that
      // repair a genuinely wrong area.
      const signRl = await checkRateLimit(`mutate-warehouse-location:sign:${auth.userId}`, {
        windowMs: 60_000,
        max: 10,
      })
      if (!signRl.ok) {
        throw new EdgeFunctionError(
          'TOO_MANY_REQUESTS',
          `Rate limit exceeded; try again in ${Math.ceil(signRl.resetMs / 1000)}s`,
        )
      }

      // 1. The warehouse and its published layout. No materialized_path and no
      //    warehouse code needed — nothing here resolves a zone or writes a name.
      const { data: whRow } = await admin.from('locations')
        .select('id, kind, location_type, active_layout_id')
        .eq('id', input.warehouse_id).maybeSingle()
      if (!whRow || (whRow as any).kind !== 'WAREHOUSE') {
        throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
      }
      const layoutId = (whRow as any).active_layout_id as number | null
      if ((whRow as any).location_type !== 'racked' || !layoutId) {
        throw new EdgeFunctionError('CONFLICT', 'This site has no published layout, so it has nowhere to put a sign')
      }
      if (layoutId !== input.layout_id) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'This site’s published layout changed while you were editing. Reload the map and try again.',
        )
      }

      const { data: layoutRow } = await admin.from('warehouse_layouts')
        .select('id, grid_width, grid_height, floor_count').eq('id', layoutId).maybeSingle()
      if (!layoutRow) throw new EdgeFunctionError('NOT_FOUND', 'Published layout not found')
      const gridW = Number((layoutRow as any).grid_width)
      const gridH = Number((layoutRow as any).grid_height)
      const floors = Number((layoutRow as any).floor_count)

      // 2. Validate into canonical specs. signNameIssue is deliberately laxer
      //    than areaNameIssue — `·` is legal on a sign because nothing composes
      //    a sign into a longer name the way composeName does with an area.
      const specs: SignSpec[] = []
      const seenSignNames = new Set<string>()
      for (const sign of input.signs) {
        const issue = signNameIssue(sign.name)
        if (issue) throw new EdgeFunctionError('INVALID_INPUT', issue)
        const name = sanitizeSignName(sign.name)
        // Two entries sanitizing to one name would make the region merge
        // ambiguous and leave the operator unable to say which they clicked.
        if (seenSignNames.has(name)) {
          throw new EdgeFunctionError('INVALID_INPUT', `“${name}” is listed twice`)
        }
        seenSignNames.add(name)
        specs.push({ name, cells: expandSignRuns(sign.runs) })
      }

      // Bounds, and a cell may carry one sign only. The RPC backstops the bounds;
      // this names the offender, which the RPC cannot.
      const signClaimedBy = new Map<string, string>()
      for (const spec of specs) {
        for (const cell of spec.cells) {
          if (cell.floor < 0 || cell.floor >= floors || cell.x < 0 || cell.x >= gridW || cell.y < 0 || cell.y >= gridH) {
            throw new EdgeFunctionError(
              'INVALID_INPUT',
              `“${spec.name}” covers a cell (floor ${cell.floor}, ${cell.x}, ${cell.y}) outside this layout’s ${gridW} × ${gridH} grid`,
            )
          }
          const key = `${cell.floor}:${cell.x}:${cell.y}`
          const owner = signClaimedBy.get(key)
          if (owner !== undefined && owner !== spec.name) {
            throw new EdgeFunctionError(
              'INVALID_INPUT',
              `Cell (floor ${cell.floor}, ${cell.x}, ${cell.y}) is labelled both “${owner}” and “${spec.name}”`,
            )
          }
          signClaimedBy.set(key, spec.name)
        }
      }

      // 3. The before-picture. Note this reads rows of ANY width: MAIN's seeded
      //    signs are single `w: 10` objects, and signSpecsFromObjects expands
      //    them, so the fingerprint the client computed from the same rows
      //    matches and the round trip is lossless.
      const { data: signRows, error: signErr } = await admin.from('layout_objects')
        .select('id, object_type, floor, x, y, w, h, meta')
        .eq('layout_id', layoutId).eq('object_type', 'label')
      if (signErr) throw new EdgeFunctionError('INTERNAL', `Could not read signs: ${signErr.message}`)
      const beforeSigns = ((signRows ?? []) as any[]).map((o) => ({
        objectType: String(o.object_type), floor: Number(o.floor), x: Number(o.x), y: Number(o.y),
        w: Number(o.w), h: Number(o.h), meta: o.meta ?? null,
      }))

      const serverSignFingerprint = signCellsFingerprint(beforeSigns)
      if (serverSignFingerprint !== input.base_fingerprint) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Someone else changed this site’s signs while you were editing. Reload the map and try again.',
        )
      }

      const afterSigns = signObjectsFromSpecs(specs)
      const signDelta = diffSigns(beforeSigns, afterSigns)

      // No publish-readiness re-check and no zone binding, deliberately. A
      // `label` row is inert in buildWalkableCells and names nothing, so the
      // gates could only ever fail for something the operator did not do, and
      // there is no parentage for this action to have made stale.

      // 4. dry_run returns HERE — before any write and before the audit.
      if (input.dry_run) {
        return new Response(JSON.stringify({
          ok: true,
          fingerprint: serverSignFingerprint,
          preview: {
            created: signDelta.created,
            erased: signDelta.erased,
            resized: signDelta.resized,
            cellsAfter: signDelta.cellsAfter,
            unchanged: signDelta.unchanged,
          },
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // 5. One transaction for the replace — two supabase-js statements are not
      //    a transaction, and delete-first would leave a live warehouse with
      //    every sign gone if the insert failed.
      const signInsertRows = afterSigns.map((o) => ({ floor: o.floor, x: o.x, y: o.y, meta: o.meta }))
      const { data: signInsertedRaw, error: signReplaceErr } = await admin.rpc('wie_replace_layout_labels_tx', {
        p_layout_id: layoutId,
        p_rows: signInsertRows,
      })
      if (signReplaceErr) {
        throw new EdgeFunctionError('INTERNAL', `Could not save the signs: ${signReplaceErr.message}`)
      }
      const signInserted = Number(signInsertedRaw ?? 0)
      if (signInserted !== signInsertRows.length) {
        throw new EdgeFunctionError('INTERNAL', `Saved ${signInserted} of ${signInsertRows.length} sign cells`)
      }

      // Deliberately NOT touching warehouse_layouts.updated_at, for the same
      // reason paint_areas does not: `needsRepublish` is derived from
      // `updated_at > published_at`, and a sign contributes no graph node, no
      // edge weight and no access_offset_m. It is also why the client's
      // staleness check is a fingerprint — nothing timestamped moves here.

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'layout_signs',
        resourceId: String(input.warehouse_id),
        metadata: {
          layout_id: layoutId,
          created: signDelta.created, erased: signDelta.erased, resized: signDelta.resized,
          signs_after: specs.length, cells_after: signDelta.cellsAfter,
        },
      })

      return new Response(JSON.stringify({
        ok: true,
        fingerprint: signCellsFingerprint(afterSigns),
        cells: signInserted,
        signs: specs.length,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── rename_area (mig 00094) ──────────────────────────────────────────────
    //
    // Rename a painted area and cascade to every auto-named bin inside it,
    // ON A LIVE WAREHOUSE. The designer cannot do this: save_geometry requires a
    // draft, and a mis-named area is only ever discovered after go-live.
    //
    // THE JOIN, since there is no FK between an area and a bin. An area is
    // `layout_objects` geometry; a bin is a `locations` row. The only thing
    // connecting them is that both describe the same grid cells on the same
    // layout, and `layout_placements` is what says which cells a bin occupies.
    // The geometric intersection is then done in TypeScript, not SQL, for the
    // same reason proposeHomeBins is JS: a SQL formulation would have to restate
    // the majority-of-cells rule and its tie-break, which is a second copy of a
    // decision that already has exactly one.
    if (input.action === 'rename_area') {
      // Its own bucket. The shared 30/min is sized for single-node edits; one
      // call here can touch 1100+ rows. Mirrors mutate-product-home-bin's :bulk.
      const bulkRl = await checkRateLimit(`mutate-warehouse-location:area:${auth.userId}`, {
        windowMs: 60_000,
        max: 10,
      })
      if (!bulkRl.ok) {
        throw new EdgeFunctionError(
          'TOO_MANY_REQUESTS',
          `Rate limit exceeded; try again in ${Math.ceil(bulkRl.resetMs / 1000)}s`,
        )
      }

      const from = sanitizeAreaName(input.from)
      const to = sanitizeAreaName(input.to)
      const issue = areaNameIssue(input.to)
      if (issue) throw new EdgeFunctionError('INVALID_INPUT', issue)
      if (!from) throw new EdgeFunctionError('INVALID_INPUT', 'Name the area being renamed')

      // 1. The warehouse, its path, and its published layout.
      const { data: whRow } = await admin.from('locations')
        .select('id, kind, code, materialized_path, location_type, active_layout_id')
        .eq('id', input.warehouse_id).maybeSingle()
      if (!whRow || (whRow as any).kind !== 'WAREHOUSE') {
        throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
      }
      const whPath = (whRow as any).materialized_path as string
      // Needed to derive a ZONE's code when binding find-or-creates one (00096).
      const whCode = (whRow as any).code as string
      const layoutId = (whRow as any).active_layout_id as number | null
      if ((whRow as any).location_type !== 'racked' || !layoutId) {
        throw new EdgeFunctionError('CONFLICT', 'This site has no published layout, so it has no areas to rename')
      }

      // 2. The area cells.
      const { data: objectRows, error: objErr } = await admin.from('layout_objects')
        .select('id, object_type, floor, x, y, w, h, meta')
        .eq('layout_id', layoutId).eq('object_type', 'area')
      if (objErr) throw new EdgeFunctionError('INTERNAL', `Could not read areas: ${objErr.message}`)
      const areaCells = (objectRows ?? []) as any[]
      const matching = areaCells.filter((o) => String(o.meta?.name ?? '').trim() === from)
      if (matching.length === 0) {
        throw new EdgeFunctionError('NOT_FOUND', `No area called "${from}" on this site`)
      }

      // The index is built from the POST-rename picture, so membership needs no
      // pre-image reconstruction — a cell is in the target area iff it will be.
      const renamedCells = areaCells.map((o) => (
        String(o.meta?.name ?? '').trim() === from
          ? { ...o, meta: { ...(o.meta ?? {}), name: to } }
          : o
      ))
      const areaIndex = buildAreaIndex(renamedCells.map((o) => ({
        objectType: o.object_type, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h, meta: o.meta ?? null,
      })))

      // 3-5. Placements → locations → rack-parent rollup → one naming unit per
      //      RACK/BIN with its levels attached. Shared with paint_areas.
      const { units, locById, levelsByParent, unitGeometry } =
        await loadLayoutNamingUnits(admin, layoutId, whPath)

      const result = assignAutoNames(units, areaIndex, {
        rename: { from, to },
        includeCustom: input.include_custom === true,
        // Numbers spoken for anywhere in this warehouse, including on racks that
        // have left the layout but whose labels are still on the racking.
        minSeq: (await loadAreaSeqClaims(admin, whPath)).high,
        // Deliberately NOT passing claimedInTarget. A rename moves a whole pool
        // at once, so the only numbers arriving in `to` are the ones leaving
        // `from`, which the high-water fold already reconciles. paint_areas is
        // the caller that needs it, because a moved BOUNDARY can sweep a rack
        // into a pool whose incumbent holding that number stays put.
      })

      // 6. Turn that into writes, and count what was deliberately left alone.
      const writes: NameWrite[] = []
      let skippedCustom = 0
      const examples: Array<{ code: string; from: string; to: string }> = []
      for (const named of result.units) {
        const id = Number(named.ref.slice(4))
        const loc = locById.get(id)!
        if (!named.isAuto) {
          // Only count the ones the rename would otherwise have taken — a
          // hand-named bin in a different area is not "kept", it is unrelated.
          if (areaForRect(areaIndex, unitGeometry.get(id)!) === to) skippedCustom++
          continue
        }
        if (named.seq == null) continue
        const rackWrite: NameWrite = {
          id, name: named.name, name_seq: named.seq,
          name_area: named.areaName || null, name_is_auto: true,
        }
        if (loc.name !== rackWrite.name) {
          writes.push(rackWrite)
          if (examples.length < 5) examples.push({ code: loc.code, from: loc.name, to: named.name })
        }
        for (const lvl of levelsByParent.get(id) ?? []) {
          const levelLoc = locById.get(lvl.id)
          // A level carries its OWN provenance, so one an operator hand-named
          // survives its rack being renamed around it.
          if (!levelLoc || (!levelLoc.nameIsAuto && input.include_custom !== true)) continue
          const levelName = composeName(named.areaName, named.seq, lvl.levelIndex, named.noun)
          if (levelLoc.name === levelName) continue
          writes.push({
            id: lvl.id, name: levelName, name_seq: null,
            name_area: named.areaName || null, name_is_auto: true,
          })
        }
      }

      const rackCount = writes.filter((w) => w.name_seq != null).length
      const levelCount = writes.length - rackCount

      // Zone binding (mig 00096). A rename on its own changes no profile and so
      // normally plans nothing — but this action ALSO accepts zone_profile_id, so
      // re-tinting an area from the rename dialog must rebind its bins. Built
      // from the post-rename picture with the new profile folded in, which is the
      // same AFTER-picture discipline the naming pass above uses.
      const boundProfileId = input.zone_profile_id === undefined
        ? undefined
        : input.zone_profile_id ?? null
      const binding = await buildZoneBindingPlan(
        admin,
        { id: input.warehouse_id, path: whPath, code: whCode },
        layoutId,
        renamedCells.map((o) => ({
          objectType: o.object_type, floor: o.floor, x: o.x, y: o.y, w: o.w, h: o.h,
          meta: String(o.meta?.name ?? '').trim() === to && boundProfileId !== undefined
            ? { ...(o.meta ?? {}), zoneProfileId: boundProfileId }
            : o.meta ?? null,
        })),
      )
      const categoryWarnings = await zoneCategoryWarnings(admin, binding)

      if (input.dry_run) {
        // Nothing happened, so nothing is audited.
        return new Response(JSON.stringify({
          ok: true,
          preview: {
            willRename: writes.length, racks: rackCount, levels: levelCount, skippedCustom, examples,
            willBind: binding.plan.units, bindLevels: binding.plan.levels,
            unbind: binding.plan.toRoot, categoryWarnings,
          },
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // 7. The area's own label, then the bins. Every cell of one area shares
      //    its meta by construction, so this is a single update. `boundProfileId`
      //    is the same value the binding plan above was computed from — derived
      //    once, so the meta that gets stored and the parentage that gets applied
      //    cannot disagree about which profile this area now names.
      const { error: metaErr } = await admin.from('layout_objects')
        .update({
          meta: {
            ...(matching[0].meta ?? {}),
            name: to,
            ...(boundProfileId === undefined ? {} : { zoneProfileId: boundProfileId }),
          },
        } as any)
        .in('id', matching.map((o) => o.id))
      if (metaErr) throw new EdgeFunctionError('INTERNAL', `Could not rename the area: ${metaErr.message}`)

      const renamed = await applyNameWrites(admin, whPath, writes)
      const bound = await applyReparents(admin, whPath, binding.plan.moves)

      // Deliberately NOT touching warehouse_layouts.updated_at. `needsRepublish`
      // is derived from `updated_at > published_at`, so bumping it would tell the
      // operator to republish — rebuilding the routing graph and refreezing every
      // edge weight — because they corrected a spelling. Re-parenting does not
      // change that: a bin's parent contributes no graph node, no edge weight and
      // no access_offset_m either.

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.warehouse_id),
        metadata: {
          area_rename: true, layout_id: layoutId, from, to,
          renamed, racks: rackCount, levels: levelCount,
          skipped_custom: skippedCustom, include_custom: input.include_custom === true,
          bound, bind_units: binding.plan.units, bind_levels: binding.plan.levels,
          unbind: binding.plan.toRoot, category_warnings: categoryWarnings.length,
        },
      })

      return new Response(JSON.stringify({
        ok: true, renamed, racks: rackCount, levels: levelCount, skippedCustom,
        bound, boundUnits: binding.plan.units, boundLevels: binding.plan.levels,
        unbound: binding.plan.toRoot, categoryWarnings,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── bind_zones (mig 00096) ───────────────────────────────────────────────
    //
    // Bind a whole site's bins to the zones its areas name, from the areas
    // already stored. paint_areas and save_geometry do this as a side effect, so
    // this is for the site painted before 00096 existed — and for previewing a
    // 1100-row re-parent before it happens.
    if (input.action === 'bind_zones') {
      // Its own bucket, deliberately shared with neither :paint: nor :area:. One
      // call can re-parent 1134 rows, and a burst of paint saves must not lock
      // the operator out of the one action that repairs a site wholesale.
      const bindRl = await checkRateLimit(`mutate-warehouse-location:bind:${auth.userId}`, {
        windowMs: 60_000,
        max: 10,
      })
      if (!bindRl.ok) {
        throw new EdgeFunctionError(
          'TOO_MANY_REQUESTS',
          `Rate limit exceeded; try again in ${Math.ceil(bindRl.resetMs / 1000)}s`,
        )
      }

      const { data: whRow } = await admin.from('locations')
        .select('id, kind, code, materialized_path, location_type, active_layout_id')
        .eq('id', input.warehouse_id).maybeSingle()
      if (!whRow || (whRow as any).kind !== 'WAREHOUSE') {
        throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
      }
      const whPath = (whRow as any).materialized_path as string
      const whCode = (whRow as any).code as string
      const layoutId = (whRow as any).active_layout_id as number | null
      if ((whRow as any).location_type !== 'racked' || !layoutId) {
        throw new EdgeFunctionError('CONFLICT', 'This site has no published layout, so it has no areas to bind')
      }

      // The areas AS STORED — this action changes no geometry, it only applies
      // the consequence of geometry that is already there.
      const { data: objectRows, error: objErr } = await admin.from('layout_objects')
        .select('object_type, floor, x, y, w, h, meta')
        .eq('layout_id', layoutId).eq('object_type', 'area')
      if (objErr) throw new EdgeFunctionError('INTERNAL', `Could not read areas: ${objErr.message}`)

      const binding = await buildZoneBindingPlan(
        admin,
        { id: input.warehouse_id, path: whPath, code: whCode },
        layoutId,
        ((objectRows ?? []) as any[]).map((o) => ({
          objectType: String(o.object_type), floor: Number(o.floor), x: Number(o.x), y: Number(o.y),
          w: Number(o.w), h: Number(o.h), meta: o.meta ?? null,
        })),
      )
      const categoryWarnings = await zoneCategoryWarnings(admin, binding)

      // dry_run returns HERE — before any write and before the audit — so the
      // previewed count is provably the count that moves.
      if (input.dry_run) {
        return new Response(JSON.stringify({
          ok: true,
          preview: {
            willBind: binding.plan.units,
            levels: binding.plan.levels,
            unbind: binding.plan.toRoot,
            unchanged: binding.plan.unchanged,
            byArea: binding.plan.byArea.map((a) => ({
              areaName: a.areaName, profileId: a.profileId, zoneId: a.zoneId,
              units: a.units, moved: a.moved,
            })),
            categoryWarnings,
            examples: binding.plan.examples,
          },
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const bound = await applyReparents(admin, whPath, binding.plan.moves)

      // No warehouse_layouts.updated_at bump, for the reason rename_area gives:
      // parentage contributes no graph node, no edge weight and no
      // access_offset_m, so demanding a republish for it would be a lie.

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.warehouse_id),
        metadata: {
          zone_bind: true, layout_id: layoutId,
          bound, bind_units: binding.plan.units, bind_levels: binding.plan.levels,
          unbind: binding.plan.toRoot, unchanged: binding.plan.unchanged,
          areas: binding.plan.byArea.length, category_warnings: categoryWarnings.length,
        },
      })

      return new Response(JSON.stringify({
        ok: true,
        bound,
        boundUnits: binding.plan.units,
        boundLevels: binding.plan.levels,
        unbound: binding.plan.toRoot,
        unchanged: binding.plan.unchanged,
        categoryWarnings,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── recode_locations (mig 00107) ─────────────────────────────────────────
    if (input.action === 'recode_locations') {
      // Its own bucket, and the fifth. Same argument as :bind: — one call rewrites
      // up to 500 units plus their levels — and the exact inverse of :sign:'s: this
      // is the expensive, dangerous edit, and it must not spend the budget the
      // cheap corrective ones need.
      const recodeRl = await checkRateLimit(`mutate-warehouse-location:recode:${auth.userId}`, {
        windowMs: 60_000,
        max: 10,
      })
      if (!recodeRl.ok) {
        throw new EdgeFunctionError(
          'TOO_MANY_REQUESTS',
          `Rate limit exceeded; try again in ${Math.ceil(recodeRl.resetMs / 1000)}s`,
        )
      }

      const { data: whRow } = await admin.from('locations')
        .select('id, kind, code, materialized_path, location_type, active_layout_id')
        .eq('id', input.warehouse_id).maybeSingle()
      if (!whRow || (whRow as any).kind !== 'WAREHOUSE') {
        throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
      }
      const whPath = (whRow as any).materialized_path as string
      const whCode = (whRow as any).code as string
      const layoutId = (whRow as any).active_layout_id as number | null
      if ((whRow as any).location_type !== 'racked' || !layoutId) {
        throw new EdgeFunctionError('CONFLICT', 'This site has no published layout, so it has no drawn bins to recode')
      }

      const stored = await loadCodePattern(admin, input.warehouse_id)
      const template = input.template_override ?? stored?.template ?? BUILTIN_PATTERN.template
      const tmplIssue = templateIssue(template)
      if (tmplIssue) throw new EdgeFunctionError('INVALID_INPUT', tmplIssue)

      const block = sanitizeBlock(input.block)
      if (!block) throw new EdgeFunctionError('INVALID_INPUT', 'Give the block a name')
      const order = (input.order ?? stored?.order ?? BUILTIN_PATTERN.order) as CodeOrder
      const origin = (input.origin ?? stored?.origin ?? DEFAULT_ORIGIN) as CodeOrigin

      // Resolve the selection through the SAME loader the naming pass uses. The
      // client rolled its SHELF hits up to their rack parents already; doing it
      // again here is what protects a stale tab, and reusing loadLayoutNamingUnits
      // is what stops a recode and a rename disagreeing about what a unit even is.
      // It also applies the warehouse scope check on every id it resolves.
      const resolved = await loadLayoutNamingUnits(admin, layoutId, whPath)
      const requested = new Map(input.units.map((u) => [u.location_id, u.expected_code]))

      // Fold every requested id to the unit that owns it: a SHELF id becomes its
      // rack, and two levels of one rack become one unit.
      const unitIds = new Set<number>()
      for (const id of requested.keys()) {
        const loc = resolved.locById.get(id)
        if (!loc) throw new EdgeFunctionError('NOT_FOUND', `Location ${id} is not on this layout`)
        const unitId = loc.kind === 'SHELF' && loc.parentId != null ? loc.parentId : loc.id
        if (!resolved.unitGeometry.has(unitId)) {
          throw new EdgeFunctionError('INVALID_INPUT', `Location ${loc.code} is not a placed unit`)
        }
        unitIds.add(unitId)
      }

      // Compare-and-swap, before anything is planned. An id whose code has moved
      // under the operator voids the batch — see the note on recodeSchema.
      const stale: Array<{ code: string; expected: string }> = []
      for (const [id, expected] of requested) {
        const loc = resolved.locById.get(id)!
        if (loc.code !== expected) stale.push({ code: loc.code, expected })
      }
      if (stale.length > 0) {
        throw new EdgeFunctionError('CONFLICT', 'Some of these locations were recoded while you were selecting', {
          stale: stale.slice(0, 5),
        })
      }

      // Everything already carrying this block that is NOT in the selection. Free —
      // loadLayoutNamingUnits has already loaded every placed unit on the layout, so
      // "who else is in BULK" costs no query. These are PLANNED but never written:
      // they exist so the framing can be checked against the codes already on the
      // racking (see `drift`).
      const incumbentIds = [...resolved.unitGeometry.keys()].filter((id) => {
        const loc = resolved.locById.get(id)
        return !!loc && loc.codeBlock === block && !unitIds.has(id)
      })

      // Renumbering the whole block is the operator's explicit second answer to
      // drift, and it simply makes the incumbents part of the selection.
      if (input.renumber_block) for (const id of incumbentIds) unitIds.add(id)
      const incumbentsRemaining = input.renumber_block ? [] : incumbentIds
      if (unitIds.size > 500) {
        throw new EdgeFunctionError(
          'INVALID_INPUT',
          `Renumbering all of "${block}" would rewrite ${unitIds.size} locations; the limit is 500 per sweep`,
        )
      }

      const stocked = await loadStockedLocations(
        admin,
        [...unitIds, ...incumbentsRemaining, ...requested.keys()],
      )
      const buildUnit = (id: number): RecodeUnit => {
        const loc = resolved.locById.get(id)!
        const geo = resolved.unitGeometry.get(id)!
        const levels = (resolved.levelsByParent.get(id) ?? []).map((l) => {
          const levelLoc = resolved.locById.get(l.id)!
          return {
            id: l.id, levelIndex: l.levelIndex, code: levelLoc.code,
            labelPrinted: levelLoc.labelPrinted,
          }
        }).sort((a, b) => a.levelIndex - b.levelIndex)
        return {
          id, floor: geo.floor, x: geo.x, y: geo.y,
          code: loc.code, codeBlock: loc.codeBlock, codeSeq: loc.codeSeq, kind: loc.kind,
          labelPrinted: loc.labelPrinted,
          hasStock: stocked.has(id) || levels.some((l) => stocked.has(l.id)),
          levels: levels.length > 0 ? levels : undefined,
        }
      }
      const units: RecodeUnit[] = [...unitIds].map(buildUnit)
      const incumbents: RecodeUnit[] = incumbentsRemaining.map(buildUnit)

      // A fresh block starts at 1; an existing one continues past its high-water
      // mark, so two sweeps over adjacent aisles do not both mint 01.
      //
      // THE SELECTION IS EXCLUDED FROM THAT HIGH-WATER, and it has to be. Counting
      // the rows this sweep is about to rewrite makes re-running the identical
      // sweep start where the last one finished — 01..06 becomes 07..12 and the
      // operator's "did that work?" click has silently moved every code. Caught on
      // dev doing exactly that.
      const sweptIds = [...unitIds, ...[...unitIds].flatMap(
        (id) => (resolved.levelsByParent.get(id) ?? []).map((l) => l.id),
      )]
      const highWater = await loadCodeHighWater(admin, whPath, sweptIds)
      const start = input.start_at ?? (highWater.get(block) ?? 0) + 1

      const takenCodes = await loadTakenCodes(admin)
      // The frame spans the UNION, so a bin painted onto the end of an existing run
      // continues it instead of restarting at 1-1. With no incumbents this is just
      // the selection, which is the ordinary first-sweep case.
      const frameCells = [...units, ...incumbents]
      const plan = planRecode(units, {
        template, block, start, order, wh: whCode, takenCodes, origin,
        frameCells, incumbents,
      })

      // When a framing does not fit, the useful thing to say is which one WOULD —
      // recovered from the codes already on the racking rather than remembered.
      const suggestedFraming = plan.drift.length > 0
        ? solveBlockFraming(incumbents, { template, block, wh: whCode })
        : null

      const examples = plan.writes.slice(0, 5).map((w) => ({ from: w.from, to: w.to }))
      const levelCount = plan.writes.reduce((n, w) => n + w.levels.length, 0)

      // dry_run returns HERE — before any write and before the audit — so the
      // previewed count is provably the count that moves. Note this REPORTS the
      // refusal list rather than throwing on the first offender, unlike
      // paint_areas: a malformed payload there is one bug, whereas these are a list
      // the operator has to act on and one per round trip is a bad tool.
      if (input.dry_run) {
        return new Response(JSON.stringify({
          ok: true,
          preview: {
            willRecode: plan.writes.length,
            units: units.length,
            levels: levelCount,
            unchanged: plan.unchanged,
            nextCounter: plan.nextCounter,
            startedAt: start,
            block,
            template,
            examples,
            refusals: plan.refusals.slice(0, 20),
            refusedTotal: plan.refusals.length,
            labelPrinted: plan.labelPrinted.length,
            holdingStock: plan.holdingStock.length,
            codes: plan.allCodes,
            // Growth reporting. `drift` is the list of block members this framing
            // would move; non-empty means the batch is refused, and
            // `suggestedFraming` is the origin/order that DOES reproduce them.
            frame: plan.frame,
            drift: plan.drift.slice(0, 20),
            driftTotal: plan.drift.length,
            incumbents: incumbents.length,
            origin,
            order,
            suggestedFraming,
          },
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      if (plan.refusals.length > 0) {
        throw new EdgeFunctionError('CONFLICT', plan.refusals[0].detail, {
          refusals: plan.refusals.slice(0, 20),
          refusedTotal: plan.refusals.length,
          drift: plan.drift.slice(0, 20),
          driftTotal: plan.drift.length,
          suggestedFraming,
        })
      }
      if (plan.writes.length === 0) {
        return new Response(JSON.stringify({ ok: true, recoded: 0, unchanged: plan.unchanged }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Every new path is rebuilt from its PARENT's path, never by patching the old
      // path's last segment — on MAIN, 378 rows carry a `-X<id>` suffix in the code
      // that never reached the path, so the last segment is not the code there.
      const parentIds = plan.writes
        .map((w) => resolved.locById.get(w.id)?.parentId)
        .filter((id): id is number => id != null)
      const parentPaths = await loadParentPaths(admin, parentIds)
      const rows = buildRecodeRows(plan.writes, resolved.locById, parentPaths)
      const recoded = await applyRecodeWrites(admin, whPath, rows)

      // Record what moved, so the operator can put it back after a reload. NOT
      // fatal if it fails: the sweep has already committed, and reporting a write
      // that did happen as an error is far worse than losing an undo affordance.
      // The response says whether the record was kept and the panel only offers
      // Revert when it was.
      const prevProvenance = new Map(
        units.map((u) => [u.id, { block: u.codeBlock, seq: u.codeSeq }]),
      )
      const recordedSweep = await recordSweep(admin, {
        warehouseId: input.warehouse_id,
        block, template, origin, order,
        rows: sweptRowsFrom(plan.writes, prevProvenance),
        actorId: auth.userId,
      })

      // No warehouse_layouts.updated_at bump, for the reason rename_area gives: a
      // code contributes no graph node, no edge weight and no access_offset_m, so
      // demanding a republish for it would be a lie.

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.warehouse_id),
        metadata: {
          recode: true, layout_id: layoutId, block, template, start_at: start, order, origin,
          renumber_block: input.renumber_block === true,
          incumbents: incumbents.length,
          units: units.length, levels: levelCount, recoded, unchanged: plan.unchanged,
          label_printed_reset: plan.labelPrinted.length,
          holding_stock: plan.holdingStock.length,
          first: examples[0] ? `${examples[0].from}→${examples[0].to}` : null,
          last: plan.writes.length > 0
            ? `${plan.writes[plan.writes.length - 1].from}→${plan.writes[plan.writes.length - 1].to}`
            : null,
        },
      })

      return new Response(JSON.stringify({
        ok: true,
        recoded,
        units: plan.writes.length,
        levels: levelCount,
        unchanged: plan.unchanged,
        nextCounter: plan.nextCounter,
        labelPrintedReset: plan.labelPrinted.length,
        canRevert: recordedSweep,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── revert_code_sweep (mig 00108) ────────────────────────────────────────
    if (input.action === 'revert_code_sweep') {
      // Shares the `:recode:` bucket deliberately: a revert rewrites exactly the
      // same rows a sweep did, and giving it its own budget would let a loop of
      // sweep/revert/sweep spend twice what one of them can.
      const revertRl = await checkRateLimit(`mutate-warehouse-location:recode:${auth.userId}`, {
        windowMs: 60_000,
        max: 10,
      })
      if (!revertRl.ok) {
        throw new EdgeFunctionError(
          'TOO_MANY_REQUESTS',
          `Rate limit exceeded; try again in ${Math.ceil(revertRl.resetMs / 1000)}s`,
        )
      }

      const { data: whRow } = await admin.from('locations')
        .select('id, kind, materialized_path, active_layout_id')
        .eq('id', input.warehouse_id).maybeSingle()
      if (!whRow || (whRow as any).kind !== 'WAREHOUSE') {
        throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
      }
      const whPath = (whRow as any).materialized_path as string
      const layoutId = (whRow as any).active_layout_id as number | null
      if (!layoutId) throw new EdgeFunctionError('CONFLICT', 'This site has no published layout')

      const sweep = await loadLatestSweep(admin, input.warehouse_id)
      if (!sweep) throw new EdgeFunctionError('NOT_FOUND', 'There is no sweep to revert')

      // Resolved through the SAME loader the sweep used, so a revert and a recode
      // cannot disagree about what a row is or where it sits.
      const resolved = await loadLayoutNamingUnits(admin, layoutId, whPath)
      const parentIds = sweep.rows
        .map((r) => resolved.locById.get(r.id)?.parentId)
        .filter((id): id is number => id != null)
      const parentPaths = await loadParentPaths(admin, parentIds)
      // Throws CONFLICT naming the row if anything has been recoded again since.
      const revertRows = buildRevertRows(sweep.rows, resolved.locById, parentPaths)

      const reverted = await applyRecodeWrites(admin, whPath, revertRows)
      await markSweepReverted(admin, sweep.id, auth.userId)

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.warehouse_id),
        metadata: {
          recode_revert: true, sweep_id: sweep.id, block: sweep.block, reverted,
          first: sweep.rows[0] ? `${sweep.rows[0].to}→${sweep.rows[0].from}` : null,
        },
      })

      return new Response(JSON.stringify({ ok: true, reverted, block: sweep.block }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── rename_rack (mig 00094) ──────────────────────────────────────────────
    // One rack, optionally with its levels, in one round trip and one audit row.
    if (input.action === 'rename_rack') {
      const { data: rackRow } = await admin.from('locations')
        .select('id, code, name, kind, materialized_path').eq('id', input.id).maybeSingle()
      if (!rackRow) throw new EdgeFunctionError('NOT_FOUND', `Location ${input.id} not found`)
      if ((rackRow as any).kind === 'WAREHOUSE') {
        throw new EdgeFunctionError('INVALID_INPUT', 'Use mutate-warehouse for WAREHOUSE rows')
      }
      const name = input.name.trim().slice(0, 120)
      if (!name) throw new EdgeFunctionError('INVALID_INPUT', 'Give the location a name')

      const root = await rootWarehouse(admin, input.id)
      if (!root) throw new EdgeFunctionError('INVALID_INPUT', 'Location is not inside a warehouse')
      const { data: rootRow } = await admin.from('locations')
        .select('materialized_path').eq('id', root.id).single()
      const whPath = (rootRow as any).materialized_path as string

      // Typing a name IS the definition of a custom name, so the provenance is
      // forced here rather than taken from the client. Releasing the number is
      // deliberate: the row no longer holds a claim on its area's pool.
      const writes: NameWrite[] = [
        { id: input.id, name, name_seq: null, name_area: null, name_is_auto: false },
      ]
      if (input.include_levels) {
        const { data: levelRows } = await admin.from('locations')
          .select('id, level_index').eq('parent_id', input.id).eq('kind', 'SHELF')
          .not('level_index', 'is', null)
        for (const lvl of (levelRows ?? []) as any[]) {
          writes.push({
            id: Number(lvl.id),
            name: `${name}${NAME_SEP}L${lvl.level_index}`.slice(0, 120),
            name_seq: null, name_area: null, name_is_auto: false,
          })
        }
      }

      const renamed = await applyNameWrites(admin, whPath, writes)
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
        resourceId: String(input.id),
        before: { name: (rackRow as any).name } as Record<string, unknown>,
        after: { name } as Record<string, unknown>,
        metadata: { renamed, include_levels: input.include_levels === true },
      })
      return new Response(JSON.stringify({ ok: true, renamed }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: existing, error: fErr } = await admin.from('locations').select('*').eq('id', input.id).single()
    if (fErr || !existing) throw new EdgeFunctionError('NOT_FOUND', `Location ${input.id} not found`)
    if ((existing as any).kind === 'WAREHOUSE') {
      throw new EdgeFunctionError('INVALID_INPUT', 'Use mutate-warehouse for WAREHOUSE rows')
    }

    if (input.action === 'update') {
      // A typed name IS a custom name (mig 00094), and the provenance is forced
      // server-side rather than accepted from the client — otherwise a caller
      // could leave a hand-typed name marked auto and have the next area rename
      // silently overwrite it. Clearing the number is deliberate: this row no
      // longer holds a claim on its area's pool.
      const patch = input.data.name !== undefined
        ? { ...input.data, name_is_auto: false, name_seq: null, name_area: null }
        : input.data
      const { data: updated, error } = await admin.from('locations').update(patch as any).eq('id', input.id).select().single()
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
