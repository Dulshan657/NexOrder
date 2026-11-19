import React, { Suspense, useCallback, useMemo, useState } from 'react';
import type { User, HoReCa, Product, Order, Invoice, SalesTarget, Visit, ScheduledVisit, DashboardTimePeriod } from '../types';
import { UserRole } from '../types';
import { MapPin, Target, ShoppingBag, CheckCircle2, AlertCircle, Clock, ArrowRight, Package, Play } from 'lucide-react';
import { PageFrame } from './ui/PageFrame';
import { PageHeader } from './ui/PageHeader';
import KPICard from './dashboard/KPICard';
import ActionItemsBoard from './ActionItemsBoard';
import type { ActionItemColumn, ActionItem } from './ActionItemsBoard';
import DashCard from './dashboard/DashCard';
import Band from './dashboard/Band';
import RankedList, { type RankedItem } from './dashboard/RankedList';
import TargetBar from './dashboard/TargetBar';
import EmptyState from './dashboard/EmptyState';
import TimePeriodToggle from './dashboard/TimePeriodToggle';
import SalesLineChart from './charts/SalesLineChart';
import SalesTargetModal from './SalesTargetModal';
import SegmentBadge from './SegmentBadge';
import VisitModal from './visits/VisitModal';
import { getReorderPredictions, getAtRiskCustomersForRep, computeAllHoReCaInsights } from '../services/buyingPatternsService';
import { getTodaysScheduledVisits } from '../services/scheduledVisitService';
import { getHoReCaOutstanding } from '../services/accountingService';
import { getVisitCompletionRate } from '../services/repProductivityService';
import { computeTargetProjection } from '../services/targetProjectionService';
import { classifyStock, lowStockThresholdFor } from '../lib/stockStatus';
import { computeTargetAchieved, computeTargetProgress } from '../lib/semantic';
import { useMetric, useMetricContext } from '../hooks/useMetrics';
import { useDashboardRange } from '../hooks/useDashboardRange';
import type { CustomerRevenue, DateRevenue, ProductUnits } from '../lib/semantic';
import { useSettings } from '../hooks/queries/useSettings';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { MODULE_SHOP } from '../lib/modules';
import { appDateKey } from '../lib/period';
import { dailySeries } from '../lib/dashboardSeries';
import { formatCount, formatMoney, pctDelta } from '../lib/dashboardFormat';
import { repCanStartOrder, repNavFor, type RepDashView } from '../lib/repDashNav';

// Kitchen QR orders held for approval. Gated at the declaration, so a tenant
// without the shop module ships no chunk for it.
const PendingQrRequests = MODULE_SHOP ? lazyWithRetry(() => import('./qr/PendingQrRequests')) : null;

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
  /** NX-0043: where the page's links lead. Gated by lib/repDashNav, the sidebar's own rules. */
  onNavigate?: (view: RepDashView) => void;
}

const TOP_N = 5;
const TARGET_LABELS = { revenue: 'Revenue', orders: 'Orders', new_horecas: 'New HoReCa' } as const;

