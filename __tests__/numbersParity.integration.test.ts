/**
 * NX-0008 — order numbers parity on dev's REAL orders.
 *
 * __tests__/numbersParity.test.ts proves Nex, the dashboard's Orders KPI and the
 * order pipeline agree on a fixture. This proves they agree with the database:
 * every figure is also computed here in plain SQL, written independently of the
 * TypeScript (Sydney calendar via AT TIME ZONE, shipping from status_history),
 * so a shared mistake in lib/period or the semantic layer cannot pass both.
 *
 * Read-only, inside BEGIN … ROLLBACK like every integration test.
 * Run with: `npm run test:integration -- numbersParity` (dev credentials).
 */
import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { withRollbackTx } from './support/pgTestClient'
import { sqlTruth } from './support/orderNumbersSql'
import { toOrders } from '../lib/adapters'
import { runVoiceTool } from '../lib/voice/runVoiceTool'
import type { VoiceToolContext } from '../lib/voice/context'
import { evaluateMetric } from '../lib/semantic'
import { dashboardRange } from '../lib/period'
import { computeDispatchFunnel } from '../services/inventoryDashboardService'
import { UserRole } from '../types'
import type { Order } from '../types'

/** Every order, adapted by the app's own adapter, as the dashboard and Nex receive them. */
async function appOrders(client: pg.Client): Promise<Order[]> {
  const rows = await client.query(
    `SELECT o.id, o.horeca_id, o.submitted_by, o.status, o.total, o.notes, o.status_history,
            o.delivery_date, o.delivery_time_slot, o.delivery_address,
            to_char(o.order_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS order_date,
            '[]'::json AS order_items
     FROM public.orders o`,
  )
  return toOrders(rows.rows as never[], [], [], [])
}

// No skip: without dev credentials this fails loudly rather than passing silently.
describe('order numbers parity on dev (live)', () => {
  it('Nex, the Orders KPI and the pipeline all match SQL for this month', async () => {
    await withRollbackTx(async (client) => {
      const truth = await sqlTruth(client)
      const orders = await appOrders(client)
      const now = truth.now

      const ctx: VoiceToolContext = {
        orders,
        products: [],
        hoReCas: [],
        salesTargets: [],
        visits: [],
        routes: [],
        settings: { lowStockThreshold: 10 },
        now,
        user: { numericId: 1, uuid: '00000000-0000-4000-8000-000000000001', role: UserRole.ADMIN, name: 'Parity' },
        modules: ['sales_orders', 'shop', 'inventory_dispatch', 'field_ops', 'voice_assistant'],
      } as VoiceToolContext
      const nex = runVoiceTool('get_sales_summary', { period: 'this_month', compare_previous: false }, ctx)
      if (nex.ok === false) throw new Error(nex.error)
      const said = nex.data as {
        orderCount: number
        ordersByStatus: Array<{ status: string; count: number }>
        shippedCount: number
        shippedByStatus: { dispatched: number; delivered: number }
        stillInWarehouse: number
      }

      const range = dashboardRange('this_month', now)
      const kpi = evaluateMetric<number>(
        'sales.orderCount',
        { orders, products: [], settings: { lowStockThreshold: 10 }, now },
        { from: range.from, to: range.to },
      )
      const pipeline = computeDispatchFunnel(orders, 'month', now)

      // The figures, printed so a run doubles as the answer to "what is true on dev".
      console.info('[parity] this month on dev', JSON.stringify({ truth, nex: said, kpi, pipelineCancelled: pipeline.cancelled }))

      expect(kpi).toBe(truth.placed)
      expect(said.orderCount).toBe(truth.placed)
      expect(Object.fromEntries(said.ordersByStatus.map((s) => [s.status, s.count]))).toEqual(truth.placedByStatus)
      expect(Object.fromEntries(pipeline.stages.filter((s) => s.count > 0).map((s) => [s.status, s.count]))).toEqual(
        truth.placedByStatus,
      )
      expect(pipeline.cancelled).toBe(truth.cancelled)
      expect(said.shippedCount).toBe(truth.shipped)
      expect(said.shippedByStatus).toEqual({ dispatched: truth.shippedDispatched, delivered: truth.shippedDelivered })
      expect(said.stillInWarehouse).toBe(truth.stillInWarehouse)
    })
  })
})
