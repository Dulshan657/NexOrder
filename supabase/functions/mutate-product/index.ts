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
import { validateUoms, deriveDefaultUomInputs, type UomInput } from '../_shared/uomValidation.ts'
import {
  validateProductSuppliers,
  deriveDefaultSupplierLinks,
  type ProductSupplierInput,
} from '../_shared/productSupplierValidation.ts'

const ALLOWED: ReadonlyArray<UserRole> = ['Admin', 'Manager']

// Categories are operator-created (mig 00069 drops products_category_check), so
// this is a length bound rather than an enum. constants.ts `CATEGORIES` is now
// only the built-in suggestion list the product form seeds its dropdown with.
// (The old enum was also a footgun: 'Plant-Based' was added client-side but not
// here, which rejected every product created with the form's default category.)
const categorySchema = z.string().trim().min(1).max(60)

// One unit of measure (mig 00067). Field-level shape only; the cross-row rules
// (exactly one base, unique codes, …) are enforced by validateUoms.
const uomSchema = z.object({
  code: z.string().min(1).max(60),
  factor_to_base: z.number().int().positive(),
  is_base: z.boolean(),
  price: z.number().min(0),
  is_orderable: z.boolean().optional().default(true),
  is_receivable: z.boolean().optional().default(true),
  sort_order: z.number().int().optional().default(0),
  // m³ for one of this UOM (mig 00069); null/absent = inherit from the base unit.
  cubic_meters: z.number().min(0).nullable().optional(),
})

// One product↔supplier link (mig 00070). Field-level shape only; the cross-row
// rules (at most one primary, no duplicate supplier) live in
// validateProductSuppliers.
const productSupplierSchema = z.object({
  supplier_id: z.number().int().positive(),
  supplier_sku: z.string().max(120).nullable().optional(),
  cost_price: z.number().min(0).nullable().optional(),
  is_primary: z.boolean().optional().default(false),
  sort_order: z.number().int().optional().default(0),
})

// Shared body — inventory is never accepted (stripped silently)
const productBodySchema = z.object({
  uoms: z.array(uomSchema).min(1).optional(),
  product_suppliers: z.array(productSupplierSchema).min(1).optional(),
  sku: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  price: z.number().min(0).optional(),
  category: categorySchema.optional(),
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
  // Carton OUTER dimensions (mig 00125). NULLABLE, not merely optional:
  // blank means "not measured" and the client sends `null` to clear it.
  // `.optional()` alone REJECTS null, and with `strict` off nothing here
  // would say so until an operator hit Save.
  carton_length_cm: z.number().positive().nullable().optional(),
  carton_width_cm: z.number().positive().nullable().optional(),
  carton_height_cm: z.number().positive().nullable().optional(),
  // Racked WMS: capacity slots a single base unit consumes (mig 00039).
  size_factor: z.number().positive().optional(),
  // Supplier EAN/UPC captured by scanning (mig 00074 made it partial-unique).
  // Nullable so an operator can clear a barcode that was linked in error —
  // '' would trip the unique index the moment a second product cleared theirs,
  // so empty string is normalised to null rather than accepted.
  barcode: z.string().trim().min(1).max(64).nullable().optional(),
  // Catalogued but not sellable (mig 00027; column is NOT NULL DEFAULT true, so
  // omitting this still creates an active product). This is the only way to
  // load a product that must exist without being orderable — a line whose price
  // the operator does not know yet would otherwise have to be created at $0.00
  // and corrected afterwards, and `price >= 0` means the server would accept
  // that as a perfectly orderable free product in the meantime.
  //
  // It is also load-bearing for visibility, not just ordering: mig 00105's
  // customer SELECT policy on `products` filters on is_active, so a false here
  // hides the row from HoReCa logins entirely while staff still see it.
  is_active: z.boolean().optional(),
  // inventory intentionally excluded
})

// Required fields for create
const productCreateBodySchema = productBodySchema.extend({
  sku: z.string().min(1),
  name: z.string().min(1),
  price: z.number().min(0),
  category: categorySchema,
  unit: z.string().min(1),
  carton_size: z.number().int().min(1),
  supplier_id: z.number().int().positive(),
})

