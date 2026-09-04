// Shared, Deno-import-free bulk-create helper for mutate-product's
// `bulk-create` action.
//
// This file exists purely to keep `bulkCreateProducts` and
// `resolveSupplierByName` testable under vitest: mutate-product/index.ts
// imports `serve` from deno.land, `createClient`/`zod` from esm.sh, and reads
// `Deno.env` at module scope, none of which resolve under Node/tsc. Every
// other edge-fn test in this repo instead imports its pure helper from a
// Deno-free `_shared/*` module (see `_shared/poInbox/aliasResolver.ts` and its
// `SupabaseLike` client interface) — this module follows that convention.
//
// CRITICAL: do not import anything from `https://...` here, and do not
// reference the global `Deno` object. The zod row schema stays in
// mutate-product/index.ts (it needs the esm.sh zod import); this module only
// receives already-validated `BulkProductRow` values.

import { EdgeFunctionError } from './errors.ts'
import { deriveDefaultUomInputs, type UomInput } from './uomValidation.ts'
import type { ProductSupplierInput } from './productSupplierValidation.ts'

// ---------------------------------------------------------------------
// Minimal client surface — only the query-builder methods this helper
// actually calls against `products` / `suppliers`:
//   .from('suppliers').select('id').ilike('name', name).limit(1)
//   .from('suppliers').insert({...}).select('id').single()
//   .from('products').select('sku').in('sku', skus)
//   .from('products').insert({...}).select().single()
// ---------------------------------------------------------------------

export interface ProductBulkDbError {
  message: string
  code?: string
}

export type ProductBulkListResult<TRow> = Promise<{
  data: TRow[] | null
  error: ProductBulkDbError | null
}>

export interface ProductBulkSelectBuilder<TRow> {
  ilike(column: string, value: string): ProductBulkSelectBuilder<TRow>
  in(column: string, values: ReadonlyArray<string | number>): ProductBulkSelectBuilder<TRow>
  limit(n: number): ProductBulkSelectBuilder<TRow>
  // Every step above is also directly awaitable (no terminal call needed),
  // matching how the caller uses `.in(...)` / `.limit(...)` without `.single()`.
  then<TResult>(
    onfulfilled: (value: { data: TRow[] | null; error: ProductBulkDbError | null }) => TResult,
  ): Promise<TResult>
}

export interface ProductBulkInsertBuilder<TRow> {
  select(columns?: string): {
    single(): Promise<{ data: TRow | null; error: ProductBulkDbError | null }>
  }
}

export interface ProductBulkSupabaseLike {
  from(table: 'products' | 'suppliers'): {
    select(columns: string): ProductBulkSelectBuilder<Record<string, unknown>>
    insert(row: Record<string, unknown>): ProductBulkInsertBuilder<Record<string, unknown>>
  }
  // set_product_uoms(p_product_id, p_uoms) — seeds each created product's UOMs.
  // set_product_suppliers(p_product_id, p_links) — seeds its supplier links.
  rpc(fn: string, args: Record<string, unknown>): Promise<{ error: ProductBulkDbError | null }>
}

// ---------------------------------------------------------------------
// Types shared with mutate-product/index.ts. `BulkProductRow` is inferred
// there from the zod schema (`z.infer<typeof bulkProductRow>`) and passed in
// as a plain shape here so this module has zero zod dependency.
// ---------------------------------------------------------------------

