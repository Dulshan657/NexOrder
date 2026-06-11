/**
 * Derive an order's overall status from its per-warehouse fulfillment statuses.
 *
 * With split fulfilment, one order can be "WH1 dispatched, WH2 still picking".
 * The overall status is the LEAST-ADVANCED fulfilment on the lifecycle ladder
 * (the slowest site gates the order). This is the single source of truth used
 * both to write orders.status server-side and to render "Partially dispatched"
 * style labels client-side.
 *
 * KEEP IN SYNC with supabase/functions/_shared/orderStatusRollup.ts. Parity is
 * asserted in __tests__/orderStatusRollup.test.ts.
 */
import type { OrderStatus } from '../types';

/** A fulfilment never sits in the pre-processing 'processing' stage. */
export type FulfillmentStatus = 'processed' | 'picked' | 'packed' | 'dispatched' | 'delivered';

const LADDER: ReadonlyArray<OrderStatus> = [
  'processing',
  'processed',
  'picked',
  'packed',
  'dispatched',
  'delivered',
];

export function rollupOrderStatus(statuses: ReadonlyArray<FulfillmentStatus>): OrderStatus {
  if (statuses.length === 0) return 'processing';

  let minIdx = LADDER.length - 1;
  for (const s of statuses) {
    const i = LADDER.indexOf(s);
    if (i >= 0 && i < minIdx) minIdx = i;
  }
  return LADDER[minIdx];
}
