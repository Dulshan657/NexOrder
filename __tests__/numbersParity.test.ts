// One data set, three readers: Nex (get_sales_summary), the Admin Dashboard's
// Orders KPI (sales.orderCount over dashboardRange) and the order pipeline card
// (computeDispatchFunnel). For the same period they must give the same numbers,
// stage by stage, or the owner is told two different things about one month.

import { describe, expect, it } from 'vitest'
import { runVoiceTool } from '../lib/voice/runVoiceTool'
import { evaluateMetric } from '../lib/semantic'
import { dashboardRange } from '../lib/period'
import { computeDispatchFunnel } from '../services/inventoryDashboardService'
import { C1, MANAGER, NOW, P1, REP_A, buildOrders, ctxFor, order } from './voice/voiceFixtures'

describe('order numbers parity', () => {
  it('Nex, the Orders KPI and the pipeline agree for This month', () => {
    // One order still in the warehouse and one more cancelled this month, so every
    // reader has an open stage and cancelled orders to disagree about.
    const orders = [
      ...buildOrders(),
      order('OPEN', REP_A, C1, 2, [[P1, 1]], 'packed'),
      order('VOID', REP_A, C1, 3, [[P1, 1]], 'cancelled'),
    ]
    const ctx = ctxFor(MANAGER, { orders })

    const nex = runVoiceTool('get_sales_summary', { period: 'this_month' }, ctx)
    if (nex.ok === false) throw new Error(nex.error)
    const nexData = nex.data as { orderCount: number; ordersByStatus: Array<{ status: string; count: number }> }

    const range = dashboardRange('this_month', NOW)
    const kpi = evaluateMetric<number>(
      'sales.orderCount',
      { orders, products: [], settings: { lowStockThreshold: 10 }, now: NOW },
      { from: range.from, to: range.to },
    )

    const pipeline = computeDispatchFunnel(orders, 'month', NOW)
    const pipelineTotal = pipeline.stages.reduce((sum, s) => sum + s.count, 0)

    // Placed 1 to 20 Oct and not cancelled: O12 (6 Oct), O7 (8 Oct), O8 (12 Oct), OPEN (18 Oct).
    expect(kpi).toBe(4)
    expect(nexData.orderCount).toBe(kpi)
    expect(pipelineTotal).toBe(kpi)
    expect(nexData.ordersByStatus).toEqual(
      pipeline.stages.filter((s) => s.count > 0).map((s) => ({ status: s.status, count: s.count })),
    )
    // O13 (one day ago) and VOID (three days ago) are in no count; the pipeline
    // reports exactly those two beside the chart.
    expect(pipeline.cancelled).toBe(2)
  })
})
