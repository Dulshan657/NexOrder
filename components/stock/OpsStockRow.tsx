import React, { useId, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import type { Product } from '../../types';
import type { WarehouseScope } from '../../lib/warehouseScope';
import { useBalancesByProduct, useLocations } from '../../hooks/queries/useInventoryBalances';
import { classifyStock, lowStockThresholdFor, type StockStatus } from '../../lib/stockStatus';
import type { ProductBatchBalance } from '../../services/supabase/inventoryService';
import { decomposeToUoms, formatBreakdown } from '../../lib/uomDecompose';
import { deriveDefaultUoms } from '../../lib/uom';
import { subtreeLocationIds } from '../../lib/warehouseSubtree';
import AdjustStockModal from '../admin/AdjustStockModal';
import { locationOneLine } from '@/lib/locationDisplay';
import { BatchSlotRow } from './BatchSlotRow';
import { OPS_STOCK_ROW_COLUMNS, StockMicroLabel } from './stockRowColumns';

export interface Agg { onHand: number; allocated: number; available: number }

export const StatusPill: React.FC<{ status: StockStatus }> = ({ status }) => {
  if (status === 'in_stock') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3 h-3" aria-hidden="true" /> In Stock</span>;
  if (status === 'low_stock') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700"><AlertCircle className="w-3 h-3" aria-hidden="true" /> Low Stock</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700"><AlertCircle className="w-3 h-3" aria-hidden="true" /> Out of Stock</span>;
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
 *
 * ── IT IS A LIST ITEM, NOT A TABLE ROW ─────────────────────────────────────
 *
 * This was a `<tr>` with `onClick` and `cursor-pointer` and no key handler, so
 * the expansion was mouse-only; and its detail was a second `<table>` nested in
 * a `<td>`, which at 360px meant two horizontal scroll axes. It is now a real
 * `<button aria-expanded aria-controls>` inside an `<li>`, laid out by a
 * container query so the same single render is a card at 360px and the same
 * five columns it always was on a desk.
 *
 * Deliberately NOT given `role="table"`/`"row"`/`"cell"` to win the semantics
 * back: below the breakpoint there is no table, and the roles would be a lie
 * exactly where assistive tech is most likely to be reading.
 *
 * `canAdjust` (Admin/Manager only — see StockView's isAdminManager) shows a
 * per-batch "Adjust" opening AdjustStockModal for that exact (product,
 * location, batch) slot. `globalThreshold` is the app-wide low-stock fallback;
 * the row prefers the product's own `reorderPoint`.
 */
export const OpsStockRow: React.FC<OpsStockRowProps> = ({ product, agg, maxQty, canAdjust, globalThreshold, scope }) => {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const { data: batches, isLoading } = useBalancesByProduct(expanded ? product.id : null);
  const { data: locations } = useLocations();
  const [adjustTarget, setAdjustTarget] = useState<ProductBatchBalance | null>(null);
  const status = classifyStock(agg.available, lowStockThresholdFor(product, globalThreshold));
  const fillPercent = Math.min((agg.available / maxQty) * 100, 100);
  const barColor = status === 'out_of_stock' ? 'bg-red-400' : status === 'low_stock' ? 'bg-amber-400' : 'bg-emerald-400';

  // Locations in the scoped warehouse's subtree. `null` means "no filtering"
  // (scope is 'all', or the tree hasn't loaded) — which is NOT the same as an
  // empty set, so the filter below tests for null explicitly.
  const scopedLocationIds = useMemo(
    () => subtreeLocationIds(locations, typeof scope === 'number' ? scope : null),
    [scope, locations],
  );

  const visibleBatches = useMemo(() => {
    if (!batches || !scopedLocationIds) return batches;
    return batches.filter(b => scopedLocationIds.has(b.locationId));
  }, [batches, scopedLocationIds]);

  // Break the base-unit on-hand into UOM tiers for a quick read (mig 00067),
  // e.g. "1 pallet, 8 each". Only when a pack larger than the base exists.
  const breakdownLabel = useMemo(() => {
    const uoms = (product.uoms && product.uoms.length > 0)
      ? product.uoms
      : deriveDefaultUoms(product.unit, product.price, product.cartonSize);
    if (uoms.length <= 1 || agg.onHand <= 0) return null;
    const breakdown = decomposeToUoms(agg.onHand, uoms);
    if (breakdown.length <= 1) return null;
    return formatBreakdown(breakdown);
  }, [product.uoms, product.unit, product.price, product.cartonSize, agg.onHand]);

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className={
          'touch-target-y grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 ' +
          'px-4 py-3 text-left transition-colors hover:bg-stone-50/50 btn-press ' +
          `@min-[780px]:items-center @min-[780px]:gap-x-4 @min-[780px]:gap-y-0 ${OPS_STOCK_ROW_COLUMNS}`
        }
      >
        {/* Identity */}
        <span className="flex min-w-0 items-center gap-2">
          {expanded
            ? <ChevronDown className="w-4 h-4 shrink-0 text-stone-600" aria-hidden="true" />
            : <ChevronRight className="w-4 h-4 shrink-0 text-stone-600" aria-hidden="true" />}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-stone-900">{product.name}</span>
            <span className="block truncate font-mono text-xs text-stone-600">{product.sku}</span>
          </span>
        </span>

        <span className="col-span-2 grid grid-cols-3 gap-x-3 gap-y-2 @min-[780px]:contents">
          <span className="block @min-[780px]:text-right">
            <StockMicroLabel>On hand</StockMicroLabel>
            <span className="block font-mono text-sm text-stone-900 tabular-nums">{agg.onHand}</span>
            {breakdownLabel && (
              <span className="mt-0.5 block text-[11px] font-sans normal-nums text-stone-600">{breakdownLabel}</span>
            )}
          </span>

          <span className="block @min-[780px]:text-right">
            <StockMicroLabel>Allocated</StockMicroLabel>
            <span className="block font-mono text-sm text-stone-600 tabular-nums">{agg.allocated}</span>
          </span>

          <span className="block @min-[780px]:flex @min-[780px]:items-center @min-[780px]:gap-3">
            <StockMicroLabel>Available</StockMicroLabel>
            <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-stone-100 @min-[780px]:block">
              <span className={`block h-2 rounded-full ${barColor} transition-all duration-300`} style={{ width: `${fillPercent}%` }} />
            </span>
            <span className="block w-12 text-left font-mono text-sm font-semibold text-stone-900 tabular-nums @min-[780px]:text-right">
              {agg.available}
            </span>
          </span>
        </span>
        {/* Status sits beside the name on the narrow layout — it is the cell
            read at a glance — and becomes the last column at 780px.
            EXPLICITLY PLACED rather than reordered: at 780px this span and the
            three metric cells inside the `contents` wrapper below are siblings
            in one grid, and leaning on `order` across a `display: contents`
            boundary is a subtler thing to be right about than saying where the
            box goes. Narrow: row 1, column 2. Wide: auto, which is column 5
            because it is last in DOM order. */}
        <span className="col-start-2 row-start-1 shrink-0 justify-self-end @min-[780px]:col-start-auto @min-[780px]:row-start-auto @min-[780px]:text-right">
          <StatusPill status={status} />
        </span>
      </button>

      {expanded && (
        <div id={detailsId} className="@container bg-stone-50/60 px-4 pb-3">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {[0, 1].map((i) => <div key={i} className="h-4 rounded bg-stone-100 animate-pulse" />)}
            </div>
          ) : !visibleBatches || visibleBatches.length === 0 ? (
            <p className="px-1 py-2 text-xs text-stone-600">No batch records for this product.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
              {visibleBatches.map((b) => (
                // Wrapped in a Fragment because `key` cannot be passed to a
                // component with a typed props interface — with no
                // `@types/react` there is no global JSX namespace to carry it.
                <React.Fragment key={b.balanceId}>
                  <BatchSlotRow
                    balance={b}
                    canAdjust={canAdjust}
                    onAdjust={setAdjustTarget}
                    productName={product.name}
                  />
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}

      {adjustTarget && (
        <AdjustStockModal
          product={product}
          locationId={adjustTarget.locationId}
          locationLabel={`${locationOneLine({ code: adjustTarget.locationCode ?? 'MAIN', name: adjustTarget.locationName })} · ${adjustTarget.lotCode ? `lot ${adjustTarget.lotCode}` : 'untracked'}`}
          batchId={adjustTarget.batchId}
          currentOnHand={adjustTarget.onHand}
          onClose={() => setAdjustTarget(null)}
        />
      )}
    </li>
  );
};

export default OpsStockRow;
