// Pure validation + payload-building logic for ProductForm, extracted so it's
// unit-testable without mounting the component.
//
// The server (`supabase/functions/mutate-product`) requires sku, name, price,
// category, unit, carton_size, supplier_id on create, and rejects image_url
// as '' (must be a valid URL or null/absent). This helper enforces the same
// required fields client-side and keeps imageUrl handling consistent:
//   - create + empty imageUrl -> omitted entirely (never send '')
//   - edit + empty imageUrl   -> included as '' so the caller can map it to
//                                 null via `fromProduct` and clear the image
import type { Product } from '@/types'

export interface ProductFormData {
  sku: string
  name: string
  description: string
  price: string
  category: Product['category']
  unit: string
  imageUrl: string
  supplierId: string
  cartonSize: string
  cubicMetersUnit: string
  cubicMetersCarton: string
  lengthCm: string
  widthCm: string
  heightCm: string
  sizeFactor: string
  /**
   * Supplier EAN/UPC (mig 00074). Optional on the TYPE, not merely on the
   * value: the CSV import path builds a ProductFormData literal and has no
   * barcode column, so making this required would break that caller. Omitted
   * leaves any existing barcode untouched; present-but-empty clears it.
   */
  barcode?: string
  /**
   * Brand (mig 00114). Optional on the TYPE for the same reason `barcode` is:
   * callers that build a ProductFormData literal without a brand column must
   * keep compiling. Omitted leaves an existing brand untouched;
   * present-but-empty clears it.
   */
  brand?: string
}

export type ProductPayload = Record<string, unknown>

export type BuildProductPayloadResult =
  | { ok: true; data: ProductPayload }
  | { ok: false; error: string }

export interface BuildProductPayloadOptions {
  /** True when editing an existing product (vs. creating a new one). */
  isEdit?: boolean
  /** False for import paths where a catalog legitimately has no description
   * yet (the server treats it as optional/nullable). Defaults to true to
   * preserve the product form's existing required-field behavior. */
  requireDescription?: boolean
}

export function buildProductPayload(
  formData: ProductFormData,
  options: BuildProductPayloadOptions = {},
): BuildProductPayloadResult {
  const { isEdit = false, requireDescription = true } = options

  const sku = formData.sku.trim()
  const name = formData.name.trim()
  const description = formData.description.trim()
  const price = parseFloat(formData.price)
  const supplierId = parseInt(formData.supplierId, 10)
  const cartonSize = parseInt(formData.cartonSize, 10)

  if (!sku) return { ok: false, error: 'SKU is required.' }
  if (!name) return { ok: false, error: 'Product name is required.' }
  if (requireDescription && !description) return { ok: false, error: 'Description is required.' }
  if (isNaN(price) || price < 0) return { ok: false, error: 'Price must be a valid, non-negative number.' }
  if (isNaN(supplierId)) return { ok: false, error: 'Please select a supplier.' }
  if (isNaN(cartonSize) || cartonSize < 1) {
    return { ok: false, error: 'Carton size must be a whole number of at least 1.' }
  }

  const data: ProductPayload = {
    sku,
    name,
    price,
    category: formData.category,
    unit: formData.unit,
    supplierId,
    cartonSize,
    cubicMetersUnit: formData.cubicMetersUnit ? parseFloat(formData.cubicMetersUnit) : undefined,
    cubicMetersCarton: formData.cubicMetersCarton ? parseFloat(formData.cubicMetersCarton) : undefined,
    lengthCm: formData.lengthCm ? parseFloat(formData.lengthCm) : undefined,
    widthCm: formData.widthCm ? parseFloat(formData.widthCm) : undefined,
    heightCm: formData.heightCm ? parseFloat(formData.heightCm) : undefined,
    sizeFactor: formData.sizeFactor ? parseFloat(formData.sizeFactor) : undefined,
  }

  // Blank description: omitted entirely rather than sent as ''. When
  // `requireDescription` is true this only happens if isNaN/empty checks
  // above already returned an error, so this is unreachable there — but it
  // matters for the `requireDescription: false` (import) path.
  if (description) {
    data.description = formData.description
  }

  const imageUrl = formData.imageUrl.trim()
  if (imageUrl || isEdit) {
    data.imageUrl = imageUrl
  }

  // null, never '': the column is partial-unique (mig 00074), so a second
  // product cleared to '' would collide with the first.
  if (formData.barcode !== undefined) {
    data.barcode = formData.barcode.trim() || null
  }

  // null, never '', for a different reason than barcode's: the column's CHECK
  // refuses a blank-after-trim value, AND a stored '' would be MATCHABLE by a
  // slotting rule whose brand field was left empty — quietly enrolling the
  // whole unbranded catalogue in it. "Unbranded" has exactly one spelling.
  if (formData.brand !== undefined) {
    data.brand = formData.brand.trim() || null
  }

  return { ok: true, data }
}
