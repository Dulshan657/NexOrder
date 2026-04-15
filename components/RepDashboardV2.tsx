import React, { useState, useMemo } from 'react';
import type { User, HoReCa, Product, Order, Invoice, SalesTarget, Visit, ScheduledVisit } from '../types';
import { UserRole } from '../types';
import { MapPin, Target, ShoppingBag, DollarSign, BarChart3, CheckCircle2, AlertCircle, Clock, Phone, ArrowRight, Package, UserCheck, Play } from 'lucide-react';
import KPICard from './dashboard/KPICard';
import AlertBanner from './dashboard/AlertBanner';
import ExpandableSection from './dashboard/ExpandableSection';
import SalesLineChart from './charts/SalesLineChart';
import HorizontalBarChart from './charts/HorizontalBarChart';
import DeltaBadge from './dashboard/DeltaBadge';
import SalesTargetModal from './SalesTargetModal';
import SegmentBadge from './SegmentBadge';
import VisitModal from './visits/VisitModal';
import { computeAllHoReCaInsights, getReorderPredictions, getAtRiskCustomersForRep } from '../services/buyingPatternsService';
import { getTodaysScheduledVisits } from '../services/scheduledVisitService';
import { getHoReCaOutstanding } from '../services/accountingService';
import { getVisitCompletionRate } from '../services/repProductivityService';
import { computeTargetProjection } from '../services/targetProjectionService';

interface RepDashboardV2Props {
  currentUser: User;
  hoReCas: HoReCa[];
  products: Product[];
  orders: Order[];
  onStartOrder: (hoReCaId: number) => void;
  invoices?: Invoice[];
  salesTargets?: SalesTarget[];
  onUpdateSalesTargets?: (targets: SalesTarget[]) => void;
  visits?: Visit[];
  setVisits?: (visits: Visit[]) => void;
  routes?: ScheduledVisit[];
  onStartRoute?: (route: ScheduledVisit) => void;
  onViewRoute?: (scheduledVisitId: string) => void;
}

