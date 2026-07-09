// Validates one catalog-CSV record into a send-ready snake_case product row,
// delegating the shared field rules to `buildProductPayload` and layering on
// the checks that pure-form input never needed:
//
//  - bug C3: `buildProductPayload` parses numerics with `parseFloat`/`parseInt`,
//    which *prefix*-parse ("1,234" -> 1, silently truncating a thousands-
//    separated price by 1000x). CSV text is untrusted, so every numeric-ish
//    field is strict-validated as a full string BEFORE it reaches the
//    delegate.
//  - bug S6: category matching is case-folded against the caller-supplied
//    canonical set (so "coconut" in a CSV resolves to "Coconut").
//  - bug C1: supplier lookup is folded (trim + lowercase) against a
//    caller-supplied name->id map. An unknown supplier is not a row error —
//    it's flagged so the caller can create it and re-link the row.
//  - bug S2: `buildProductPayload` doesn't require `unit` or validate
//    `image_url` shape; both are checked here.
import { buildProductPayload, type ProductFormData } from '@/lib/productFormPayload'
import { fromProduct } from '@/lib/adapters'
import type { Product } from '@/types'

export interface CatalogImportContext {
  /** Supplier id lookup, keyed by folded (trim + lowercase) supplier name. */
  suppliersByName: Map<string, number>
  /** Canonical category values (e.g. `constants.CATEGORIES`), case-sensitive. */
  categories: Set<string>
}

export type RowResult =
  | { ok: true; row: Record<string, unknown>; supplierName: string; supplierWillBeCreated: boolean }
  | { ok: false; error: string; field?: string }

/** Full-string numeric check — rejects prefix-parseable garbage like "1,234" or "4.5abc". */
const STRICT_NUMBER = /^-?\d+(\.\d+)?$/
/** Integer-only check for carton_size — `STRICT_NUMBER` allows decimals, which
 * `buildProductPayload` then silently truncates via `parseInt` (e.g.
 * "12.9" -> 12), so carton_size needs its own stricter rule. */
const STRICT_INTEGER = /^-?\d+$/

function isStrictNumeric(value: string): boolean {
  return STRICT_NUMBER.test(value.trim())
}

/** Sentinel supplierId fed to `buildProductPayload` when the supplier is unknown, so its
 * numeric-id check passes; the resulting `supplier_id` is discarded afterward. */
const UNKNOWN_SUPPLIER_SENTINEL_ID = -1

export function validateCatalogRow(rec: Record<string, string>, ctx: CatalogImportContext): RowResult {
  const price = (rec.price ?? '').trim()
  if (!price) return { ok: false, error: 'Price is required.', field: 'price' }
  if (!isStrictNumeric(price)) {
    return { ok: false, error: `Price must be a valid number, got "${rec.price}".`, field: 'price' }
  }

  const cartonSize = (rec.carton_size ?? '').trim()
  if (cartonSize && !STRICT_INTEGER.test(cartonSize)) {
    return {
      ok: false,
      error: `carton_size must be a whole number (no decimals), got "${rec.carton_size}".`,
      field: 'carton_size',
    }
  }

  const dimensionFields: Array<[string, string]> = [
    ['cubic_meters_unit', rec.cubic_meters_unit ?? ''],
    ['cubic_meters_carton', rec.cubic_meters_carton ?? ''],
    ['length_cm', rec.length_cm ?? ''],
    ['width_cm', rec.width_cm ?? ''],
    ['height_cm', rec.height_cm ?? ''],
    ['size_factor', rec.size_factor ?? ''],
  ]
  for (const [field, value] of dimensionFields) {
    const trimmed = value.trim()
    if (trimmed && !isStrictNumeric(trimmed)) {
      return { ok: false, error: `${field} must be a valid number, got "${value}".`, field }
    }
  }

  const categoryInput = (rec.category ?? '').trim()
  const canonicalCategory = [...ctx.categories].find((c) => c.toLowerCase() === categoryInput.toLowerCase())
  if (!canonicalCategory) {
    return { ok: false, error: `Unknown category: ${rec.category}`, field: 'category' }
  }

  const unit = (rec.unit ?? '').trim()
  if (!unit) return { ok: false, error: 'Unit is required.', field: 'unit' }

  const imageUrl = (rec.image_url ?? '').trim()
  if (imageUrl) {
    try {
      new URL(imageUrl)
    } catch {
      return { ok: false, error: `image_url is not a valid URL: "${imageUrl}"`, field: 'image_url' }
    }
  }

  const supplierNameInput = (rec.supplier_name ?? '').trim()
  if (!supplierNameInput) return { ok: false, error: 'Supplier name is required.', field: 'supplier_name' }

  const knownSupplierId = ctx.suppliersByName.get(supplierNameInput.toLowerCase())
  const supplierWillBeCreated = knownSupplierId === undefined

  const formData: ProductFormData = {
    sku: rec.sku ?? '',
    name: rec.name ?? '',
    description: rec.description ?? '',
    price,
    category: canonicalCategory as ProductFormData['category'],
    unit,
    imageUrl,
    supplierId: String(knownSupplierId ?? UNKNOWN_SUPPLIER_SENTINEL_ID),
    cartonSize,
    cubicMetersUnit: rec.cubic_meters_unit ?? '',
    cubicMetersCarton: rec.cubic_meters_carton ?? '',
    lengthCm: rec.length_cm ?? '',
    widthCm: rec.width_cm ?? '',
    heightCm: rec.height_cm ?? '',
    sizeFactor: rec.size_factor ?? '',
  }

  // Realistic catalogs often omit descriptions; the server treats the field
  // as optional/nullable, so the import path shouldn't be stricter than the
  // server. `buildProductPayload` defaults to requiring one (form behavior).
  const built = buildProductPayload(formData, { isEdit: false, requireDescription: false })
  // NOTE: `built.ok === false` (not `!built.ok`) — without `strictNullChecks`
  // in this project's tsconfig, TS fails to narrow a discriminated union
  // through a negated boolean-property check inside an if-block; the
  // explicit literal comparison narrows reliably instead.
  if (built.ok === false) return { ok: false, error: built.error }

  const row = fromProduct(built.data as Partial<Product>)
  if (supplierWillBeCreated) {
    delete row.supplier_id
    row.supplier_name = supplierNameInput
  }

  return { ok: true, row, supplierName: supplierNameInput, supplierWillBeCreated }
}
