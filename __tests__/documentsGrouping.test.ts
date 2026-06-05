import { describe, it, expect } from 'vitest';
import { groupByOrder, type OrderDocGroup } from '../components/inventory/DocumentsView';
import type { OrderDocumentView } from '../services/supabase/orderDocumentService';
import type { OrderDocumentType } from '../types';

// Build an OrderDocumentView. `docs` arrive newest-first from the query
// (generated_at desc), which groupByOrder relies on.
const view = (id: number, orderId: string, docType: OrderDocumentType, generatedAt: string, horecaName = 'Lotus Garden'): OrderDocumentView => ({
  doc: { id, orderId, docType, storagePath: `${orderId}/${docType}-${id}.pdf`, generatedAt },
  orderStatus: 'picked',
  horecaName,
});

describe('groupByOrder', () => {
  it('collapses to one group per order, preserving first-seen (newest) order', () => {
    const groups = groupByOrder([
      view(5, 'ORD-2', 'pick_slip', '2026-06-05T05:00:00Z'),
      view(4, 'ORD-1', 'dispatch_advice', '2026-06-05T04:00:00Z'),
      view(3, 'ORD-1', 'pick_slip', '2026-06-05T03:00:00Z'),
    ]);
    expect(groups.map((g) => g.orderId)).toEqual(['ORD-2', 'ORD-1']);
  });

  it('splits each order into newest-first pick-slip / dispatch-advice arrays', () => {
    const [g] = groupByOrder([
      view(9, 'ORD-1', 'pick_slip', '2026-06-05T09:00:00Z'),       // latest pick slip
      view(7, 'ORD-1', 'pick_slip', '2026-06-05T07:00:00Z'),       // older pick slip
      view(8, 'ORD-1', 'dispatch_advice', '2026-06-05T08:00:00Z'), // only dispatch advice
    ]) as [OrderDocGroup];
    expect(g.pickSlips.map((d) => d.id)).toEqual([9, 7]); // newest-first → [0] is latest
    expect(g.dispatchAdvices.map((d) => d.id)).toEqual([8]);
  });

  it('leaves a missing type as an empty array', () => {
    const [g] = groupByOrder([view(1, 'ORD-3', 'pick_slip', '2026-06-05T01:00:00Z')]);
    expect(g.pickSlips).toHaveLength(1);
    expect(g.dispatchAdvices).toHaveLength(0);
  });

  it('returns nothing for an empty input', () => {
    expect(groupByOrder([])).toEqual([]);
  });
});
