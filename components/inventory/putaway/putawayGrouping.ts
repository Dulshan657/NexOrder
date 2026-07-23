// Search, filter and receipt-grouping for the putaway queue. Pure and IO-free
// so the queue's list logic is testable without mounting the view.

import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'

/** `placeable` = the engine found a bin; `unplaceable` = it didn't and the row
 *  needs a manual bin or a re-run. */
export type QueueStateFilter = 'all' | 'placeable' | 'unplaceable'

export interface QueueFilter {
  query?: string
  state?: QueueStateFilter
  /** Bin code per location id, so a search can match the destination too. */
  codeById?: ReadonlyMap<number, string>
}

/** Rows matching a free-text query (product name, SKU, supplier, receipt
 *  reference, destination bin code) and a placeability filter. Preserves the
 *  input order, which is already newest-first from the service. */
export function filterQueue(
  rows: readonly PendingPutawayRow[],
  { query, state = 'all', codeById }: QueueFilter = {},
): PendingPutawayRow[] {
  const q = (query ?? '').trim().toLowerCase()
  return rows.filter((row) => {
    if (state === 'placeable' && row.recommendedLocationId == null) return false
    if (state === 'unplaceable' && row.recommendedLocationId != null) return false
    if (!q) return true

    const binCode = row.recommendedLocationId != null
      ? codeById?.get(row.recommendedLocationId) ?? ''
      : ''
    const haystack = [
      row.product?.name,
      row.product?.sku,
      row.receipt?.supplierName,
      row.receipt?.reference,
      binCode,
      `#${row.productId}`,
    ]
    return haystack.some((field) => field != null && String(field).toLowerCase().includes(q))
  })
}

export interface PutawayGroup {
  /** Receipt id, or null for rows that arrived by adjustment / transfer-in. */
  receiptId: number | null
  label: string
  supplierName: string | null
  receivedDate: string | null
  rows: PendingPutawayRow[]
}

/**
 * Rows bucketed by their goods receipt so one delivery can be worked as a unit.
 * Group order follows first appearance in `rows` (newest-first from the
 * service); the unlinked bucket always sorts last because it isn't a delivery.
 */
export function groupByReceipt(rows: readonly PendingPutawayRow[]): PutawayGroup[] {
  const groups = new Map<number | null, PutawayGroup>()

  for (const row of rows) {
    const key = row.receipt?.id ?? null
    let group = groups.get(key)
    if (!group) {
      group = {
        receiptId: key,
        label: key == null
          ? 'Not from a delivery'
          : row.receipt?.reference?.trim() || `Receipt #${key}`,
        supplierName: row.receipt?.supplierName ?? null,
        receivedDate: row.receipt?.receivedDate ?? null,
        rows: [],
      }
      groups.set(key, group)
    }
    group.rows.push(row)
  }

  const ordered = [...groups.values()]
  return [
    ...ordered.filter((g) => g.receiptId != null),
    ...ordered.filter((g) => g.receiptId == null),
  ]
}

/** Rows an "accept all" can action — the engine has to have picked a bin. */
export function placeableRows(rows: readonly PendingPutawayRow[]): PendingPutawayRow[] {
  return rows.filter((r) => r.recommendedLocationId != null)
}
