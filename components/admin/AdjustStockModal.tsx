import React, { useMemo, useState } from 'react';
import { SlidersHorizontal, AlertTriangle } from 'lucide-react';
import type { Product } from '../../types';
import { Button, Modal } from '../ui';
import { useAdjustStock } from '../../hooks/queries/useAdjustStock';
import {
  computeAdjustPreview,
  validateAdjustInput,
  buildAdjustPayload,
  friendlyAdjustError,
  type AdjustMode,
} from '../../lib/stockAdjustment';

interface AdjustStockModalProps {
  product: Product;
  locationId: number;
  /** e.g. "MAIN · lot L2026-07" or "MAIN · untracked" — the exact slot being adjusted. */
  locationLabel: string;
  batchId: number | null;
  currentOnHand: number;
  onClose: () => void;
}

const fieldCls =
  'w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30';

/** Shrinkage/damage/found-stock adjustments and stocktake-count corrections for
 * one exact (product, location, batch) balance slot. Mirrors TransferStockModal's
 * structure/styling; delegates the math to lib/stockAdjustment.ts so it's unit
 * tested without rendering this component. */
const AdjustStockModal: React.FC<AdjustStockModalProps> = ({
  product,
  locationId,
  locationLabel,
  batchId,
  currentOnHand,
  onClose,
}) => {
  const adjust = useAdjustStock();
  const [mode, setMode] = useState<AdjustMode>('delta');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const preview = useMemo(
    () => computeAdjustPreview(mode, amountText, currentOnHand),
    [mode, amountText, currentOnHand],
  );

  // Only the two typed fields are worth protecting — `mode` is a toggle that clears
  // them anyway, and once the adjustment is recorded there is nothing left to discard.
  const isDirty = !done && (amountText.trim() !== '' || reason.trim() !== '');

  const switchMode = (next: AdjustMode) => {
    setMode(next);
    setAmountText('');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const formInput = { productId: product.id, locationId, batchId, mode, amountText, reason, currentOnHand };
    const validationError = validateAdjustInput(formInput);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      const payload = buildAdjustPayload(formInput);
      await adjust.mutateAsync(payload);
      setDone(true);
      setTimeout(onClose, 900);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Adjustment failed.';
      setError(friendlyAdjustError(message));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      dirty={isDirty}
      onSubmit={handleSubmit}
      icon={<SlidersHorizontal className="w-4 h-4 text-nexgen-blue" />}
      title="Adjust stock"
      description={`${product.name} · ${locationLabel}`}
      footer={({ requestClose }) => (
        <>
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={done} loading={adjust.isPending}>
            {adjust.isPending ? 'Saving…' : 'Save adjustment'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex rounded-lg border border-stone-200 p-1 bg-stone-50">
          <button
            type="button"
            onClick={() => switchMode('delta')}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === 'delta' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
          >
            Adjust by amount
          </button>
          <button
            type="button"
            onClick={() => switchMode('set_count')}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === 'set_count' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
          >
            Set counted total
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">
            {mode === 'delta' ? 'Quantity change (use − for shrinkage)' : 'Counted total'}
          </label>
          <input
            className={fieldCls}
            type="number"
            step="1"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder={mode === 'delta' ? 'e.g. -3 or 5' : `e.g. ${currentOnHand}`}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Reason (required)</label>
          <textarea
            className={`${fieldCls} resize-none`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Damaged in transit, cycle count correction…"
          />
        </div>

        <div className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-xs text-stone-600 flex items-center justify-between">
          <span>Current on hand</span>
          <span className="font-mono font-semibold text-stone-900">{currentOnHand}</span>
        </div>
        {preview && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between ${
              preview.newOnHand < 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}
          >
            <span>New on hand ({preview.delta > 0 ? '+' : ''}{preview.delta})</span>
            <span className="font-mono font-semibold">{preview.newOnHand}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-600">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {done && <p className="text-sm text-emerald-600">Adjustment recorded.</p>}
      </div>
    </Modal>
  );
};

export default AdjustStockModal;
