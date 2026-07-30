// Public surface of the semantic layer. Import from here rather than reaching
// into the individual modules, so the internal file split stays free to change.

export { METRICS, getMetric, listMetrics } from './registry'
export { evaluateMetric, evaluateMetrics } from './evaluate'
export { dayRange, filterOrders, rangeBounds, withinRange } from './filter'
export { computeTargetAchieved, computeTargetProgress, targetFilter } from './targets'
export type { RangeBounds } from './filter'
export type { TargetProgress } from './targets'
export type {
  MetricContext,
  MetricContextKey,
  MetricDef,
  MetricSettings,
  MetricShape,
  MetricUnit,
  OrderFilter,
} from './types'
export type {
  CategoryRevenue,
  CustomerRevenue,
  DateRevenue,
  ProductUnits,
  RepRevenue,
  StatusCount,
} from './metrics/sales'
