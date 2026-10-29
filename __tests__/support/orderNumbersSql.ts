/**
 * NX-0008 — "this month" order numbers computed in plain SQL, as ground truth.
 *
 * Written independently of the TypeScript under test: the Sydney calendar via
 * AT TIME ZONE, not lib/period; shipping from status_history JSON, not
 * sales.shippedCount. Shared by the live parity test
 * (__tests__/numbersParity.integration.test.ts) and the dashboard end-to-end
 * spec (tests/e2e/order-numbers.spec.ts), so both check against one truth.
 */
import type pg from 'pg'

const TZ = 'Australia/Sydney'

// This calendar month in Sydney, up to the end of today in Sydney: the window Nex
// and the dashboard mean by "this month".
const MONTH_SQL = `
  order_date >= (date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')
  AND order_date < ((date_trunc('day', now() AT TIME ZONE '${TZ}') + interval '1 day') AT TIME ZONE '${TZ}')`

const FIRST_SHIPPED_SQL = `(
  SELECT min((e->>'timestamp')::timestamptz)
  FROM jsonb_array_elements(COALESCE(o.status_history, '[]'::jsonb)) e
  WHERE e->>'status' IN ('dispatched', 'delivered'))`

export interface SqlTruth {
  now: Date
  placed: number
  placedByStatus: Record<string, number>
  cancelled: number
  shipped: number
  shippedDispatched: number
  shippedDelivered: number
  stillInWarehouse: number
}

export async function sqlTruth(client: pg.Client): Promise<SqlTruth> {
  const now = (await client.query<{ now: Date }>('SELECT now() AS now')).rows[0].now
  const placed = await client.query<{ status: string; n: string }>(
    `SELECT status, count(*) AS n FROM public.orders WHERE ${MONTH_SQL} GROUP BY status`,
  )
  const byStatus: Record<string, number> = {}
  for (const row of placed.rows) byStatus[row.status] = Number(row.n)
  const shipped = await client.query<{ status: string; n: string }>(
    `SELECT o.status, count(*) AS n FROM public.orders o
     WHERE o.status <> 'cancelled'
       AND ${FIRST_SHIPPED_SQL} >= (date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')
       AND ${FIRST_SHIPPED_SQL} < ((date_trunc('day', now() AT TIME ZONE '${TZ}') + interval '1 day') AT TIME ZONE '${TZ}')
     GROUP BY o.status`,
  )
  const shippedBy: Record<string, number> = {}
  for (const row of shipped.rows) shippedBy[row.status] = Number(row.n)
  const open = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM public.orders WHERE status IN ('processing','processed','picked','packed')`,
  )
  const { cancelled = 0, ...live } = byStatus
  return {
    now,
    placed: Object.values(live).reduce((a, b) => a + b, 0),
    placedByStatus: live,
    cancelled,
    shipped: Object.values(shippedBy).reduce((a, b) => a + b, 0),
    shippedDispatched: Object.entries(shippedBy).filter(([s]) => s !== 'delivered').reduce((a, [, n]) => a + n, 0),
    shippedDelivered: shippedBy.delivered ?? 0,
    stillInWarehouse: Number(open.rows[0].n),
  }
}
