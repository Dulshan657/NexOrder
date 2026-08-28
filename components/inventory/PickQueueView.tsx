import React, { useState } from 'react';
import { usePickQueue } from '../../hooks/queries/usePickQueue';
import type { PickQueueOrder } from '../../services/supabase/pickService';
import PickWorkspaceModal from './PickWorkspaceModal';
import { ClipboardCheck, PackageCheck, Clock, ChevronRight } from 'lucide-react';
import type { User } from '../../types';
import { UserRole } from '../../types';

const statusBadge: Record<string, { label: string; cls: string }> = {
  processed: { label: 'Ready to pick', cls: 'bg-nexgen-blue/10 text-nexgen-blue' },
  picked: { label: 'Picked', cls: 'bg-emerald-50 text-emerald-700' },
  packed: { label: 'Packed', cls: 'bg-amber-50 text-amber-700' },
};

const OrderRow: React.FC<{ order: PickQueueOrder; onOpen: () => void }> = ({ order, onOpen }) => {
  const totalOrdered = order.lines.reduce((s, l) => s + l.quantity, 0);
  const totalPicked = order.lines.reduce((s, l) => s + Math.min(l.picked, l.quantity), 0);
  const pct = totalOrdered > 0 ? Math.round((totalPicked / totalOrdered) * 100) : 0;
  const badge = statusBadge[order.status] ?? { label: order.status, cls: 'bg-stone-100 text-stone-600' };

  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-4 w-full px-4 py-3.5 text-left hover:bg-stone-50/70 btn-press"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-display font-bold text-stone-900 truncate">{order.orderId}</p>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
        </div>
        <p className="text-xs text-stone-500 mt-0.5 truncate">{order.horecaName}</p>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-stone-500 shrink-0 w-28">
        <Clock className="w-3.5 h-3.5" />
        {order.deliveryDate ? order.deliveryDate.slice(0, 10) : 'no date'}
      </div>
      <div className="shrink-0 w-28 text-right">
        <span className="font-mono text-sm text-stone-900">{totalPicked}</span>
        <span className="font-mono text-sm text-stone-500">/{totalOrdered}</span>
        <p className="text-[11px] text-stone-500">{order.lines.length} line{order.lines.length === 1 ? '' : 's'} · {pct}%</p>
      </div>
      <ChevronRight className="w-4 h-4 text-stone-300 shrink-0" />
    </button>
  );
};

interface PickQueueViewProps {
  currentUser?: User;
}

const PickQueueView: React.FC<PickQueueViewProps> = ({ currentUser }) => {
  const { data: orders, isLoading, isError } = usePickQueue();
  const [tab, setTab] = useState<'all' | 'processed' | 'picked' | 'packed'>('all');
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  // Warehouse staff see only orders fulfilled (in part) from their own site.
  const homeId = currentUser?.role === UserRole.WAREHOUSE ? currentUser.homeWarehouseId : undefined;
  const scoped = homeId != null
    ? (orders ?? []).filter((o) => o.fulfilmentWarehouseIds.length === 0 || o.fulfilmentWarehouseIds.includes(homeId))
    : (orders ?? []);
  const filtered = scoped.filter((o) => tab === 'all' || o.status === tab);

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-nexgen-blue/10">
          <ClipboardCheck className="w-5 h-5 text-nexgen-blue" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Pick Queue</h1>
          <p className="text-xs text-stone-500 mt-0.5">Open an order to pick its lines, then pack &amp; dispatch.</p>
        </div>
      </div>

      <div className="flex gap-2">
        {(['all', 'processed', 'picked', 'packed'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors btn-press ${
              tab === t ? 'bg-nexgen-blue text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {t === 'processed' ? 'Ready to pick' : t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="glass-card rounded-xl divide-y divide-stone-100">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse bg-stone-100/60" />
          ))}
        </div>
      ) : isError ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <p className="text-sm text-red-600">Couldn't load the pick queue.</p>
          <p className="text-xs text-stone-500 mt-1">Check your connection and try again.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <PackageCheck className="w-9 h-9 text-stone-300 mx-auto mb-3" />
          <p className="text-sm text-stone-600">No orders awaiting picking</p>
          <p className="text-xs text-stone-500 mt-1">Processed orders will appear here for the warehouse to pick.</p>
        </div>
      ) : (
        <div className="glass-card rounded-xl divide-y divide-stone-100 overflow-hidden">
          {filtered.map((order) => (
            <OrderRow key={order.orderId} order={order} onOpen={() => setOpenOrderId(order.orderId)} />
          ))}
        </div>
      )}

      {openOrderId && (
        <PickWorkspaceModal orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
      )}
    </div>
  );
};

export default PickQueueView;
