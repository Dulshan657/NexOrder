// mutate-storage-type Edge Function
//
// Admin-only create / update / deactivate on `storage_types` — the tenant-global
// catalogue of physical storage-unit types (Pallet Rack, Shelving, Bulk Floor,
// Cold Room, …) operators manage. Types are never hard-deleted (locations FK
// them via storage_type_id); deactivate hides them from the pickers while keeping
// history valid. Direct writes are RLS-blocked; this service-role function is the
// sole write path.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { levelRetroPatches } from '../_shared/storageFormLevels.ts'
import { assertValidRoles, loadActiveRoleKeys } from '../_shared/levelRoleLookup.ts'
// A unit is called what its FORM says it is (mig 00100), so editing the form can
// leave every unit wearing it called the wrong thing. The rule is pure and shared
// with the designer; the I/O sits beside it, outside the wie/ purity contract.
import { unitNoun } from '../_shared/wie/locationNaming.ts'
import { restampFormNames } from '../_shared/locationNamingWrite.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin']
const SLOT_UNITS = ['pallet', 'carton', 'each', 'uncounted'] as const

// One entry of a storage form's STANDARD level layout (mig 00072) — every rack
// drawn with this form inherits it; individual racks may override.
const levelTemplateEntrySchema = z.object({
  // Validated at runtime against level_roles (mig 00081). level_template is
  // JSONB, so no FK can guard it — validateLevelTemplate below is the ONLY
  // thing standing between an operator and a form that references a role which
  // does not exist.
  role: z.string().min(1).max(32),
  capacity_slots: z.number().nonnegative().nullable().optional(),
  // A level names its OWN slot unit, because one rack can carry two of them:
  // Amadiya's bays are carton pick-zone levels below and pallet positions above.
  // Without this the whole rack inherits the form's single `slot_unit`, and
  // `slot_kind` is what picks the fill formula (_shared/wie/capacity.ts) — a
  // pallet level labelled `carton` counts 130 loose units against 2 slots, the
  // exact arithmetic mig 00078 was written to stop. Nullish, like every other
  // per-level field: the column is nullable and null is the honest wire value
  // for "inherit the form's slot_unit", which is what every pre-existing
  // template says by saying nothing.
  slot_kind: z.enum(['pallet', 'carton']).nullable().optional(),
  weight_capacity_kg: z.number().nonnegative().nullable().optional(),
})

// Storage-forms capacity fields (mig 00061): structured capacity, dims, weight,
// palette colour, drawable flag. All nullable/optional and additive.
const formFields = {
  levels: z.number().int().nonnegative().nullable().optional(),
  positions_per_level: z.number().int().nonnegative().nullable().optional(),
  weight_capacity_kg: z.number().nonnegative().nullable().optional(),
  length_cm: z.number().nonnegative().nullable().optional(),
  width_cm: z.number().nonnegative().nullable().optional(),
  height_cm: z.number().nonnegative().nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  is_drawable: z.boolean().optional(),
  // Rack levels (mig 00072). has_levels opts this form into addressable
  // per-level locations; level_template is its standard layout.
  has_levels: z.boolean().optional(),
  level_template: z.array(levelTemplateEntrySchema).max(50).nullable().optional(),
  // Floor storage (mig 00100). Deliberately independent of has_levels: that one
  // means "carries a standard level layout" and is false on real racking with
  // no template yet, so it cannot answer "can this be levelled at all".
  is_floor: z.boolean().optional(),
}

/** A form with has_levels=true needs a non-empty template — this is a system
 *  boundary (the client cannot be trusted to enforce it), and it must be
 *  checked against the row's EFFECTIVE state, not the raw request body: an
 *  update can patch has_levels and level_template in separate calls, so
 *  either field alone can be absent from a given payload. */
function validateLevelTemplate(hasLevels: unknown, template: unknown, validRoles: string[]): void {
  if (!hasLevels) return
  if (!Array.isArray(template) || template.length === 0) {
    throw new EdgeFunctionError('INVALID_INPUT', 'A form with levels needs at least one level in its template')
  }
  for (const entry of template as any[]) {
    if (!entry || typeof entry !== 'object') {
      throw new EdgeFunctionError('INVALID_INPUT', 'Each level must be an object with a role')
    }
    assertValidRoles([entry.role], validRoles)
    if (entry.capacity_slots != null && (typeof entry.capacity_slots !== 'number' || entry.capacity_slots < 0)) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Level capacity must be zero or a positive number')
    }
    if (entry.weight_capacity_kg != null && (typeof entry.weight_capacity_kg !== 'number' || entry.weight_capacity_kg < 0)) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Level weight capacity must be zero or a positive number')
    }
  }
}

const createSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  default_capacity_slots: z.number().nonnegative().nullable().optional(),
  slot_unit: z.enum(SLOT_UNITS).default('pallet'),
  attributes: z.record(z.unknown()).optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  ...formFields,
})