export interface BulkProductRow {
  sku: string
  name: string
  description?: string | null
  price: number
  category: string
  // mig 00114. Optional because the CSV importer omits the key entirely when the
  // column is blank (which means "leave it alone"), and nullable because
  // clearing a brand is an explicit `null`. See mutate-product's schema comment.
  brand?: string | null
  image_url?: string | null
  unit: string
  carton_size: number
  dietary_labels?: string[] | null
  cubic_meters_unit?: number | null
  cubic_meters_carton?: number | null
  length_cm?: number | null
  width_cm?: number | null
  height_cm?: number | null
  size_factor?: number
  supplier_id?: number
  supplier_name?: string
  // Extra suppliers this product can also be bought from (mig 00070), by name;
  // resolved/created in the same batched pass as `supplier_name`. The row's
  // primary supplier is NOT repeated here.
  additional_suppliers?: string[]
  // Supplier part numbers, positionally aligned with [primary, ...additional].
  // A shorter array just leaves the trailing links without a part number.
  supplier_skus?: Array<string | null>
  // Optional explicit UOM list; when absent, a base+carton default is derived.
  uoms?: UomInput[]
}

// One row's outcome from a bulk-create invoke. Index-aligned with the input
// `data` array so callers can zip results back to what they submitted.
export interface BulkCreateResult {
  index: number
  ok: boolean
  id?: number
  sku: string
  error?: string
  code?: string
}

// A row that survived per-row zod validation in index.ts (where zod is
// available), paired with its position in the ORIGINAL request payload —
// `bulkCreateProducts` only ever sees this already-valid subset, so its own
// `BulkCreateResult.index` values are positions within that subset, not the
// original array.
export interface RawBulkRow {
  originalIndex: number
  data: BulkProductRow
}

// Merge per-row zod-validation failures (indexed against the original
// request payload) with `bulkCreateProducts`' results (indexed against the
// filtered `validRows` subset it was called with), remapping the latter back
// to original-array positions, then sort so the final array is complete and
// index-aligned to what the operator submitted — regardless of how many rows
// were dropped for failing validation before ever reaching the DB layer.
// Deno-free and zod-free (the caller already parsed), so it's unit-testable
// under vitest without dragging in mutate-product/index.ts's Deno imports.
export function remapBulkResults(
  invalidResults: ReadonlyArray<BulkCreateResult>,
  validRows: ReadonlyArray<RawBulkRow>,
  validResults: ReadonlyArray<BulkCreateResult>,
): BulkCreateResult[] {
  const remapped = validResults.map((result) => ({
    ...result,
    index: validRows[result.index].originalIndex,
  }))
  return [...invalidResults, ...remapped].sort((a, b) => a.index - b.index)
}

// `ilike()` treats `%` and `_` as SQL LIKE wildcards. A CSV-supplied
// supplier_name is untrusted text, not a pattern — without escaping, a name
// like "Acme%Foods" would match any supplier whose name happens to fit that
// wildcard shape (or create a junk supplier if nothing matches), silently
// mislinking the row to the wrong supplier. Escape the three LIKE
// metacharacters before using the name as a lookup *pattern*; the ORIGINAL,
// unescaped name is still used for the insert (and returned to the caller).
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c)
}

// Resolve a free-text supplier name to an id: exact case-insensitive match on
// suppliers.name, else create a minimal supplier row. Ported from
// receive-stock/index.ts `resolveHeaderSupplier` (same ilike-then-insert
// pattern), simplified for the bulk-create path where a name is always given.
export async function resolveSupplierByName(
  admin: ProductBulkSupabaseLike,
  name: string,
): Promise<number> {
  const { data: existing, error: findErr } = await admin
    .from('suppliers')
    .select('id')
    .ilike('name', escapeLikePattern(name))
    .limit(1)
  if (findErr) throw new EdgeFunctionError('INTERNAL', `supplier lookup failed: ${findErr.message}`)
  if (existing && existing.length > 0) return existing[0].id as number

  const { data: created, error: createErr } = await admin
    .from('suppliers')
    .insert({ name, contact_person: '', email: '', phone: '' })
    .select('id')
    .single()
  if (createErr) throw new EdgeFunctionError('INTERNAL', `supplier create failed: ${createErr.message}`)
  return (created as Record<string, unknown>).id as number
}

