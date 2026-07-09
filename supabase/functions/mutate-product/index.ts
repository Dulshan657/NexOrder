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
import { checkRateLimit } from '../_shared/rateLimit.ts'
import { logAuditEvent } from '../_shared/audit.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import {
  bulkCreateProducts,
  remapBulkResults,
  type BulkCreateResult,
  type BulkProductRow,
  type RawBulkRow,
} from '../_shared/productBulk.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

const categoryEnum = z.enum([
  // Keep in sync with types.ts `Category` and constants.ts `CATEGORIES`.
  // 'Plant-Based' (v2food demo, mig 00043) was added client-side but not here,
  // which rejected every product created with the form's default category.
  'Plant-Based',
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
  // Racked WMS: capacity slots a single base unit consumes (mig 00039).
  size_factor: z.number().positive().optional(),
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

// One row of a bulk-create batch. Same create-shape as productCreateBodySchema,
// except supplier_id becomes optional and a free-text supplier_name is allowed
// instead (resolved/created server-side, see resolveSupplierByName). Exactly
// one of the two must be present per row.
const bulkProductRow = productCreateBodySchema
  .omit({ supplier_id: true })
  .extend({
    supplier_id: z.number().int().positive().optional(),
    supplier_name: z.string().min(1).max(200).optional(),
  })
  .refine(
    row => (row.supplier_id !== undefined) !== (row.supplier_name !== undefined),
    {
      message: 'Exactly one of supplier_id or supplier_name must be provided',
      path: ['supplier_id'],
    },
  )

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), data: productCreateBodySchema }),
  z.object({
    action: z.literal('update'),
    id: z.number().int().positive(),
    data: productBodySchema,
  }),
  z.object({ action: z.literal('delete'), id: z.number().int().positive() }),
  z.object({
    action: z.literal('bulk-create'),
    // Deliberately LOOSE at this level: each element is only checked for
    // being an object, not validated against `bulkProductRow` yet. If it
    // were `z.array(bulkProductRow)` here, a single bad row (e.g. a typo'd
    // price) would fail the WHOLE top-level `safeParse`, throwing away up
    // to 99 otherwise-valid rows before the partial-success machinery below
    // ever runs. `bulkProductRow` is applied PER ROW in the handler instead.
    data: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
  }),
])

// Extract the first validation message for a rejected bulk-create row from
// zod's flattened error shape — form-level errors (from the `.refine`) take
// priority since they're the more specific "which combination of fields is
// wrong" message; otherwise the first field-level message.
function firstZodIssueMessage(error: z.ZodError): string {
  const flat = error.flatten()
  const fieldMessage = Object.values(flat.fieldErrors).flat()[0]
  return flat.formErrors[0] ?? fieldMessage ?? 'Invalid row'
}

// Strip the inventory field from any incoming data object to prevent callers
// from modifying stock levels through this function.
function stripInventory<T extends Record<string, unknown>>(data: T): Omit<T, 'inventory'> {
  const { inventory: _stripped, ...rest } = data as any
  return rest
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const auth = await requireAuth(req, { allowedRoles: ALLOWED })

    // Per-user rate limit: 30/min/user. Matches other admin mutate functions.
    const rl = await checkRateLimit(`mutate-product:${auth.userId}`, {
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

    // ---- BULK-CREATE ----
    if (input.action === 'bulk-create') {
      // Per-row zod validation (S3/partial-success): one bad row must not
      // sink the other 99. `input.data` is only loosely typed at this point
      // (see the discriminated-union schema above) — apply `bulkProductRow`
      // to each row individually, preserving its ORIGINAL index so a mix of
      // valid/invalid rows still comes back fully index-aligned to what the
      // operator submitted.
      const rawRows = input.data as Array<Record<string, unknown>>
      const invalidResults: BulkCreateResult[] = []
      const validRows: RawBulkRow[] = []

      rawRows.forEach((row, originalIndex) => {
        const rowParsed = bulkProductRow.safeParse(row)
        if (!rowParsed.success) {
          invalidResults.push({
            index: originalIndex,
            ok: false,
            sku: String(row.sku ?? ''),
            error: firstZodIssueMessage(rowParsed.error),
            code: 'INVALID_INPUT',
          })
        } else {
          validRows.push({ originalIndex, data: rowParsed.data as BulkProductRow })
        }
      })

      const validResults = await bulkCreateProducts(admin, validRows.map(v => v.data))
      const results = remapBulkResults(invalidResults, validRows, validResults)

      const created = results.filter(r => r.ok).length
      const failed = results.length - created

      // One summary audit event for the whole invoke — never one per row, and
      // never the full row bodies (could be 100 rows of PII/pricing data).
      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'product',
        metadata: {
          bulkAction: 'bulk-create',
          created,
          failed,
          skus: results.map(r => r.sku),
        },
      })

      // Always 200: a FunctionsHttpError on any non-2xx status makes
      // supabase.functions.invoke() throw and discard the response body,
      // which would lose the per-row results for a batch that partially
      // succeeded. Row-level failures live inside `results` instead (S3).
      return new Response(
        JSON.stringify({ ok: true, results }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // Unreachable
    throw new EdgeFunctionError('INVALID_INPUT', 'Unrecognised action')
  } catch (e) {
    if (isEdgeFunctionError(e)) return e.toResponse(req)
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})
