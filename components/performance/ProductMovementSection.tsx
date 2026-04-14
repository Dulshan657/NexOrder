import React, { useMemo, useState } from 'react';
import type { Order, Product } from '../../types';
import { getTopMovers, getSlowMovers, getDeadStock, getCategoryPerformance, getRestockAlerts, computeMovementSummary } from '../../services/productMovementService';
import VelocityBar from './VelocityBar';
import { Package, TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown, ChevronUp, Zap, Archive, BarChart3 } from 'lucide-react';

interface ProductMovementSectionProps {
  orders: Order[];
  products: Product[];
}

const TrendIcon: React.FC<{ trend: string }> = ({ trend }) => {
  if (trend === 'accelerating') return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
  if (trend === 'declining') return <TrendingDown className="w-3.5 h-3.5 text-orange-600" />;
  return <Minus className="w-3.5 h-3.5 text-stone-400" />;
};

const ProductMovementSection: React.FC<ProductMovementSectionProps> = ({ orders, products }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeView, setActiveView] = useState<'movers' | 'slow' | 'dead' | 'restock'>('movers');

  const summary = useMemo(() => computeMovementSummary(orders, products), [orders, products]);
  const topMovers = useMemo(() => getTopMovers(orders, products), [orders, products]);
  const slowMovers = useMemo(() => getSlowMovers(orders, products), [orders, products]);
  const deadStock = useMemo(() => getDeadStock(orders, products), [orders, products]);
  const restockAlerts = useMemo(() => getRestockAlerts(orders, products), [orders, products]);
  const categoryPerf = useMemo(() => getCategoryPerformance(orders, products), [orders, products]);

  const maxVelocity = topMovers.length > 0 ? topMovers[0].unitsPerWeek : 1;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden">
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full flex items-center justify-between p-5 hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-stone-600" />
          <h3 className="font-semibold text-stone-800">Product Movement</h3>
        </div>
        {isExpanded ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
      </button>

      {isExpanded && (
        <div className="px-5 pb-5 space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <p className="text-xs text-stone-500 mb-1">Units Sold (90d)</p>
              <p className="text-xl font-bold text-stone-800">{summary.totalUnitsSold.toLocaleString()}</p>
            </div>
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <p className="text-xs text-stone-500 mb-1">Avg Velocity</p>
              <p className="text-xl font-bold text-stone-800">{summary.avgWeeklyVelocity}/wk</p>
            </div>
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <p className="text-xs text-stone-500 mb-1">Dead Stock</p>
              <p className={`text-xl font-bold ${summary.deadStockCount > 0 ? 'text-red-600' : 'text-stone-800'}`}>{summary.deadStockCount}</p>
            </div>
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <p className="text-xs text-stone-500 mb-1">Restock Alerts</p>
              <p className={`text-xl font-bold ${summary.restockAlertCount > 0 ? 'text-amber-600' : 'text-stone-800'}`}>{summary.restockAlertCount}</p>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 overflow-x-auto">
            {[
              { key: 'movers' as const, label: 'Top Movers', icon: <Zap className="w-3 h-3" />, count: topMovers.length },
              { key: 'slow' as const, label: 'Slow Movers', icon: <TrendingDown className="w-3 h-3" />, count: slowMovers.length },
              { key: 'dead' as const, label: 'Dead Stock', icon: <Archive className="w-3 h-3" />, count: deadStock.length },
              { key: 'restock' as const, label: 'Restock', icon: <AlertTriangle className="w-3 h-3" />, count: restockAlerts.length },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveView(tab.key)}
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                  activeView === tab.key ? 'bg-nexgen-blue text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {tab.icon}
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* Product Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-200">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium text-right">Velocity</th>
                  <th className="pb-2 font-medium">Trend</th>
                  <th className="pb-2 font-medium text-right">Stock</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(activeView === 'movers' ? topMovers : activeView === 'slow' ? slowMovers : activeView === 'dead' ? deadStock : restockAlerts)
                  .slice(0, 10)
                  .map(item => (
                    <tr key={item.productId} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="py-2.5 font-medium text-stone-800 truncate max-w-[200px]">{item.productName}</td>
                      <td className="py-2.5 text-stone-500 text-xs">{item.category}</td>
                      <td className="py-2.5 text-right font-mono">{item.unitsPerWeek}/wk</td>
                      <td className="py-2.5"><TrendIcon trend={item.trend} /></td>
                      <td className="py-2.5 text-right">{item.currentStock}</td>
                      <td className="py-2.5"><VelocityBar value={item.unitsPerWeek} maxValue={maxVelocity} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Category Performance */}
          {categoryPerf.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-stone-500 mb-2 flex items-center gap-1">
                <BarChart3 className="w-3 h-3" />
                Category Performance
              </h4>
              <div className="space-y-2">
                {categoryPerf.slice(0, 8).map(cat => {
                  const maxRevenue = categoryPerf[0].totalRevenue;
                  const barWidth = maxRevenue > 0 ? (cat.totalRevenue / maxRevenue) * 100 : 0;
                  return (
                    <div key={cat.category} className="flex items-center gap-3 text-sm">
                      <span className="w-28 text-stone-700 truncate text-xs">{cat.category}</span>
                      <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${barWidth}%` }} />
                      </div>
                      <span className="text-xs text-stone-500 w-20 text-right">${cat.totalRevenue.toFixed(0)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductMovementSection;