// Build the set_product_suppliers payload for one bulk row (mig 00070): the
// resolved primary first, then each additional supplier in CSV order, with
// `supplier_skus` applied positionally over that same sequence.
//
// Pure — takes the already-resolved id map, so it's unit-testable on its own.
// An additional name that didn't resolve (or that duplicates the primary) is
// skipped rather than failing the row: the product is already created, and a
// duplicate supplier_id would trip the table's unique index.
export function buildBulkSupplierLinks(
  row: BulkProductRow,
  primarySupplierId: number,
  supplierIdByFoldedName: ReadonlyMap<string, number>,
): ProductSupplierInput[] {
  const skus = row.supplier_skus ?? []
  const skuAt = (position: number): string | null => {
    const raw = skus[position]
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim()
    return trimmed === '' ? null : trimmed
  }

  const links: ProductSupplierInput[] = [{
    supplier_id: primarySupplierId,
    supplier_sku: skuAt(0),
    is_primary: true,
    sort_order: 0,
  }]
  const seen = new Set<number>([primarySupplierId])

  ;(row.additional_suppliers ?? []).forEach((name, i) => {
    const id = supplierIdByFoldedName.get(String(name ?? '').trim().toLowerCase())
    if (id === undefined || seen.has(id)) return
    seen.add(id)
    links.push({
      supplier_id: id,
      supplier_sku: skuAt(i + 1),
      is_primary: false,
      sort_order: links.length,
    })
  })

  return links
}

