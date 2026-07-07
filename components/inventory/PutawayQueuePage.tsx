// Admin/Manager-facing wrapper around <PutawayQueueView>. Those roles have no
// home warehouse, so this page owns its own warehouse picker and hands the
// chosen id down. Warehouse staff default to their home site.

import React, { useMemo, useState } from 'react';
import { PackageOpen } from 'lucide-react';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import type { User } from '../../types';
import PutawayQueueView from './PutawayQueueView';

interface PutawayQueuePageProps {
  currentUser: User;
}

const PutawayQueuePage: React.FC<PutawayQueuePageProps> = ({ currentUser }) => {
  const { data: warehouses } = useWarehouses();
  const activeWarehouses = useMemo(
    () => (warehouses ?? []).filter((w) => w.isActive),
    [warehouses],
  );

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(
    currentUser.homeWarehouseId ?? activeWarehouses[0]?.id ?? null,
  );

  // Once warehouses load, adopt a sensible default if we still have none selected.
  const effectiveWarehouseId =
    selectedWarehouseId ?? currentUser.homeWarehouseId ?? activeWarehouses[0]?.id ?? null;

  return (
    <div className="bg-white min-h-screen">
      <div className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8">
        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
          <span className="font-medium">Warehouse</span>
          <select
            value={effectiveWarehouseId ?? ''}
            onChange={(e) => setSelectedWarehouseId(e.target.value ? Number(e.target.value) : null)}
            className="text-sm rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-stone-800 focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
          >
            <option value="">Select a warehouse…</option>
            {activeWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>
        </label>
      </div>

      {effectiveWarehouseId != null ? (
        <PutawayQueueView warehouseId={effectiveWarehouseId} />
      ) : (
        <div className="px-4 sm:px-6 lg:px-8 py-16">
          <div className="glass-card rounded-xl p-10 text-center">
            <PackageOpen className="w-9 h-9 text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-600">Pick a warehouse to see its putaway queue</p>
            <p className="text-xs text-stone-400 mt-1">Choose a site from the selector above.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PutawayQueuePage;
