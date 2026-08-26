import { useMemo, useState } from 'react';
import { Boxes, Truck } from 'lucide-react';
import type { Order, Product } from '@/types';
import {
  computeStockHealth,
  computeDispatchFunnel,
  type DispatchWindow,
} from '@/services/inventoryDashboardService';
import { useWarehouseScope } from '@/context/WarehouseScopeContext';
import { useProductStockByWarehouse } from '@/hooks/queries/useInventoryBalances';
import StockHealthDonut from '@/components/charts/StockHealthDonut';
import DispatchFunnelChart from '@/components/charts/DispatchFunnelChart';

interface InventoryDispatchSectionProps {
  allOrders: Order[];
  products: Product[];
  lowStockThreshold?: number;
  onNavigateTab?: (tab: string) => void;
}

const WINDOWS: DispatchWindow[] = [7, 30, 90];

function InventoryDispatchSection({
  allOrders,
  products,
  lowStockThreshold = 10,
  onNavigateTab,
}: InventoryDispatchSectionProps) {
  const [window, setWindow] = useState<DispatchWindow>(30);

  // The donut follows the shared warehouse scope (set from Stock/Products/
  // Warehouse) so it always reflects the site the user is currently focused
  // on — hence the "Showing: <site>" chip below telling them so.
  const { scope, scopeLabel } = useWarehouseScope();
  const { data: stockByWarehouse } = useProductStockByWarehouse(scope === 'all' ? null : scope);

  const onHandBySite = useMemo(() => {
    const map = new Map<number, number>();
    (stockByWarehouse ?? []).forEach((row) => map.set(row.productId, row.onHand));
    return map;
  }, [stockByWarehouse]);

  // Absent from `onHandBySite` -> 0 is correct HERE: a product not stocked at
  // the scoped site genuinely has 0 on hand for health-bucketing purposes.
  // Pass nothing under 'all' so global behaviour stays byte-identical to today
  // (computeStockHealth's own default, `p => p.inventory`).
  const onHandOf = useMemo(
    () => (scope === 'all' ? undefined : (product: Product) => onHandBySite.get(product.id) ?? 0),
    [scope, onHandBySite],
  );

  const stockHealth = useMemo(
    () => computeStockHealth(products, lowStockThreshold, onHandOf),
    [products, lowStockThreshold, onHandOf],
  );

  const dispatchFunnel = useMemo(
    () => computeDispatchFunnel(allOrders, window, new Date()),
    [allOrders, window],
  );

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-stone-900">Inventory &amp; Dispatch</h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Stock health — current snapshot */}
        <div
          className={`glass-card rounded-xl p-5 ${onNavigateTab ? 'cursor-pointer transition-shadow hover:shadow-card' : ''}`}
          onClick={onNavigateTab ? () => onNavigateTab('Stock') : undefined}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <Boxes className="h-4 w-4 text-emerald-600" /> Stock Health
            </h3>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-medium text-stone-500">
                Showing: {scopeLabel}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                Current
              </span>
            </div>
          </div>
          <StockHealthDonut data={stockHealth} />
        </div>

        {/* Dispatch funnel — windowed */}
        <div className="glass-card rounded-xl p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <Truck className="h-4 w-4 text-nexgen-blue" /> Dispatch Funnel
            </h3>
            <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWindow(w)}
                  className={`touch-target-y cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-150 ${
                    window === w
                      ? 'bg-nexgen-blue text-white shadow-sm'
                      : 'text-stone-500 hover:bg-stone-50 hover:text-stone-900'
                  }`}
                >
                  {w}d
                </button>
              ))}
            </div>
          </div>
          <DispatchFunnelChart data={dispatchFunnel} />
        </div>
      </div>
    </div>
  );
}

export default InventoryDispatchSection;
