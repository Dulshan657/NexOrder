import React, { useEffect, useMemo } from 'react';
import {
  usePickQueue,
  useRecordPick,
  useUpdateOrderStatus,
  useGeneratePickSlip,
  useGenerateDispatchAdvice,
} from '../../hooks/queries/usePickQueue';
import { useOrderPickTasks } from '../../hooks/queries/useOrderPickTasks';
import { useToasts } from '../../hooks/useToasts';
import { useAuth } from '../../hooks/useAuth';
import { useDocumentViewer } from '../../context/DocumentViewerContext';
import { PickRoutePanel } from './PickRoutePanel';
import { PickTaskRow } from './pick/PickTaskRow';
import type { PickQueueLine, PickTask } from '../../services/supabase/pickService';
import {
  X, Check, PackageCheck, FileText, Truck, MapPin, Box, PackageCheck as PackIcon,
} from 'lucide-react';

const statusBadge: Record<string, { label: string; cls: string }> = {
  processed: { label: 'Ready to pick', cls: 'bg-nexgen-blue/10 text-nexgen-blue' },
  picked: { label: 'Picked', cls: 'bg-emerald-50 text-emerald-700' },
  packed: { label: 'Packed', cls: 'bg-amber-50 text-amber-700' },
  dispatched: { label: 'Dispatched', cls: 'bg-stone-200 text-stone-700' },
};

interface PickLineRowProps {
  line: PickQueueLine;
  orderId: string;
  tasks: PickTask[];
  tasksLoading: boolean;
  canPick: boolean;
  homeWarehouseId: number | null;
  isWarehouseRole: boolean;
}

/** One order line, grouped line → warehouse → bin: each allocated bin is its
 *  own directed pick task (PickTaskRow) so the operator is told exactly where
 *  to pick and the recorded pick decrements that exact bin. */
