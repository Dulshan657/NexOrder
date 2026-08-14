// mutate-warehouse Edge Function
//
// Admin/Manager-only create / update / deactivate of WAREHOUSE-kind locations
// (mig 00036). Warehouses are never hard-deleted (they anchor inventory_balances
// and historical movements) — they are deactivated. A bulk<->racked type flip is
// blocked while the warehouse still holds stock. Direct writes to `locations` are
// RLS-blocked; only the service role (this function) can mutate them.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { requireModule } from '../_shared/modules.ts'
import { SHEET_PRESETS, type SheetPresetName } from '../_shared/labelSheet.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const coord = z.number().gte(-180).lte(180)

const warehouseCreateSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  location_type: z.enum(['bulk', 'racked']).default('bulk'),
  lat: coord.optional(),
  lng: coord.optional(),
  address: z.string().max(500).optional(),
  contact: z.string().max(200).optional(),
  hours: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
})

const warehouseUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    location_type: z.enum(['bulk', 'racked']).optional(),
    lat: coord.nullable().optional(),
    lng: coord.nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    contact: z.string().max(200).nullable().optional(),
    hours: z.string().max(200).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided for update',
  })

/**
 * Which sticker stock this site prints each sheet group on (mig 00106).
 *
 * `preset` is validated against the preset library rather than a restated list,
 * so adding a stock is one edit. A null clears the preference and restores the
 * built-in default from SHEET_GROUPS — deleting the row rather than writing a
 * sentinel, so "unset" has exactly one representation.
 */
const labelPrefsSchema = z.object({
  warehouseId: z.number().int().positive(),
  prefs: z
    .array(
      z.object({
        sheetGroup: z.enum(['wayfinding', 'slots', 'staging']),
        preset: z
          .enum(Object.keys(SHEET_PRESETS) as [SheetPresetName, ...SheetPresetName[]])
          .nullable(),
      }),
    )
    .min(1)
    .max(3),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: warehouseCreateSchema }),
  z.object({ action: z.literal('update'), id: z.number().int().positive(), data: warehouseUpdateSchema }),
  z.object({ action: z.literal('deactivate'), id: z.number().int().positive() }),
  z.object({ action: z.literal('set_label_prefs'), data: labelPrefsSchema }),
])

