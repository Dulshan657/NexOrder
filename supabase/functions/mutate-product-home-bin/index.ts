// mutate-product-home-bin Edge Function
//
// Admin/Manager set or clear a product's default put-away bin for a racked
// warehouse (mig 00039 product_home_bins). The home bin is the first suggestion
// when putting stock away. Validates the bin sits inside the given (racked)
// warehouse. Direct writes to product_home_bins are RLS-blocked.
//
// Since mig 00082 the row is also the REPLENISHMENT config: min/max in base
// units, and a flag that turns the detector on for this slot. Enabling it
// requires a pick-zone level -- re-checked here so the operator gets a readable
// error, though the real enforcement is the table's trigger (service_role
// bypasses RLS but not triggers).
//
// `purpose` distinguishes several slots for one SKU in one warehouse; every
// existing caller means 'primary', which is the column default.
//
// `bulkSet` (onboarding gap H3) carries a whole warehouse's grid in one call.
// Setting min/max one product at a time through a product form is not work
// anybody completes for 200 SKUs, so replenishment stayed switched off and
// nothing said so. Three things about it are deliberate:
//
//  * `replenEnabled` is CALL-LEVEL, not per-row. It maps onto the two things the
//    operator actually does -- save the numbers, then arm them as a separate
//    act -- and PostgREST needs a uniform key set across an upsert batch anyway.
//    Omitting it leaves the column untouched on existing rows and false (its
//    default) on new ones, which is exactly right for "just save the numbers".
//  * EVERY row is validated BEFORE anything is written, by the same pure module
//    the grid runs. product_home_bins' two CHECKs and its pick-zone trigger
//    abort the whole statement on one bad row, so a single typo would otherwise
//    discard 199 good ones.
//  * A refused row is REPORTED, never fatal -- same posture as count-bin.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { MAX_BULK_REPLEN_ROWS, validateReplenRow } from '../_shared/wie/replenPolicy.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

/**
 * Failure details that NAME THE FIELD. `error.flatten()` collapses a nested path
 * onto its top-level key, which for a 200-row payload would tell the operator
 * only "Invalid request body" when the real fault is `rows.87.maxQty`.
 */
