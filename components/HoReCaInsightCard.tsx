import React, { useMemo } from 'react';
import type { Order, HoReCa } from '../types';
import { computeHoReCaInsights, getReorderPredictions } from '../services/buyingPatternsService';
import SegmentBadge from './SegmentBadge';
import { Calendar, TrendingUp, TrendingDown, Minus, Package, Clock, BarChart3 } from 'lucide-react';

interface HoReCaInsightCardProps {
  customer: HoReCa;
  allOrders: Order[];
}

const TrendIcon: React.FC<{ trend: 'increasing' | 'decreasing' | 'stable' }> = ({ trend }) => {
  if (trend === 'increasing') return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
  if (trend === 'decreasing') return <TrendingDown className="w-3.5 h-3.5 text-orange-600" />;
  return <Minus className="w-3.5 h-3.5 text-stone-400" />;
};

const HoReCaInsightCard: React.FC<HoReCaInsightCardProps> = ({ customer, allOrders }) => {
  const insights = useMemo(
    () => computeHoReCaInsights(allOrders, customer.id, customer.name),
    [allOrders, customer.id, customer.name]
  );

  if (insights.totalOrders === 0) {
    return (
      <div className="bg-stone-50/50 rounded-xl border border-stone-100 p-4">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-4 h-4 text-stone-400" />
          <h4 className="text-sm font-semibold text-stone-700">Buying Patterns</h4>
        </div>
        <p className="text-sm text-stone-500 italic">No order history yet.</p>
      </div>
    );
  }

  const topProducts = insights.productFrequencies.slice(0, 5);

  return (
    <div className="bg-stone-50/50 rounded-xl border border-stone-100 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-stone-500" />
          <h4 className="text-sm font-semibold text-stone-700">Buying Patterns</h4>
        </div>
        <SegmentBadge segment={insights.segment} />
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-xs text-stone-500 mb-1">Avg Order</p>
          <p className="text-lg font-bold text-stone-800">${insights.avgOrderValue.toFixed(0)}</p>
          <div className="flex justify-center"><TrendIcon trend={insights.spendTrend} /></div>
        </div>
        <div className="text-center">
          <p className="text-xs text-stone-500 mb-1">Frequency</p>
          <p className="text-lg font-bold text-stone-800">
            {insights.avgDaysBetweenOrders !== null ? `${insights.avgDaysBetweenOrders}d` : '—'}
          </p>
          <div className="flex justify-center"><TrendIcon trend={insights.frequencyTrend} /></div>
        </div>
        <div className="text-center">
          <p className="text-xs text-stone-500 mb-1">Total Spend</p>
          <p className="text-lg font-bold text-stone-800">${insights.totalSpend.toFixed(0)}</p>
        </div>
      </div>

      {/* Predicted Next Order */}
      {insights.predictedNextOrderDate && (
        <div className="flex items-center gap-2 text-sm bg-blue-50 rounded-lg p-2.5 border border-blue-100">
          <Calendar className="w-4 h-4 text-blue-600" />
          <span className="text-blue-800">
            Next order predicted: <strong>{new Date(insights.predictedNextOrderDate).toLocaleDateString()}</strong>
          </span>
          {insights.daysSinceLastOrder !== null && (
            <span className="text-blue-600 ml-auto text-xs">
              ({insights.daysSinceLastOrder}d since last)
            </span>
          )}
        </div>
      )}

      {/* Top Product Preferences */}
      {topProducts.length > 0 && (
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2">Top Products</p>
          <div className="space-y-1.5">
            {topProducts.map(pf => (
              <div key={pf.productId} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Package className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                  <span className="text-stone-700 truncate">{pf.productName}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <span className="text-xs text-stone-500">
                    ~{pf.avgQuantityPerOrder}/order
                  </span>
                  {pf.isOverdue && (
                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                      Due
                    </span>
                  )}
                  {pf.avgDaysBetweenOrders !== null && (
                    <span className="text-[10px] text-stone-400">
                      every {pf.avgDaysBetweenOrders}d
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spending Trend Mini-Chart */}
      {insights.spendingTrends.length >= 2 && (
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2">Monthly Spend</p>
          <div className="flex items-end gap-1 h-12">
            {insights.spendingTrends.map(st => {
              const maxSpend = Math.max(...insights.spendingTrends.map(s => s.totalSpend));
              const height = maxSpend > 0 ? (st.totalSpend / maxSpend) * 100 : 0;
              return (
                <div key={st.month} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-blue-300 rounded-t-sm min-h-[2px]"
                    style={{ height: `${Math.max(height, 4)}%` }}
                    title={`${st.month}: $${st.totalSpend.toFixed(0)}`}
                  />
                  <span className="text-[8px] text-stone-400 mt-1">{st.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default HoReCaInsightCard;
