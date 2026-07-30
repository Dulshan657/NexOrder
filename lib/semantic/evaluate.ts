// Evaluating a metric. Thin on purpose — the meaning lives in the registry, and
// this file only enforces the rules that no individual metric can enforce alone.

import { getMetric } from './registry'
import type { MetricContext, OrderFilter } from './types'

/**
 * Evaluate a metric by id.
 *
 * Throws when a line-level (`category`) scope is applied to a metric built on the
 * stored order total. That combination has no correct answer: an order's total
 * belongs to the whole order, so "revenue for category X" computed from stored
 * totals over-counts every mixed-category order. Failing loudly is the point —
 * silently returning the over-counted number is what a semantic layer exists to
 * prevent. Ask for `sales.lineRevenue` instead.
 */
export function evaluateMetric<TValue = unknown>(
  id: string,
  ctx: MetricContext,
  filter: OrderFilter = {},
): TValue {
  const def = getMetric(id)

  if (filter.category !== undefined && !def.supportsLineScope) {
    throw new Error(
      `[semantic] ${id} does not accept a line-level scope (category=${String(filter.category)}). ` +
        `It is built on the stored order total, which cannot be attributed to one category. ` +
        `Use a line-based metric such as sales.lineRevenue.`,
    )
  }

  return def.compute(ctx, filter) as TValue
}

/**
 * Evaluate several metrics over one context and filter. Convenience for a tile
 * row; identical to calling `evaluateMetric` per id.
 */
export function evaluateMetrics(
  ids: readonly string[],
  ctx: MetricContext,
  filter: OrderFilter = {},
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const id of ids) out[id] = evaluateMetric(id, ctx, filter)
  return out
}