// One row of a bulk-create batch. Same create-shape as productCreateBodySchema,
// except supplier_id becomes optional and a free-text supplier_name is allowed
// instead (resolved/created server-side, see resolveSupplierByName). Exactly
// one of the two must be present per row.
const bulkProductRow = productCreateBodySchema
  .omit({ supplier_id: true, product_suppliers: true })
  .extend({
    supplier_id: z.number().int().positive().optional(),
    supplier_name: z.string().min(1).max(200).optional(),
    // Extra suppliers by name (mig 00070) — resolved/created server-side in the
    // same batched pass as supplier_name. Part numbers are positional over
    // [primary, ...additional]; see buildBulkSupplierLinks.
    additional_suppliers: z.array(z.string().min(1).max(200)).max(20).optional(),
    supplier_skus: z.array(z.string().max(120).nullable()).max(21).optional(),
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

// Strip fields that aren't `products` columns: `inventory` (managed only by the
// stock flows), `uoms` (its own table, written via set_product_uoms) and
// `product_suppliers` (likewise, via set_product_suppliers).
function stripNonColumns<T extends Record<string, unknown>>(
  data: T,
): Omit<T, 'inventory' | 'uoms' | 'product_suppliers'> {
  const { inventory: _inv, uoms: _uoms, product_suppliers: _links, ...rest } = data as any
  return rest
}

/**
 * Turn a barcode unique-violation into a message an operator can act on.
 *
 * mig 00074 made products.barcode partial-unique, so linking a scanned carton
 * barcode to a second product raises a raw 23505 whose text names an index, not
 * a product. Since barcode linking happens at a rack face from a scan, "already
 * used by another product" has to be the message.
 */
function rethrowBarcodeConflict(error: { code?: string; message?: string } | null, barcode: unknown): void {
  if (!error) return
  const isUnique = error.code === '23505' || /duplicate key/i.test(error.message ?? '')
  if (isUnique && /uq_products_barcode|barcode/i.test(error.message ?? '')) {
    throw new EdgeFunctionError(
      'CONFLICT',
      `Barcode "${String(barcode)}" is already linked to another product.`,
      { barcode },
    )
  }
}

// Read the singleton carton-discount setting so a derived carton UOM matches the
// backfill's pricing. Fail-open to 0 (undiscounted) — a missing setting must not
// block product creation.
async function cartonDiscountPercent(admin: any): Promise<number> {
  try {
    const { data } = await admin
      .from('app_settings')
      .select('carton_discount_percent')
      .eq('id', 1)
      .maybeSingle()
    const v = Number(data?.carton_discount_percent)
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

// Validate then atomically replace a product's UOM list. Throws INVALID_INPUT on
// a cross-row rule violation (keeps the product row consistent with its UOMs).
async function applyProductUoms(admin: any, productId: number, uoms: UomInput[]): Promise<void> {
  const check = validateUoms(uoms)
  if (!check.ok) throw new EdgeFunctionError('INVALID_INPUT', check.error)
  const { error } = await admin.rpc('set_product_uoms', { p_product_id: productId, p_uoms: uoms })
  if (error) throw new EdgeFunctionError('INTERNAL', `Failed to save units of measure: ${error.message}`)
}

// Validate then atomically replace a product's supplier links. Throws
// INVALID_INPUT on a cross-row rule violation; the RPC also re-points
// products.supplier_id at the primary link so the legacy column stays honest.
async function applyProductSuppliers(
  admin: any,
  productId: number,
  links: ProductSupplierInput[],
): Promise<void> {
  const check = validateProductSuppliers(links)
  if (!check.ok) throw new EdgeFunctionError('INVALID_INPUT', check.error)
  const { error } = await admin.rpc('set_product_suppliers', {
    p_product_id: productId,
    p_links: links,
  })
  if (error) throw new EdgeFunctionError('INTERNAL', `Failed to save suppliers: ${error.message}`)
}

// Re-read a product with its UOM list + supplier links embedded, for the
// mutation response.
async function reselectProduct(admin: any, id: number): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from('products')
    .select('*, product_uoms(*), product_suppliers(*)')
    .eq('id', id)
    .single()
  if (error || !data) throw new EdgeFunctionError('INTERNAL', error?.message ?? 'Failed to re-read product')
  return data as Record<string, unknown>
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
      const incoming = input.data as Record<string, unknown>
      const safeData = stripNonColumns(incoming)

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
        rethrowBarcodeConflict(insertError, safeData.barcode)
        throw new EdgeFunctionError('INTERNAL', insertError?.message ?? 'Failed to create product')
      }

      const productId = (createdRow as any).id as number

      // Persist the UOM list — the caller's, or a base+carton default derived
      // from unit/price/carton_size (keeps carton_size-only callers working).
      const uoms = (incoming.uoms as UomInput[] | undefined) ?? deriveDefaultUomInputs(
        String(safeData.unit ?? 'each'),
        Number(safeData.price ?? 0),
        Number(safeData.carton_size ?? 1),
        await cartonDiscountPercent(admin),
      )
      await applyProductUoms(admin, productId, uoms)

      // Persist the supplier links — the caller's, or a single primary link
      // derived from the required supplier_id (keeps pre-00070 callers working).
      const links = (incoming.product_suppliers as ProductSupplierInput[] | undefined)
        ?? deriveDefaultSupplierLinks(Number(safeData.supplier_id))
      await applyProductSuppliers(admin, productId, links)

      const product = await reselectProduct(admin, productId)

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'create',
        resource: 'product',
        resourceId: String(productId),
        after: product,
      })

      return new Response(
        JSON.stringify({ ok: true, product }),
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
      const incoming = input.data as Record<string, unknown>
      const safeData = stripNonColumns(incoming)

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

      // Only touch the products row when there are actual column changes — a
      // UOM-only update (safeData empty) must not fire an empty UPDATE.
      if (Object.keys(safeData).length > 0) {
        const { error: updateError } = await admin
          .from('products')
          .update(safeData as any)
          .eq('id', input.id)
          .select()
          .single()

        if (updateError) {
          rethrowBarcodeConflict(updateError, safeData.barcode)
          throw new EdgeFunctionError('INTERNAL', updateError.message ?? 'Failed to update product')
        }
      }

      // Replace the UOM list only when the caller sent one (omitting `uoms`
      // leaves the existing list untouched).
      if (incoming.uoms !== undefined) {
        await applyProductUoms(admin, input.id, incoming.uoms as UomInput[])
      }

      // Same for the supplier links — omitting `product_suppliers` leaves them
      // untouched. This runs AFTER the column update so its supplier_id sync
      // wins over any supplier_id the caller also sent in `data`.
      if (incoming.product_suppliers !== undefined) {
        await applyProductSuppliers(
          admin,
          input.id,
          incoming.product_suppliers as ProductSupplierInput[],
        )
      }

      const product = await reselectProduct(admin, input.id)

      await logAuditEvent(admin, {
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'update',
        resource: 'product',
        resourceId: String(input.id),
        before: beforeData,
        after: product,
      })

      return new Response(
        JSON.stringify({ ok: true, product }),
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

      const validResults = await bulkCreateProducts(
        admin,
        validRows.map(v => v.data),
        await cartonDiscountPercent(admin),
      )
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
