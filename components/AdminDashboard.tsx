import React, { Suspense, useMemo, useState } from 'react';
import type { Order, Product, HoReCa, User, Invoice, SalesTarget, Promotion, Visit, ScheduledVisit, DashboardTimePeriod } from '../types';
import { UserRole } from '../types';
import { AlertTriangle, CreditCard, Package, Download, Target } from 'lucide-react';
import KPICard from './dashboard/KPICard';
import ActionItemsBoard from './ActionItemsBoard';
import type { ActionItemColumn, ActionItem } from './ActionItemsBoard';
import TimePeriodToggle from './dashboard/TimePeriodToggle';
import SalesLineChart from './charts/SalesLineChart';
import InventoryDispatchSection from './admin/InventoryDispatchSection';
import DashCard from './dashboard/DashCard';
import RankedList, { type RankedItem } from './dashboard/RankedList';
import TargetBar from './dashboard/TargetBar';
import EmptyState from './dashboard/EmptyState';
import SegmentBadge from './SegmentBadge';
import { MODULE_FIELD_OPS, MODULE_INVOICING, MODULE_PO_INBOX, MODULE_PROMOTIONS } from '../lib/modules';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { ADMIN_TAB_LABELS, type AdminTab } from '../lib/adminTabUrl';
import { PageFrame } from './ui/PageFrame';
import { PageHeader } from './ui/PageHeader';
import { useDashNav } from '../hooks/useDashNav';
import { requestOrderImportTab, type OrderImportTab } from '../lib/orderImportHandoff';

// The Dashboard is CORE — every tenant lands on it — but four of its panels
// report on modules a tenant may not have. Gated on the DECLARATION as well as
// the render, or the chunk ships to someone who can never see the panel.
//
// What is deliberately NOT gated: Revenue, Orders, Average Order Value, the
// sales trend, top products and top customers. Those are order analytics, and
// a tenant who takes orders has orders — including one on a single flat price
// list, where the figures are exactly right. Only the panels that report on a
// surface the tenant does not own come out.
const POInboxStatsTile = MODULE_PO_INBOX ? lazyWithRetry(() => import('./admin/POInboxStatsTile')) : null;
const SalesTargetModal = MODULE_FIELD_OPS ? lazyWithRetry(() => import('./SalesTargetModal')) : null;
import { getAllOutstanding } from '../services/accountingService';
import { getDaysToStockout } from '../services/productMovementService';
import { computeAllHoReCaInsights } from '../services/buyingPatternsService';
import { getPromotionROI } from '../services/promotionROIService';
import { computeRepProductivity } from '../services/repProductivityService';
import { computeTargetProgress, filterOrders } from '../lib/semantic';
import { formatCount, formatMoney, pctDelta } from '../lib/dashboardFormat';
import { appDateKey } from '../lib/period';
import { dailySeries } from '../lib/dashboardSeries';
import Band from './dashboard/Band';
import { useDashboardRange } from '../hooks/useDashboardRange';
import { useMetric, useMetricContext } from '../hooks/useMetrics';
import type { CustomerRevenue, DateRevenue, ProductUnits, RepRevenue } from '../lib/semantic';

interface AdminDashboardProps {
  allOrders: Order[];
  products: Product[];
  hoReCas: HoReCa[];
  users: User[];
  invoices: Invoice[];
  salesTargets?: SalesTarget[];
  onUpdateSalesTargets?: (targets: SalesTarget[]) => void;
  currentUser: User;
  lowStockThreshold?: number;
  promotions?: Promotion[];
  visits?: Visit[];
  routes?: ScheduledVisit[];
  onNavigateTab?: (tab: string) => void;
}

const TOP_N = 5;
const SEGMENT_ORDER = ['high_value', 'growing', 'new', 'declining', 'at_risk'] as const;

