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
  /** Bin id lookup keyed by `locations.code`, for the OPTIONAL `bin_code`
   * column. The caller must populate this with the bins of the destination
   * warehouse only — `locations.code` is globally unique, so a code belonging
   * to another site is simply absent here and the row is rejected by name
   * rather than silently receiving stock into the wrong building.
   *
   * Absent/empty map = the importer is running against a warehouse with no
   * addressable bins, and any `bin_code` in the file is an error worth saying
   * out loud. */
  binIdByCode?: Map<string, number>
}

export interface StockImportLine {
  product_id: number
  quantity: number
  lot_code?: string
  expiry_date?: string
  barcode?: string
}

export type StockRowResult =
  | {
      ok: true
      line: StockImportLine
      sku: string
      /** Resolved destination bin, when the row named one. Deliberately NOT on
       *  `line`: the receipt schema has no bin field, because stock reaches a
       *  bin through putaway, never through the receipt itself. The caller
       *  groups rows by this id and places each group after receiving it. */
      binLocationId?: number
      /** The code exactly as stored, for messages and receipt references. */
      binCode?: string
    }
  | { ok: false; error: string; sku: string }

/** Full-string numeric check — rejects prefix-parseable garbage like "1,000" or "10 units". */
const STRICT_NUMBER = /^-?\d+(\.\d+)?$/
const EXPIRY_FORMAT = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXT_FIELD_LEN = 120

/** Exact hit first, then a case-insensitive scan — a CSV typed by hand off a
 *  printed label routinely differs from the stored value only in casing. */
function resolveByCode(value: string, byCode: Map<string, number>): { id: number; code: string } | undefined {
  const exact = byCode.get(value)
  if (exact !== undefined) return { id: exact, code: value }
  const folded = value.toLowerCase()
  for (const [key, id] of byCode) {
    if (key.toLowerCase() === folded) return { id, code: key }
  }
  return undefined
}

function resolveProductId(sku: string, bySku: Map<string, number>): number | undefined {
  return resolveByCode(sku, bySku)?.id
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

  // Optional. A file with no bin_code column behaves exactly as it always has:
  // everything is received to the warehouse root and putaway is left to the
  // operator. Naming a bin is what makes a counted-by-bin opening stocktake
  // importable in one pass.
  const binCode = (rec.bin_code ?? '').trim()
  if (binCode) {
    if (binCode.length > MAX_TEXT_FIELD_LEN) {
      return { ok: false, error: `bin_code must be ${MAX_TEXT_FIELD_LEN} characters or fewer.`, sku }
    }
    const bins = ctx.binIdByCode
    if (!bins || bins.size === 0) {
      return {
        ok: false,
        error: `This warehouse has no addressable bins, so bin_code "${binCode}" cannot be used. Publish a layout first, or clear the column.`,
        sku,
      }
    }
    const bin = resolveByCode(binCode, bins)
    if (bin === undefined) {
      return { ok: false, error: `No bin "${binCode}" in this warehouse — check the label or the warehouse selection.`, sku }
    }
    return { ok: true, line, sku, binLocationId: bin.id, binCode: bin.code }
  }

  return { ok: true, line, sku }
}