const PickLineRow: React.FC<PickLineRowProps> = ({
  line, orderId, tasks, tasksLoading, canPick, homeWarehouseId, isWarehouseRole,
}) => {
  const remaining = Math.max(line.quantity - line.picked, 0);
  const done = remaining === 0;

  const byWarehouse = useMemo(() => {
    const groups = new Map<number, { warehouseCode: string; tasks: PickTask[] }>();
    for (const t of tasks) {
      const g = groups.get(t.warehouseId) ?? { warehouseCode: t.warehouseCode, tasks: [] };
      g.tasks.push(t);
      groups.set(t.warehouseId, g);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [tasks]);

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-stone-800 truncate">{line.productName}</p>
          <p className="text-xs text-stone-400 font-mono">{line.productSku}</p>
        </div>
        <div className="text-right shrink-0 w-20">
          <span className="font-mono text-sm text-stone-900">{line.picked}</span>
          <span className="font-mono text-sm text-stone-400">/{line.quantity}</span>
        </div>
        <div className="shrink-0 w-28 text-right">
          {done && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              <Check className="w-3 h-3" /> Picked
            </span>
          )}
        </div>
      </div>
      {!done && (
        tasksLoading ? (
          <p className="pl-5 pt-1 text-xs text-stone-400">loading pick tasks…</p>
        ) : byWarehouse.length === 0 ? (
          <p className="pl-5 pt-1 text-xs text-amber-600">No allocated bin for this line yet.</p>
        ) : (
          <div className="mt-1">
            {byWarehouse.map(([warehouseId, group]) => (
              <div key={warehouseId}>
                {byWarehouse.length > 1 && (
                  <p className="pl-5 text-[11px] font-medium text-stone-400 uppercase tracking-wide">{group.warehouseCode}</p>
                )}
                {group.tasks.map((t) => (
                  <PickTaskRow
                    key={t.locationId}
                    orderId={orderId}
                    task={t}
                    line={line}
                    disabled={!canPick || (isWarehouseRole && warehouseId !== homeWarehouseId)}
                  />
                ))}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

interface PickWorkspaceModalProps {
  orderId: string;
  onClose: () => void;
}

const PickWorkspaceModal: React.FC<PickWorkspaceModalProps> = ({ orderId, onClose }) => {
  const { addToast } = useToasts();
  const { profile } = useAuth();
  const homeWarehouseId = profile?.home_warehouse_id ?? null;
  const isWarehouseRole = profile?.role === 'Warehouse';
  // Read the order LIVE from the shared pick-queue cache so progress updates as
  // picks land (useRecordPick invalidates ['pick_queue']).
  const { data: orders } = usePickQueue();
  const order = (orders ?? []).find((o) => o.orderId === orderId) ?? null;
  // Directed, per-bin pick tasks — the same allocation the route and the pick
  // slip read, so the panel names the exact bin the recorded pick decrements.
  const { data: pickTasks, isLoading: tasksLoading } = useOrderPickTasks(orderId);
  const tasksByLine = useMemo(() => {
    const map = new Map<number, PickTask[]>();
    for (const t of pickTasks ?? []) {
      const list = map.get(t.orderItemId);
      if (list) list.push(t);
      else map.set(t.orderItemId, [t]);
    }
    return map;
  }, [pickTasks]);

  const updateStatus = useUpdateOrderStatus();
  const pickSlip = useGeneratePickSlip();
  const dispatchAdvice = useGenerateDispatchAdvice();
  const { previewDocument } = useDocumentViewer();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The order can leave the queue once dispatched (queue holds processed/picked/
  // packed). Close gracefully if it's gone.
  useEffect(() => {
    if (orders && !order) onClose();
  }, [orders, order, onClose]);

  if (!order) return null;

  const totalOrdered = order.lines.reduce((s, l) => s + l.quantity, 0);
  const totalPicked = order.lines.reduce((s, l) => s + Math.min(l.picked, l.quantity), 0);
  const allPicked = order.lines.length > 0 && order.lines.every((l) => l.picked >= l.quantity);
  const pct = totalOrdered > 0 ? Math.round((totalPicked / totalOrdered) * 100) : 0;
  const canPick = order.status === 'processed' || order.status === 'picked';
  const badge = statusBadge[order.status] ?? { label: order.status, cls: 'bg-stone-100 text-stone-600' };

  const advance = async (status: 'packed' | 'dispatched', label: string) => {
    try {
      await updateStatus.mutateAsync({ orderId: order.orderId, status });
      addToast(`Order ${label}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : `Failed to mark ${label}`, 'error');
    }
  };

  const openDoc = (kind: 'pick' | 'dispatch') => {
    const m = kind === 'pick' ? pickSlip : dispatchAdvice;
    const label = kind === 'pick' ? 'Pick slip' : 'Dispatch advice';
    const slug = kind === 'pick' ? 'pick_slip' : 'dispatch_advice';
    // Generate the doc, then preview it in-app (no popup — the signed URL is
    // produced async, so window.open would be popup-blocked).
    previewDocument(
      async () => {
        const res = await m.mutateAsync(order.orderId);
        if (!res.signedUrl) throw new Error('No document URL returned');
        return res.signedUrl;
      },
      `${order.orderId} · ${label}`,
      `${order.orderId}-${slug}.pdf`,
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Pick order ${order.orderId}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-stone-200">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-nexgen-blue/10 flex items-center justify-center text-nexgen-blue shrink-0">
              <Box className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-stone-900 truncate">{order.orderId}</h2>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
              </div>
              <p className="text-xs text-stone-500 truncate">
                {order.horecaName}{order.deliveryDate ? ` · deliver ${order.deliveryDate.slice(0, 10)}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer shrink-0" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {/* Progress */}
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
            <span>Picking progress</span>
            <span className="font-mono text-stone-700">{totalPicked}/{totalOrdered} · {pct}%</span>
          </div>
          <div className="bg-stone-100 rounded-full h-2 overflow-hidden">
            <div className={`h-2 rounded-full transition-all duration-300 ${allPicked ? 'bg-emerald-400' : 'bg-nexgen-blue'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Lines */}
        <div className="px-5 py-2 overflow-y-auto flex-1">
          {/* Additive advisory: engine-suggested bin-walk order for this order's
              fulfilment warehouse (renders nothing for non-layout sites). */}
          <PickRoutePanel
            warehouseId={
              homeWarehouseId != null && order.fulfilmentWarehouseIds.includes(homeWarehouseId)
                ? homeWarehouseId
                : (order.fulfilmentWarehouseIds[0] ?? null)
            }
            orderIds={[order.orderId]}
          />
          <div className="divide-y divide-stone-100">
          {order.lines.map((line) => (
            <PickLineRow
              key={line.orderItemId}
              line={line}
              orderId={order.orderId}
              tasks={tasksByLine.get(line.orderItemId) ?? []}
              tasksLoading={tasksLoading}
              canPick={canPick}
              homeWarehouseId={homeWarehouseId}
              isWarehouseRole={isWarehouseRole}
            />
          ))}
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-stone-200 p-4 space-y-3 bg-stone-50/60 rounded-b-2xl">
          {!allPicked ? (
            <p className="text-xs text-stone-500 text-center">Pick every line to unlock packing &amp; dispatch.</p>
          ) : (
            <div className="flex items-center justify-center gap-2">
              {order.status === 'picked' && (
                <button
                  onClick={() => advance('packed', 'packed')}
                  disabled={updateStatus.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
                >
                  <PackIcon className="w-4 h-4" /> Mark packed
                </button>
              )}
              {(order.status === 'packed') && (
                <button
                  onClick={() => advance('dispatched', 'dispatched')}
                  disabled={updateStatus.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
                >
                  <Truck className="w-4 h-4" /> Mark dispatched
                </button>
              )}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => openDoc('pick')}
              disabled={pickSlip.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press disabled:opacity-50"
            >
              <FileText className="w-4 h-4" /> Pick slip
            </button>
            <button
              onClick={() => openDoc('dispatch')}
              disabled={!allPicked || dispatchAdvice.isPending}
              title={allPicked ? 'Generate dispatch advice' : 'Pick all lines first'}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Truck className="w-4 h-4" /> Dispatch advice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PickWorkspaceModal;
