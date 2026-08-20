// Turn a pasted block of SKU/quantity rows into order lines, or into named
// refusals. Pure: products in, decisions out, no fetching and no React.
//
// ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
//
// The New Order screen shows the operator exactly what it is about to send,
// per row, BEFORE they press anything — so the preview grid and the submitted
// payload have to be the same decision, not two implementations that agree
// most of the time. Same split as `_shared/binCount.ts` and
// `_shared/wie/replenPolicy.ts`: evaluate the rule early, render the answer.
//
// It deliberately does NOT talk to `place-order`. The server prices the order
// and is the authority on whether it can be placed at all; this only decides
// which product a typed string means and whether a quantity is a quantity.

import type { Product } from '../../types'

export interface ParsedOrderLine {
  productId: number
  sku: string
  name: string
  quantity: number
}

export type OrderLineIssueReason =
  | 'unknown_sku'
  | 'inactive'
  | 'missing_quantity'
  | 'bad_quantity'
  | 'not_positive'

export interface OrderLineIssue {
  /** 1-based, counting blank lines, so it matches the row the operator sees. */
  line: number
  raw: string
  reason: OrderLineIssueReason
  detail: string
}

export interface OrderLineParseResult {
  lines: ParsedOrderLine[]
  issues: OrderLineIssue[]
}

/** A spreadsheet paste is tab-separated; a saved CSV is comma-separated. */
const SPLIT_COLUMNS = /[\t,;]/

const HEADER_FIRST_CELLS = new Set(['sku', 'code', 'product', 'item', 'product code'])

function normaliseSku(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * A quantity is a positive whole number of base units.
 *
 * Blank is NOT zero and 0 is not an order line — unlike a stocktake, where a
 * typed 0 is a real write-off, there is nothing an order can mean by "none of
 * this". Both are refused, separately, so the message can say which happened.
 */
function readQuantity(raw: string | undefined): { qty: number } | { reason: OrderLineIssueReason } {
  if (raw === undefined || raw.trim() === '') return { reason: 'missing_quantity' }
  const cleaned = raw.trim().replace(/[, ]/g, '')
  if (!/^-?\d+$/.test(cleaned)) return { reason: 'bad_quantity' }
  const qty = Number(cleaned)
  if (!Number.isFinite(qty)) return { reason: 'bad_quantity' }
  if (qty <= 0) return { reason: 'not_positive' }
  return { qty }
}

export function resolveOrderLines(text: string, products: Product[]): OrderLineParseResult {
  const bySku = new Map<string, Product>()
  for (const p of products) bySku.set(normaliseSku(p.sku), p)

  const lines: ParsedOrderLine[] = []
  const issues: OrderLineIssue[] = []
  // Insertion-ordered, so a repeated SKU lands back on its first appearance
  // rather than jumping to the bottom of the grid when it is merged.
  const byProduct = new Map<number, ParsedOrderLine>()

  const rows = text.split(/\r?\n/)

  rows.forEach((raw, index) => {
    const lineNumber = index + 1
    if (raw.trim() === '') return

    const cells = raw.split(SPLIT_COLUMNS).map((c) => c.trim())
    const skuCell = cells[0] ?? ''

    // A header only counts as one on the first non-blank row; a product
    // legitimately called "Item" further down is a product.
    if (lines.length === 0 && issues.length === 0 && HEADER_FIRST_CELLS.has(skuCell.toLowerCase())) {
      return
    }

    const product = bySku.get(normaliseSku(skuCell))
    if (!product) {
      issues.push({
        line: lineNumber,
        raw,
        reason: 'unknown_sku',
        detail: `No product has the code "${skuCell}".`,
      })
      return
    }
    if (product.isActive === false) {
      issues.push({
        line: lineNumber,
        raw,
        reason: 'inactive',
        detail: `"${product.name}" (${product.sku}) is not an active product.`,
      })
      return
    }

    const qty = readQuantity(cells[1])
    if (!('qty' in qty)) {
      const detail =
        qty.reason === 'missing_quantity'
          ? `"${product.sku}" has no quantity beside it.`
          : qty.reason === 'not_positive'
            ? `A quantity must be more than zero — "${product.sku}" has "${cells[1]}".`
            : `"${cells[1]}" is not a whole number of ${product.unit ?? 'units'}.`
      issues.push({ line: lineNumber, raw, reason: qty.reason, detail })
      return
    }

    const existing = byProduct.get(product.id)
    if (existing) {
      existing.quantity += qty.qty
      return
    }
    const line: ParsedOrderLine = {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: qty.qty,
    }
    byProduct.set(product.id, line)
    lines.push(line)
  })

  return { lines, issues }
}
