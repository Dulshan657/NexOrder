import { useMemo, useState } from 'react';
import { Boxes, Truck } from 'lucide-react';
import type { Order, Product } from '@/types';
import {
  computeStockHealth,
  computeDispatchFunnel,
  type DispatchWindow,
} from '@/services/inventoryDashboardService';
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

  const stockHealth = useMemo(
    () => computeStockHealth(products, lowStockThreshold),
    [products, lowStockThreshold],
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
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <Boxes className="h-4 w-4 text-emerald-600" /> Stock Health
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
              Current
            </span>
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
                  className={`min-h-[32px] cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-150 ${
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
