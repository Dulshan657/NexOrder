import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wand2, AlertTriangle, CheckCircle2, MapPin } from 'lucide-react';
import type { Order } from '../types';
// --- V2: multi-warehouse allocation (disabled for v1) -----------------------
// The mock multi-warehouse layer and distance-based allocator are preserved on
// disk (lib/mockWarehouses.ts, lib/stockAllocator.ts) for a future release but
// are no longer wired into the v1 Order-Import UI. v1 assumes ONE warehouse.
// import {
//   WAREHOUSES,
//   getMockStockByWarehouse,
//   type Warehouse,
// } from '../lib/mockWarehouses';
// import {
//   allocateOrder,
//   buildAllocationNote,
//   deriveHoReCaCoords,
// } from '../lib/stockAllocator';
// --- end V2 -----------------------------------------------------------------
import {
  isLineBalanced,
  lineKeyFor,
  totalAssigned,
  type AllocatedLine,
} from '../lib/stockAllocator';
import {
  MAIN_WAREHOUSE,
  buildSingleWarehouseLines,
  buildSingleWarehouseNote,
} from '../lib/singleWarehouse';

export interface StockAssignmentModalProps {
  order: Order | null;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

// --- V2: multi-warehouse allocation (disabled for v1) -----------------------
// /**
//  * Build the productId → warehouseId → qty map from the order's line-item
//  * inventory snapshots, deterministic and pure.
//  */
// function buildStockLookup(order: Order): Record<number, Record<string, number>> {
//   const map: Record<number, Record<string, number>> = {};
//   for (const item of order.items) {
//     if (map[item.id]) continue;
//     map[item.id] = getMockStockByWarehouse(item.id, item.inventory ?? 0);
//   }
//   return map;
// }
// --- end V2 -----------------------------------------------------------------

const StockAssignmentModal: React.FC<StockAssignmentModalProps> = ({
  order,
  onConfirm,
  onCancel,
}) => {
  // Hooks must run unconditionally — gate on order at the bottom.
  // v1: on-hand per line is the product's full cached inventory at the single
  // Main Warehouse. The map keeps the per-line ceiling for manual edits.
  const onHandByLineKey = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    if (!order) return map;
    for (const item of order.items) {
      map[lineKeyFor(item)] = Math.max(0, Math.floor(item.inventory ?? 0));
    }
    return map;
  }, [order]);

  const optimized = useMemo<AllocatedLine[]>(() => {
    if (!order) return [];
    return buildSingleWarehouseLines(order);
  }, [order]);

  const [lines, setLines] = useState<AllocatedLine[]>(optimized);

  useEffect(() => {
    setLines(optimized);
  }, [optimized]);

  // ESC closes
  useEffect(() => {
    if (!order) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [order, onCancel]);

  if (!order) return null;

  const allBalanced = lines.every(isLineBalanced);
  const anyShort = lines.some((l) => l.shortBy > 0);

  const updateAllocation = (
    lineKey: string,
    warehouseId: string,
    nextQty: number,
  ) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.lineKey !== lineKey) return line;
        // v1: a line draws only from the Main Warehouse, capped at its on-hand.
        const onHand = onHandByLineKey[lineKey] ?? 0;
        const clamped = Math.max(0, Math.min(onHand, Math.floor(nextQty || 0)));

        const existing = line.allocations.find((a) => a.warehouseId === warehouseId);
        const nextAllocations = existing
          ? line.allocations.map((a) =>
              a.warehouseId === warehouseId ? { ...a, qty: clamped } : a,
            )
          : [...line.allocations, { warehouseId, qty: clamped }];

        const assigned = nextAllocations.reduce((s, a) => s + a.qty, 0);
        return {
          ...line,
          allocations: nextAllocations.filter((a) => a.qty > 0),
          shortBy: Math.max(0, line.requestedQty - assigned),
        };
      }),
    );
  };

  const resetToOptimized = () => setLines(optimized);

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allBalanced) return;
    const note = buildSingleWarehouseNote(lines);
    onConfirm(note);
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-assignment-title"
    >
      <form
        onSubmit={handleConfirm}
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col border border-stone-200"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-stone-200">
          <div>
            <h2
              id="stock-assignment-title"
              className="text-lg font-display font-semibold text-stone-900"
            >
              Process Order {order.id}
            </h2>
            <p className="text-sm text-stone-500 mt-0.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {order.hoReCa.name}
              {/* --- V2: multi-warehouse origin notice (disabled for v1) ---
              {!horecaCoords && (
                <span className="ml-2 text-amber-700 text-xs font-medium">
                  No location on file — using {WAREHOUSES[0].name} as origin
                </span>
              )}
              --- end V2 --- */}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
            aria-label="Close stock assignment"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 bg-stone-50 border-b border-stone-200 text-xs text-stone-600">
          <span>
            Stock assigned from the {MAIN_WAREHOUSE.name}. Adjust per line if needed.
          </span>
          <button
            type="button"
            onClick={resetToOptimized}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium text-blue-700 hover:bg-blue-50 cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          {lines.map((line) => {
            const assigned = totalAssigned(line);
            const balanced = isLineBalanced(line);
            const onHand = onHandByLineKey[line.lineKey] ?? 0;
            const current =
              line.allocations.find((a) => a.warehouseId === MAIN_WAREHOUSE.id)?.qty ?? 0;
            const noStock = onHand === 0;

            return (
              <div
                key={line.lineKey}
                className={`rounded-lg border ${
                  balanced ? 'border-stone-200' : 'border-rose-300 bg-rose-50/30'
                } p-4`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium text-stone-900 text-sm">
                      {line.productName}
                      {line.packSize ? (
                        <span className="text-stone-500 ml-1.5 text-xs">
                          (carton of {line.packSize})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Requested: <span className="font-semibold tabular-nums">{line.requestedQty}</span>
                    </p>
                  </div>
                  <div
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums px-2.5 py-1 rounded-full ${
                      balanced
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {balanced ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    )}
                    {assigned} / {line.requestedQty}
                    {line.shortBy > 0 && (
                      <span className="ml-1 text-rose-700">· short {line.shortBy}</span>
                    )}
                  </div>
                </div>

                {/* v1: single Main Warehouse row per line. */}
                <label
                  className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                    noStock
                      ? 'border-stone-200 bg-stone-50 text-stone-400'
                      : 'border-stone-200 bg-white'
                  }`}
                >
                  <span className="flex flex-col min-w-0">
                    <span className="text-xs font-medium text-stone-700 truncate">
                      {MAIN_WAREHOUSE.name}
                    </span>
                    <span className="text-[10px] text-stone-400 tabular-nums">
                      on hand: {onHand}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={onHand}
                    value={current}
                    onChange={(e) =>
                      updateAllocation(line.lineKey, MAIN_WAREHOUSE.id, Number(e.target.value))
                    }
                    disabled={noStock}
                    className="w-16 rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-right tabular-nums focus:ring-2 focus:ring-blue-600 focus:outline-none disabled:bg-stone-100 disabled:cursor-not-allowed"
                    aria-label={`Quantity from ${MAIN_WAREHOUSE.name} for ${line.productName}`}
                  />
                </label>

                {/* --- V2: multi-warehouse grid (disabled for v1) -----------
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {WAREHOUSES.map((wh: Warehouse) => {
                    const whOnHand = stockForProduct[wh.id] ?? 0;
                    const whCurrent =
                      line.allocations.find((a) => a.warehouseId === wh.id)?.qty ?? 0;
                    const whNoStock = whOnHand === 0;
                    return (
                      <label
                        key={wh.id}
                        className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                          whNoStock
                            ? 'border-stone-200 bg-stone-50 text-stone-400'
                            : 'border-stone-200 bg-white'
                        }`}
                      >
                        <span className="flex flex-col min-w-0">
                          <span className="text-xs font-medium text-stone-700 truncate">
                            {wh.name}
                          </span>
                          <span className="text-[10px] text-stone-400 tabular-nums">
                            on hand: {whOnHand}
                          </span>
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={whOnHand}
                          value={whCurrent}
                          onChange={(e) =>
                            updateAllocation(line.lineKey, wh.id, Number(e.target.value))
                          }
                          disabled={whNoStock}
                          className="w-16 rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-right tabular-nums focus:ring-2 focus:ring-blue-600 focus:outline-none disabled:bg-stone-100 disabled:cursor-not-allowed"
                          aria-label={`Quantity from ${wh.name} for ${line.productName}`}
                        />
                      </label>
                    );
                  })}
                </div>
                --- end V2 --------------------------------------------------- */}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-200 bg-white flex items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            {anyShort
              ? 'One or more lines are short on stock. Resolve before confirming.'
              : allBalanced
                ? 'All lines balanced — ready to confirm.'
                : 'Adjust the assigned quantities so each line totals the requested amount.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!allBalanced}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-stone-300 disabled:cursor-not-allowed cursor-pointer"
            >
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