// Pure(ish) — the only side effects are DB calls through the injected `admin`
// client, so it can be exercised in tests against a fake without a network.
// Batches supplier resolution (one lookup/create per distinct folded supplier
// name, not per row — bug C1), dedups intra-batch SKUs (bug S5), and does a
// single existence pre-check for the whole batch instead of N point queries.
// Rows are then inserted one at a time so the batch gets partial success; a
// 23505 unique-violation at insert time (a pre-check-to-insert TOCTOU race)
// is mapped to a CONFLICT result rather than throwing the whole batch (S3).
export async function bulkCreateProducts(
  admin: ProductBulkSupabaseLike,
  rows: ReadonlyArray<BulkProductRow>,
  cartonDiscountPercent = 0,
): Promise<BulkCreateResult[]> {
  const results: BulkCreateResult[] = rows.map((row, index) => ({
    index,
    ok: false,
    sku: row.sku,
  }))

  // ---- Intra-batch SKU dedup: mark every occurrence after the first ----
  const firstIndexForSku = new Map<string, number>()
  const duplicateIndexes = new Set<number>()
  rows.forEach((row, index) => {
    const seenAt = firstIndexForSku.get(row.sku)
    if (seenAt !== undefined) {
      duplicateIndexes.add(index)
      results[index] = {
        index,
        ok: false,
        sku: row.sku,
        error: `duplicate of row ${seenAt}`,
        code: 'CONFLICT',
      }
    } else {
      firstIndexForSku.set(row.sku, index)
    }
  })

  const candidateIndexes = rows
    .map((_row, index) => index)
    .filter(index => !duplicateIndexes.has(index))

  // ---- Batch supplier resolution: one resolve per distinct folded name ----
  const distinctFoldedNames = new Map<string, string>() // folded -> first-seen casing
  const noteName = (name: string | undefined | null): void => {
    if (!name) return
    const trimmed = name.trim()
    if (!trimmed) return
    const folded = trimmed.toLowerCase()
    if (!distinctFoldedNames.has(folded)) distinctFoldedNames.set(folded, trimmed)
  }
  for (const index of candidateIndexes) {
    noteName(rows[index].supplier_name)
    // Additional suppliers (mig 00070) resolve through the SAME batched pass —
    // one lookup/create per distinct name across the whole batch, not per row.
    for (const extra of rows[index].additional_suppliers ?? []) noteName(extra)
  }

  const supplierIdByFoldedName = new Map<string, number>()
  for (const [folded, originalCasing] of distinctFoldedNames) {
    const id = await resolveSupplierByName(admin, originalCasing)
    supplierIdByFoldedName.set(folded, id)
  }

  // ---- Single existence pre-check for the whole batch ----
  const candidateSkus = candidateIndexes.map(index => rows[index].sku)
  const existingSkuSet = new Set<string>()
  if (candidateSkus.length > 0) {
    const { data: existingRows, error: existingError } = await admin
      .from('products')
      .select('sku')
      .in('sku', candidateSkus)
    if (existingError) {
      throw new EdgeFunctionError('INTERNAL', `SKU existence check failed: ${existingError.message}`)
    }
    for (const row of (existingRows ?? []) as Array<{ sku: string }>) {
      existingSkuSet.add(row.sku)
    }
  }

  // ---- Insert surviving rows one at a time (for partial success) ----
  for (const index of candidateIndexes) {
    const row = rows[index]

    if (existingSkuSet.has(row.sku)) {
      results[index] = {
        index,
        ok: false,
        sku: row.sku,
        error: `A product with SKU "${row.sku}" already exists`,
        code: 'CONFLICT',
      }
      continue
    }

    const supplierId = row.supplier_id ??
      supplierIdByFoldedName.get((row.supplier_name as string).trim().toLowerCase())

    if (supplierId === undefined) {
      results[index] = {
        index,
        ok: false,
        sku: row.sku,
        error: `Failed to resolve supplier "${row.supplier_name ?? ''}"`,
        code: 'INTERNAL',
      }
      continue
    }

    // `row` never carries an `inventory` field — the zod schema in index.ts
    // doesn't accept one (default zod behavior strips unknown keys), so
    // unlike create/update there's nothing to strip here. `uoms` and the
    // supplier-link fields are not products columns, so they're pulled out and
    // written via set_product_uoms / set_product_suppliers below.
    const {
      supplier_name: _supplierName,
      uoms: _uoms,
      additional_suppliers: _additional,
      supplier_skus: _supplierSkus,
      ...rest
    } = row
    const insertData = { ...rest, supplier_id: supplierId, inventory: 0 }

    const { data: createdRow, error: insertError } = await admin
      .from('products')
      .insert(insertData)
      .select()
      .single()

    if (insertError || !createdRow) {
      const pgCode = insertError?.code
      if (pgCode === '23505') {
        results[index] = {
          index,
          ok: false,
          sku: row.sku,
          error: `A product with SKU "${row.sku}" already exists`,
          code: 'CONFLICT',
        }
      } else {
        results[index] = {
          index,
          ok: false,
          sku: row.sku,
          error: insertError?.message ?? 'Failed to create product',
          code: 'INTERNAL',
        }
      }
      continue
    }

    const createdId = (createdRow as Record<string, unknown>).id as number

    // Seed the product's UOMs — the row's explicit list, or a base+carton
    // default. A UOM failure shouldn't undo a created product (there's no
    // batch transaction), so surface it on the row but keep it marked ok:
    // the product exists and an operator can fix its units afterward.
    const uoms = row.uoms ?? deriveDefaultUomInputs(
      row.unit, row.price, row.carton_size, cartonDiscountPercent,
    )
    const { error: uomError } = await admin.rpc('set_product_uoms', {
      p_product_id: createdId,
      p_uoms: uoms,
    })

    // Seed the product's supplier links (mig 00070). The insert above already
    // set products.supplier_id, so a failure here leaves the product with its
    // primary supplier intact — same non-fatal treatment as UOMs.
    const links = buildBulkSupplierLinks(row, supplierId, supplierIdByFoldedName)
    const { error: linkError } = await admin.rpc('set_product_suppliers', {
      p_product_id: createdId,
      p_links: links,
    })

    const warning = uomError
      ? `Created, but units of measure failed: ${uomError.message}`
      : linkError
        ? `Created, but extra suppliers failed: ${linkError.message}`
        : undefined

    results[index] = {
      index,
      ok: true,
      id: createdId,
      sku: row.sku,
      ...(warning ? { error: warning } : {}),
    }
  }

  return results
}
