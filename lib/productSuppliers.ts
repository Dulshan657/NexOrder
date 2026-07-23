// Pure read helpers over a product's supplier links (mig 00070), kept free of
// React/Supabase so they're directly unit-testable — same rationale as lib/uom.ts.
//
// Every product has AT LEAST one supplier: the primary link, which the server
// keeps mirrored into products.supplier_id. Rows read without the
// product_suppliers(*) embed have `suppliers` undefined, so every accessor here
// falls back to synthesising that single primary link from `supplierId`. That
// fallback is what stops an un-joined read (or a pre-migration cache) from
// making a product look supplier-less and vanishing from a filtered picker.
import type { Product, ProductSupplierLink } from '@/types'

/** A product's supplier links — the embedded list, else the legacy single supplier. */
export function linksForProduct(product: Product): ProductSupplierLink[] {
  if (product.suppliers && product.suppliers.length > 0) return product.suppliers
  if (product.supplierId == null) return []
  return [{ supplierId: product.supplierId, isPrimary: true, sortOrder: 0 }]
}

/** The primary link, or the first one when no link is flagged primary. */
export function primaryLink(product: Product): ProductSupplierLink | undefined {
  const links = linksForProduct(product)
  return links.find(l => l.isPrimary) ?? links[0]
}

/** True when this product can be bought from `supplierId`. */
export function isSuppliedBy(product: Product, supplierId: number): boolean {
  return linksForProduct(product).some(l => l.supplierId === supplierId)
}

/** Every product `supplierId` supplies, in the catalogue's existing order. */
export function productsForSupplier(
  products: readonly Product[],
  supplierId: number,
): Product[] {
  return products.filter(p => isSuppliedBy(p, supplierId))
}

/** This supplier's own part number for the product, if one is recorded. */
export function supplierSkuFor(product: Product, supplierId: number | null): string | undefined {
  if (supplierId == null) return undefined
  const sku = linksForProduct(product).find(l => l.supplierId === supplierId)?.supplierSku
  return sku && sku.trim() !== '' ? sku : undefined
}

/** What this supplier charges per base unit, if recorded. */
export function costPriceFor(product: Product, supplierId: number | null): number | undefined {
  if (supplierId == null) return undefined
  return linksForProduct(product).find(l => l.supplierId === supplierId)?.costPrice
}

/**
 * Does the product match a free-text picker query? Matches our name / SKU /
 * barcode, plus — when a supplier is in play — that supplier's part number, so
 * a goods-in operator can type straight off the delivery docket.
 *
 * `query` is assumed already trimmed+lowercased by the caller's memo.
 */
export function matchesProductQuery(
  product: Product,
  query: string,
  supplierId?: number | null,
): boolean {
  if (!query) return false
  if (product.name.toLowerCase().includes(query)) return true
  if (product.sku.toLowerCase().includes(query)) return true
  if ((product.barcode ?? '').toLowerCase().includes(query)) return true
  const supplierSku = supplierSkuFor(product, supplierId ?? null)
  return supplierSku != null && supplierSku.toLowerCase().includes(query)
}
