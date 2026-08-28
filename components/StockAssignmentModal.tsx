import React, { useMemo, useState } from 'react';
import { MapPin, Warehouse as WarehouseIcon } from 'lucide-react';
import type { Order } from '../types';
import { Button, Modal } from './ui';
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

  if (!order) return null;

  const hasCoords = typeof order.hoReCa.lat === 'number' && typeof order.hoReCa.lng === 'number';
  const multiWarehouse = orderedIds.length > 1;

  // The override select is the only editable field, so it alone decides whether a
  // dismiss should prompt to discard.
  const isDirty = primaryId !== 'auto';

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

  return (
    <Modal
      open
      onClose={onCancel}
      size="2xl"
      dirty={isDirty}
      onSubmit={handleConfirm}
      icon={<MapPin className="w-4 h-4 text-nexgen-blue" />}
      title={`Process Order ${order.id}`}
      description={order.hoReCa.name}
      footer={({ requestClose }) => (
        <>
          <p className="mr-auto text-xs text-stone-500">
            {primaryId === 'auto'
              ? 'Confirm to process and create per-warehouse fulfilments.'
              : 'Stock will be re-reserved with your chosen warehouse first.'}
          </p>
          <Button variant="ghost" size="sm" onClick={requestClose}>Cancel</Button>
          <Button type="submit" size="sm">Confirm &amp; Process</Button>
        </>
      )}
    >
      <div className="space-y-4">
        {/* The header sub-line is truncated, so the routing caveat lives here. */}
        {!hasCoords && (
          <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No coordinates for this customer — using default routing.
          </p>
        )}

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
                    <span className="font-mono text-stone-500">{i + 1}</span> {nameById.get(id) ?? `WH ${id}`}
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
                {it.packSize ? <span className="text-stone-500 ml-1.5 text-xs">(carton of {it.packSize})</span> : null}
              </p>
              <span className="text-sm font-mono text-stone-900 tabular-nums">×{it.quantity}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};

export default StockAssignmentModal;
