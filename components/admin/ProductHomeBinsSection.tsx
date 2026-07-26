import React, { useState } from 'react';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import { useProductHomeBins, useSetProductHomeBin, useClearProductHomeBin } from '../../hooks/queries/useProductHomeBins';
import { useLevelRoles } from '../../hooks/queries/useLevelRoles';
import { roleLabel } from '../../lib/levelRoles';
import type { ProductHomeBin } from '../../services/supabase/productHomeBinService';
import type { Warehouse } from '../../types';

/** One racked warehouse's home-bin selector for a product, plus its
 *  replenishment thresholds. Its own component so the per-warehouse bin hook is
 *  legal (not inside a parent loop). */
const HomeBinRow: React.FC<{ productId: number; warehouse: Warehouse; current?: ProductHomeBin }> = ({ productId, warehouse, current }) => {
  const { data: bins } = useWarehouseLocations(warehouse.id);
  const { data: levelRoles = [] } = useLevelRoles();
  const setBin = useSetProductHomeBin(productId);
  const clearBin = useClearProductHomeBin(productId);

  const [minQty, setMinQty] = useState(current?.minQty != null ? String(current.minQty) : '');
  const [maxQty, setMaxQty] = useState(current?.maxQty != null ? String(current.maxQty) : '');
  const [error, setError] = useState<string | null>(null);

  const leafBins = (bins ?? []).filter((b) => b.isActive);
  const chosenBin = leafBins.find((b) => b.id === current?.binId);

  // Replenishment refills a pick zone, so the toggle is only meaningful when the
  // home bin IS one. Disabled rather than hidden: an operator who wants it needs
  // to see WHY it is unavailable, not just find it missing.
  const pickZoneKeys = new Set(levelRoles.filter((r) => r.isPickZone && r.isActive).map((r) => r.key));
  const binIsPickZone = Boolean(chosenBin?.levelRole && pickZoneKeys.has(chosenBin.levelRole));

  const onChangeBin = (value: string) => {
    setError(null);
    if (value === '') clearBin.mutate(warehouse.id);
    else setBin.mutate({ warehouseId: warehouse.id, binId: Number(value) });
  };

  const saveReplen = async (enabled: boolean) => {
    if (!current?.binId) return;
    setError(null);
    const min = minQty.trim() === '' ? null : Number(minQty);
    const max = maxQty.trim() === '' ? null : Number(maxQty);
    if (enabled && (min == null || max == null)) {
      setError('Replenishment needs both a minimum and a maximum.');
      return;
    }
    if (min != null && max != null && max <= min) {
      setError('The maximum has to be higher than the minimum.');
      return;
    }
    try {
      await setBin.mutateAsync({
        warehouseId: warehouse.id,
        binId: current.binId,
        replen: { minQty: min, maxQty: max, replenEnabled: enabled },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  return (
    <div className="py-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-sm text-stone-700 flex-1 truncate">{warehouse.name}</span>
        <select
          value={current?.binId ?? ''}
          onChange={(e) => onChangeBin(e.target.value)}
          disabled={setBin.isPending || clearBin.isPending}
          className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 w-56"
        >
          <option value="">No default bin</option>
          {leafBins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} · {b.name}
              {b.levelRole ? ` (${roleLabel(levelRoles, b.levelRole)})` : ''}
            </option>
          ))}
        </select>
      </div>

      {current?.binId != null && (
        <div className="pl-0 sm:pl-4 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-stone-500">
            Min
            <input
              type="number"
              min={0}
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
              className="mt-0.5 block w-20 text-sm border border-stone-200 rounded px-2 py-1"
            />
          </label>
          <label className="text-[11px] text-stone-500">
            Max
            <input
              type="number"
              min={0}
              value={maxQty}
              onChange={(e) => setMaxQty(e.target.value)}
              className="mt-0.5 block w-20 text-sm border border-stone-200 rounded px-2 py-1"
            />
          </label>
          <span className="text-[11px] text-stone-400 pb-1.5">base units</span>

          <label
            className="flex items-center gap-1.5 text-xs text-stone-600 pb-1.5 ml-auto"
            title={binIsPickZone
              ? 'Raise a top-up task when this slot drops to its minimum'
              : 'Replenishment refills a pick zone. Choose a pick-zone level as the home bin first.'}
          >
            <input
              type="checkbox"
              checked={current.replenEnabled}
              disabled={!binIsPickZone || setBin.isPending}
              onChange={(e) => saveReplen(e.target.checked)}
            />
            Auto-replenish
          </label>
          {!binIsPickZone && (
            <p className="w-full text-[11px] text-stone-400">
              This bin is{' '}
              {chosenBin?.levelRole
                ? `a ${roleLabel(levelRoles, chosenBin.levelRole)} level`
                : 'not a rack level'}
              , so it cannot be auto-replenished. Point it at a pick-zone level to enable it.
            </p>
          )}
          {error && <p className="w-full text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
};

interface ProductHomeBinsSectionProps {
  productId: number;
}

/** Per-racked-warehouse default put-away bin for a product, and — since mig
 *  00082 — the replenishment thresholds for that slot. The home bin is the first
 *  suggestion when putting stock away, and the slot replenishment keeps topped
 *  up. */
const ProductHomeBinsSection: React.FC<ProductHomeBinsSectionProps> = ({ productId }) => {
  const { data: warehouses } = useWarehouses();
  const { data: homeBins } = useProductHomeBins(productId);
  const racked = (warehouses ?? []).filter((w) => w.isActive && w.locationType === 'racked');

  if (racked.length === 0) return null;

  const byWarehouse = new Map((homeBins ?? []).map((h) => [h.warehouseId, h]));

  return (
    <div className="border-t border-stone-100 pt-4">
      <label className="block text-sm font-medium text-stone-700 mb-1">
        Pick slots &amp; replenishment (racked warehouses)
      </label>
      <p className="text-xs text-stone-400 mb-2">
        Where this product is suggested for put-away, and — when the bin is a pick zone — the levels at which
        it is automatically topped up from reserve or bulk.
      </p>
      <div className="divide-y divide-stone-100">
        {racked.map((w) => (
          <HomeBinRow key={w.id} productId={productId} warehouse={w} current={byWarehouse.get(w.id)} />
        ))}
      </div>
    </div>
  );
};

export default ProductHomeBinsSection;
