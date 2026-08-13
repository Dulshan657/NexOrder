// mutate-promotion Edge Function
//
// Admin and Manager can create, update, or delete promotions.
//
// Business rules:
//   - start_date <= end_date (when both are provided)
//   - percent_off in 0–100 (when provided)
//   - If the promotion type is 'bogo' and bogo_config.buyProductId resolves to a
//     product with carton_size <= 1, and the caller requests applies_to='carton',
//     the write is rejected.
//   - A promotion that has already been applied to at least one non-cancelled
//     order is immutable: update and delete are both blocked (409 CONFLICT).

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

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

// ---- Zod helpers ----

const promotionTypeEnum = z.enum(['percentage', 'fixed_price', 'bogo', 'bundle', 'clearance'])

// Shared promotion body — all fields optional for partial update
const promotionBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  type: promotionTypeEnum.optional(),
  percent_off: z.number().min(0).max(100).nullable().optional(),
  fixed_price: z.number().min(0).nullable().optional(),
  bogo_config: z.unknown().nullable().optional(),
  bundle_config: z.unknown().nullable().optional(),
  clearance_percent: z.number().min(0).max(100).nullable().optional(),
  scope: z.unknown().optional(),
  targeting: z.unknown().optional(),
  min_order_value: z.number().min(0).nullable().optional(),
  stack_with_horeca_pricing: z.boolean().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  created_by: z.string().optional(),
  priority: z.number().int().optional(),
  // Frontend-level field captured in spec; not a DB column — used for carton check
  applies_to: z.enum(['unit', 'carton']).optional(),
})

// Required fields when creating
const promotionCreateBodySchema = promotionBodySchema.extend({
  name: z.string().min(1),
  type: promotionTypeEnum,
  scope: z.unknown(),
  targeting: z.unknown(),
  stack_with_horeca_pricing: z.boolean(),
  is_active: z.boolean(),
  created_by: z.string(),
  priority: z.number().int(),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: promotionCreateBodySchema }),
  z.object({ action: z.literal('update'), id: z.string().uuid(), data: promotionBodySchema }),
  z.object({ action: z.literal('delete'), id: z.string().uuid() }),
])

// ---- Helpers ----

function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