// Update touches everything except the stable `code` key.
const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  default_capacity_slots: z.number().nonnegative().nullable().optional(),
  slot_unit: z.enum(SLOT_UNITS).optional(),
  attributes: z.record(z.unknown()).optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  is_active: z.boolean().optional(),
  ...formFields,
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided for update' })

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: createSchema }),
  // apply_to_existing: retro-apply the form's capacity/weight to every existing
  // location of this type (the "Apply to all units" choice on the save prompt).
  z.object({
    action: z.literal('update'),
    id: z.number().int().positive(),
    data: updateSchema,
    apply_to_existing: z.boolean().optional(),
  }),
  z.object({ action: z.literal('deactivate'), id: z.number().int().positive() }),
])

/** Normalise a code to SCREAMING_SNAKE so it stays a clean, stable key. */
function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })
    const rl = await checkRateLimit(`mutate-storage-type:${auth.userId}`, { windowMs: 60_000, max: 60 })
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

    if (input.action === 'create') {
      const row = {
        code: normaliseCode(input.data.code),
        name: input.data.name,
        default_capacity_slots: input.data.default_capacity_slots ?? null,
        slot_unit: input.data.slot_unit,
        attributes: input.data.attributes ?? {},
        sort_order: input.data.sort_order ?? 100,
        levels: input.data.levels ?? null,
        positions_per_level: input.data.positions_per_level ?? null,
        weight_capacity_kg: input.data.weight_capacity_kg ?? null,
        length_cm: input.data.length_cm ?? null,
        width_cm: input.data.width_cm ?? null,
        height_cm: input.data.height_cm ?? null,
        color: input.data.color ?? null,
        is_drawable: input.data.is_drawable ?? true,
        has_levels: input.data.has_levels ?? false,
        level_template: input.data.level_template ?? null,
        is_floor: input.data.is_floor ?? false,
      }
      if (!row.code) throw new EdgeFunctionError('INVALID_INPUT', 'Code must contain a letter or digit')
      validateLevelTemplate(row.has_levels, row.level_template, await loadActiveRoleKeys(admin))

      const { data: created, error } = await admin.from('storage_types').insert(row as any).select().single()
      if (error) {
        if ((error as any).code === '23505') {
          throw new EdgeFunctionError('CONFLICT', `A storage type with code "${row.code}" already exists`)
        }
        throw new EdgeFunctionError('INTERNAL', error.message)
      }
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create', resource: 'storage_types',
        resourceId: String((created as any).id), after: created as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, storage_type: created }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // update / deactivate both need the existing row for the audit before-image.
    const { data: existing, error: fetchErr } = await admin
      .from('storage_types').select('*').eq('id', input.id).single()
    if (fetchErr || !existing) throw new EdgeFunctionError('NOT_FOUND', `Storage type ${input.id} not found`)

    const patch = input.action === 'deactivate' ? { is_active: false } : input.data
    if (input.action === 'update') {
      // Effective (merged) state — has_levels/level_template may each be
      // patched independently of the other across separate update calls.
      const effectiveHasLevels = input.data.has_levels ?? (existing as any).has_levels
      const effectiveTemplate = input.data.level_template !== undefined
        ? input.data.level_template
        : (existing as any).level_template
      validateLevelTemplate(effectiveHasLevels, effectiveTemplate, await loadActiveRoleKeys(admin))
    }
    const { data: updated, error: updErr } = await admin
      .from('storage_types').update(patch as any).eq('id', input.id).select().single()
    if (updErr || !updated) throw new EdgeFunctionError('INTERNAL', updErr?.message ?? 'Failed to update storage type')

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role,
      action: input.action === 'deactivate' ? 'delete' : 'update', resource: 'storage_types',
      resourceId: String(input.id), before: existing as Record<string, unknown>, after: updated as Record<string, unknown>,
      metadata: input.action === 'deactivate' ? { deactivated: true } : undefined,
    })

    // Retro-apply: push this form's capacity/weight onto every existing unit of
    // the type (the operator chose "Apply to all units" on the save prompt).
    let appliedCount = 0
    if (input.action === 'update' && input.apply_to_existing) {
      const u = updated as Record<string, unknown>
      const auditAfter: Record<string, unknown> = {}
      const auditMeta: Record<string, unknown> = { source: 'storage_type_retro_apply', storage_type_id: input.id }

      if (u.has_levels) {
        // A LEVELLED form's whole-unit figures describe the rack, not any one
        // level, so writing them across every location of the type would give
        // each level the WHOLE rack's capacity (mig 00072). Levels carry this
        // storage_type_id too — they're created with it in mutate-layout — so
        // the update has to be split by kind.
        //
        // 1. RACK parents hold no stock and no capacity of their own: the
        //    parent is a container, its levels are the places. Clear both.
        const { data: racks, error: rackErr } = await admin
          .from('locations')
          .update({ capacity_slots: null, weight_capacity_kg: null })
          .eq('storage_type_id', input.id).eq('kind', 'RACK')
          .select('id')
        if (rackErr) throw new EdgeFunctionError('INTERNAL', `Applied the type but failed to reset its racks: ${rackErr.message}`)

        // 2. Each level gets its own share, matched positionally by level_index.
        //    Levels beyond the template's length aren't described by the new
        //    standard, so `levelRetroPatches` omits them and they keep whatever
        //    per-rack override they were given.
        const { data: levelRows, error: lvlErr } = await admin
          .from('locations')
          .select('level_index')
          .eq('storage_type_id', input.id).eq('kind', 'SHELF').not('level_index', 'is', null)
        if (lvlErr) throw new EdgeFunctionError('INTERNAL', `Applied the type but failed to read its levels: ${lvlErr.message}`)

        const indices = (levelRows ?? []).map((r: any) => r.level_index as number)
        const patches = levelRetroPatches(u.level_template, indices)
        let levelsUpdated = 0
        for (const patch of patches) {
          const { data: affectedLevels, error: patchErr } = await admin
            .from('locations')
            .update({
              capacity_slots: patch.capacitySlots,
              slot_kind: patch.slotKind,
              weight_capacity_kg: patch.weightCapacityKg,
            })
            .eq('storage_type_id', input.id).eq('kind', 'SHELF').eq('level_index', patch.levelIndex)
            .select('id')
          if (patchErr) {
            throw new EdgeFunctionError('INTERNAL', `Applied the type but failed to update level ${patch.levelIndex}: ${patchErr.message}`)
          }
          levelsUpdated += (affectedLevels ?? []).length
        }

        // 3. Flat units of the same form — racks drawn BEFORE it gained levels
        //    (PALLET_RACK has 18 such BINs live). They are still whole units,
        //    so they still take the whole-unit figures, exactly as before.
        const { data: flats, error: flatErr } = await admin
          .from('locations')
          .update({ capacity_slots: u.default_capacity_slots ?? null, weight_capacity_kg: u.weight_capacity_kg ?? null })
          .eq('storage_type_id', input.id).neq('kind', 'RACK').is('level_index', null)
          .select('id')
        if (flatErr) throw new EdgeFunctionError('INTERNAL', `Applied the type but failed to update its unlevelled units: ${flatErr.message}`)

        appliedCount = (racks ?? []).length + levelsUpdated + (flats ?? []).length
        auditAfter.level_template = u.level_template ?? null
        auditAfter.capacity_slots = u.default_capacity_slots ?? null
        auditAfter.weight_capacity_kg = u.weight_capacity_kg ?? null
        auditMeta.leveled = true
        auditMeta.racks_reset = (racks ?? []).length
        auditMeta.levels_updated = levelsUpdated
        auditMeta.flat_units_updated = (flats ?? []).length
      } else {
        const { data: affected, error: applyErr } = await admin
          .from('locations')
          .update({ capacity_slots: u.default_capacity_slots ?? null, weight_capacity_kg: u.weight_capacity_kg ?? null })
          .eq('storage_type_id', input.id)
          .select('id')
        if (applyErr) throw new EdgeFunctionError('INTERNAL', `Applied the type but failed to update its units: ${applyErr.message}`)
        appliedCount = (affected ?? []).length
        auditAfter.capacity_slots = u.default_capacity_slots ?? null
        auditAfter.weight_capacity_kg = u.weight_capacity_kg ?? null
        auditMeta.leveled = false
      }

      // ── The names, once the figures have landed ─────────────────────────────
      //
      // `is_floor` and `slot_unit` are what decide a unit's NOUN (unitNoun), and
      // both are editable right here — so a form edit can leave 23 pallet spots
      // on a slab called `· Rack N`. `assignAutoNames` already recomposes on
      // every naming pass, but the only passes that run are `save_geometry`
      // (drafts) and the opt-in area cascades: on a PUBLISHED layout nothing
      // reaches them, and that is exactly how one bin sat reading "Rack" beside
      // 22 siblings reading "Pallet" (mig 00103).
      //
      // Deliberately inside `apply_to_existing`, and not run unconditionally:
      // this is the one branch where the operator has said "reach the units
      // already drawn with this", and it is the branch the save prompt describes.
      // Untick it and the names stay as they are until the next save that ticks
      // it — which is a re-runnable, idempotent repair rather than a lost one.
      //
      // Nothing is renumbered and no pool moves: `name_area`/`name_seq` are
      // echoed back unchanged, and `locations.code` — the barcode payload and the
      // scan identity — is not in this write at all.
      const restamped = await restampFormNames(
        admin,
        input.id,
        unitNoun({ isFloor: u.is_floor === true, slotUnit: (u.slot_unit as string | null) ?? null }),
      )
      if (restamped > 0) auditMeta.names_restamped = restamped

      auditMeta.units_updated = appliedCount
      if (appliedCount > 0 || restamped > 0) {
        await logAuditEvent(admin, {
          actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'locations',
          resourceId: String(input.id),
          after: auditAfter,
          metadata: auditMeta,
        })
      }
    }

    return new Response(JSON.stringify({ ok: true, storage_type: updated, applied_to_units: appliedCount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
