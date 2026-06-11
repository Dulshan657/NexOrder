import React from 'react';
import { useWarehouses } from '../../hooks/queries/useWarehouses';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import { useProductHomeBins, useSetProductHomeBin, useClearProductHomeBin } from '../../hooks/queries/useProductHomeBins';
import type { Warehouse } from '../../types';

/** One racked warehouse's home-bin selector for a product. Its own component so
 * the per-warehouse bin hook is legal (not inside a parent loop). */
const HomeBinRow: React.FC<{ productId: number; warehouse: Warehouse; currentBinId?: number }> = ({ productId, warehouse, currentBinId }) => {
  const { data: bins } = useWarehouseLocations(warehouse.id);
  const setBin = useSetProductHomeBin(productId);
  const clearBin = useClearProductHomeBin(productId);
  const leafBins = (bins ?? []).filter((b) => b.isActive);

  const onChange = (value: string) => {
    if (value === '') clearBin.mutate(warehouse.id);
    else setBin.mutate({ warehouseId: warehouse.id, binId: Number(value) });
  };

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-sm text-stone-700 flex-1 truncate">{warehouse.name}</span>
      <select
        value={currentBinId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={setBin.isPending || clearBin.isPending}
        className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 w-48"
      >
        <option value="">No default bin</option>
        {leafBins.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
      </select>
    </div>
  );
};

interface ProductHomeBinsSectionProps {
  productId: number;
}

/** Per-racked-warehouse default put-away bin for a product. The home bin is the
 * first suggestion when putting stock away. */
const ProductHomeBinsSection: React.FC<ProductHomeBinsSectionProps> = ({ productId }) => {
  const { data: warehouses } = useWarehouses();
  const { data: homeBins } = useProductHomeBins(productId);
  const racked = (warehouses ?? []).filter((w) => w.isActive && w.locationType === 'racked');

  if (racked.length === 0) return null;

  const binByWarehouse = new Map((homeBins ?? []).map((h) => [h.warehouseId, h.binId]));

  return (
    <div className="border-t border-stone-100 pt-4">
      <label className="block text-sm font-medium text-stone-700 mb-1">Default put-away bins (racked warehouses)</label>
      <p className="text-xs text-stone-400 mb-2">Where this product is suggested for put-away in each racked warehouse.</p>
      <div className="divide-y divide-stone-100">
        {racked.map((w) => (
          <HomeBinRow key={w.id} productId={productId} warehouse={w} currentBinId={binByWarehouse.get(w.id)} />
        ))}
      </div>
    </div>
  );
};

export default ProductHomeBinsSection;
