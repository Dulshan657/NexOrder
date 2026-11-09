// Pure pieces of rescore-open-putaway.mjs, kept apart so they can be tested
// without a database or a login (__tests__/rescoreOpenPutaway.test.ts).

/**
 * The recommend-putaway body that re-scores one open task.
 *
 * The plate (hu_id/hu_type) goes along ONLY with its goods receipt:
 * recommend-putaway refuses an hu_id that is not on goods_receipt_id (NX-0032),
 * and a task with no receipt (opening stock, adjustments) has nothing to check
 * the plate against. Without the plate the line is re-scored as loose units.
 *
 * @param {{ warehouseId: number, rowId: number,
 *           cur: { product_id: number, quantity: number|string, goods_receipt_id?: number|null },
 *           hu: { id: number, hu_type: string } | null | undefined }} input
 */
export function buildRescoreBody({ warehouseId, rowId, cur, hu }) {
  const hasReceipt = cur.goods_receipt_id != null
  /** @type {Record<string, unknown>} */
  const line = { product_id: cur.product_id, quantity: Number(cur.quantity) }
  if (hasReceipt && hu) {
    line.hu_id = hu.id
    line.hu_type = hu.hu_type
  }
  return {
    warehouse_id: warehouseId,
    goods_receipt_id: hasReceipt ? cur.goods_receipt_id : undefined,
    replaces_recommendation_id: rowId,
    lines: [line],
  }
}

/** The server's own words for a failed invoke, else the error's message. */
async function refusalReason(error) {
  const context = error?.context
  if (context && typeof context.clone === 'function') {
    try {
      const body = await context.clone().json()
      const message = body?.error?.message
      if (typeof message === 'string' && message.trim()) return message.trim()
    } catch {
      // Not JSON, or already read: fall back to the error's own message.
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return String(error ?? 'unknown error')
}

/**
 * Re-score one task. Never throws: a refused (or failed) row comes back as
 * `{ ok: false, skipped: { id, reason } }` so the run can log it and go on.
 *
 * @param {(fn: string, opts: { body: unknown }) => Promise<{ data: any, error: any }>} invoke
 * @param {number} rowId
 * @param {unknown} body
 */
export async function rescoreRow(invoke, rowId, body) {
  try {
    const { data, error } = await invoke('recommend-putaway', { body })
    if (error) return { ok: false, skipped: { id: rowId, reason: await refusalReason(error) } }
    return { ok: true, recs: data?.recommendations ?? [] }
  } catch (err) {
    return { ok: false, skipped: { id: rowId, reason: await refusalReason(err) } }
  }
}

/** The closing lines that name every skipped task. */
export function formatSkippedSummary(skipped) {
  if (skipped.length === 0) return ['[rescore] skipped 0 task(s).']
  return [
    `[rescore] skipped ${skipped.length} task(s); not re-scored, still open on the queue:`,
    ...skipped.map((s) => `  ${s.id}: ${s.reason}`),
  ]
}
