import React from 'react';
import type { Order, User } from '../../types';
import { Truck, PackageCheck, Clock, ChevronRight } from 'lucide-react';
import { canSeeOrderValue } from '../../lib/canSeeOrderValue';

interface DispatchedOrdersViewProps {
  orders: Order[];
  currentUser?: User;
  onViewDetail?: (orderId: string) => void;
}

/** ISO timestamp the order was marked dispatched, falling back to order date. */
function dispatchedAt(order: Order): string {
  const entry = order.statusHistory?.find((s) => s.status === 'dispatched');
  return entry?.timestamp ?? order.orderDate;
}

const OrderRow: React.FC<{ order: Order; showValue: boolean; onOpen?: () => void }> = ({ order, showValue, onOpen }) => {
  const itemCount = order.items.length;
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-4 w-full px-4 py-3.5 text-left hover:bg-stone-50/70 btn-press"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-display font-bold text-stone-900 truncate">{order.id}</p>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-teal-50 text-teal-700">
            Dispatched
          </span>
        </div>
        <p className="text-xs text-stone-500 mt-0.5 truncate">{order.hoReCa.name}</p>
      </div>
      <div className="hidden sm:flex flex-col items-start text-xs text-stone-400 shrink-0 w-32">
        <span className="inline-flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5" />
          {dispatchedAt(order).slice(0, 10)}
        </span>
        <span className="inline-flex items-center gap-1.5 mt-0.5">
          <Clock className="w-3.5 h-3.5" />
          {order.deliveryDate ? order.deliveryDate.slice(0, 10) : 'no date'}
        </span>
      </div>
      <div className="shrink-0 w-28 text-right">
        {showValue && <span className="font-mono text-sm text-stone-900">${order.total.toFixed(2)}</span>}
        <p className="text-[11px] text-stone-400">
          {itemCount} line{itemCount === 1 ? '' : 's'}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-stone-300 shrink-0" />
    </button>
  );
};

const DispatchedOrdersView: React.FC<DispatchedOrdersViewProps> = ({ orders, currentUser, onViewDetail }) => {
  const showValue = canSeeOrderValue(currentUser?.role);
  const dispatched = orders
    .filter((o) => o.status === 'dispatched')
    .sort((a, b) => dispatchedAt(b).localeCompare(dispatchedAt(a)));

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-500/10">
          <Truck className="w-5 h-5 text-teal-600" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Dispatched</h1>
          <p className="text-xs text-stone-500 mt-0.5">Orders that have left the warehouse, most recent first.</p>
        </div>
      </div>

      {dispatched.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <PackageCheck className="w-9 h-9 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-600">No dispatched orders yet</p>
          <p className="text-xs text-stone-400 mt-1">Orders appear here once they're dispatched from the Pick Queue.</p>
        </div>
      ) : (
        <div className="glass-card rounded-xl divide-y divide-stone-100 overflow-hidden">
          {dispatched.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              showValue={showValue}
              onOpen={onViewDetail ? () => onViewDetail(order.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default DispatchedOrdersView;
