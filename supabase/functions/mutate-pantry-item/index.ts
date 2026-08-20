// mutate-pantry-item Edge Function
//
// Upsert / delete on `pantry_items`. Customers can mutate only their own
// HoReCa's pantry; reps, managers, and admins can mutate any HoReCa.
//
// `preferred_pack_size` is either null (single unit) or the matching
// product.carton_size (carton). Any other value is rejected.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { requireModule } from '../_shared/modules.ts'

const ALLOWED: ReadonlyArray<UserRole> = [
  'Admin',
  'Manager',
  'Field Sales Rep',
  'Office Sales Rep',
  'Restaurant/Hotel Customer',
]

const upsertDataSchema = z.object({
  horeca_id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  preferred_pack_size: z.number().int().positive().nullable(),
  default_quantity: z.number().int().min(1, 'default_quantity must be >= 1'),
})

const deleteDataSchema = z.object({
  horeca_id: z.number().int().positive(),
  product_id: z.number().int().positive(),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upsert'), data: upsertDataSchema }),
  z.object({ action: z.literal('delete'), data: deleteDataSchema }),
  // Convenience: support flat shape for delete too — `{ action, horeca_id, product_id }`
  z.object({
    action: z.literal('delete'),
    horeca_id: z.number().int().positive(),
    product_id: z.number().int().positive(),
  }),
])

interface PantryItemRow {
  id: number
  horeca_id: number
  product_id: number
  preferred_pack_size: number | null
  default_quantity: number
}

async function loadProductCartonSize(admin: SupabaseClient, productId: number): Promise<number> {
  const { data, error } = await admin
    .from('products')
    .select('id, carton_size')
    .eq('id', productId)
    .single()
  if (error || !data) {
    throw new EdgeFunctionError('NOT_FOUND', `Product ${productId} not found`)
  }
  return Number((data as { carton_size: number }).carton_size)
}

async function findExistingPantryItem(
  admin: SupabaseClient,
  horecaId: number,
  productId: number,
): Promise<PantryItemRow | null> {
  const { data, error } = await admin
    .from('pantry_items')
    .select('*')
    .eq('horeca_id', horecaId)
    .eq('product_id', productId)
    .maybeSingle()
  if (error) {
    throw new EdgeFunctionError('INTERNAL', error.message)
  }
  return (data as PantryItemRow) ?? null
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    requireModule('shop')
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Rate limit per user — pantry edits can be rapid (drag-resort, bulk
    // toggles) so 60 req/min is generous; meaningful guard against script
    // abuse from a compromised session.
    const rl = await checkRateLimit(`mutate-pantry-item:${auth.userId}`, { windowMs: 60_000, max: 60 })
    if (!rl.ok) {
      throw new EdgeFunctionError('TOO_MANY_REQUESTS', 'Rate limit exceeded')
    }

    const body = await req.json().catch(() => {
      throw new EdgeFunctionError('INVALID_INPUT', 'Request body must be valid JSON')
    })

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      throw new EdgeFunctionError('INVALID_INPUT', 'Invalid request body', parsed.error.flatten())
    }
    const input = parsed.data

    // Normalize delete shapes (flat vs. nested data) into a single shape.
    const horecaId =
      input.action === 'delete' && !('data' in input)
        ? input.horeca_id
        : input.action === 'delete'
          ? input.data.horeca_id
          : input.data.horeca_id
    const productId =
      input.action === 'delete' && !('data' in input)
        ? input.product_id
        : input.action === 'delete'
          ? input.data.product_id
          : input.data.product_id

    // Customer scope check: customers can only touch their own HoReCa pantry.
    if (auth.role === 'Restaurant/Hotel Customer') {
      if (auth.profile.horeca_id == null || auth.profile.horeca_id !== horecaId) {
        throw new EdgeFunctionError(
          'FORBIDDEN',
          'Customers can only mutate their own HoReCa pantry',
        )
      }
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )

    if (input.action === 'upsert') {
      const data = input.data

      // preferred_pack_size must be null or equal to product.carton_size
      if (data.preferred_pack_size !== null) {
        const cartonSize = await loadProductCartonSize(admin, data.product_id)
        if (data.preferred_pack_size !== cartonSize) {
          throw new EdgeFunctionError(
            'INVALID_INPUT',
            'preferred_pack_size must be null or equal to product.carton_size',
            {
              field: 'preferred_pack_size',
              expected: 'null or product.carton_size',
              productCartonSize: cartonSize,
              received: data.preferred_pack_size,
            },
          )
        }
      }

      const existing = await findExistingPantryItem(admin, data.horeca_id, data.product_id)

      if (existing) {
        const { data: updated, error: updateErr } = await admin
          .from('pantry_items')
          .update({
            preferred_pack_size: data.preferred_pack_size,
            default_quantity: data.default_quantity,
          } as any)
          .eq('id', existing.id)
          .select()
          .single()
        if (updateErr || !updated) {
          throw new EdgeFunctionError(
            'INTERNAL',
            updateErr?.message ?? 'Failed to update pantry item',
          )
        }

        await logAuditEvent(admin, {
          actorId: auth.userId,
          actorRole: auth.role,
          action: 'update',
          resource: 'pantry_items',
          resourceId: String(existing.id),
          before: existing as unknown as Record<string, unknown>,
          after: updated as Record<string, unknown>,
        })

        return new Response(JSON.stringify({ ok: true, pantryItem: updated, created: false }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: inserted, error: insertErr } = await admin
        .from('pantry_items')
        .insert(data as any)
        .select()
        .single()
      if (insertErr || !inserted) {
        throw new EdgeFunctionError(
          'INTERNAL',
          insertErr?.message ?? 'Failed to insert pantry item',
        )
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'pantry_items',
        resourceId: String((inserted as PantryItemRow).id),
        after: inserted as Record<string, unknown>,
      })

      return new Response(JSON.stringify({ ok: true, pantryItem: inserted, created: true }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // delete
    const existing = await findExistingPantryItem(admin, horecaId, productId)
    if (!existing) {
      throw new EdgeFunctionError(
        'NOT_FOUND',
        `Pantry item not found for horeca ${horecaId} / product ${productId}`,
      )
    }

    const { error: deleteErr } = await admin
      .from('pantry_items')
      .delete()
      .eq('id', existing.id)
    if (deleteErr) {
      throw new EdgeFunctionError('INTERNAL', deleteErr.message)
    }

    await logAuditEvent(admin, {
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'delete',
      resource: 'pantry_items',
      resourceId: String(existing.id),
      before: existing as unknown as Record<string, unknown>,
    })

    return new Response(JSON.stringify({ ok: true, deletedId: existing.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