const RepDashboardV2: React.FC<RepDashboardV2Props> = ({
  currentUser, hoReCas, products, orders, onStartOrder,
  invoices = [], salesTargets = [], onUpdateSalesTargets,
  visits = [], setVisits, routes = [],
  onStartRoute, onViewRoute,
}) => {
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [visitHoReCaId, setVisitHoReCaId] = useState<number | null>(null);
  const [expandedStop, setExpandedStop] = useState<number | null>(null);

  const myOrders = useMemo(() => orders.filter(o => o.submittedBy.id === currentUser.id), [orders, currentUser.id]);

  // Performance metrics with period-over-period comparison
  const metrics = useMemo(() => {
    const sorted = [...myOrders].sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);

    const totalSales = myOrders.reduce((sum, o) => sum + o.total, 0);
    const totalOrders = myOrders.length;
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    const uniqueHoReCas = new Set(myOrders.map(o => o.hoReCa?.id).filter(Boolean)).size;

    const firstRevenue = firstHalf.reduce((s, o) => s + o.total, 0);
    const secondRevenue = secondHalf.reduce((s, o) => s + o.total, 0);
    const revenueDelta = firstRevenue > 0 ? ((secondRevenue - firstRevenue) / firstRevenue) * 100 : 0;

    const firstAOV = firstHalf.length > 0 ? firstRevenue / firstHalf.length : 0;
    const secondAOV = secondHalf.length > 0 ? secondRevenue / secondHalf.length : 0;
    const aovDelta = firstAOV > 0 ? ((secondAOV - firstAOV) / firstAOV) * 100 : 0;

    const ordersDelta = firstHalf.length > 0 ? ((secondHalf.length - firstHalf.length) / firstHalf.length) * 100 : 0;

    return { totalSales, totalOrders, avgOrderValue, uniqueHoReCas, revenueDelta, ordersDelta, aovDelta };
  }, [myOrders]);

  // Today's route (only for field reps)
  const isFieldRep = currentUser.role === UserRole.FIELD_REP;
  const todaysRoutes = useMemo(() => isFieldRep ? getTodaysScheduledVisits(routes, currentUser.id) : [], [routes, currentUser.id, isFieldRep]);
  const todayRoute = todaysRoutes[0] ?? null;

  const todayStopsWithContext = useMemo(() => {
    if (!todayRoute) return [];
    return todayRoute.stops.map(stop => {
      const hoReCa = hoReCas.find(c => c.id === stop.hoReCaId);
      const outstanding = hoReCa ? getHoReCaOutstanding(hoReCa.id, hoReCa.name, invoices) : null;
      const insights = hoReCa ? computeAllHoReCaInsights(orders, [hoReCa]) : [];
      const insight = insights[0] ?? null;
      return { ...stop, hoReCa, outstanding, insight };
    });
  }, [todayRoute, hoReCas, invoices, orders]);

  const completedStops = todayRoute ? todayRoute.stops.filter(s => s.status === 'arrived').length : 0;
  const totalStops = todayRoute ? todayRoute.stops.length : 0;

  // Target gap
  const targetGap = useMemo(() => {
    const revenueTarget = salesTargets.find(t => t.userId === currentUser.id && t.type === 'revenue');
    if (!revenueTarget) return null;

    const startMs = new Date(revenueTarget.startDate).getTime();
    const endMs = new Date(revenueTarget.endDate + 'T23:59:59').getTime();
    const achieved = myOrders
      .filter(o => {
        const d = new Date(o.orderDate).getTime();
        return d >= startMs && d <= endMs;
      })
      .reduce((sum, o) => sum + o.total, 0);

    const remaining = Math.max(revenueTarget.targetValue - achieved, 0);
    const projection = computeTargetProjection(revenueTarget, myOrders, currentUser.id);

    return { target: revenueTarget, achieved, remaining, projection };
  }, [salesTargets, currentUser.id, myOrders]);

  // Sales targets progress
  const myTargets = salesTargets.filter(t => t.userId === currentUser.id);

  // Visit completion rate (30d)
  const visitCompletion = useMemo(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    return getVisitCompletionRate(visits, routes, currentUser.id, thirtyDaysAgo, new Date());
  }, [visits, routes, currentUser.id]);

  // Action items
  const reorderPredictions = useMemo(() => {
    return getReorderPredictions(orders, hoReCas).filter(p => p.daysUntil <= 7 && p.daysUntil >= -3);
  }, [orders, hoReCas]);

  const atRiskCustomers = useMemo(() => {
    return getAtRiskCustomersForRep(orders, hoReCas, currentUser.id);
  }, [orders, hoReCas, currentUser.id]);

  const lowStockProducts = useMemo(() => {
    // Products the rep frequently sells that are low/out of stock
    const repProductIds = new Set<number>();
    myOrders.forEach(o => o.items.forEach(item => repProductIds.add(item.id)));
    return products.filter(p => repProductIds.has(p.id) && p.inventory <= 10);
  }, [myOrders, products]);

  // Sales trend chart data (last 30 days)
  const salesChartData = useMemo(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const salesByDate = new Map<string, number>();
    myOrders.filter(o => new Date(o.orderDate) >= thirtyDaysAgo).forEach(o => {
      const date = o.orderDate.split('T')[0];
      salesByDate.set(date, (salesByDate.get(date) || 0) + o.total);
    });

    const data: { date: string; revenue: number }[] = [];
    const d = new Date(thirtyDaysAgo);
    const now = new Date();
    while (d <= now) {
      const dateStr = d.toISOString().split('T')[0];
      data.push({ date: dateStr, revenue: salesByDate.get(dateStr) || 0 });
      d.setDate(d.getDate() + 1);
    }
    return data;
  }, [myOrders]);

  // Top customers & products
  const { topCustomers, topProducts } = useMemo(() => {
    const custMap = new Map<string, number>();
    myOrders.forEach(o => custMap.set(o.hoReCa.name, (custMap.get(o.hoReCa.name) || 0) + o.total));
    const topC = [...custMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([label, value]) => ({ label, value, formattedValue: `$${value.toFixed(0)}` }));

    const prodMap = new Map<string, number>();
    myOrders.forEach(o => o.items.forEach(i => prodMap.set(i.name, (prodMap.get(i.name) || 0) + i.quantity)));
    const topP = [...prodMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([label, value]) => ({ label, value, formattedValue: `${value} units` }));

    return { topCustomers: topC, topProducts: topP };
  }, [myOrders]);

  const greetingTime = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening';

  const handleCheckIn = (hoReCaId: number) => {
    setVisitHoReCaId(hoReCaId);
    setShowVisitModal(true);
  };

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      {/* A. Morning Header + Quick Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">
            Good {greetingTime}, {currentUser.name.split(' ')[0]}
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {todayRoute && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-nexgen-blue/10 text-nexgen-blue text-xs font-semibold">
              <MapPin className="w-3.5 h-3.5" />
              {totalStops} visits today
            </span>
          )}
          {targetGap && targetGap.remaining > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
              <Target className="w-3.5 h-3.5" />
              ${targetGap.remaining.toLocaleString(undefined, { maximumFractionDigits: 0 })} to go
            </span>
          )}
        </div>
      </div>

      {/* B. Today's ScheduledVisit Card (HERO) */}
      {todayRoute ? (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-stone-200/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-nexgen-blue" />
                <h2 className="text-sm font-semibold text-stone-900">{todayRoute.name}</h2>
              </div>
              <span className="text-xs text-stone-500">{completedStops}/{totalStops} completed</span>
            </div>
            <div className="w-full bg-stone-200 rounded-full h-2">
              <div className="h-2 rounded-full bg-nexgen-blue transition-all" style={{ width: `${totalStops > 0 ? (completedStops / totalStops) * 100 : 0}%` }} />
            </div>
            {todayRoute.status === 'planned' && onStartRoute && (
              <button
                onClick={() => onStartRoute(todayRoute)}
                className="w-full flex items-center justify-center gap-2 mt-3 px-4 py-3 rounded-lg bg-nexgen-blue text-white text-sm font-semibold hover:bg-nexgen-blue-dark btn-press cursor-pointer min-h-[44px]"
              >
                <Play className="w-4 h-4" /> Start ScheduledVisit
              </button>
            )}
            {todayRoute.status === 'in_progress' && onViewRoute && (
              <button
                onClick={() => onViewRoute(todayRoute.id)}
                className="w-full flex items-center justify-center gap-2 mt-3 px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 btn-press cursor-pointer min-h-[44px]"
              >
                <ArrowRight className="w-4 h-4" /> Continue ScheduledVisit
              </button>
            )}
          </div>

          <div className="flex overflow-x-auto gap-3 p-4 sm:p-5 snap-x snap-mandatory">
            {todayStopsWithContext.map((stop, idx) => (
              <div key={stop.hoReCaId}
                className={`flex-shrink-0 w-[280px] sm:w-[300px] rounded-lg border transition-all snap-start ${
                  stop.status === 'arrived' ? 'bg-emerald-50 border-emerald-200' :
                  stop.status === 'skipped' ? 'bg-stone-50 border-stone-200 opacity-50' :
                  'bg-stone-50 border-stone-200 hover:border-nexgen-blue/30 hover:shadow-sm'
                }`}
              >
                <div className="p-3.5">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-stone-900 truncate">{stop.hoReCa?.name ?? 'Unknown'}</p>
                      <p className="text-xs text-stone-500 truncate mt-0.5">{stop.hoReCa?.address ?? ''}</p>
                    </div>
                    <span className="text-xs font-mono text-stone-400 ml-2">#{idx + 1}</span>
                  </div>

                  {stop.insight && (
                    <div className="flex items-center gap-2 mb-2">
                      <SegmentBadge segment={stop.insight.segment} />
                      {stop.insight.daysSinceLastOrder !== null && (
                        <span className="text-xs text-stone-500">
                          {stop.insight.daysSinceLastOrder}d since last order
                        </span>
                      )}
                    </div>
                  )}

                  {stop.outstanding && stop.outstanding.totalOutstanding > 0 && (
                    <div className={`text-xs px-2 py-1 rounded mb-2 ${stop.outstanding.isBlocked ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                      ${stop.outstanding.totalOutstanding.toFixed(2)} outstanding
                      {stop.outstanding.isBlocked && ' (Blocked)'}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-3">
                    {stop.status !== 'arrived' && stop.status !== 'skipped' && (
                      <>
                        <button onClick={() => handleCheckIn(stop.hoReCaId)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-nexgen-blue/10 text-nexgen-blue text-xs font-semibold hover:bg-nexgen-blue/20 cursor-pointer min-h-[44px]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Check In
                        </button>
                        <button onClick={() => onStartOrder(stop.hoReCaId)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 cursor-pointer min-h-[44px]">
                          <ShoppingBag className="w-3.5 h-3.5" /> Order
                        </button>
                      </>
                    )}
                    {stop.status === 'arrived' && (
                      <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Visited
                      </span>
                    )}
                  </div>

                  {/* Expandable customer context */}
                  {expandedStop === stop.hoReCaId && stop.insight && (
                    <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
                      <div className="text-xs text-stone-600">
                        <span className="text-stone-400">Avg Order:</span> ${stop.insight.avgOrderValue.toFixed(2)}
                      </div>
                      <div className="text-xs text-stone-600">
                        <span className="text-stone-400">Total Spend:</span> ${stop.insight.totalSpend.toFixed(2)}
                      </div>
                      {stop.insight.predictedNextOrderDate && (
                        <div className="text-xs text-stone-600">
                          <span className="text-stone-400">Next Order:</span> {new Date(stop.insight.predictedNextOrderDate).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setExpandedStop(expandedStop === stop.hoReCaId ? null : stop.hoReCaId)}
                  className="w-full text-xs text-stone-400 hover:text-stone-600 py-2 border-t border-stone-200 cursor-pointer text-center"
                >
                  {expandedStop === stop.hoReCaId ? 'Less' : 'More details'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-xl p-5 text-center">
          <MapPin className="w-8 h-8 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-stone-600 mb-3">No scheduled visit planned for today</p>
          <p className="text-xs text-stone-400">Head to Scheduled Visits to plan your day</p>
        </div>
      )}

      {/* C. Target Progress (compact) */}
      {myTargets.length > 0 && (
        <div className="glass-card rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-stone-900 flex items-center gap-2">
              <Target className="w-4 h-4 text-nexgen-blue" /> Targets
            </h3>
            <button onClick={() => setShowTargetModal(true)}
              className="text-xs text-nexgen-blue hover:text-nexgen-blue-dark cursor-pointer">Edit</button>
          </div>
          <div className="space-y-3">
            {myTargets.map(target => {
              const startMs = new Date(target.startDate).getTime();
              const endMs = new Date(target.endDate + 'T23:59:59').getTime();
              const ordersInRange = myOrders.filter(o => {
                const d = new Date(o.orderDate).getTime();
                return d >= startMs && d <= endMs;
              });

              let achieved = 0;
              if (target.type === 'revenue') {
                achieved = ordersInRange.reduce((s, o) => s + o.total, 0);
              } else if (target.type === 'orders') {
                achieved = ordersInRange.length;
              } else {
                const firstByHoReCa: Record<number, number> = {};
                myOrders.forEach(o => {
                  const t = new Date(o.orderDate).getTime();
                  if (!firstByHoReCa[o.hoReCa.id] || t < firstByHoReCa[o.hoReCa.id]) firstByHoReCa[o.hoReCa.id] = t;
                });
                achieved = Object.values(firstByHoReCa).filter(t => t >= startMs && t <= endMs).length;
              }

              const pct = target.targetValue > 0 ? Math.min((achieved / target.targetValue) * 100, 100) : 0;
              const labels = { revenue: 'Revenue', orders: 'Orders', new_horecas: 'New HoReCa' } as const;
              const fmtA = target.type === 'revenue' ? `$${achieved.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : String(achieved);
              const fmtT = target.type === 'revenue' ? `$${target.targetValue.toLocaleString()}` : String(target.targetValue);
              const barColor = pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-500';

              const projection = computeTargetProjection(target, myOrders, currentUser.id);
              const daysLeft = projection?.daysRemaining ?? 0;
              const dailyNeeded = daysLeft > 0 && target.type === 'revenue'
                ? (target.targetValue - achieved) / daysLeft
                : 0;

              return (
                <div key={target.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-stone-700">{labels[target.type]}</span>
                    <span className="text-xs text-stone-500">{fmtA} / {fmtT}</span>
                  </div>
                  <div className="w-full bg-stone-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between mt-0.5">
                    {dailyNeeded > 0 && (
                      <span className="text-xs text-stone-400">
                        Need ${dailyNeeded.toFixed(0)}/day for {daysLeft}d
                      </span>
                    )}
                    <span className={`text-xs font-semibold ml-auto ${pct >= 60 ? 'text-emerald-600' : pct >= 30 ? 'text-amber-600' : 'text-red-600'}`}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* D. Action Items */}
      {(reorderPredictions.length > 0 || atRiskCustomers.length > 0 || lowStockProducts.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <AlertBanner icon={Clock} label="Reorder Due" count={reorderPredictions.length} severity="info">
            <div className="space-y-2">
              {reorderPredictions.slice(0, 5).map(p => (
                <div key={p.hoReCaId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-stone-700 truncate">{p.hoReCaName}</span>
                    <SegmentBadge segment={p.segment} />
                  </div>
                  <button onClick={() => onStartOrder(p.hoReCaId)}
                    className="text-xs text-nexgen-blue hover:text-nexgen-blue-dark font-semibold shrink-0 cursor-pointer ml-2">
                    Order <ArrowRight className="w-3 h-3 inline" />
                  </button>
                </div>
              ))}
            </div>
          </AlertBanner>

          <AlertBanner icon={AlertCircle} label="At-Risk" count={atRiskCustomers.length} severity="warning">
            <div className="space-y-2">
              {atRiskCustomers.slice(0, 5).map(c => (
                <div key={c.hoReCaId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-stone-700 truncate">{c.hoReCaName}</span>
                    <span className="text-xs text-stone-500">{c.daysSinceLastOrder}d ago</span>
                  </div>
                  <button onClick={() => handleCheckIn(c.hoReCaId)}
                    className="text-xs text-amber-600 hover:text-amber-700 font-semibold shrink-0 cursor-pointer ml-2">
                    Visit <ArrowRight className="w-3 h-3 inline" />
                  </button>
                </div>
              ))}
            </div>
          </AlertBanner>

          <AlertBanner icon={Package} label="Low Stock" count={lowStockProducts.length} severity="warning">
            <div className="space-y-2">
              {lowStockProducts.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-stone-700 truncate">{p.name}</span>
                  <span className={`font-semibold ${p.inventory <= 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {p.inventory <= 0 ? 'Out' : `${p.inventory} left`}
                  </span>
                </div>
              ))}
            </div>
          </AlertBanner>
        </div>
      )}

      {/* E. Performance Snapshot (KPI Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard icon={DollarSign} label="Revenue" value={`$${metrics.totalSales.toFixed(2)}`} delta={metrics.revenueDelta} />
        <KPICard icon={ShoppingBag} label="Orders" value={String(metrics.totalOrders)} delta={metrics.ordersDelta} />
        <KPICard icon={BarChart3} label="Avg Order Value" value={`$${metrics.avgOrderValue.toFixed(2)}`} delta={metrics.aovDelta} />
        <KPICard icon={UserCheck} label="Visit Completion" value={`${visitCompletion.rate}%`}
          subtitle={`${visitCompletion.completed}/${visitCompletion.planned} visits`} />
      </div>

      {/* F. Detailed Analytics (collapsible) */}
      <ExpandableSection title="Revenue Trend (30 days)">
        <SalesLineChart data={salesChartData} />
      </ExpandableSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExpandableSection title="Top Customers">
          <HorizontalBarChart title="" data={topCustomers} />
        </ExpandableSection>
        <ExpandableSection title="Top Products">
          <HorizontalBarChart title="" data={topProducts} />
        </ExpandableSection>
      </div>

      {/* Modals */}
      {showTargetModal && onUpdateSalesTargets && (
        <SalesTargetModal
          isOpen={showTargetModal}
          onClose={() => setShowTargetModal(false)}
          existingTargets={salesTargets}
          userId={currentUser.id}
          onSave={onUpdateSalesTargets}
        />
      )}

      {showVisitModal && visitHoReCaId !== null && setVisits && (
        <VisitModal
          hoReCaId={visitHoReCaId}
          hoReCaName={hoReCas.find(c => c.id === visitHoReCaId)?.name ?? ''}
          currentUser={currentUser}
          onSave={(visit) => {
            setVisits([...visits, visit]);
            setShowVisitModal(false);
            setVisitHoReCaId(null);
          }}
          onClose={() => { setShowVisitModal(false); setVisitHoReCaId(null); }}
        />
      )}
    </div>
  );
};

export default RepDashboardV2;