const AdminDashboard: React.FC<AdminDashboardProps> = ({
  allOrders, products, hoReCas, users, invoices, salesTargets = [], onUpdateSalesTargets,
  currentUser, lowStockThreshold = 10, promotions = [], visits = [], routes = [], onNavigateTab,
}) => {
  const [period, setPeriod] = useState<DashboardTimePeriod>('this_month');
  const [customStart, setCustomStart] = useState(() => appDateKey(new Date(Date.now() - 30 * 86400000)));
  const [customEnd, setCustomEnd] = useState(() => appDateKey(new Date()));
  const [showTargetModal, setShowTargetModal] = useState(false);

  // Every link on the page goes through here: a tab this role cannot open, or
  // whose module is off in this build, gets no handler and renders as text.
  const go = useDashNav(currentUser.role, onNavigateTab as ((tab: AdminTab) => void) | undefined);

  // This window and the one before it, for the deltas. Both come from
  // dashboardRange, the same Sydney calendar Nex resolves "this week" and "this
  // month" in (lib/period), so the KPIs and Nex count the same orders.
  // Re-resolved every minute while the page is open: the comparison stops at
  // the same time of day (NX-0010), so a range fixed at opening would drift.
  const dateRange = useDashboardRange(period, customStart, customEnd);
  const periodFilter = useMemo(() => ({ from: dateRange.from, to: dateRange.to }), [dateRange]);
  const previousFilter = useMemo(
    () => ({ from: dateRange.previous.from, to: dateRange.previous.to }),
    [dateRange],
  );

  const metricCtx = useMetricContext({ orders: allOrders, products, lowStockThreshold });

  const filteredOrders = useMemo(() => filterOrders(allOrders, periodFilter), [allOrders, periodFilter]);

  const revenue = useMetric<number>('sales.revenue', metricCtx, periodFilter);
  const prevRevenue = useMetric<number>('sales.revenue', metricCtx, previousFilter);
  const orderCount = useMetric<number>('sales.orderCount', metricCtx, periodFilter);
  const prevOrderCount = useMetric<number>('sales.orderCount', metricCtx, previousFilter);
  const aov = useMetric<number>('sales.averageOrderValue', metricCtx, periodFilter);
  const prevAov = useMetric<number>('sales.averageOrderValue', metricCtx, previousFilter);

  // Receivables math stays inline: the AR domain is deliberately outside the
  // semantic layer's first cut.
  const receivables = useMemo(() => {
    const totalInvoiced = invoices.reduce((s, i) => s + i.amount, 0);
    const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
    return { collectionRate: totalInvoiced > 0 ? (totalPaid / totalInvoiced) * 100 : 0, totalOverdue };
  }, [invoices]);

  const lowStockProducts = useMetric<readonly Product[]>('inventory.lowStockProducts', metricCtx);
  const outOfStockProducts = useMetric<readonly Product[]>('inventory.outOfStockProducts', metricCtx);

  const insights = useMemo(() => computeAllHoReCaInsights(allOrders, hoReCas), [allOrders, hoReCas]);

  // ── Needs attention ──────────────────────────────────────────────────────
  const actionColumns = useMemo((): ActionItemColumn[] => {
    const toAccounts = go('Accounts');
    const toProducts = go('Products');
    const toInsights = go('HoReCa Insights');

    const overdueItems: ActionItem[] = getAllOutstanding(invoices, hoReCas).map(o => ({
      id: `overdue-${o.hoReCaId}`,
      title: o.hoReCaName,
      subtitle: `${formatMoney(o.totalOutstanding)}${o.isBlocked ? ' · Blocked' : ''}`,
      onClick: toAccounts,
    }));

    // Stock counts (products.inventory) and days-to-stockout are company-wide:
    // sales velocity has no warehouse dimension. Labelled plainly rather than
    // scoping only the numerator into a plausible-looking but wrong figure.
    const stockoutData = getDaysToStockout(allOrders, products).filter(d => (d.daysRemaining ?? Infinity) <= 30);
    const stockItems: ActionItem[] = [
      ...outOfStockProducts.map(p => ({
        id: `stock-out-${p.id}`,
        title: p.name,
        subtitle: 'Out of stock — all sites',
        badge: { label: 'Out', color: 'bg-red-50 text-red-700 border-red-200' },
        onClick: toProducts,
      })),
      ...stockoutData.map(s => ({
        id: `stock-risk-${s.productId}`,
        title: s.productName,
        subtitle: `${s.currentStock} left (all sites) · ${s.daysRemaining ?? '?'}d`,
        onClick: toProducts,
      })),
      ...lowStockProducts.map(p => ({
        id: `stock-low-${p.id}`,
        title: p.name,
        subtitle: `${p.inventory} left (all sites)`,
        onClick: toProducts,
      })),
    ];

    const riskItems: ActionItem[] = insights
      .filter(i => i.segment === 'at_risk' || i.segment === 'declining')
      .map(c => ({
        id: `risk-${c.hoReCaId}`,
        title: c.hoReCaName,
        subtitle: c.daysSinceLastOrder != null ? `Last order ${c.daysSinceLastOrder}d ago` : undefined,
        badge: {
          label: c.segment === 'at_risk' ? 'At risk' : 'Declining',
          color: c.segment === 'at_risk' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-orange-50 text-orange-800 border-orange-200',
        },
        onClick: toInsights,
      }));

    return [
      { id: 'overdue', label: 'Overdue payments', icon: CreditCard, severity: 'critical' as const, items: overdueItems, onViewAll: toAccounts },
      { id: 'stock', label: 'Low / out of stock', icon: Package, severity: 'warning' as const, items: stockItems, onViewAll: toProducts },
      { id: 'at-risk', label: 'At-risk customers', icon: AlertTriangle, severity: 'warning' as const, items: riskItems, onViewAll: toInsights },
    ];
  }, [go, invoices, hoReCas, allOrders, products, outOfStockProducts, lowStockProducts, insights]);

  // ── Trend: this period and the one before, day for day ──────────────────
  const revenueByDate = useMetric<readonly DateRevenue[]>('sales.revenueByDate', metricCtx, periodFilter);
  const prevRevenueByDate = useMetric<readonly DateRevenue[]>('sales.revenueByDate', metricCtx, previousFilter);
  const trend = useMemo(() => dailySeries(revenueByDate, dateRange.from, dateRange.to), [revenueByDate, dateRange]);
  const prevTrend = useMemo(
    () => dailySeries(prevRevenueByDate, dateRange.previous.from, dateRange.previous.to),
    [prevRevenueByDate, dateRange],
  );

  // ── Rankings ─────────────────────────────────────────────────────────────
  const unitsByProduct = useMetric<readonly ProductUnits[]>('sales.unitsByProduct', metricCtx, periodFilter);
  const revenueByCustomer = useMetric<readonly CustomerRevenue[]>('sales.revenueByCustomer', metricCtx, periodFilter);
  const revenueByRep = useMetric<readonly RepRevenue[]>('sales.revenueByRep', metricCtx, periodFilter);

  // Rep productivity: the last 30 days, whatever the page period — labelled so.
  const productivityByRep = useMemo(() => {
    const from = new Date(Date.now() - 30 * 86400000);
    const to = new Date();
    const reps = users.filter(u => u.role === UserRole.FIELD_REP || u.role === UserRole.OFFICE_REP);
    return new Map(reps.map(rep => [rep.id, computeRepProductivity(visits, routes, allOrders, rep.id, from, to)]));
  }, [users, visits, routes, allOrders]);

  const toProductsTab = go('Products');
  const toHoReCaTab = go('HoReCa');

  const topProducts = useMemo((): RankedItem[] => {
    const rows = unitsByProduct.slice(0, TOP_N);
    const max = rows[0]?.units ?? 0;
    return rows.map(row => ({
      id: row.name,
      label: row.name,
      value: `${formatCount(row.units)} units`,
      share: max > 0 ? row.units / max : 0,
      onClick: toProductsTab,
    }));
  }, [unitsByProduct, toProductsTab]);

  const topCustomers = useMemo((): RankedItem[] => {
    const rows = revenueByCustomer.slice(0, TOP_N);
    const max = rows[0]?.revenue ?? 0;
    return rows.map(row => ({
      id: row.horecaId,
      label: row.name,
      value: formatMoney(row.revenue, { cents: false }),
      share: max > 0 ? row.revenue / max : 0,
      onClick: toHoReCaTab,
    }));
  }, [revenueByCustomer, toHoReCaTab]);

  const topReps = useMemo((): RankedItem[] => {
    const rows = revenueByRep.slice(0, TOP_N);
    const max = rows[0]?.revenue ?? 0;
    return rows.map(row => {
      const p = productivityByRep.get(row.repId);
      return {
        id: row.repId,
        label: row.name,
        avatarUrl: row.avatarUrl,
        value: formatMoney(row.revenue, { cents: false }),
        sub: p ? `${p.visitCompletionRate}% visits done · ${p.visitConversionRate}% converted` : undefined,
        share: max > 0 ? row.revenue / max : 0,
      };
    });
  }, [revenueByRep, productivityByRep]);

  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = { high_value: 0, growing: 0, new: 0, declining: 0, at_risk: 0 };
    insights.forEach(i => { counts[i.segment] = (counts[i.segment] || 0) + 1; });
    return counts;
  }, [insights]);

  const promoROI = useMemo(
    () => (MODULE_PROMOTIONS ? getPromotionROI(promotions, allOrders, products) : []),
    [promotions, allOrders, products],
  );
  const topPromos = useMemo(
    () => [...promoROI].sort((a, b) => b.revenueFromPromoOrders - a.revenueFromPromoOrders).slice(0, 3),
    [promoROI],
  );

  // ── Links ────────────────────────────────────────────────────────────────
  const toOrders = go('Order Import');
  const openOrders = toOrders
    ? (tab: OrderImportTab) => { requestOrderImportTab(tab); toOrders(); }
    : undefined;

  const handleExportCSV = () => {
    const headers = ['Order ID', 'Date', 'HoReCa', 'Rep', 'Status', 'Total'];
    const rows = filteredOrders.map(o => [
      o.id, new Date(o.orderDate).toLocaleString('en-AU'), o.hoReCa.name, o.submittedBy.name, o.status || 'N/A', o.total.toFixed(2),
    ].map(String));
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `sales_report_${appDateKey(new Date())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const myTargets = salesTargets.filter(t => t.userId === currentUser.id);
  const showSideColumn = MODULE_FIELD_OPS || Boolean(POInboxStatsTile);
  const showPrograms = (MODULE_PROMOTIONS && topPromos.length > 0) || (MODULE_FIELD_OPS && Boolean(onUpdateSalesTargets));

  return (
    <PageFrame>
      <PageHeader
        title={ADMIN_TAB_LABELS.Dashboard}
        description="How the business is doing, and what needs you"
        actions={
          <>
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
            <button onClick={handleExportCSV} disabled={filteredOrders.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-40 transition-colors duration-150 cursor-pointer touch-target-y">
              <Download className="w-3.5 h-3.5" aria-hidden="true" /> Export CSV
            </button>
          </>
        }
      />

      <ActionItemsBoard
        title="Needs attention"
        columns={actionColumns}
        storageKey="admin_action_items"
        users={users}
        showAssign={true}
      />

      <Band label="Key numbers">
        <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${MODULE_INVOICING ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          <KPICard label="Revenue" value={formatMoney(revenue)} delta={pctDelta(revenue, prevRevenue)} onClick={toOrders} />
          <KPICard label="Orders" value={formatCount(orderCount)} delta={pctDelta(orderCount, prevOrderCount)} onClick={toOrders} />
          <KPICard label="Avg order value" value={formatMoney(aov)} delta={pctDelta(aov, prevAov)} onClick={toOrders} />
          {MODULE_INVOICING && (
            <KPICard
              label="Collection rate"
              value={`${receivables.collectionRate.toFixed(0)}%`}
              subtitle={receivables.totalOverdue > 0 ? `${formatMoney(receivables.totalOverdue)} overdue` : 'Nothing overdue'}
              onClick={go('Accounts')}
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <DashCard
            title="Sales trend"
            caption="Revenue by day · dashed line is the previous period"
            className={showSideColumn ? 'lg:col-span-2' : 'lg:col-span-3'}
          >
            <SalesLineChart data={trend} previous={prevTrend} />
          </DashCard>

          {showSideColumn && (
            <div className="flex flex-col gap-4">
              {MODULE_FIELD_OPS && (
                <DashCard title="Top reps" caption="Revenue this period · visits over 30 days" action={go('Scheduled Visits') ? { label: 'Visits', onClick: go('Scheduled Visits')! } : undefined}>
                  <RankedList label="Top reps" items={topReps} emptyMessage="No rep sales in this period" />
                </DashCard>
              )}
              {POInboxStatsTile && (
                <Suspense fallback={<div className="dash-card h-40 animate-pulse" />}>
                  <POInboxStatsTile onNavigate={go('PO Inbox')} />
                </Suspense>
              )}
            </div>
          )}
        </div>
      </Band>

      <Band label="Inventory & dispatch">
        <InventoryDispatchSection
          allOrders={allOrders}
          products={products}
          lowStockThreshold={lowStockThreshold}
          onOpenStock={go('Stock')}
          onOpenOrders={openOrders}
        />
      </Band>

      <Band label="Breakdown">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DashCard title="Top selling products" caption="Units this period" action={toProductsTab ? { label: 'Products', onClick: toProductsTab } : undefined}>
            <RankedList label="Top selling products" items={topProducts} emptyMessage="No sales in this period" />
          </DashCard>
          <DashCard
            title="Top customers"
            caption="Revenue this period"
            action={toHoReCaTab ? { label: 'Customers', onClick: toHoReCaTab } : undefined}
            footer={
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-xs text-stone-500">Segments</span>
                {SEGMENT_ORDER.map(seg => (
                  <span key={seg} className="inline-flex items-center gap-1.5">
                    <SegmentBadge segment={seg} />
                    <span className="text-xs font-semibold tabular-nums text-stone-700">{segmentCounts[seg] ?? 0}</span>
                  </span>
                ))}
                {go('HoReCa Insights') && (
                  <button type="button" onClick={go('HoReCa Insights')}
                    className="ml-auto text-xs font-semibold text-nexgen-blue-dark hover:underline cursor-pointer touch-target-y">
                    Insights →
                  </button>
                )}
              </div>
            }
          >
            <RankedList label="Top customers" items={topCustomers} emptyMessage="No customer orders in this period" />
          </DashCard>
        </div>
      </Band>

      {showPrograms && (
        <Band label="Programs">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {MODULE_PROMOTIONS && topPromos.length > 0 && (
              <DashCard title="Promotions" caption="Top 3 by revenue" action={go('Promotions') ? { label: 'View all', onClick: go('Promotions')! } : undefined}>
                <ul className="divide-y divide-stone-100">
                  {topPromos.map(roi => (
                    <li key={roi.promotionId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-stone-800">{roi.promotionName}</span>
                        <span className="block text-xs text-stone-500">
                          {roi.ordersUsing} {roi.ordersUsing === 1 ? 'order' : 'orders'} · {formatMoney(roi.totalDiscountGiven, { cents: false })} discount
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-stone-900">{formatMoney(roi.revenueFromPromoOrders, { cents: false })}</span>
                        {roi.estimatedUplift !== null && (
                          <span className={`block text-xs font-semibold tabular-nums ${roi.estimatedUplift >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                            {roi.estimatedUplift >= 0 ? '+' : ''}{roi.estimatedUplift}% uplift
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </DashCard>
            )}

            {MODULE_FIELD_OPS && onUpdateSalesTargets && (
              <DashCard
                title="My targets"
                action={{ label: myTargets.length > 0 ? 'Edit' : 'Set targets', onClick: () => setShowTargetModal(true) }}
              >
                {myTargets.length > 0 ? (
                  <div className="space-y-4">
                    {myTargets.map(target => {
                      const { achieved, percent } = computeTargetProgress({ ...target, userId: currentUser.id }, metricCtx);
                      const labelMap = { revenue: 'Revenue', orders: 'Orders', new_horecas: 'New HoReCa' } as const;
                      const fmt = (n: number) => (target.type === 'revenue' ? formatMoney(n, { cents: false }) : formatCount(n));
                      return (
                        <React.Fragment key={target.id}>
                          <TargetBar
                            label={labelMap[target.type]}
                            achieved={fmt(achieved)}
                            target={fmt(target.targetValue)}
                            percent={percent}
                            startDate={target.startDate}
                            endDate={target.endDate}
                          />
                        </React.Fragment>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState icon={Target} message="No targets set" action={{ label: 'Set targets', onClick: () => setShowTargetModal(true) }} />
                )}
              </DashCard>
            )}
          </div>
        </Band>
      )}

      {SalesTargetModal && showTargetModal && onUpdateSalesTargets && (
        // NX-0041: these are the props SalesTargetModal actually takes.
        <SalesTargetModal
          isOpen={showTargetModal}
          existingTargets={salesTargets}
          userId={currentUser.id}
          onSave={(targets) => { onUpdateSalesTargets(targets); setShowTargetModal(false); }}
          onClose={() => setShowTargetModal(false)}
        />
      )}
    </PageFrame>
  );
};

export default AdminDashboard;
