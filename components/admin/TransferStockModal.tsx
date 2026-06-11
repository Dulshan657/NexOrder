import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, Repeat } from 'lucide-react';
import type { Product } from '../../types';
import { useWarehouses, useTransferStock } from '../../hooks/queries/useWarehouses';

interface TransferStockModalProps {
  products: Product[];
  onClose: () => void;
}

const fieldCls =
  'w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30';

/** Move available stock between warehouses (DC -> DC). Backed by the
 * transfer-stock Edge Function / inv_transfer_stock RPC (moves only unreserved
 * stock, FIFO across batches, preserving lot/expiry). */
const TransferStockModal: React.FC<TransferStockModalProps> = ({ products, onClose }) => {
  const { data: warehouses } = useWarehouses();
  const transfer = useTransferStock();

  const activeWarehouses = useMemo(() => (warehouses ?? []).filter((w) => w.isActive), [warehouses]);

  const [productId, setProductId] = useState<number | ''>('');
  const [fromId, setFromId] = useState<number | ''>('');
  const [toId, setToId] = useState<number | ''>('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const q = Number(qty);
    if (!productId || !fromId || !toId || !q || q <= 0) {
      setError('Pick a product, both warehouses, and a positive quantity.');
      return;
    }
    if (fromId === toId) {
      setError('Source and destination must differ.');
      return;
    }
    try {
      await transfer.mutateAsync({
        productId: Number(productId),
        fromLocationId: Number(fromId),
        toLocationId: Number(toId),
        qty: q,
        reason: reason.trim() || undefined,
      });
      setDone(true);
      setTimeout(onClose, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed.');
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4" role="dialog" aria-modal="true">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-stone-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-nexgen-blue/10"><Repeat className="w-4 h-4 text-nexgen-blue" /></div>
            <h2 className="text-base font-display font-bold text-stone-900">Transfer Stock</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-stone-100" aria-label="Close"><X className="w-4 h-4 text-stone-500" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">Product</label>
            <select className={fieldCls} value={productId} onChange={(e) => setProductId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Select a product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">From</label>
              <select className={fieldCls} value={fromId} onChange={(e) => setFromId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">…</option>
                {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-400 mb-2.5" />
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">To</label>
              <select className={fieldCls} value={toId} onChange={(e) => setToId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">…</option>
                {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">Quantity (base units)</label>
            <input className={fieldCls} type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 24" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">Reason (optional)</label>
            <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rebalancing" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {done && <p className="text-sm text-emerald-600">Transfer complete.</p>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-stone-100">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100">Cancel</button>
          <button type="submit" disabled={transfer.isPending || done} className="px-4 py-2 rounded-lg text-sm font-semibold bg-nexgen-blue text-white hover:bg-nexgen-blue/90 disabled:opacity-60">
            {transfer.isPending ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};

export default TransferStockModal;