function validationIssues(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    productId: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    binId: z.number().int().positive(),
    purpose: z.string().min(1).max(32).optional(),
    // Base units. null clears the figure; omitted leaves it untouched.
    minQty: z.number().nonnegative().nullable().optional(),
    maxQty: z.number().nonnegative().nullable().optional(),
    replenEnabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('clear'),
    productId: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    purpose: z.string().min(1).max(32).optional(),
  }),
  z.object({
    action: z.literal('bulkSet'),
    warehouseId: z.number().int().positive(),
    purpose: z.string().min(1).max(32).optional(),
    // Omitted = leave replen_enabled exactly as it is. true arms, false disarms.
    replenEnabled: z.boolean().optional(),
    rows: z
      .array(
        z.object({
          productId: z.number().int().positive(),
          binId: z.number().int().positive(),
          // `.nullish()`, never `.optional()`: these back NULLABLE columns and
          // the client sends `?? null` for a cleared figure. `.optional()`
          // accepts undefined and REJECTS null, and with `strict` off nothing
          // local would tell you -- the mutate-layout levelSchema incident.
          minQty: z.number().nonnegative().nullish(),
          maxQty: z.number().nonnegative().nullish(),
        }),
      )
      .min(1, 'Send at least one row')
      .max(MAX_BULK_REPLEN_ROWS, `A bulk save may carry at most ${MAX_BULK_REPLEN_ROWS} rows`),
  }),
])

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('inventory_dispatch')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // The body is read before the limiter because the bucket depends on the
    // action: one `bulkSet` carries up to 200 rows, so it cannot share an
    // allowance with single-row edits. Same reasoning as count-bin's 20/min for
    // a call that carries a whole location. The caller is already authenticated
    // and role-checked above.
    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', validationIssues(parsed.error))
    }
    const input = parsed.data

    const isBulk = input.action === 'bulkSet'
    const rl = await checkRateLimit(
      `mutate-product-home-bin${isBulk ? ':bulk' : ''}:${auth.userId}`,
      { windowMs: 60_000, max: isBulk ? 10 : 30 },
    )
    if (!rl.ok) {
      throw new EdgeFunctionError(
        'TOO_MANY_REQUESTS',
        `Rate limit exceeded; try again in ${Math.ceil(rl.resetMs / 1000)}s`,
      )
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    if (input.action === 'clear') {
      await admin.from('product_home_bins').delete()
        .eq('product_id', input.productId).eq('warehouse_id', input.warehouseId)
        .eq('purpose', input.purpose ?? 'primary')
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'delete', resource: 'product_home_bins',
        resourceId: `${input.productId}:${input.warehouseId}`, after: null,
      })
      return new Response(JSON.stringify({ ok: true, cleared: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (input.action === 'bulkSet') {
      const purpose = input.purpose ?? 'primary'

      const { data: bulkWh } = await admin.from('locations')
        .select('materialized_path, location_type')
        .eq('id', input.warehouseId).eq('kind', 'WAREHOUSE').single()
      if (!bulkWh) throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
      if ((bulkWh as any).location_type !== 'racked') {
        throw new EdgeFunctionError('CONFLICT', 'Home bins apply only to racked warehouses')
      }
      const bulkPath = (bulkWh as any).materialized_path as string

      // Three reads, then all the judging happens in memory. Per-row queries
      // would be 600 round trips for a full grid.
      const [{ data: siteLocs }, { data: roles }, { data: existing }] = await Promise.all([
        admin.from('locations').select('id, level_role, is_active')
          .like('materialized_path', `${bulkPath}/%`),
        admin.from('level_roles').select('key, is_pick_zone, is_active'),
        admin.from('product_home_bins').select('product_id, replen_enabled')
          .eq('warehouse_id', input.warehouseId).eq('purpose', purpose)
          .in('product_id', input.rows.map((r) => r.productId)),
      ])

      const pickZoneKeys = new Set(
        ((roles ?? []) as any[]).filter((r) => r.is_pick_zone && r.is_active).map((r) => r.key),
      )
      // Inactive bins are kept, separately, so a retired bin is refused with the
      // reason it was actually refused for rather than "not in this warehouse".
      const binRole = new Map<number, string | null>()
      const inactiveBins = new Set<number>()
      for (const loc of (siteLocs ?? []) as any[]) {
        if (loc.is_active) binRole.set(loc.id, loc.level_role ?? null)
        else inactiveBins.add(loc.id)
      }
      const armedNow = new Map<number, boolean>(
        ((existing ?? []) as any[]).map((r) => [r.product_id, Boolean(r.replen_enabled)]),
      )

      const failed: Array<{ productId: number; reason: string }> = []
      const payload: Array<Record<string, unknown>> = []
      const seen = new Set<number>()

      for (const row of input.rows) {
        // A duplicated product would make ON CONFLICT hit the same key twice in
        // one statement, which Postgres refuses outright ("cannot affect row a
        // second time") -- and it would take the other 199 rows down with it.
        if (seen.has(row.productId)) {
          failed.push({ productId: row.productId, reason: 'Sent twice in the same save.' })
          continue
        }
        seen.add(row.productId)

        if (inactiveBins.has(row.binId)) {
          failed.push({ productId: row.productId, reason: 'That bin is no longer active.' })
          continue
        }

        const role = binRole.get(row.binId)
        const verdict = validateReplenRow({
          binId: row.binId,
          binInWarehouse: binRole.has(row.binId),
          binIsPickZone: role != null && pickZoneKeys.has(role),
          minQty: row.minQty ?? null,
          maxQty: row.maxQty ?? null,
          // Omitting replenEnabled leaves the column alone, so the row stays as
          // armed as it already was -- and an armed row still has to satisfy the
          // pick-zone rule even when nobody is arming anything.
          arming: input.replenEnabled ?? armedNow.get(row.productId) ?? false,
        })
        if (!verdict.ok) {
          failed.push({ productId: row.productId, reason: verdict.reason ?? 'Refused.' })
          continue
        }

        // Uniform keys across the batch: PostgREST builds one statement from the
        // first row's shape, so a row missing a key would silently drop it for
        // everyone.
        const record: Record<string, unknown> = {
          product_id: row.productId,
          warehouse_id: input.warehouseId,
          bin_id: row.binId,
          purpose,
          min_qty: row.minQty ?? null,
          max_qty: row.maxQty ?? null,
          updated_by: auth.userId,
        }
        if (input.replenEnabled !== undefined) record.replen_enabled = input.replenEnabled
        payload.push(record)
      }

      let applied = 0
      if (payload.length > 0) {
        const { error: bulkError } = await admin.from('product_home_bins')
          .upsert(payload as any, { onConflict: 'product_id,warehouse_id,purpose' })
        if (bulkError) {
          // Pre-validation should have caught everything the CHECKs and the
          // trigger enforce, so landing here means the database knows something
          // this function does not. Report it whole rather than pretending rows
          // were written.
          throw new EdgeFunctionError('CONFLICT', bulkError.message)
        }
        applied = payload.length
      }

      // ONE event for the batch. Two hundred audit rows for one operator action
      // buries the log without saying anything the batch does not.
      await logAuditEvent(admin, {
        actorId: auth.userId, actorRole: auth.role, action: 'update',
        resource: 'product_home_bins_bulk', resourceId: String(input.warehouseId),
        after: {
          applied,
          refused: failed.length,
          replenEnabled: input.replenEnabled ?? null,
          productIds: payload.map((r) => r.product_id),
        },
      })

      return new Response(JSON.stringify({ ok: true, applied, failed }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate the bin lives inside the (racked) warehouse via materialized_path.
    const { data: wh } = await admin.from('locations').select('materialized_path, location_type').eq('id', input.warehouseId).eq('kind', 'WAREHOUSE').single()
    if (!wh) throw new EdgeFunctionError('NOT_FOUND', 'Warehouse not found')
    if ((wh as any).location_type !== 'racked') throw new EdgeFunctionError('CONFLICT', 'Home bins apply only to racked warehouses')

    const { data: bin } = await admin.from('locations').select('id, materialized_path').eq('id', input.binId).single()
    if (!bin) throw new EdgeFunctionError('NOT_FOUND', 'Bin not found')
    const whPath = (wh as any).materialized_path as string
    if (!String((bin as any).materialized_path).startsWith(`${whPath}/`)) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Bin is not inside the given warehouse')
    }

    // Replenishment needs a pick-zone level as its destination. The trigger on
    // the table refuses this anyway; checking first turns a raw plpgsql string
    // into something an operator can act on.
    if (input.replenEnabled) {
      const { data: pickZone } = await admin
        .from('locations')
        .select('id, code, level_role, level_roles!inner(is_pick_zone, is_active)')
        .eq('id', input.binId)
        .maybeSingle()
      const role = (pickZone as any)?.level_roles
      if (!role?.is_pick_zone || !role?.is_active) {
        throw new EdgeFunctionError(
          'CONFLICT',
          'Replenishment refills a pick zone, so the home bin has to be a pick-zone level. ' +
            'Choose a pick-zone level, or change the role on this one first.',
          { reason: 'not_pick_zone' },
        )
      }
    }

    const row: Record<string, unknown> = {
      product_id: input.productId,
      warehouse_id: input.warehouseId,
      bin_id: input.binId,
      purpose: input.purpose ?? 'primary',
      updated_by: auth.userId,
    }
    if (input.minQty !== undefined) row.min_qty = input.minQty
    if (input.maxQty !== undefined) row.max_qty = input.maxQty
    if (input.replenEnabled !== undefined) row.replen_enabled = input.replenEnabled

    const { data: upserted, error } = await admin
      .from('product_home_bins')
      .upsert(row as any, { onConflict: 'product_id,warehouse_id,purpose' })
      .select()
      .single()
    if (error || !upserted) {
      const msg = error?.message ?? 'Failed to set home bin'
      // The table's CHECKs and its pick-zone trigger surface here.
      if (/INVALID_BIN|product_home_bins_(minmax|replen_config)_check/.test(msg)) {
        throw new EdgeFunctionError(
          'CONFLICT',
          msg.includes('INVALID_BIN')
            ? 'Replenishment needs a pick-zone level as its home bin.'
            : 'Replenishment needs a minimum and a maximum, with the maximum higher than the minimum.',
        )
      }
      throw new EdgeFunctionError('INTERNAL', msg)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId, actorRole: auth.role, action: 'update', resource: 'product_home_bins',
      resourceId: `${input.productId}:${input.warehouseId}`, after: upserted as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ ok: true, homeBin: upserted }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
