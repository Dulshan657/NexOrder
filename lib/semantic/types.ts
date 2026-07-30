// The semantic layer's vocabulary.
//
// A metric here is data plus a pure function, not just a function. The prose in
// `description` is the deliverable as much as the number is: before this module
// existed there was nowhere to look up what "revenue" meant, and the copies
// scattered through the dashboards disagreed.

import type { Category, Order, OrderStatus, Product, UserRole } from '../../types'

/** What a metric's value means, so callers format it without guessing. */
export type MetricUnit = 'currency' | 'count' | 'ratio' | 'quantity'

/**
 * What a metric returns.
 *
 * - `scalar`    — a single number, formatted with `unit`.
 * - `series`    — rows ordered for plotting (by date, or ranked descending).
 * - `rows`      — a set of entities; `unit` describes the notable numeric field.
 * - `breakdown` — a fixed-key object of numbers that sum to a whole.
 *
 * Without this, `getMetric(id)` tells a caller the unit of a value whose very
 * shape it has to guess.
 */
export type MetricShape = 'scalar' | 'series' | 'rows' | 'breakdown'

export interface MetricSettings {
  /**
   * `app_settings.low_stock_threshold` — the fallback low-stock boundary for a
   * product with no `reorderPoint` of its own.
   */
  lowStockThreshold: number
}

/**
 * Everything a metric may read. Rows come from the TanStack cache the dashboards
 * already hold, so evaluating a metric costs no I/O.
 *
 * `now` is injected and never read from the clock inside a metric — that is what
 * makes every metric deterministic and testable, following the precedent set by
 * `computeDispatchFunnel(orders, windowDays, now)`.
 */
export interface MetricContext {
  orders: readonly Order[]
  products: readonly Product[]
  settings: MetricSettings
  now: Date
}

export type MetricContextKey = keyof MetricContext

/**
 * Order scoping. Every metric applies these through the single `filterOrders`
 * implementation, so two surfaces asking for the same metric over the same
 * window cannot disagree about what the window means. Three different spellings
 * of "inclusive date range" existed before this type did.
 */
export interface OrderFilter {
  /** Inclusive lower bound on `orderDate`, as an exact instant. */
  from?: Date
  /**
   * Inclusive upper bound, as an exact instant.
   *
   * For a range picked as two calendar dates, build these with `dayRange()`
   * rather than by hand — that is the one place that knows an inclusive whole-day
   * range ends at 23:59:59.999 UTC.
   */
  to?: Date
  horecaId?: number
  /** `submittedBy.id`. */
  repId?: number
  /** Role of the submitter. */
  userRole?: UserRole
  statuses?: readonly OrderStatus[]
  /**
   * LINE-level scope: narrows each order's items to one category and drops
   * orders left with none.
   *
   * An order's stored `total` cannot be attributed to a single category, so a
   * filter carrying `category` makes stored-total metrics unanswerable.
   * `evaluateMetric` throws rather than returning a number nobody should trust;
   * use `sales.lineRevenue` instead. Metrics declare their stance in
   * `supportsLineScope`.
   */
  category?: Category
}

export interface MetricDef<TValue = unknown> {
  /** `<domain>.<name>`, e.g. `sales.revenue`. Also the key in the registry. */
  id: string
  /** Short human label for a tile or legend. */
  label: string
  /** What is counted and what is excluded, in prose. Not optional, by test. */
  description: string
  unit: MetricUnit
  shape: MetricShape
  /** Which context slices this metric reads. */
  requires: readonly MetricContextKey[]
  /** Whether a line-level (`category`) scope is meaningful for this metric. */
  supportsLineScope: boolean
  compute(ctx: MetricContext, filter: OrderFilter): TValue
}
