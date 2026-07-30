// React access to the semantic layer.
//
// The dashboards receive their rows as props (allOrders, products,
// lowStockThreshold), so these hooks assemble a MetricContext from what a
// component already holds rather than fetching anything. Evaluating a metric is
// pure and cheap; the memoisation here is about keeping object identity stable
// so downstream memos are not invalidated every render.

import { useMemo } from 'react';

import { evaluateMetric } from '../lib/semantic/evaluate';
import type { MetricContext, OrderFilter } from '../lib/semantic/types';
import type { Order, Product } from '../types';

export interface MetricContextInput {
  orders: readonly Order[];
  products?: readonly Product[];
  /** `app_settings.low_stock_threshold`. Same default the dashboards use. */
  lowStockThreshold?: number;
  /**
   * The clock. Captured once per mount when omitted, so a metric's value does
   * not shift mid-render. Pass an explicit value when the caller already owns a
   * period boundary and wants both to agree.
   */
  now?: Date;
}

export function useMetricContext(input: MetricContextInput): MetricContext {
  const { orders, products, lowStockThreshold = 10, now } = input;

  // Stable unless explicitly provided: one clock reading per mount.
  const mountedAt = useMemo(() => new Date(), []);

  return useMemo(
    () => ({
      orders,
      products: products ?? [],
      settings: { lowStockThreshold },
      now: now ?? mountedAt,
    }),
    [orders, products, lowStockThreshold, now, mountedAt],
  );
}

/**
 * Evaluate one metric, memoised on the context and the filter's fields.
 *
 * The filter is spread into the dependency list rather than compared by
 * identity, so a caller may pass a fresh object literal each render — which is
 * what every call site naturally does — without defeating the memo.
 */
export function useMetric<TValue = unknown>(
  id: string,
  ctx: MetricContext,
  filter: OrderFilter = {},
): TValue {
  const { from, to, horecaId, repId, userRole, statuses, category } = filter;
  return useMemo(
    () => evaluateMetric<TValue>(id, ctx, { from, to, horecaId, repId, userRole, statuses, category }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, ctx, from?.getTime(), to?.getTime(), horecaId, repId, userRole, statuses, category],
  );
}
