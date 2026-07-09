// Validates one stock-CSV record into a receiving line, resolving the SKU
// against a caller-supplied product-id map. Quantities are BASE units
// (matching the ledger's carton unit model — see `lib/adapters.ts` /
// carton-unit-model memory) and are deliberately NOT multiplied by
// pack_size here; that belongs to whatever consumes these lines.

export interface StockImportContext {
  /** Product id lookup, keyed by the exact (trimmed) SKU as stored in the DB —
   * SKUs are case-sensitive-unique there. If an exact match misses, a
   * case-insensitive fallback scan of this same map is attempted, so a CSV
   * casing typo (e.g. "ayb-001" vs "AYB-001") still resolves. */
  productIdBySku: Map<string, number>
}

export interface StockImportLine {
  product_id: number
  quantity: number
  lot_code?: string
  expiry_date?: string
  barcode?: string
}

export type StockRowResult =
  | { ok: true; line: StockImportLine; sku: string }
  | { ok: false; error: string; sku: string }

/** Full-string numeric check — rejects prefix-parseable garbage like "1,000" or "10 units". */
const STRICT_NUMBER = /^-?\d+(\.\d+)?$/
const EXPIRY_FORMAT = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXT_FIELD_LEN = 120

function resolveProductId(sku: string, bySku: Map<string, number>): number | undefined {
  const exact = bySku.get(sku)
  if (exact !== undefined) return exact
  const folded = sku.toLowerCase()
  for (const [key, id] of bySku) {
    if (key.toLowerCase() === folded) return id
  }
  return undefined
}

export function validateStockRow(rec: Record<string, string>, ctx: StockImportContext): StockRowResult {
  const sku = (rec.sku ?? '').trim()
  if (!sku) return { ok: false, error: 'SKU is required.', sku }

  const productId = resolveProductId(sku, ctx.productIdBySku)
  if (productId === undefined) {
    return { ok: false, error: `No product with SKU ${sku} — import it in the catalog first`, sku }
  }

  const quantityRaw = (rec.quantity ?? '').trim()
  if (!quantityRaw || !STRICT_NUMBER.test(quantityRaw)) {
    return { ok: false, error: `Quantity must be a valid number, got "${rec.quantity}".`, sku }
  }
  const quantity = Number(quantityRaw)
  if (!(quantity > 0)) {
    return { ok: false, error: 'Quantity must be greater than 0.', sku }
  }

  const line: StockImportLine = { product_id: productId, quantity }

  const lotCode = (rec.lot_code ?? '').trim()
  if (lotCode) {
    if (lotCode.length > MAX_TEXT_FIELD_LEN) {
      return { ok: false, error: `lot_code must be ${MAX_TEXT_FIELD_LEN} characters or fewer.`, sku }
    }
    line.lot_code = lotCode
  }

  const expiryDate = (rec.expiry_date ?? '').trim()
  if (expiryDate) {
    if (!EXPIRY_FORMAT.test(expiryDate)) {
      return { ok: false, error: `expiry_date must be YYYY-MM-DD, got "${expiryDate}".`, sku }
    }
    line.expiry_date = expiryDate
  }

  const barcode = (rec.barcode ?? '').trim()
  if (barcode) {
    if (barcode.length > MAX_TEXT_FIELD_LEN) {
      return { ok: false, error: `barcode must be ${MAX_TEXT_FIELD_LEN} characters or fewer.`, sku }
    }
    line.barcode = barcode
  }

  return { ok: true, line, sku }
}
