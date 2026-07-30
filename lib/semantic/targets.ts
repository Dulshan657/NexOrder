// Sales-target attainment.
//
// This existed in FOUR places before this file: AdminDashboard.tsx:480,
// SalesDashboard.tsx:426, RepDashboardV2.tsx:398 and
// services/targetProjectionService.ts:5 — and they disagreed. The dashboards
// bounded the window with `endDate + 'T23:59:59'` (dropping the final second);
// the service used `<= new Date(endDate)`, i.e. midnight, dropping the entire
// last day. `computeWeeklyPace:113` documented its own wrong third definition of
// new_horecas in a comment: "Simplified: count unique customer IDs".
//
// Attainment is not a new definition here. It is a COMPOSITION of registry
// metrics over the filter the target itself describes, which is why there is
// nothing left to disagree about.

import type { SalesTarget } from '../../types'
import { evaluateMetric } from './evaluate'
import type { MetricContext, OrderFilter } from './types'

/** The scope a target describes: its window, for its owner. */
export function targetFilter(target: SalesTarget): OrderFilter {
  return {
    from: new Date(target.startDate),
    to: new Date(target.endDate),
    repId: target.userId,
  }
}

/** Which registry metric answers each target type. */
const METRIC_BY_TARGET_TYPE: Readonly<Record<string, string>> = {
  revenue: 'sales.revenue',
  orders: 'sales.orderCount',
  new_horecas: 'sales.newCustomerCount',
}

/**
 * What the target owner has actually achieved so far.
 *
 * Returns 0 for an unrecognised target type rather than throwing — a target row
 * with a type this build does not know about should render as "no progress",
 * not crash the dashboard it sits on.
 */
export function computeTargetAchieved(target: SalesTarget, ctx: MetricContext): number {
  const metricId = METRIC_BY_TARGET_TYPE[target.type]
  if (!metricId) return 0
  return evaluateMetric<number>(metricId, ctx, targetFilter(target))
}

export interface TargetProgress {
  achieved: number
  /** Percentage of target, capped at 100 for bar rendering. 0 when the target is 0. */
  percent: number
}

/**
 * Attainment plus the capped percentage every caller derived by hand. The cap is
 * preserved from the dashboards (`Math.min(..., 100)`) so an over-performing rep
 * does not render a bar wider than its track.
 */
export function computeTargetProgress(target: SalesTarget, ctx: MetricContext): TargetProgress {
  const achieved = computeTargetAchieved(target, ctx)
  const percent = target.targetValue > 0
    ? Math.min((achieved / target.targetValue) * 100, 100)
    : 0
  return { achieved, percent }
}