const RepDashboardV2: React.FC<RepDashboardV2Props> = ({
  currentUser, hoReCas, products, orders, onStartOrder,
  invoices = [], salesTargets = [], onUpdateSalesTargets,
  visits = [], setVisits, routes = [],
  onStartRoute, onViewRoute, onNavigate,
}) => {
  const [period, setPeriod] = useState<DashboardTimePeriod>('this_month');
  const [customStart, setCustomStart] = useState(() => appDateKey(new Date(Date.now() - 30 * 86400000)));
  const [customEnd, setCustomEnd] = useState(() => appDateKey(new Date()));
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [visitHoReCaId, setVisitHoReCaId] = useState<number | null>(null);

  const isFieldRep = currentUser.role === UserRole.FIELD_REP;
  // Reps are not HoReCa users, so AppShell's showStockTab is always true for
  // them, and they are never QR staff.
  const nav = useMemo(
    () => repNavFor({ isFieldRep, canSeeStock: true, isQrStaff: false }, onNavigate),
    [isFieldRep, onNavigate],
  );

  // Starting an order needs the Shop; without the module, nothing offers it.
  const startOrder = repCanStartOrder() ? onStartOrder : undefined;

  // Data source stays global (products.available) — this is a rep-facing
  // surface, not warehouse-scoped. Only the threshold is configurable.
  const { data: settings } = useSettings();
  const globalThreshold = settings?.low_stock_threshold ?? 10;

  const myOrders = useMemo(() => orders.filter(o => o.submittedBy.id === currentUser.id), [orders, currentUser.id]);

  // ── The period: same picker and Sydney calendar as the Admin dashboard ───
  const dateRange = useDashboardRange(period, customStart, customEnd);
  const periodFilter = useMemo(
    () => ({ repId: currentUser.id, from: dateRange.from, to: dateRange.to }),
    [currentUser.id, dateRange],
  );
  const previousFilter = useMemo(
    () => ({ repId: currentUser.id, from: dateRange.previous.from, to: dateRange.previous.to }),
    [currentUser.id, dateRange],
  );
  const metricCtx = useMetricContext({ orders, products, lowStockThreshold: globalThreshold });

  const revenue = useMetric<number>('sales.revenue', metricCtx, periodFilter);
  const prevRevenue = useMetric<number>('sales.revenue', metricCtx, previousFilter);
  const orderCount = useMetric<number>('sales.orderCount', metricCtx, periodFilter);
  const prevOrderCount = useMetric<number>('sales.orderCount', metricCtx, previousFilter);
  const aov = useMetric<number>('sales.averageOrderValue', metricCtx, periodFilter);
  const prevAov = useMetric<number>('sales.averageOrderValue', metricCtx, previousFilter);

  const visitCompletion = useMemo(
    () => getVisitCompletionRate(visits, routes, currentUser.id, dateRange.from, dateRange.to),
    [visits, routes, currentUser.id, dateRange],
  );
  const prevVisitCompletion = useMemo(
    () => getVisitCompletionRate(visits, routes, currentUser.id, dateRange.previous.from, dateRange.previous.to),
    [visits, routes, currentUser.id, dateRange],
  );

  // ── Today's route (field reps) ───────────────────────────────────────────
  const todaysRoutes = useMemo(
    () => (isFieldRep ? getTodaysScheduledVisits(routes, currentUser.id) : []),
    [routes, currentUser.id, isFieldRep],
  );
  const todayRoute = todaysRoutes[0] ?? null;

  const todayStops = useMemo(() => {
    if (!todayRoute) return [];
    return todayRoute.stops.map(stop => {
      const hoReCa = hoReCas.find(c => c.id === stop.hoReCaId);
      const outstanding = hoReCa ? getHoReCaOutstanding(hoReCa.id, hoReCa.name, invoices) : null;
      const insight = hoReCa ? computeAllHoReCaInsights(orders, [hoReCa])[0] ?? null : null;
      return { ...stop, hoReCa, outstanding, insight };
    });
  }, [todayRoute, hoReCas, invoices, orders]);

  const completedStops = todayRoute ? todayRoute.stops.filter(s => s.status === 'arrived').length : 0;
  const totalStops = todayRoute ? todayRoute.stops.length : 0;

  // ── Targets ──────────────────────────────────────────────────────────────
  const myTargets = salesTargets.filter(t => t.userId === currentUser.id);
  const revenueGap = useMemo(() => {
    const revenueTarget = myTargets.find(t => t.type === 'revenue');
    if (!revenueTarget) return null;
    const achieved = computeTargetAchieved({ ...revenueTarget, userId: currentUser.id }, metricCtx);
    return Math.max(revenueTarget.targetValue - achieved, 0);
  }, [myTargets, currentUser.id, metricCtx]);

  // ── Needs attention ──────────────────────────────────────────────────────
  const handleCheckIn = useCallback((hoReCaId: number) => setVisitHoReCaId(hoReCaId), []);
  const canCheckIn = Boolean(setVisits);

  const actionColumns = useMemo((): ActionItemColumn[] => {
    const reorderItems: ActionItem[] = getReorderPredictions(orders, hoReCas)
      .filter(p => p.daysUntil <= 7 && p.daysUntil >= -3)
      .map(p => ({
        id: `reorder-${p.hoReCaId}`,
        title: p.hoReCaName,
        subtitle: p.daysUntil < 0 ? `Reorder ${-p.daysUntil}d overdue` : p.daysUntil === 0 ? 'Reorder due today' : `Reorder due in ${p.daysUntil}d`,
        onClick: startOrder ? () => startOrder(p.hoReCaId) : undefined,
        actions: startOrder ? [{ label: 'Order', icon: ArrowRight, onClick: () => startOrder(p.hoReCaId) }] : undefined,
      }));

    const riskItems: ActionItem[] = getAtRiskCustomersForRep(orders, hoReCas, currentUser.id).map(c => ({
      id: `risk-${c.hoReCaId}`,
      title: c.hoReCaName,
      subtitle: `Last order ${c.daysSinceLastOrder}d ago`,
      onClick: canCheckIn ? () => handleCheckIn(c.hoReCaId) : undefined,
      actions: canCheckIn ? [{ label: 'Visit', icon: ArrowRight, onClick: () => handleCheckIn(c.hoReCaId) }] : undefined,
    }));

    // Products this rep sells that are low or out — global stock, not a site.
    const soldIds = new Set<number>();
    myOrders.forEach(o => o.items.forEach(item => soldIds.add(item.id)));
    const toStock = nav('stock');
    const stockItems: ActionItem[] = products
      .filter(p => soldIds.has(p.id) && classifyStock(p.available, lowStockThresholdFor(p, globalThreshold)) !== 'in_stock')
      .map(p => ({
        id: `stock-${p.id}`,
        title: p.name,
        subtitle: p.available <= 0 ? 'Out of stock' : `${formatCount(p.available)} left`,
        badge: p.available <= 0 ? { label: 'Out', color: 'bg-red-50 text-red-700 border-red-200' } : undefined,
        onClick: toStock,
      }));

    return [
      { id: 'reorder', label: 'Reorder due', icon: Clock, severity: 'info' as const, items: reorderItems },
      { id: 'at-risk', label: 'At-risk customers', icon: AlertCircle, severity: 'warning' as const, items: riskItems },
      { id: 'low-stock', label: 'Low stock', icon: Package, severity: 'warning' as const, items: stockItems, onViewAll: toStock },
    ];
  }, [orders, hoReCas, currentUser.id, myOrders, products, globalThreshold, nav, startOrder, canCheckIn, handleCheckIn]);

  // ── Trend and rankings, all for the chosen period ────────────────────────
  const revenueByDate = useMetric<readonly DateRevenue[]>('sales.revenueByDate', metricCtx, periodFilter);
  const prevRevenueByDate = useMetric<readonly DateRevenue[]>('sales.revenueByDate', metricCtx, previousFilter);
  const trend = useMemo(() => dailySeries(revenueByDate, dateRange.from, dateRange.to), [revenueByDate, dateRange]);
  const prevTrend = useMemo(
    () => dailySeries(prevRevenueByDate, dateRange.previous.from, dateRange.previous.to),
    [prevRevenueByDate, dateRange],
  );

  const revenueByCustomer = useMetric<readonly CustomerRevenue[]>('sales.revenueByCustomer', metricCtx, periodFilter);
  const unitsByProduct = useMetric<readonly ProductUnits[]>('sales.unitsByProduct', metricCtx, periodFilter);

  const topCustomers = useMemo((): RankedItem[] => {
    const rows = revenueByCustomer.slice(0, TOP_N);
    const max = rows[0]?.revenue ?? 0;
    return rows.map(row => ({
      id: row.horecaId,
      label: row.name,
      value: formatMoney(row.revenue, { cents: false }),
      share: max > 0 ? row.revenue / max : 0,
      onClick: startOrder ? () => startOrder(row.horecaId) : undefined,
    }));
  }, [revenueByCustomer, startOrder]);

  const toStockTab = nav('stock');
  const topProducts = useMemo((): RankedItem[] => {
    const rows = unitsByProduct.slice(0, TOP_N);
    const max = rows[0]?.units ?? 0;
    return rows.map(row => ({
      id: row.name,
      label: row.name,
      value: `${formatCount(row.units)} units`,
      share: max > 0 ? row.units / max : 0,
      onClick: toStockTab,
    }));
  }, [unitsByProduct, toStockTab]);

  const hour = new Date().getHours();
  const greetingTime = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const toOrders = nav('orders');
  const toVisits = nav('scheduled_visits');
  const toAccounts = nav('accounts');

  return (
    <PageFrame>
      <PageHeader
        visibleOnMobile
        title={`Good ${greetingTime}, ${currentUser.name.split(' ')[0]}`}
        description={new Date().toLocaleDateString('en-AU', { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={todayRoute || (revenueGap !== null && revenueGap > 0) ? <>
          {todayRoute && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700">
              <MapPin className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" />
              {totalStops} {totalStops === 1 ? 'visit' : 'visits'} today
            </span>
          )}
          {revenueGap !== null && revenueGap > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
              <Target className="w-3.5 h-3.5" aria-hidden="true" />
              {formatMoney(revenueGap, { cents: false })} to go
            </span>
          )}
        </> : undefined}
      />

      {/* Kitchen QR orders waiting on this rep (RLS limits the list to assigned venues). Renders nothing when there are none. */}
      {PendingQrRequests && (
        <ErrorBoundary label="Orders awaiting approval">
          <Suspense fallback={null}>
            <PendingQrRequests mode="approver" compact />
          </Suspense>
        </ErrorBoundary>
      )}

      {isFieldRep && (
        todayRoute ? (
          <DashCard
            title={todayRoute.name}
            caption={`${completedStops} of ${totalStops} visited`}
            flush
            footer={
              todayRoute.status === 'planned' && onStartRoute ? (
                <button type="button" onClick={() => onStartRoute(todayRoute)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-nexgen-blue-dark px-4 py-2.5 text-sm font-semibold text-white hover:bg-nexgen-blue-dark/90 cursor-pointer touch-target">
                  <Play className="w-4 h-4" aria-hidden="true" /> Start today's visits
                </button>
              ) : todayRoute.status === 'in_progress' && onViewRoute ? (
                <button type="button" onClick={() => onViewRoute(todayRoute.id)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-nexgen-blue-dark px-4 py-2.5 text-sm font-semibold text-white hover:bg-nexgen-blue-dark/90 cursor-pointer touch-target">
                  <ArrowRight className="w-4 h-4" aria-hidden="true" /> Continue today's visits
                </button>
              ) : undefined
            }
          >
            <div className="px-4 sm:px-5">
              <div role="progressbar" aria-label="Visits completed" aria-valuemin={0} aria-valuemax={totalStops} aria-valuenow={completedStops}
                className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                <div className="h-full rounded-full bg-nexgen-blue transition-[width] duration-500" style={{ width: `${totalStops > 0 ? (completedStops / totalStops) * 100 : 0}%` }} />
              </div>
            </div>
            <ol className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 sm:px-5 py-4">
              {todayStops.map((stop, idx) => {
                const done = stop.status === 'arrived';
                const skipped = stop.status === 'skipped';
                return (
                  <li key={stop.hoReCaId}
                    className={`snap-start shrink-0 w-[272px] rounded-lg border p-3.5 ${done ? 'border-emerald-200 bg-emerald-50/60' : skipped ? 'border-stone-200 bg-stone-50 opacity-60' : 'border-stone-200 bg-white'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-stone-900">{stop.hoReCa?.name ?? 'Unknown customer'}</p>
                        <p className="truncate text-xs text-stone-500">{stop.hoReCa?.address ?? ''}</p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-stone-500">#{idx + 1}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600">
                      {stop.insight && <SegmentBadge segment={stop.insight.segment} />}
                      {stop.insight?.daysSinceLastOrder != null && <span>Last order {stop.insight.daysSinceLastOrder}d ago</span>}
                      {stop.insight && <span>· Avg {formatMoney(stop.insight.avgOrderValue, { cents: false })}</span>}
                    </div>
                    {stop.outstanding && stop.outstanding.totalOutstanding > 0 && (
                      toAccounts ? (
                        <button type="button" onClick={toAccounts}
                          className={`mt-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold cursor-pointer ${stop.outstanding.isBlocked ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                          {formatMoney(stop.outstanding.totalOutstanding)} owed{stop.outstanding.isBlocked ? ' · Blocked' : ''}
                          <ArrowRight className="w-3 h-3" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className={`mt-2 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${stop.outstanding.isBlocked ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                          {formatMoney(stop.outstanding.totalOutstanding)} owed{stop.outstanding.isBlocked ? ' · Blocked' : ''}
                        </span>
                      )
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      {done ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Visited
                        </span>
                      ) : !skipped && (
                        <>
                          {canCheckIn && (
                            <button type="button" onClick={() => handleCheckIn(stop.hoReCaId)}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer touch-target">
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Check in
                            </button>
                          )}
                          {startOrder && (
                          <button type="button" onClick={() => startOrder(stop.hoReCaId)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-nexgen-blue-light px-3 py-2 text-xs font-semibold text-nexgen-blue-dark hover:bg-nexgen-blue/15 cursor-pointer touch-target">
                            <ShoppingBag className="w-3.5 h-3.5" aria-hidden="true" /> Order
                          </button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </DashCard>
        ) : (
          <DashCard title="Today's visits">
            <EmptyState
              icon={MapPin}
              message="No visits planned for today"
              action={toVisits ? { label: 'Plan visits', onClick: toVisits } : undefined}
            />
          </DashCard>
        )
      )}

      <ActionItemsBoard
        title="Needs attention"
        columns={actionColumns}
        storageKey="rep_action_items"
        showAssign={false}
      />

      {myTargets.length > 0 && (
        <DashCard
          title="Targets"
          action={onUpdateSalesTargets ? { label: 'Edit', onClick: () => setShowTargetModal(true) } : undefined}
        >
          <div className="space-y-4">
            {myTargets.map(target => {
              const { achieved, percent } = computeTargetProgress({ ...target, userId: currentUser.id }, metricCtx);
              const isMoney = target.type === 'revenue';
              const fmt = (n: number) => (isMoney ? formatMoney(n, { cents: false }) : formatCount(n));
              const projection = computeTargetProjection(target, myOrders, currentUser.id);
              const daysLeft = projection?.daysRemaining ?? 0;
              const dailyNeeded = daysLeft > 0 && isMoney ? Math.max(target.targetValue - achieved, 0) / daysLeft : 0;
              return (
                <React.Fragment key={target.id}>
                  <TargetBar
                    label={TARGET_LABELS[target.type]}
                    achieved={fmt(achieved)}
                    target={fmt(target.targetValue)}
                    percent={percent}
                    startDate={target.startDate}
                    endDate={target.endDate}
                    hint={dailyNeeded > 0 ? `Need ${formatMoney(dailyNeeded, { cents: false })}/day for ${daysLeft}d` : undefined}
                  />
                </React.Fragment>
              );
            })}
          </div>
        </DashCard>
      )}

      <Band
        label="Key numbers"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TimePeriodToggle value={period} onChange={setPeriod} />
            {period === 'custom' && (
              <div className="flex items-center gap-2">
                <input type="date" aria-label="From" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  className="bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-900" />
                <span className="text-stone-500 text-xs">to</span>
                <input type="date" aria-label="To" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  className="bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-900" />
              </div>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KPICard label="Revenue" value={formatMoney(revenue)} delta={pctDelta(revenue, prevRevenue)} onClick={toOrders} />
          <KPICard label="Orders" value={formatCount(orderCount)} delta={pctDelta(orderCount, prevOrderCount)} onClick={toOrders} />
          <KPICard label="Avg order value" value={formatMoney(aov)} delta={pctDelta(aov, prevAov)} onClick={toOrders} />
          <KPICard
            label="Visit completion"
            value={`${visitCompletion.rate}%`}
            delta={visitCompletion.planned > 0 || prevVisitCompletion.planned > 0 ? visitCompletion.rate - prevVisitCompletion.rate : undefined}
            deltaSuffix=" pts"
            subtitle={`${visitCompletion.completed} of ${visitCompletion.planned} visits`}
            onClick={toVisits}
          />
        </div>

        <DashCard title="Sales trend" caption="Your revenue by day · dashed line is the previous period">
          <SalesLineChart data={trend} previous={prevTrend} />
        </DashCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DashCard title="Top customers" caption={startOrder ? 'Your revenue this period · tap to start an order' : 'Your revenue this period'}>
            <RankedList label="Top customers" items={topCustomers} emptyMessage="No orders in this period" />
          </DashCard>
          <DashCard title="Top products" caption="Units this period" action={toStockTab ? { label: 'Stock', onClick: toStockTab } : undefined}>
            <RankedList label="Top products" items={topProducts} emptyMessage="No sales in this period" />
          </DashCard>
        </div>
      </Band>

      {showTargetModal && onUpdateSalesTargets && (
        <SalesTargetModal
          isOpen={showTargetModal}
          onClose={() => setShowTargetModal(false)}
          existingTargets={salesTargets}
          userId={currentUser.id}
          onSave={onUpdateSalesTargets}
        />
      )}

      {visitHoReCaId !== null && setVisits && (
        <VisitModal
          hoReCaId={visitHoReCaId}
          userId={currentUser.id}
          hoReCas={hoReCas}
          onSave={(visit) => {
            setVisits([...visits, visit]);
            setVisitHoReCaId(null);
          }}
          onClose={() => setVisitHoReCaId(null)}
        />
      )}
    </PageFrame>
  );
};

export default RepDashboardV2;
