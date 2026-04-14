import React, { useMemo, useState } from 'react';
import type { Order, HoReCa, Product, HoReCaSegment, HoReCaInsights } from '../types';
import { computeAllHoReCaInsights, computeCoPurchasePatterns } from '../services/buyingPatternsService';
import SegmentBadge from './SegmentBadge';
import { Crown, TrendingUp, TrendingDown, AlertTriangle, UserPlus, Users, Calendar, DollarSign, ShoppingCart, Package, ChevronDown, ChevronUp } from 'lucide-react';

interface HoReCaInsightsPanelProps {
  allOrders: Order[];
  hoReCas: HoReCa[];
  products: Product[];
  onStartOrder?: (hoReCaId: number) => void;
}

const SEGMENT_ORDER: HoReCaSegment[] = ['high_value', 'growing', 'new', 'declining', 'at_risk'];
const SEGMENT_ICONS: Record<HoReCaSegment, React.ReactNode> = {
  high_value: <Crown className="w-5 h-5 text-amber-600" />,
  growing: <TrendingUp className="w-5 h-5 text-emerald-600" />,
  declining: <TrendingDown className="w-5 h-5 text-orange-600" />,
  at_risk: <AlertTriangle className="w-5 h-5 text-red-600" />,
  new: <UserPlus className="w-5 h-5 text-blue-600" />,
};
const SEGMENT_BG: Record<HoReCaSegment, string> = {
  high_value: 'bg-amber-50 border-amber-200',
  growing: 'bg-emerald-50 border-emerald-200',
  declining: 'bg-orange-50 border-orange-200',
  at_risk: 'bg-red-50 border-red-200',
  new: 'bg-blue-50 border-blue-200',
};
const SEGMENT_LABELS: Record<HoReCaSegment, string> = {
  high_value: 'High Value',
  growing: 'Growing',
  declining: 'Declining',
  at_risk: 'At Risk',
  new: 'New',
};