async function assertNotUsedInOrders(
  admin: ReturnType<typeof createClient>,
  promoId: string,
): Promise<void> {
  // applied_promotions stores a JSON array. We check if any element contains
  // the promoId using the Postgres JSONB containment operator via a raw RPC
  // or a filter. supabase-js doesn't expose @> natively, so we use a stored
  // procedure approach via .rpc, or fall back to fetching rows and filtering
  // in JS. Using count + filter is safer for correctness.
  //
  // We use textSearch via .ilike on the JSON cast for simplicity:
  // applied_promotions::text ILIKE '%<promoId>%'
  // This may have false positives for overlapping UUID substrings, which is
  // effectively impossible but we double-check the actual JSON value too.
  const { data, error } = await admin
    .from('orders')
    .select('id, applied_promotions')
    .neq('status', 'cancelled')
    .not('applied_promotions', 'is', null)

  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Failed to query orders: ${error.message}`)
  }

  const usedInOrders = (data ?? []).filter((row: any) => {
    const ap = row.applied_promotions
    if (!ap) return false
    // applied_promotions is a JSON array of objects; each may have promoId or promotionId
    if (Array.isArray(ap)) {
      return ap.some(
        (entry: any) =>
          entry?.promoId === promoId ||
          entry?.promotionId === promoId ||
          entry?.id === promoId,
      )
    }
    return false
  })

  if (usedInOrders.length > 0) {
    throw new EdgeFunctionError(
      'CONFLICT',
      'This promotion has already been applied to confirmed orders and cannot be modified or deleted',
      { usedInOrderCount: usedInOrders.length, firstOrderId: usedInOrders[0].id },
    )
  }
}

async function assertCartonProductValid(
  admin: ReturnType<typeof createClient>,
  appliesTo: string | undefined,
  type: string | undefined,
  bogoConfig: unknown,
  bundleConfig: unknown,
): Promise<void> {
  if (appliesTo !== 'carton') return
  if (type !== 'bogo' && type !== 'bundle') return

  const productIds: number[] = []

  if (type === 'bogo' && bogoConfig && typeof bogoConfig === 'object') {
    const cfg = bogoConfig as Record<string, unknown>
    if (typeof cfg.buyProductId === 'number') productIds.push(cfg.buyProductId)
    if (typeof cfg.getProductId === 'number' && cfg.getProductId !== cfg.buyProductId) {
      productIds.push(cfg.getProductId as number)
    }
  }

  if (type === 'bundle' && bundleConfig && typeof bundleConfig === 'object') {
    const cfg = bundleConfig as Record<string, unknown>
    if (Array.isArray(cfg.productIds)) {
      for (const id of cfg.productIds) {
        if (typeof id === 'number') productIds.push(id)
      }
    }
  }

  if (productIds.length === 0) return

  const { data, error } = await admin
    .from('products')
    .select('id, carton_size')
    .in('id', productIds)

  if (error) {
    throw new EdgeFunctionError('INTERNAL', `Failed to query products: ${error.message}`)
  }

  const invalidProducts = (data ?? []).filter((p: any) => (p.carton_size ?? 1) <= 1)
  if (invalidProducts.length > 0) {
    throw new EdgeFunctionError(
      'INVALID_INPUT',
      'Promotion applies_to=carton but one or more target products have carton_size <= 1',
      { invalidProductIds: invalidProducts.map((p: any) => p.id) },
    )
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('sales_orders')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-promotion:${auth.userId}`, {
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

    // ---- CREATE ----
    if (input.action === 'create') {
      const d = input.data as any

      // Date range validation
      const startDate = parseDateOrNull(d.start_date)
      const endDate = parseDateOrNull(d.end_date)
      if (startDate && endDate && startDate > endDate) {
        throw new EdgeFunctionError('INVALID_INPUT', 'start_date must be on or before end_date')
      }

      // Carton validation
      await assertCartonProductValid(admin, d.applies_to, d.type, d.bogo_config, d.bundle_config)

      // Strip client-only field before writing
      const { applies_to: _appliesTo, ...insertData } = d

      const { data: createdRow, error: insertError } = await admin
        .from('promotions')
        .insert(insertData as any)
        .select()
        .single()

      if (insertError || !createdRow) {
        throw new EdgeFunctionError('INTERNAL', insertError?.message ?? 'Failed to create promotion')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'promotion',
        resourceId: (createdRow as any).id,
        after: createdRow as Record<string, unknown>,
      })

      return new Response(
        JSON.stringify({ ok: true, promotion: createdRow }),
        {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ---- UPDATE ----
    if (input.action === 'update') {
      // Fetch existing for before_data and immutability check
      const { data: existingRow, error: fetchError } = await admin
        .from('promotions')
        .select('*')
        .eq('id', input.id)
        .single()

      if (fetchError || !existingRow) {
        throw new EdgeFunctionError('NOT_FOUND', `Promotion ${input.id} not found`)
      }

      const beforeData = existingRow as Record<string, unknown>

      // Immutability check
      await assertNotUsedInOrders(admin, input.id)

      const d = input.data as any

      // Date range validation — merge with existing values
      const existing = existingRow as any
      const startDate = parseDateOrNull(d.start_date !== undefined ? d.start_date : existing.start_date)
      const endDate = parseDateOrNull(d.end_date !== undefined ? d.end_date : existing.end_date)
      if (startDate && endDate && startDate > endDate) {
        throw new EdgeFunctionError('INVALID_INPUT', 'start_date must be on or before end_date')
      }

      // Carton validation — merge with existing values
      const effectiveType = d.type ?? existing.type
      const effectiveAppliesTo = d.applies_to ?? undefined
      const effectiveBogoConfig = d.bogo_config !== undefined ? d.bogo_config : existing.bogo_config
      const effectiveBundleConfig = d.bundle_config !== undefined ? d.bundle_config : existing.bundle_config
      await assertCartonProductValid(admin, effectiveAppliesTo, effectiveType, effectiveBogoConfig, effectiveBundleConfig)

      // Strip client-only field before writing
      const { applies_to: _appliesTo, ...updateData } = d

      const { data: updatedRow, error: updateError } = await admin
        .from('promotions')
        .update(updateData as any)
        .eq('id', input.id)
        .select()
        .single()

      if (updateError || !updatedRow) {
        throw new EdgeFunctionError('INTERNAL', updateError?.message ?? 'Failed to update promotion')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'promotion',
        resourceId: input.id,
        before: beforeData,
        after: updatedRow as Record<string, unknown>,
      })

      return new Response(
        JSON.stringify({ ok: true, promotion: updatedRow }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ---- DELETE ----
    if (input.action === 'delete') {
      const { data: existingRow, error: fetchError } = await admin
        .from('promotions')
        .select('*')
        .eq('id', input.id)
        .single()

      if (fetchError || !existingRow) {
        throw new EdgeFunctionError('NOT_FOUND', `Promotion ${input.id} not found`)
      }

      const beforeData = existingRow as Record<string, unknown>

      // Immutability check
      await assertNotUsedInOrders(admin, input.id)

      const { error: deleteError } = await admin
        .from('promotions')
        .delete()
        .eq('id', input.id)

      if (deleteError) {
        throw new EdgeFunctionError('INTERNAL', deleteError.message)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'delete',
        resource: 'promotion',
        resourceId: input.id,
        before: beforeData,
      })

      return new Response(
        JSON.stringify({ ok: true }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Unreachable — discriminatedUnion enforces exhaustiveness
    throw new EdgeFunctionError('INVALID_INPUT', 'Unrecognised action')
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
