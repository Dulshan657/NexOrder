import React from 'react';
import { Warehouse as WarehouseIcon, ChevronRight, CheckCircle2 } from 'lucide-react';
import type { Order, OrderStatus, FulfillmentStatus } from '../types';

const LADDER: FulfillmentStatus[] = ['processed', 'picked', 'packed', 'dispatched', 'delivered'];

const STATUS_META: Record<FulfillmentStatus, { label: string; cls: string }> = {
  processed: { label: 'Processed', cls: 'bg-stone-100 text-stone-600' },
  picked: { label: 'Picked', cls: 'bg-emerald-50 text-emerald-700' },
  packed: { label: 'Packed', cls: 'bg-amber-50 text-amber-700' },
  dispatched: { label: 'Dispatched', cls: 'bg-nexgen-blue/10 text-nexgen-blue' },
  delivered: { label: 'Delivered', cls: 'bg-violet-50 text-violet-700' },
};

interface OrderFulfillmentsPanelProps {
  order: Order;
  /** Admin/Manager can advance any site; Warehouse only their own. Others read-only. */
  canAdvanceAll: boolean;
  homeWarehouseId?: number;
  onAdvance?: (orderId: string, nextStatus: OrderStatus, locationId: number) => void;
}

/** Per-warehouse fulfilment rows — lets Admin/Manager see at a glance that one
 * DC has dispatched its portion while another is still picking, and advance each
 * site independently. */
const OrderFulfillmentsPanel: React.FC<OrderFulfillmentsPanelProps> = ({
  order,
  canAdvanceAll,
  homeWarehouseId,
  onAdvance,
}) => {
  const fulfilments = order.fulfillments ?? [];
  if (fulfilments.length === 0) return null;

  const multi = fulfilments.length > 1;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <WarehouseIcon className="w-4 h-4 text-nexgen-blue" />
        <h3 className="text-sm font-display font-bold text-stone-900">
          Fulfilment{multi ? ` · ${fulfilments.length} warehouses` : ''}
        </h3>
        {multi && (
          <span className="text-[11px] text-stone-500">overall: {order.status}</span>
        )}
      </div>

      <div className="space-y-2">
        {fulfilments.map((f) => {
          const meta = STATUS_META[f.status] ?? { label: f.status, cls: 'bg-stone-100 text-stone-600' };
          const idx = LADDER.indexOf(f.status);
          const next = idx >= 0 && idx < LADDER.length - 1 ? LADDER[idx + 1] : null;
          const canAdvanceThis = !!onAdvance && next != null && (canAdvanceAll || homeWarehouseId === f.locationId);

          return (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-stone-200">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-900 truncate">{f.warehouseName ?? `Warehouse ${f.locationId}`}</p>
              </div>
              <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${meta.cls}`}>
                {f.status === 'delivered' && <CheckCircle2 className="w-3 h-3" />}
                {meta.label}
              </span>
              {canAdvanceThis && next && (
                <button
                  onClick={() => onAdvance!(order.id, next, f.locationId)}
                  className="inline-flex items-center gap-0.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-nexgen-blue text-white hover:bg-nexgen-blue/90 btn-press"
                >
                  Mark {STATUS_META[next].label.toLowerCase()} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderFulfillmentsPanel;
