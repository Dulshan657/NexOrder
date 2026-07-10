import React, { useState, useMemo } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, MapPin, SlidersHorizontal } from 'lucide-react';
import type { Product } from '../../types';
import type { WarehouseScope } from '../../lib/warehouseScope';
import { useBalancesByProduct, useLocations } from '../../hooks/queries/useInventoryBalances';
import { classifyStock, lowStockThresholdFor, type StockStatus } from '../../lib/stockStatus';
import type { ProductBatchBalance } from '../../services/supabase/inventoryService';
import AdjustStockModal from '../admin/AdjustStockModal';

export interface Agg { onHand: number; allocated: number; available: number }

export const StatusPill: React.FC<{ status: StockStatus }> = ({ status }) => {
  if (status === 'in_stock') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3 h-3" /> In Stock</span>;
  if (status === 'low_stock') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700"><AlertCircle className="w-3 h-3" /> Low Stock</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700"><AlertCircle className="w-3 h-3" /> Out of Stock</span>;
};

interface OpsStockRowProps {
  product: Product;
  agg: Agg;
  maxQty: number;
  canAdjust: boolean;
  globalThreshold: number;
  /** The active warehouse scope. When numeric, the expanded per-batch detail
   * is filtered to that warehouse's subtree — otherwise the collapsed
   * aggregate (site-scoped) and the expansion (which reads every location
   * via `useBalancesByProduct`) wouldn't reconcile. */
  scope: WarehouseScope;
}

/** Ops-only expandable row: aggregate on top, lazy per-batch detail on expand.
 * `canAdjust` (Admin/Manager only for now — see StockView's isAdminManager)
 * shows a per-batch "Adjust" action that opens AdjustStockModal for that exact
 * (product, location, batch) slot. `globalThreshold` is the app-wide low-stock
 * fallback; the row prefers the product's own `reorderPoint`. */
export const OpsStockRow: React.FC<OpsStockRowProps> = ({ product, agg, maxQty, canAdjust, globalThreshold, scope }) => {
  const [expanded, setExpanded] = useState(false);
  const { data: batches, isLoading } = useBalancesByProduct(expanded ? product.id : null);
  const { data: locations } = useLocations();
  const [adjustTarget, setAdjustTarget] = useState<ProductBatchBalance | null>(null);
  const status = classifyStock(agg.available, lowStockThresholdFor(product, globalThreshold));
  const fillPercent = Math.min((agg.available / maxQty) * 100, 100);
  const barColor = status === 'out_of_stock' ? 'bg-red-400' : status === 'low_stock' ? 'bg-amber-400' : 'bg-emerald-400';

  // Locations in the scoped warehouse's subtree (root + every descendant
  // whose materializedPath falls under it) — same rule the server RPC uses.
  // `null` means "no filtering" (scope is 'all', or the root hasn't loaded).
  const scopedLocationIds = useMemo(() => {
    if (typeof scope !== 'number' || !locations) return null;
    const root = locations.find(l => l.id === scope);
    if (!root) return null;
    const prefix = `${root.materializedPath}/`;
    const ids = new Set<number>([root.id]);
    for (const loc of locations) {
      if (loc.materializedPath.startsWith(prefix)) ids.add(loc.id);
    }
    return ids;
  }, [scope, locations]);

  const visibleBatches = useMemo(() => {
    if (!batches || !scopedLocationIds) return batches;
    return batches.filter(b => scopedLocationIds.has(b.locationId));
  }, [batches, scopedLocationIds]);

  return (
    <>
      <tr className="border-b border-stone-100 transition-colors hover:bg-stone-50/50 cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="w-4 h-4 text-stone-400" /> : <ChevronRight className="w-4 h-4 text-stone-400" />}
            <div>
              <p className="text-sm font-medium text-stone-900">{product.name}</p>
              <p className="text-xs text-stone-400 font-mono">{product.sku}</p>
            </div>
          </div>
        </td>
        <td className="px-5 py-3.5 text-right font-mono text-sm text-stone-900 tabular-nums">{agg.onHand}</td>
        <td className="px-5 py-3.5 text-right font-mono text-sm text-stone-500 tabular-nums">{agg.allocated}</td>
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-stone-100 rounded-full h-2 overflow-hidden min-w-[80px]">
              <div className={`h-2 rounded-full ${barColor} transition-all duration-300`} style={{ width: `${fillPercent}%` }} />
            </div>
            <span className="font-mono text-sm font-semibold text-stone-900 tabular-nums w-12 text-right">{agg.available}</span>
          </div>
        </td>
        <td className="px-5 py-3.5 text-right">
          <StatusPill status={status} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-stone-50/60">
          <td colSpan={5} className="px-5 py-3">
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1].map((i) => <div key={i} className="h-4 rounded bg-stone-100 animate-pulse" />)}
              </div>
            ) : !visibleBatches || visibleBatches.length === 0 ? (
              <p className="text-xs text-stone-400 px-2 py-1">No batch records for this product.</p>
            ) : (
              <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-stone-100 bg-stone-50 text-stone-500">
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide">Location · Lot</th>
                      <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide">Expiry</th>
                      <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide">On hand</th>
                      <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide">Allocated</th>
                      <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide">Available</th>
                      {canAdjust && <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide">&nbsp;</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {visibleBatches.map((b) => (
                      <tr key={b.balanceId}>
                        <td className="px-3 py-2 text-stone-700">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-stone-400" />
                            {b.locationCode ?? 'MAIN'} · {b.lotCode ? `lot ${b.lotCode}` : 'untracked'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-stone-500">{b.expiryDate ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-700 tabular-nums">{b.onHand}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-500 tabular-nums">{b.allocated}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-stone-900 tabular-nums">{b.available}</td>
                        {canAdjust && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setAdjustTarget(b); }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-nexgen-blue hover:bg-nexgen-blue/10 btn-press"
                            >
                              <SlidersHorizontal className="w-3 h-3" /> Adjust
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
      {adjustTarget && (
        <AdjustStockModal
          product={product}
          locationId={adjustTarget.locationId}
          locationLabel={`${adjustTarget.locationCode ?? 'MAIN'} · ${adjustTarget.lotCode ? `lot ${adjustTarget.lotCode}` : 'untracked'}`}
          batchId={adjustTarget.batchId}
          currentOnHand={adjustTarget.onHand}
          onClose={() => setAdjustTarget(null)}
        />
      )}
    </>
  );
};

export default OpsStockRow;
