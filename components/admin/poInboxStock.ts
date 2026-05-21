// Per-line stock classification for the PO Inbox review modal.
//
// Approving an inbound PO no longer blocks on short stock (the customer
// already placed the order and approve-po does not decrement inventory), so
// the operator instead needs an at-a-glance signal per line:
//
//   out_of_stock  — nothing on hand (inventory <= 0)
//   insufficient  — some stock, but less than this line orders (can't fully fill)
//   low_stock     — covers the order but sits under the low-stock threshold
//   ok            — comfortably in stock
//
// Thresholds mirror the app-wide convention (ProductCard / StockView): the
// configurable app_settings.low_stock_threshold, default 10.

export type LineStockKind = 'out_of_stock' | 'insufficient' | 'low_stock' | 'ok'

export interface LineStockStatus {
  kind: LineStockKind
  available: number
  ordered: number
}

export function lineStockStatus(
  inventory: number,
  ordered: number,
  lowThreshold = 10,
): LineStockStatus {
  const available = Number.isFinite(inventory) ? inventory : 0
  const orderedQty = Number.isFinite(ordered) ? ordered : 0

  let kind: LineStockKind
  if (available <= 0) {
    kind = 'out_of_stock'
  } else if (available < orderedQty) {
    kind = 'insufficient'
  } else if (available < lowThreshold) {
    kind = 'low_stock'
  } else {
    kind = 'ok'
  }

  return { kind, available, ordered: orderedQty }
}
