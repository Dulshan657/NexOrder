/**
 * Derive an order's overall status from its per-warehouse fulfillment statuses
 * — Deno/Edge-Function twin of lib/orderStatusRollup.ts. Overall = least-advanced
 * fulfilment on the ladder (slowest site gates the order). Pure TypeScript so
 * the vitest parity test can import both. KEEP IN SYNC with the client copy.
 */

export type OrderStatus =
  | 'processing'
  | 'processed'
  | 'picked'
  | 'packed'
  | 'dispatched'
  | 'delivered';

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
