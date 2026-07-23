// Cross-row validation for a product's supplier list (mig 00070). Deliberately
// free of Deno and zod imports so it can be unit-tested under vitest (same
// rationale as uomValidation.ts). Field-level shape (types, min/max) is enforced
// by the zod schema in mutate-product; this covers the rules that span the list.

export interface ProductSupplierInput {
  supplier_id: number;
  supplier_sku?: string | null;
  cost_price?: number | null;
  is_primary?: boolean;
  sort_order?: number;
}

export type ProductSupplierValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate a product's supplier list:
 *  - non-empty (products.supplier_id is NOT NULL — there is always a primary)
 *  - at most one primary. Zero is allowed: set_product_suppliers promotes the
 *    lowest sort_order link, which is what lets a caller send a plain list.
 *  - no duplicate supplier_id (the unique index would reject the upsert with an
 *    opaque 23505; catching it here gives the operator a usable message)
 *  - every cost_price, when supplied, is a finite number >= 0
 */
export function validateProductSuppliers(
  links: readonly ProductSupplierInput[],
): ProductSupplierValidationResult {
  if (!Array.isArray(links) || links.length === 0) {
    return { ok: false, error: 'A product needs at least one supplier.' };
  }

  const primaries = links.filter(l => l.is_primary);
  if (primaries.length > 1) {
    return { ok: false, error: 'Only one supplier can be the primary supplier.' };
  }

  const seen = new Set<number>();
  for (const l of links) {
    if (!Number.isInteger(l.supplier_id) || l.supplier_id < 1) {
      return { ok: false, error: 'Every supplier link needs a valid supplier.' };
    }
    if (seen.has(l.supplier_id)) {
      return { ok: false, error: 'The same supplier is listed twice for this product.' };
    }
    seen.add(l.supplier_id);

    if (l.cost_price !== undefined && l.cost_price !== null) {
      if (!Number.isFinite(l.cost_price) || l.cost_price < 0) {
        return { ok: false, error: 'A supplier cost price must be 0 or more.' };
      }
    }
  }

  return { ok: true };
}

/**
 * Server-side default supplier list, used when a create/bulk-create omits
 * `product_suppliers` — the single required supplier_id becomes the primary
 * link, preserving pre-00070 behaviour for callers that know nothing about the
 * join table (CSV imports, older clients).
 */
export function deriveDefaultSupplierLinks(supplierId: number): ProductSupplierInput[] {
  return [{ supplier_id: supplierId, is_primary: true, sort_order: 0 }];
}
