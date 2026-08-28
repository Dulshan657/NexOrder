import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Repeat, AlertTriangle } from 'lucide-react';
import type { Product, Warehouse } from '../../types';
import { Button, Modal } from '../ui';
import { useWarehouses, useTransferStock } from '../../hooks/queries/useWarehouses';
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations';
import { useProductHomeBins } from '../../hooks/queries/useProductHomeBins';
import { getBinFillSlots } from '../../services/supabase/inventoryService';

interface TransferStockModalProps {
  products: Product[];
  onClose: () => void;
}

const fieldCls =
  'w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30';

/** Pick a warehouse and (for racked warehouses) optionally a specific bin. The
 * effective location id is the bin when chosen, otherwise the warehouse root. */
const LocationPicker: React.FC<{
  label: string;
  warehouses: Warehouse[];
  warehouseId: number | '';
  binId: number | '';
  onWarehouse: (id: number | '') => void;
  onBin: (id: number | '') => void;
}> = ({ label, warehouses, warehouseId, binId, onWarehouse, onBin }) => {
  const selected = warehouses.find((w) => w.id === warehouseId);
  const racked = selected?.locationType === 'racked';
  const { data: bins } = useWarehouseLocations(racked ? (warehouseId as number) : null);
  const leafBins = (bins ?? []).filter((b) => b.isActive);

  return (
    <div>
      <label className="block text-xs font-semibold text-stone-600 mb-1">{label}</label>
      <select className={fieldCls} value={warehouseId} onChange={(e) => { onWarehouse(e.target.value === '' ? '' : Number(e.target.value)); onBin(''); }}>
        <option value="">…</option>
        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {racked && leafBins.length > 0 && (
        <select className={`${fieldCls} mt-1.5`} value={binId} onChange={(e) => onBin(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Warehouse root (unsorted)</option>
          {leafBins.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
        </select>
      )}
    </div>
  );
};

const TransferStockModal: React.FC<TransferStockModalProps> = ({ products, onClose }) => {
  const { data: warehouses } = useWarehouses();
  const transfer = useTransferStock();
  const activeWarehouses = useMemo(() => (warehouses ?? []).filter((w) => w.isActive), [warehouses]);

  const [productId, setProductId] = useState<number | ''>('');
  const [fromWh, setFromWh] = useState<number | ''>('');
  const [fromBin, setFromBin] = useState<number | ''>('');
  const [toWh, setToWh] = useState<number | ''>('');
  const [toBin, setToBin] = useState<number | ''>('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const fromLoc = fromBin !== '' ? fromBin : fromWh;
  const toLoc = toBin !== '' ? toBin : toWh;

  // Directed put-away: default the destination bin to the product's home bin for
  // the chosen racked warehouse.
  const { data: homeBins } = useProductHomeBins(productId === '' ? null : Number(productId));
  const toWhObj = activeWarehouses.find((w) => w.id === toWh);
  const { data: toBins } = useWarehouseLocations(toWhObj?.locationType === 'racked' ? (toWh as number) : null);
  useEffect(() => {
    if (productId !== '' && toWhObj?.locationType === 'racked' && homeBins && toBin === '') {
      const hb = homeBins.find((h) => h.warehouseId === toWh);
      if (hb) setToBin(hb.binId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, toWh, homeBins]);

  // Soft capacity warning: bin fill (Σ on_hand × size_factor) + incoming vs capacity.
  const { data: destFill } = useQuery({
    queryKey: ['bin-fill', toBin],
    queryFn: () => getBinFillSlots(Number(toBin)),
    enabled: toBin !== '',
  });
  const product = products.find((p) => p.id === Number(productId));
  const destBin = (toBins ?? []).find((b) => b.id === toBin);
  const incomingSlots = product && qty ? Number(qty) * (product.sizeFactor ?? 1) : 0;
  const overCapacity =
    destBin?.capacitySlots != null && destFill != null && destFill + incomingSlots > destBin.capacitySlots;

  // The form is a bag of independent scalars rather than one object, so `dirty` is
  // derived over them directly: every input's empty value is ''. Once the transfer is
  // recorded there is nothing left to discard.
  const isDirty =
    !done && [productId, fromWh, fromBin, toWh, toBin, qty, reason].some((value) => value !== '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const q = Number(qty);
    if (!productId || !fromLoc || !toLoc || !q || q <= 0) {
      setError('Pick a product, both locations, and a positive quantity.');
      return;
    }
    if (fromLoc === toLoc) {
      setError('Source and destination must differ.');
      return;
    }
    try {
      await transfer.mutateAsync({
        productId: Number(productId),
        fromLocationId: Number(fromLoc),
        toLocationId: Number(toLoc),
        qty: q,
        reason: reason.trim() || undefined,
      });
      setDone(true);
      setTimeout(onClose, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      dirty={isDirty}
      onSubmit={handleSubmit}
      icon={<Repeat className="w-4 h-4 text-nexgen-blue" />}
      title="Transfer / Put-away"
      footer={({ requestClose }) => (
        <>
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={done} loading={transfer.isPending}>
            {transfer.isPending ? 'Transferring…' : 'Transfer'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Product</label>
          <select className={fieldCls} value={productId} onChange={(e) => setProductId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Select a product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </select>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          <LocationPicker label="From" warehouses={activeWarehouses} warehouseId={fromWh} binId={fromBin} onWarehouse={setFromWh} onBin={setFromBin} />
          <ArrowRight className="w-4 h-4 text-stone-500 mt-7" />
          <LocationPicker label="To" warehouses={activeWarehouses} warehouseId={toWh} binId={toBin} onWarehouse={setToWh} onBin={setToBin} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Quantity (base units)</label>
          <input className={fieldCls} type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 24" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Reason (optional)</label>
          <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rebalancing / put-away" />
        </div>

        {overCapacity && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              This put-away (~{incomingSlots.toLocaleString()} slots) would exceed the bin's capacity of{' '}
              {destBin?.capacitySlots?.toLocaleString()} (currently ~{Math.round(destFill ?? 0).toLocaleString()} used).
              You can still proceed.
            </span>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {done && <p className="text-sm text-emerald-600">Transfer complete.</p>}
      </div>
    </Modal>
  );
};

export default TransferStockModal;
