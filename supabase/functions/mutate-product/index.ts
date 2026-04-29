// mutate-product Edge Function
//
// Admin and Manager can create, update, or delete products.
// The `inventory` field is always stripped from incoming data (inventory is
// managed exclusively by place-order / purchase-order flows).
//
// Business rules:
//   - price >= 0
//   - carton_size >= 1
//   - SKU must be unique on insert (409 CONFLICT if duplicate)
//   - Delete: blocked if any pantry_items reference the product (409 CONFLICT),
//     returns hasPantryReferences + count + sample HoReCa names

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { requireAuth, type UserRole } from '../_shared/auth.ts'
import { EdgeFunctionError, errorResponse, isEdgeFunctionError } from '../_shared/errors.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeaders } from '../_shared/cors.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const categoryEnum = z.enum([
  'Coconut',
  'Meal Pastes',
  'Asian Sauces',
  'Soy Sauces',
  'Chilli Sauces',
  'Condiments',
  'Noodles',
  'Fish',
  'Satay Sauces',
  'Desserts',
  'Ready Meal Sauces',
  'Other',
])

// Shared body — inventory is never accepted (stripped silently)
const productBodySchema = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  price: z.number().min(0).optional(),
  category: categoryEnum.optional(),
  image_url: z.string().url().nullable().optional(),
  unit: z.string().min(1).optional(),
  carton_size: z.number().int().min(1).optional(),
  dietary_labels: z.array(z.string()).nullable().optional(),
  supplier_id: z.number().int().positive().optional(),
  cubic_meters_unit: z.number().min(0).nullable().optional(),
  cubic_meters_carton: z.number().min(0).nullable().optional(),
  length_cm: z.number().min(0).nullable().optional(),
  width_cm: z.number().min(0).nullable().optional(),
  height_cm: z.number().min(0).nullable().optional(),
  // inventory intentionally excluded
})

// Required fields for create
const productCreateBodySchema = productBodySchema.extend({
  sku: z.string().min(1),
  name: z.string().min(1),
  price: z.number().min(0),
  category: categoryEnum,
  unit: z.string().min(1),
  carton_size: z.number().int().min(1),
  supplier_id: z.number().int().positive(),
})

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: productCreateBodySchema }),
  z.object({
    action: z.literal('update'),
    id: z.number().int().positive(),
    data: productBodySchema,
  }),
  z.object({ action: z.literal('delete'), id: z.number().int().positive() }),
])

// Strip the inventory field from any incoming data object to prevent callers
// from modifying stock levels through this function.
function stripInventory<T extends Record<string, unknown>>(data: T): Omit<T, 'inventory'> {
  const { inventory: _stripped, ...rest } = data as any
  return rest
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

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
      const safeData = stripInventory(input.data as Record<string, unknown>)

      // SKU uniqueness check
      const { data: existingSku, error: skuError } = await admin
        .from('products')
        .select('id')
        .eq('sku', safeData.sku as string)
        .maybeSingle()

      if (skuError) {
        throw new EdgeFunctionError('INTERNAL', `SKU lookup failed: ${skuError.message}`)
      }

      if (existingSku) {
        throw new EdgeFunctionError(
          'CONFLICT',
          `A product with SKU "${safeData.sku}" already exists`,
          { sku: safeData.sku },
        )
      }

      // New products start with 0 inventory — inventory is never taken from input
      const insertData = { ...safeData, inventory: 0 }

      const { data: createdRow, error: insertError } = await admin
        .from('products')
        .insert(insertData as any)
        .select()
        .single()

      if (insertError || !createdRow) {
        throw new EdgeFunctionError('INTERNAL', insertError?.message ?? 'Failed to create product')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'product',
        resourceId: String((createdRow as any).id),
        after: createdRow as Record<string, unknown>,
      })

      return new Response(
        JSON.stringify({ ok: true, product: createdRow }),
        {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ---- UPDATE ----
    if (input.action === 'update') {
      const { data: existingRow, error: fetchError } = await admin
        .from('products')
        .select('*')
        .eq('id', input.id)
        .single()

      if (fetchError || !existingRow) {
        throw new EdgeFunctionError('NOT_FOUND', `Product ${input.id} not found`)
      }

      const beforeData = existingRow as Record<string, unknown>
      const safeData = stripInventory(input.data as Record<string, unknown>)

      // If SKU is being changed, ensure uniqueness
      if (safeData.sku && safeData.sku !== (beforeData.sku as string)) {
        const { data: skuConflict, error: skuError } = await admin
          .from('products')
          .select('id')
          .eq('sku', safeData.sku as string)
          .maybeSingle()

        if (skuError) {
          throw new EdgeFunctionError('INTERNAL', `SKU lookup failed: ${skuError.message}`)
        }

        if (skuConflict) {
          throw new EdgeFunctionError(
            'CONFLICT',
            `A product with SKU "${safeData.sku}" already exists`,
            { sku: safeData.sku },
          )
        }
      }

      const { data: updatedRow, error: updateError } = await admin
        .from('products')
        .update(safeData as any)
        .eq('id', input.id)
        .select()
        .single()

      if (updateError || !updatedRow) {
        throw new EdgeFunctionError('INTERNAL', updateError?.message ?? 'Failed to update product')
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'product',
        resourceId: String(input.id),
        before: beforeData,
        after: updatedRow as Record<string, unknown>,
      })

      return new Response(
        JSON.stringify({ ok: true, product: updatedRow }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // ---- DELETE ----
    if (input.action === 'delete') {
      const { data: existingRow, error: fetchError } = await admin
        .from('products')
        .select('*')
        .eq('id', input.id)
        .single()

      if (fetchError || !existingRow) {
        throw new EdgeFunctionError('NOT_FOUND', `Product ${input.id} not found`)
      }

      const beforeData = existingRow as Record<string, unknown>

      // Check for pantry references — fetch up to 5 horeca names for the error detail
      const { data: pantryRefs, error: pantryError } = await admin
        .from('pantry_items')
        .select('id, horeca_id')
        .eq('product_id', input.id)

      if (pantryError) {
        throw new EdgeFunctionError('INTERNAL', `Failed to query pantry_items: ${pantryError.message}`)
      }

      const pantryCount = (pantryRefs ?? []).length

      if (pantryCount > 0) {
        // Resolve HoReCa names for a sample of up to 5 references
        const sampleHoRecaIds = [...new Set((pantryRefs ?? []).slice(0, 5).map((r: any) => r.horeca_id))]
        const { data: horecaRows } = await admin
          .from('horecas')
          .select('id, name')
          .in('id', sampleHoRecaIds)

        const sampleNames = (horecaRows ?? []).map((h: any) => h.name)

        throw new EdgeFunctionError(
          'CONFLICT',
          'Cannot delete a product that is referenced by active pantry entries',
          { hasPantryReferences: true, count: pantryCount, sample: sampleNames },
        )
      }

      const { error: deleteError } = await admin
        .from('products')
        .delete()
        .eq('id', input.id)

      if (deleteError) {
        throw new EdgeFunctionError('INTERNAL', deleteError.message)
      }

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'delete',
        resource: 'product',
        resourceId: String(input.id),
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

    // Unreachable
    throw new EdgeFunctionError('INVALID_INPUT', 'Unrecognised action')
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse()
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error')
  }
})