/** True when the warehouse (or any descendant location) still holds on_hand stock. */
async function hasStock(admin: any, warehouseId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('inventory_balances')
    .select('id, on_hand, locations!inner(id, materialized_path)')
    .gt('on_hand', 0)
    .eq('location_id', warehouseId)
    .limit(1)
  if (error) throw new EdgeFunctionError('INTERNAL', error.message)
  if (data && data.length > 0) return true
  // descendant bins (racked) — match by materialized_path prefix
  const { data: wh } = await admin.from('locations').select('materialized_path').eq('id', warehouseId).single()
  const path = (wh as any)?.materialized_path as string | undefined
  if (!path) return false
  const { data: kids } = await admin
    .from('locations')
    .select('id')
    .like('materialized_path', `${path}/%`)
  const childIds = ((kids ?? []) as any[]).map((k) => k.id)
  if (childIds.length === 0) return false
  const { data: childBal } = await admin
    .from('inventory_balances')
    .select('id')
    .gt('on_hand', 0)
    .in('location_id', childIds)
    .limit(1)
  return !!(childBal && childBal.length > 0)
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-warehouse:${auth.userId}`, {
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
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const input = parsed.data

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    if (input.action === 'set_label_prefs') {
      const { warehouseId, prefs } = input.data

      const { data: warehouse } = await admin
        .from('locations')
        .select('id, kind, name')
        .eq('id', warehouseId)
        .maybeSingle()
      if (!warehouse || (warehouse as any).kind !== 'WAREHOUSE') {
        throw new EdgeFunctionError('INVALID_INPUT', 'That id is not a warehouse.')
      }

      // A null preset clears the row rather than storing a sentinel, so "use
      // the built-in default" has exactly one representation in the table.
      const cleared = prefs.filter((p) => p.preset === null).map((p) => p.sheetGroup)
      const set = prefs.filter((p) => p.preset !== null)

      if (cleared.length > 0) {
        const { error } = await admin
          .from('warehouse_label_prefs')
          .delete()
          .eq('warehouse_id', warehouseId)
          .in('sheet_group', cleared)
        if (error) throw new EdgeFunctionError('INTERNAL', error.message)
      }

      if (set.length > 0) {
        const { error } = await admin.from('warehouse_label_prefs').upsert(
          set.map((p) => ({
            warehouse_id: warehouseId,
            sheet_group: p.sheetGroup,
            preset: p.preset,
            updated_at: new Date().toISOString(),
            updated_by: auth.userId,
          })),
          { onConflict: 'warehouse_id,sheet_group' },
        )
        if (error) throw new EdgeFunctionError('INTERNAL', error.message)
      }

      // One event per call, not one per group: the operator made one decision.
      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'warehouse_label_prefs',
        resourceId: String(warehouseId),
        after: { warehouse: (warehouse as any).name, prefs },
      })

      return new Response(JSON.stringify({ ok: true, warehouseId, prefs }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (input.action === 'create') {
      const row = {
        parent_id: null,
        kind: 'WAREHOUSE' as const,
        code: input.data.code,
        name: input.data.name,
        location_type: input.data.location_type,
        lat: input.data.lat ?? null,
        lng: input.data.lng ?? null,
        address: input.data.address ?? null,
        contact: input.data.contact ?? null,
        hours: input.data.hours ?? null,
        notes: input.data.notes ?? null,
        materialized_path: input.data.code, // root warehouse path = its code
        is_active: true,
      }
      const { data: created, error } = await admin.from('locations').insert(row as any).select().single()
      if (error || !created) {
        if (error?.code === '23505') {
          throw new EdgeFunctionError('CONFLICT', `Warehouse code "${input.data.code}" already exists`)
        }
        throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to create warehouse')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'create',
        resource: 'locations', resourceId: String((created as any).id),
        after: created as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, warehouse: created }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // load existing (update + deactivate)
    const { data: existing, error: fetchErr } = await admin
      .from('locations')
      .select('*')
      .eq('id', input.id)
      .eq('kind', 'WAREHOUSE')
      .single()
    if (fetchErr || !existing) {
      throw new EdgeFunctionError('NOT_FOUND', `Warehouse ${input.id} not found`)
    }

    if (input.action === 'update') {
      // Block a storage-model flip while stock is on hand (re-slot first).
      if (
        input.data.location_type &&
        input.data.location_type !== (existing as any).location_type &&
        (await hasStock(admin, input.id))
      ) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Cannot change warehouse type while it still holds stock — move/transfer the stock out first',
        )
      }

      const { data: updated, error: updateErr } = await admin
        .from('locations')
        .update(input.data as any)
        .eq('id', input.id)
        .select()
        .single()
      if (updateErr || !updated) {
        throw new EdgeFunctionError('INTERNAL', updateErr?.message ?? 'Failed to update warehouse')
      }
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update',
        resource: 'locations', resourceId: String(input.id),
        before: existing as Record<string, unknown>, after: updated as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true, warehouse: updated }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // deactivate
    if (await hasStock(admin, input.id)) {
      throw new EdgeFunctionError(
        'CONFLICT',
        'Cannot deactivate a warehouse that still holds stock — transfer it out first',
      )
    }
    const { data: deactivated, error: deErr } = await admin
      .from('locations')
      .update({ is_active: false })
      .eq('id', input.id)
      .select()
      .single()
    if (deErr || !deactivated) {
      throw new EdgeFunctionError('INTERNAL', deErr?.message ?? 'Failed to deactivate warehouse')
    }
    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update',
      resource: 'locations', resourceId: String(input.id),
      before: existing as Record<string, unknown>, after: deactivated as Record<string, unknown>,
      metadata: { deactivated: true },
    })
    return new Response(JSON.stringify({ ok: true, warehouse: deactivated }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