const HoReCaInsightsPanel: React.FC<HoReCaInsightsPanelProps> = ({ allOrders, hoReCas, products, onStartOrder }) => {
  const [expandedSection, setExpandedSection] = useState<string | null>('segments');
  const [selectedSegmentFilter, setSelectedSegmentFilter] = useState<HoReCaSegment | 'all'>('all');

  const allInsights = useMemo(
    () => computeAllHoReCaInsights(allOrders, hoReCas),
    [allOrders, hoReCas]
  );

  const coPurchasePairs = useMemo(
    () => computeCoPurchasePatterns(allOrders),
    [allOrders]
  );

  const segmentCounts = useMemo(() => {
    const counts: Record<HoReCaSegment, number> = { high_value: 0, growing: 0, declining: 0, at_risk: 0, new: 0 };
    for (const insight of allInsights) {
      counts[insight.segment]++;
    }
    return counts;
  }, [allInsights]);

  const atRiskCustomers = useMemo(
    () => allInsights.filter(i => i.segment === 'at_risk').sort((a, b) => (b.daysSinceLastOrder ?? 0) - (a.daysSinceLastOrder ?? 0)),
    [allInsights]
  );

  const growingCustomers = useMemo(
    () => allInsights.filter(i => i.segment === 'growing').sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 5),
    [allInsights]
  );

  const decliningCustomers = useMemo(
    () => allInsights.filter(i => i.segment === 'declining').sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 5),
    [allInsights]
  );

  const filteredInsights = useMemo(
    () => selectedSegmentFilter === 'all' ? allInsights : allInsights.filter(i => i.segment === selectedSegmentFilter),
    [allInsights, selectedSegmentFilter]
  );

  const frequencyDistribution = useMemo(() => {
    const buckets = { 'Weekly (1-7d)': 0, 'Biweekly (8-14d)': 0, 'Monthly (15-30d)': 0, 'Infrequent (30d+)': 0, 'Single order': 0 };
    for (const insight of allInsights) {
      if (insight.avgDaysBetweenOrders === null) { buckets['Single order']++; continue; }
      if (insight.avgDaysBetweenOrders <= 7) buckets['Weekly (1-7d)']++;
      else if (insight.avgDaysBetweenOrders <= 14) buckets['Biweekly (8-14d)']++;
      else if (insight.avgDaysBetweenOrders <= 30) buckets['Monthly (15-30d)']++;
      else buckets['Infrequent (30d+)']++;
    }
    return buckets;
  }, [allInsights]);

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-5 h-5 text-stone-700" />
        <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">HoReCa Insights</h2>
        <span className="text-sm text-stone-500">({hoReCas.length} hoReCas)</span>
      </div>

      {/* Segment Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {SEGMENT_ORDER.map(segment => (
          <button
            key={segment}
            onClick={() => setSelectedSegmentFilter(prev => prev === segment ? 'all' : segment)}
            className={`p-4 rounded-xl border transition-all ${
              selectedSegmentFilter === segment ? 'ring-2 ring-stone-400 shadow-md' : ''
            } ${SEGMENT_BG[segment]} hover:shadow-sm`}
          >
            <div className="flex items-center gap-2 mb-2">
              {SEGMENT_ICONS[segment]}
              <span className="text-sm font-medium">{SEGMENT_LABELS[segment]}</span>
            </div>
            <div className="text-2xl font-bold">{segmentCounts[segment]}</div>
          </button>
        ))}
      </div>

      {selectedSegmentFilter !== 'all' && (
        <div className="text-sm text-stone-500">
          Showing {SEGMENT_LABELS[selectedSegmentFilter]} hoReCas.{' '}
          <button onClick={() => setSelectedSegmentFilter('all')} className="text-blue-600 hover:underline">Show all</button>
        </div>
      )}

      {/* At Risk Customers */}
      {atRiskCustomers.length > 0 && (
        <Section title="At-Risk HoReCa" icon={<AlertTriangle className="w-5 h-5 text-red-500" />} isExpanded={expandedSection === 'at_risk'} onToggle={() => toggleSection('at_risk')}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-200">
                  <th className="pb-2 font-medium">HoReCa</th>
                  <th className="pb-2 font-medium">Days Since Last Order</th>
                  <th className="pb-2 font-medium">Total Orders</th>
                  <th className="pb-2 font-medium">Total Spend</th>
                  <th className="pb-2 font-medium">Avg Order Value</th>
                  {onStartOrder && <th className="pb-2 font-medium">Action</th>}
                </tr>
              </thead>
              <tbody>
                {atRiskCustomers.map(c => (
                  <tr key={c.hoReCaId} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="py-2.5 font-medium text-stone-800">{c.hoReCaName}</td>
                    <td className="py-2.5">
                      <span className="text-red-600 font-medium">{c.daysSinceLastOrder} days</span>
                    </td>
                    <td className="py-2.5">{c.totalOrders}</td>
                    <td className="py-2.5">${c.totalSpend.toFixed(2)}</td>
                    <td className="py-2.5">${c.avgOrderValue.toFixed(2)}</td>
                    {onStartOrder && (
                      <td className="py-2.5">
                        <button onClick={() => onStartOrder(c.hoReCaId)} className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 transition-colors">
                          Start Order
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Growing & Declining Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {growingCustomers.length > 0 && (
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <h3 className="font-semibold text-emerald-800 text-sm">Top Growing Customers</h3>
            </div>
            <div className="space-y-2">
              {growingCustomers.map((c, i) => (
                <div key={c.hoReCaId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-600 font-medium w-5">{i + 1}.</span>
                    <span className="text-stone-800">{c.hoReCaName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-stone-600">
                    <span>${c.totalSpend.toFixed(0)}</span>
                    <span className="text-emerald-600 text-xs">
                      {c.frequencyTrend === 'increasing' ? 'Ordering more often' : 'Spending more'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {decliningCustomers.length > 0 && (
          <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-4 h-4 text-orange-600" />
              <h3 className="font-semibold text-orange-800 text-sm">Declining Customers</h3>
            </div>
            <div className="space-y-2">
              {decliningCustomers.map((c, i) => (
                <div key={c.hoReCaId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-orange-600 font-medium w-5">{i + 1}.</span>
                    <span className="text-stone-800">{c.hoReCaName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-stone-600">
                    <span>${c.totalSpend.toFixed(0)}</span>
                    <span className="text-orange-600 text-xs">
                      {c.frequencyTrend === 'decreasing' ? 'Ordering less often' : 'Spending less'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Co-Purchase Patterns */}
      {coPurchasePairs.length > 0 && (
        <Section title="Frequently Bought Together" icon={<Package className="w-5 h-5 text-stone-500" />} isExpanded={expandedSection === 'copurchase'} onToggle={() => toggleSection('copurchase')}>
          <div className="space-y-2">
            {coPurchasePairs.slice(0, 10).map((pair, i) => {
              const maxCount = coPurchasePairs[0].coOccurrenceCount;
              const barWidth = (pair.coOccurrenceCount / maxCount) * 100;
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <div className="w-8 text-right text-stone-400 font-mono">{pair.coOccurrenceCount}x</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-stone-700 truncate">{pair.productNameA}</span>
                      <span className="text-stone-400">&</span>
                      <span className="text-stone-700 truncate">{pair.productNameB}</span>
                    </div>
                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${barWidth}%` }} />
                    </div>
                  </div>
                  <div className="text-xs text-stone-400 w-12 text-right">{pair.supportPercent}%</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Order Frequency Distribution */}
      <Section title="Order Frequency Distribution" icon={<Calendar className="w-5 h-5 text-stone-500" />} isExpanded={expandedSection === 'frequency'} onToggle={() => toggleSection('frequency')}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(frequencyDistribution).map(([label, count]) => {
            const maxCount = Math.max(...Object.values(frequencyDistribution));
            const barHeight = maxCount > 0 ? (count / maxCount) * 100 : 0;
            return (
              <div key={label} className="text-center">
                <div className="h-24 flex items-end justify-center mb-2">
                  <div
                    className="w-10 bg-blue-400 rounded-t-md transition-all"
                    style={{ height: `${Math.max(barHeight, 4)}%` }}
                  />
                </div>
                <div className="text-lg font-bold text-stone-800">{count}</div>
                <div className="text-xs text-stone-500">{label}</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* All HoReCa Table */}
      <Section title="All HoReCa" icon={<Users className="w-5 h-5 text-stone-500" />} isExpanded={expandedSection === 'all'} onToggle={() => toggleSection('all')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-200">
                <th className="pb-2 font-medium">HoReCa</th>
                <th className="pb-2 font-medium">Segment</th>
                <th className="pb-2 font-medium">Orders</th>
                <th className="pb-2 font-medium">Total Spend</th>
                <th className="pb-2 font-medium">Avg Value</th>
                <th className="pb-2 font-medium">Frequency</th>
                <th className="pb-2 font-medium">Last Order</th>
                <th className="pb-2 font-medium">Next Predicted</th>
              </tr>
            </thead>
            <tbody>
              {filteredInsights.sort((a, b) => b.totalSpend - a.totalSpend).map(insight => (
                <tr key={insight.hoReCaId} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="py-2.5 font-medium text-stone-800">{insight.hoReCaName}</td>
                  <td className="py-2.5"><SegmentBadge segment={insight.segment} /></td>
                  <td className="py-2.5">{insight.totalOrders}</td>
                  <td className="py-2.5">${insight.totalSpend.toFixed(2)}</td>
                  <td className="py-2.5">${insight.avgOrderValue.toFixed(2)}</td>
                  <td className="py-2.5">
                    {insight.avgDaysBetweenOrders !== null
                      ? `Every ${insight.avgDaysBetweenOrders} days`
                      : '—'}
                  </td>
                  <td className="py-2.5">
                    {insight.daysSinceLastOrder !== null
                      ? `${insight.daysSinceLastOrder} days ago`
                      : '—'}
                  </td>
                  <td className="py-2.5 text-stone-500">
                    {insight.predictedNextOrderDate
                      ? new Date(insight.predictedNextOrderDate).toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
};

// Collapsible section wrapper
function Section({ title, icon, isExpanded, onToggle, children }: {
  title: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 hover:bg-stone-50 transition-colors">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-semibold text-stone-800 text-sm">{title}</h3>
        </div>
        {isExpanded ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
      </button>
      {isExpanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export default HoReCaInsightsPanel;
