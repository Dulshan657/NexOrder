import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, Warehouse as WarehouseIcon } from 'lucide-react';
import type { Order } from '../types';
import { useWarehouses } from '../hooks/queries/useWarehouses';
import { orderedWarehousesFor, type RoutableWarehouse } from '../lib/warehouseRouting';

export interface StockAssignmentModalProps {
  order: Order | null;
  /** opts.locationPref is set only when the operator overrides the routing. */
  onConfirm: (opts: { note: string; locationPref?: number[] }) => void;
  onCancel: () => void;
}

/**
 * Process-order modal. Stock auto-allocates closest-first across the warehouses
 * (computed from the customer's coordinates) and splits when the nearest is
 * short. The operator may override the primary warehouse; otherwise the order
 * keeps the allocation made at placement.
 */
const StockAssignmentModal: React.FC<StockAssignmentModalProps> = ({ order, onConfirm, onCancel }) => {
  const { data: warehouses } = useWarehouses();
  const [primaryId, setPrimaryId] = useState<number | 'auto'>('auto');

  // Closest-first warehouse order for this customer.
  const orderedIds = useMemo<number[]>(() => {
    if (!order || !warehouses) return [];
    const coords =
      typeof order.hoReCa.lat === 'number' && typeof order.hoReCa.lng === 'number'
        ? { lat: order.hoReCa.lat, lng: order.hoReCa.lng }
        : null;
    const routable: RoutableWarehouse[] = warehouses.map((w) => ({
      id: w.id,
      lat: w.lat ?? null,
      lng: w.lng ?? null,
      isActive: w.isActive,
      locationType: w.locationType,
    }));
    return orderedWarehousesFor(coords, routable);
  }, [order, warehouses]);

  const nameById = useMemo(() => new Map((warehouses ?? []).map((w) => [w.id, w.name])), [warehouses]);

  useEffect(() => {
    if (!order) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [order, onCancel]);

  if (!order) return null;

  const hasCoords = typeof order.hoReCa.lat === 'number' && typeof order.hoReCa.lng === 'number';
  const multiWarehouse = orderedIds.length > 1;

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (primaryId === 'auto') {
      onConfirm({ note: 'Processed — auto-allocated closest-first' });
    } else {
      // Move the chosen warehouse to the front of the closest-first list.
      const pref = [primaryId, ...orderedIds.filter((id) => id !== primaryId)];
      onConfirm({ note: `Processed — re-routed to ${nameById.get(primaryId) ?? `WH ${primaryId}`} first`, locationPref: pref });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="process-order-title"
    >
      <form onSubmit={handleConfirm} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-stone-200">
        <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-stone-200">
          <div>
            <h2 id="process-order-title" className="text-lg font-display font-semibold text-stone-900">Process Order {order.id}</h2>
            <p className="text-sm text-stone-500 mt-0.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> {order.hoReCa.name}
              {!hasCoords && <span className="ml-2 text-amber-700 text-xs font-medium">No coordinates — using default routing</span>}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          {/* Fulfilment routing */}
          <div className="rounded-lg border border-stone-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <WarehouseIcon className="w-4 h-4 text-nexgen-blue" />
              <p className="text-sm font-semibold text-stone-900">Fulfilment</p>
            </div>
            {orderedIds.length === 0 ? (
              <p className="text-sm text-stone-500">No active warehouses configured.</p>
            ) : (
              <>
                <p className="text-xs text-stone-500 mb-2">
                  Stock allocates closest-first{multiWarehouse ? ', splitting across sites when the nearest is short' : ''}.
                  {' '}Order of preference:
                </p>
                <ol className="flex flex-wrap gap-1.5 mb-3">
                  {orderedIds.map((id, i) => (
                    <li key={id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-stone-100 text-stone-700">
                      <span className="font-mono text-stone-400">{i + 1}</span> {nameById.get(id) ?? `WH ${id}`}
                    </li>
                  ))}
                </ol>
                {multiWarehouse && (
                  <label className="block">
                    <span className="block text-xs font-semibold text-stone-600 mb-1">Override primary warehouse (optional)</span>
                    <select
                      value={primaryId}
                      onChange={(e) => setPrimaryId(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                    >
                      <option value="auto">Auto (closest first) — keep placement allocation</option>
                      {orderedIds.map((id) => (
                        <option key={id} value={id}>{nameById.get(id) ?? `WH ${id}`}</option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>

          {/* Lines */}
          <div className="rounded-lg border border-stone-200 divide-y divide-stone-100">
            {order.items.map((it, idx) => (
              <div key={`${it.id}-${idx}`} className="flex items-center justify-between px-4 py-2.5">
                <p className="text-sm text-stone-800 truncate">
                  {it.name}
                  {it.packSize ? <span className="text-stone-400 ml-1.5 text-xs">(carton of {it.packSize})</span> : null}
                </p>
                <span className="text-sm font-mono text-stone-900 tabular-nums">×{it.quantity}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-stone-200 bg-white flex items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            {primaryId === 'auto'
              ? 'Confirm to process and create per-warehouse fulfilments.'
              : 'Stock will be re-reserved with your chosen warehouse first.'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg">Cancel</button>
            <button type="submit" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-nexgen-blue rounded-lg hover:bg-nexgen-blue/90">
              Confirm &amp; Process
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
};

export default StockAssignmentModal;
