import React from 'react';
import { Package, AlertCircle, CheckCircle2, TrendingDown } from 'lucide-react';

/** Summary counts driving the four Stock KPI tiles. Scope-agnostic — the
 * caller decides whether these were computed against the global aggregate
 * or a single warehouse's subtree (see `useScopedStock`). */
export interface StockMetrics {
  total: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
}

interface StockKpiTilesProps {
  metrics: StockMetrics;
}

/** Extracted from StockView so the parent file stays under ~400 lines. */
export const StockKpiTiles: React.FC<StockKpiTilesProps> = ({ metrics }) => {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="glass-card gradient-card rounded-xl p-3 flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-nexgen-blue/10"><Package className="w-4 h-4 text-nexgen-blue" /></div>
        <div><p className="text-lg font-bold text-stone-900 leading-tight">{metrics.total}</p><p className="text-xs text-stone-500 font-medium">Total Products</p></div>
      </div>
      <div className="glass-card gradient-card rounded-xl p-3 flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-emerald-50"><CheckCircle2 className="w-4 h-4 text-emerald-600" /></div>
        <div><p className="text-lg font-bold text-stone-900 leading-tight">{metrics.inStock}</p><p className="text-xs text-stone-500 font-medium">In Stock</p></div>
      </div>
      <div className="glass-card gradient-card rounded-xl p-3 flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-amber-50"><AlertCircle className="w-4 h-4 text-amber-600" /></div>
        <div><p className="text-lg font-bold text-stone-900 leading-tight">{metrics.lowStock}</p><p className="text-xs text-stone-500 font-medium">Low Stock</p></div>
      </div>
      <div className="glass-card gradient-card rounded-xl p-3 flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-red-50"><TrendingDown className="w-4 h-4 text-red-600" /></div>
        <div><p className="text-lg font-bold text-stone-900 leading-tight">{metrics.outOfStock}</p><p className="text-xs text-stone-500 font-medium">Out of Stock</p></div>
      </div>
    </div>
  );
};

export default StockKpiTiles;
