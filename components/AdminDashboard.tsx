import React, { useMemo, useState } from 'react';
import type { Order, Product, HoReCa, User, Invoice, SalesTarget, Promotion, Visit, ScheduledVisit, DashboardTimePeriod } from '../types';
import { UserRole } from '../types';
import { DollarSign, ShoppingBag, BarChart3, Wallet, AlertTriangle, CreditCard, Users, Package, Target, Download, TrendingUp } from 'lucide-react';
import KPICard from './dashboard/KPICard';
import ActionItemsBoard from './ActionItemsBoard';
import OptimizedImage from './OptimizedImage';
import type { ActionItemColumn, ActionItem } from './ActionItemsBoard';
import TimePeriodToggle from './dashboard/TimePeriodToggle';
import ExpandableSection from './dashboard/ExpandableSection';
import SalesLineChart from './charts/SalesLineChart';
import InventoryDispatchSection from './admin/InventoryDispatchSection';
import HorizontalBarChart from './charts/HorizontalBarChart';
import { MODULE_FIELD_OPS, MODULE_INVOICING, MODULE_PO_INBOX, MODULE_PROMOTIONS } from '../lib/modules';
import { lazyWithRetry } from '../lib/lazyWithRetry';

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
import SegmentBadge from './SegmentBadge';
import { getAllOutstanding, getOverduePaymentsSummary } from '../services/accountingService';
import { getRestockAlerts, getDaysToStockout } from '../services/productMovementService';
import { computeAllHoReCaInsights } from '../services/buyingPatternsService';
import { getPromotionROI } from '../services/promotionROIService';
import { computeRepProductivity } from '../services/repProductivityService';
import { computeTargetProgress, dayRange, filterOrders } from '../lib/semantic';
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

const formatDateForInput = (date: Date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function getDateRange(period: DashboardTimePeriod, customStart?: string, customEnd?: string): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return { start: today, end: now };
    case 'this_week': {
      const dayOfWeek = today.getDay();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - dayOfWeek);
      return { start: weekStart, end: now };
    }
    case 'this_month':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: now };
    case 'custom':
      // Both bounds come from date inputs, so this is a calendar range and
      // dayRange owns it. The old `customEnd + 'T23:59:59'` built the boundary in
      // local time and dropped the final second of the day.
      if (customStart && customEnd) {
        const range = dayRange(customStart, customEnd);
        return { start: range.from, end: range.to };
      }
      return {
        start: customStart ? new Date(customStart) : new Date(today.getTime() - 30 * 86400000),
        end: customEnd ? new Date(customEnd + 'T23:59:59') : now,
      };
    default:
      return { start: new Date(today.getTime() - 30 * 86400000), end: now };
  }
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({
  allOrders, products, hoReCas, users, invoices, salesTargets = [], onUpdateSalesTargets,
  currentUser, lowStockThreshold = 10, promotions = [], visits = [], routes = [], onNavigateTab,
}) => {
  const [period, setPeriod] = useState<DashboardTimePeriod>('this_month');
  const [customStart, setCustomStart] = useState(formatDateForInput(new Date(Date.now() - 30 * 86400000)));
  const [customEnd, setCustomEnd] = useState(formatDateForInput(new Date()));
  const [showTargetModal, setShowTargetModal] = useState(false);

  const dateRange = useMemo(() => getDateRange(period, customStart, customEnd), [period, customStart, customEnd]);

  // This window and the one before it, for the deltas. Both are INSTANT ranges:
  // getDateRange returns local midnight .. now, not two calendar dates, so they
  // are passed through as instants rather than via dayRange.
  const periodFilter = useMemo(
    () => ({ from: dateRange.start, to: dateRange.end }),
    [dateRange],
  );
  const previousFilter = useMemo(() => {
    const periodMs = dateRange.end.getTime() - dateRange.start.getTime();
    return {
      from: new Date(dateRange.start.getTime() - periodMs),
      // The old predicate was `< prevEnd`; one millisecond short of the current
      // window's start is the same set of orders, expressed inclusively.
      to: new Date(dateRange.start.getTime() - 1),
    };
  }, [dateRange]);

  const metricCtx = useMetricContext({ orders: allOrders, products, lowStockThreshold });

  const filteredOrders = useMemo(
    () => filterOrders(allOrders, periodFilter),
    [allOrders, periodFilter],
  );

  const revenue = useMetric<number>('sales.revenue', metricCtx, periodFilter);
  const prevRevenue = useMetric<number>('sales.revenue', metricCtx, previousFilter);
  const orderCount = useMetric<number>('sales.orderCount', metricCtx, periodFilter);
  const prevOrderCount = useMetric<number>('sales.orderCount', metricCtx, previousFilter);
  const aov = useMetric<number>('sales.averageOrderValue', metricCtx, periodFilter);
  const prevAov = useMetric<number>('sales.averageOrderValue', metricCtx, previousFilter);

  // Receivables math stays inline: the AR domain is deliberately outside the
  // semantic layer's first cut. See lib/semantic/registry.ts when it lands.
  const metrics = useMemo(() => {
    const totalInvoiced = invoices.reduce((s, i) => s + i.amount, 0);
    const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
    const collectionRate = totalInvoiced > 0 ? (totalPaid / totalInvoiced) * 100 : 0;

    const delta = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0;

    return {
      revenue, prevRevenue, revenueDelta: delta(revenue, prevRevenue),
      orders: orderCount, prevOrders: prevOrderCount, ordersDelta: delta(orderCount, prevOrderCount),
      aov, prevAov, aovDelta: delta(aov, prevAov),
      collectionRate, totalOverdue,
    };
  }, [invoices, revenue, prevRevenue, orderCount, prevOrderCount, aov, prevAov]);

  const lowStockProducts = useMetric<readonly Product[]>('inventory.lowStockProducts', metricCtx);
  const outOfStockProducts = useMetric<readonly Product[]>('inventory.outOfStockProducts', metricCtx);

  // Alerts
  const alerts = useMemo(() => {
    const overdue = getOverduePaymentsSummary(invoices);
    const outstanding = getAllOutstanding(invoices, hoReCas);
    const restockAlerts = getRestockAlerts(allOrders, products);
    const stockoutData = getDaysToStockout(allOrders, products).filter(d => (d.daysRemaining ?? Infinity) <= 30);
    // Was `p.inventory > 0 && p.inventory < lowStockThreshold` / `p.inventory <= 0`,
    // which used a strict `<`, ignored each product's own reorderPoint and
    // alerted on retired products. The registry applies the canonical
    // classifyStock rule instead, so a product exactly at its threshold is low.
    const lowStock = lowStockProducts;
    const outOfStock = outOfStockProducts;

    const allInsights = computeAllHoReCaInsights(allOrders, hoReCas);
    const atRisk = allInsights.filter(i => i.segment === 'at_risk' || i.segment === 'declining');

    return { overdue, outstanding, restockAlerts, stockoutData, lowStock, outOfStock, atRisk };
  }, [invoices, hoReCas, allOrders, products, lowStockProducts, outOfStockProducts]);

  const actionColumns = useMemo((): ActionItemColumn[] => {
    const overdueItems: ActionItem[] = alerts.outstanding.map(o => ({
      id: `overdue-${o.hoReCaId}`,
      title: o.hoReCaName,
      subtitle: `$${o.totalOutstanding.toFixed(2)}${o.isBlocked ? ' · Blocked' : ''}`,
      onClick: onNavigateTab ? () => onNavigateTab('Accounts') : undefined,
    }));

    // Stock counts here (products.inventory) and the days-to-stockout
    // projection (getDaysToStockout) are both company-wide: sales velocity has
    // no warehouse dimension, so this data is never scoped to a single site.
    // Label plainly rather than quietly scoping just the numerator, which
    // would produce a plausible-looking but wrong days-to-stockout number.
    const stockItems: ActionItem[] = [
      ...alerts.outOfStock.map(p => ({
        id: `stock-out-${p.id}`,
        title: p.name,
        subtitle: 'Out of stock — all sites',
        badge: { label: 'Out', color: 'bg-red-50 text-red-700 border-red-200' },
        onClick: onNavigateTab ? () => onNavigateTab('Products') : undefined,
      })),
      ...alerts.stockoutData.map(s => ({
        id: `stock-risk-${s.productId}`,
        title: s.productName,
        subtitle: `${s.currentStock} left (all sites) · ${s.daysRemaining ?? '?'}d`,
        onClick: onNavigateTab ? () => onNavigateTab('Products') : undefined,
      })),
      ...alerts.lowStock.map(p => ({
        id: `stock-low-${p.id}`,
        title: p.name,
        subtitle: `${p.inventory} left (all sites)`,
        onClick: onNavigateTab ? () => onNavigateTab('Products') : undefined,
      })),
    ];

    const riskItems: ActionItem[] = alerts.atRisk.map(c => ({
      id: `risk-${c.hoReCaId}`,
      title: c.hoReCaName,
      subtitle: c.daysSinceLastOrder != null ? `${c.daysSinceLastOrder}d ago` : undefined,
      badge: {
        label: c.segment === 'at_risk' ? 'At Risk' : 'Declining',
        color: c.segment === 'at_risk' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-orange-50 text-orange-800 border-orange-200',
      },
      onClick: onNavigateTab ? () => onNavigateTab('HoReCa Insights') : undefined,
    }));

    return [
      { id: 'overdue', label: 'Overdue Payments', icon: CreditCard, severity: 'critical' as const,
        items: overdueItems, onViewAll: onNavigateTab ? () => onNavigateTab('Accounts') : undefined },
      { id: 'stock', label: 'Low / Out of Stock (All Sites)', icon: Package, severity: 'warning' as const,
        items: stockItems, onViewAll: onNavigateTab ? () => onNavigateTab('Products') : undefined },
      { id: 'at-risk', label: 'At-Risk Customers', icon: AlertTriangle, severity: 'warning' as const,
        items: riskItems, onViewAll: onNavigateTab ? () => onNavigateTab('HoReCa Insights') : undefined },
    ];
  }, [alerts, onNavigateTab]);

  // Sales trend chart data. The registry supplies the per-day revenue; filling
  // the gaps stays here because only this component knows the axis it is drawing.
  const revenueByDate = useMetric<readonly DateRevenue[]>('sales.revenueByDate', metricCtx, periodFilter);
  const salesOverTimeData = useMemo(() => {
    const salesByDate = new Map(revenueByDate.map(row => [row.date, row.revenue]));

    const data: { date: string; revenue: number }[] = [];
    const d = new Date(dateRange.start);
    while (d <= dateRange.end) {
      const dateString = formatDateForInput(d);
      data.push({ date: dateString, revenue: salesByDate.get(dateString) || 0 });
      d.setDate(d.getDate() + 1);
    }
    return data;
  }, [revenueByDate, dateRange]);

  // Top data. The ranking and the rep-roles-only rule live in the registry; only
  // the top-5 cut and the display formatting are this component's business.
  const unitsByProduct = useMetric<readonly ProductUnits[]>('sales.unitsByProduct', metricCtx, periodFilter);
  const revenueByCustomer = useMetric<readonly CustomerRevenue[]>('sales.revenueByCustomer', metricCtx, periodFilter);
  const revenueByRep = useMetric<readonly RepRevenue[]>('sales.revenueByRep', metricCtx, periodFilter);

  const { topProducts, topCustomers, topReps } = useMemo(() => ({
    topProducts: unitsByProduct.slice(0, 5)
      .map(row => ({ label: row.name, value: row.units, formattedValue: `${row.units} units` })),
    topCustomers: revenueByCustomer.slice(0, 5)
      .map(row => ({ name: row.name, value: `$${row.revenue.toFixed(2)}` })),
    topReps: revenueByRep.slice(0, 5)
      .map(row => ({ name: row.name, value: `$${row.revenue.toFixed(2)}`, avatarUrl: row.avatarUrl })),
  }), [unitsByProduct, revenueByCustomer, revenueByRep]);

  // Promo ROI
  const promoROI = useMemo(() => getPromotionROI(promotions, allOrders, products), [promotions, allOrders, products]);

  // Rep productivity summary
  const repProductivity = useMemo(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const now = new Date();
    const reps = users.filter(u => u.role === UserRole.FIELD_REP || u.role === UserRole.OFFICE_REP);

    return reps.map(rep => ({
      name: rep.name,
      ...computeRepProductivity(visits, routes, allOrders, rep.id, thirtyDaysAgo, now),
    }));
  }, [users, visits, routes, allOrders]);

  // Customer segment distribution
  const segmentDistribution = useMemo(() => {
    const allInsights = computeAllHoReCaInsights(allOrders, hoReCas);
    const counts: Record<string, number> = { high_value: 0, growing: 0, declining: 0, at_risk: 0, new: 0 };
    allInsights.forEach(i => { counts[i.segment] = (counts[i.segment] || 0) + 1; });
    return counts;
  }, [allOrders, hoReCas]);

  // CSV Export
  const handleExportCSV = () => {
    const headers = ["Order ID", "Date", "HoReCa", "Rep", "Status", "Total"];
    const rows = filteredOrders.map(o => [
      o.id, new Date(o.orderDate).toLocaleString(), o.hoReCa.name, o.submittedBy.name, o.status || 'N/A', o.total.toFixed(2)
    ].map(String));
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `sales_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Sales Targets
  const myTargets = salesTargets.filter(t => t.userId === currentUser.id);

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      {/* A. Command Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Dashboard</h1>
          <p className="text-xs text-stone-500 mt-0.5">Overview of business performance</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <TimePeriodToggle value={period} onChange={setPeriod} />
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-900" />
              <span className="text-stone-500 text-xs">to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-900" />
            </div>
          )}
          <button onClick={handleExportCSV} disabled={filteredOrders.length === 0}
            className="bg-nexgen-blue/10 text-nexgen-blue border border-nexgen-blue/20 font-semibold py-1.5 px-3 rounded-lg hover:bg-nexgen-blue/20 disabled:opacity-40 flex items-center gap-1.5 text-xs transition-colors cursor-pointer">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* B. Operational Alerts Banner */}
      <ActionItemsBoard
        title="Action Items"
        columns={actionColumns}
        storageKey="admin_action_items"
        users={users}
        showAssign={true}
      />

      {/* C. Revenue Snapshot KPIs */}
      <div className={`grid grid-cols-2 gap-4 ${MODULE_INVOICING ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <KPICard icon={DollarSign} label="Revenue" value={`$${metrics.revenue.toFixed(2)}`} delta={metrics.revenueDelta} />
        <KPICard icon={ShoppingBag} label="Orders" value={String(metrics.orders)} delta={metrics.ordersDelta} />
        <KPICard icon={BarChart3} label="Avg Order Value" value={`$${metrics.aov.toFixed(2)}`} delta={metrics.aovDelta} />
        {MODULE_INVOICING && (
        <KPICard icon={Wallet} label="Collection Rate" value={`${metrics.collectionRate.toFixed(0)}%`}
          subtitle={metrics.totalOverdue > 0 ? `$${metrics.totalOverdue.toFixed(2)} overdue` : undefined} />
        )}
      </div>

      {/* PO Inbox health tile — visible to Admin + Manager */}
      {MODULE_PO_INBOX && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <POInboxStatsTile onNavigate={onNavigateTab ? () => onNavigateTab('PO Inbox') : undefined} />
        </div>
      </div>
      )}

      {/* C2. Inventory & Dispatch visualisations */}
      <InventoryDispatchSection
        allOrders={allOrders}
        products={products}
        lowStockThreshold={lowStockThreshold}
        onNavigateTab={onNavigateTab}
      />

      {/* D. Sales Trend + Team Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`glass-card rounded-xl p-5 ${MODULE_FIELD_OPS ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <h3 className="text-sm font-semibold text-stone-900 mb-4">Sales Trend</h3>
          <SalesLineChart data={salesOverTimeData} />
        </div>
        {MODULE_FIELD_OPS && (
        <div className="glass-card rounded-xl p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-stone-900 mb-3">Top Reps</h3>
            {topReps.length > 0 ? (
              <ul className="space-y-2.5">
                {topReps.map((rep, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {rep.avatarUrl && <OptimizedImage src={rep.avatarUrl} alt={rep.name} className="h-7 w-7 rounded-full border border-stone-200" transformWidth={128} />}
                      <span className="text-sm text-stone-700">{rep.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-nexgen-blue">{rep.value}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-stone-500">No rep data</p>}
          </div>
          {repProductivity.length > 0 && (
            <div className="border-t border-stone-200 pt-4">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Rep Productivity (30d)</h3>
              <div className="space-y-1.5">
                {repProductivity.map(rp => (
                  <div key={rp.name} className="flex items-center justify-between text-xs">
                    <span className="text-stone-500">{rp.name}</span>
                    <div className="flex gap-3">
                      <span className="text-nexgen-blue" title="Visit completion">{rp.visitCompletionRate}%</span>
                      <span className="text-nexgen-blue-dark" title="Conversion">{rp.visitConversionRate}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* E. Product & Customer Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card rounded-xl p-5">
          <HorizontalBarChart title="Top Selling Products" data={topProducts} />
        </div>
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-bold text-stone-900 text-lg mb-3">Top Customers</h3>
          {topCustomers.length > 0 ? (
            <ul className="space-y-2.5">
              {topCustomers.map((c, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-sm text-stone-700">{c.name}</span>
                  <span className="text-sm font-semibold text-nexgen-blue">{c.value}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-stone-500">No customer data</p>}

          <div className="border-t border-stone-200 mt-4 pt-4">
            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Customer Segments</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(segmentDistribution).map(([seg, count]) => (
                <div key={seg} className="flex items-center gap-1.5">
                  <SegmentBadge segment={seg as any} />
                  <span className="text-xs text-stone-500">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* F. Promotional ROI */}
      {MODULE_PROMOTIONS && promoROI.length > 0 && (
        <ExpandableSection title="Promotional ROI" defaultExpanded>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500 text-xs uppercase tracking-wider">
                  <th className="pb-3 pr-4">Promotion</th>
                  <th className="pb-3 pr-4">Type</th>
                  <th className="pb-3 pr-4 text-right">Orders</th>
                  <th className="pb-3 pr-4 text-right">Discount Given</th>
                  <th className="pb-3 pr-4 text-right">Revenue</th>
                  <th className="pb-3 text-right">Uplift</th>
                </tr>
              </thead>
              <tbody>
                {promoROI.map(roi => (
                  <tr key={roi.promotionId} className="border-t border-stone-100">
                    <td className="py-2.5 pr-4 text-stone-700 font-medium">{roi.promotionName}</td>
                    <td className="py-2.5 pr-4">
                      <span className="px-2 py-0.5 rounded-full bg-nexgen-blue/10 text-nexgen-blue text-xs capitalize">{roi.type}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-stone-600">{roi.ordersUsing}</td>
                    <td className="py-2.5 pr-4 text-right text-red-600">${roi.totalDiscountGiven.toFixed(2)}</td>
                    <td className="py-2.5 pr-4 text-right text-emerald-600">${roi.revenueFromPromoOrders.toFixed(2)}</td>
                    <td className="py-2.5 text-right">
                      <span className={`font-semibold ${roi.estimatedUplift >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {roi.estimatedUplift >= 0 ? '+' : ''}{roi.estimatedUplift}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ExpandableSection>
      )}

      {/* G. Sales Targets */}
      {MODULE_FIELD_OPS && currentUser && onUpdateSalesTargets && (
        <ExpandableSection title="Sales Targets" defaultExpanded={myTargets.length > 0}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-stone-900">My Targets</h4>
            <button onClick={() => setShowTargetModal(true)}
              className="text-xs font-medium text-nexgen-blue hover:text-nexgen-blue-dark flex items-center gap-1 cursor-pointer">
              <Target className="w-3.5 h-3.5" />
              {myTargets.length > 0 ? 'Edit' : 'Set Targets'}
            </button>
          </div>
          {myTargets.length > 0 ? (
            <div className="space-y-3">
              {myTargets.map(target => {
                // Was ~25 lines re-deriving attainment for each of the three
                // target types, with its own 'T23:59:59' window bound. The
                // registry composes the same three metrics over the window the
                // target itself describes.
                const { achieved, percent } = computeTargetProgress(
                  { ...target, userId: currentUser.id },
                  metricCtx,
                );
                const labelMap = { revenue: 'Revenue', orders: 'Orders', new_horecas: 'New HoReCa' } as const;
                const formatVal = target.type === 'revenue' ? `$${achieved.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : String(achieved);
                const formatTarget = target.type === 'revenue' ? `$${target.targetValue.toLocaleString()}` : String(target.targetValue);

                const barColor = percent >= 60 ? 'bg-emerald-500' : percent >= 30 ? 'bg-amber-500' : 'bg-red-500';

                return (
                  <div key={target.id} className="bg-stone-50 rounded-lg p-3 border border-stone-200">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-stone-900">{labelMap[target.type]}</span>
                      <span className="text-xs text-stone-500">{formatVal} / {formatTarget}</span>
                    </div>
                    <div className="w-full bg-stone-200 rounded-full h-2">
                      <div className={`h-2 rounded-full ${barColor} transition-all`} style={{ width: `${percent}%` }} />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-xs text-stone-500">
                        {new Date(target.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {new Date(target.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                      <span className={`text-xs font-semibold ${percent >= 60 ? 'text-emerald-600' : percent >= 30 ? 'text-amber-600' : 'text-red-600'}`}>
                        {percent.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-stone-500">No targets set. Click &quot;Set Targets&quot; to get started.</p>
          )}
        </ExpandableSection>
      )}

      {MODULE_FIELD_OPS && showTargetModal && onUpdateSalesTargets && (
        <SalesTargetModal
          currentUser={currentUser}
          salesTargets={salesTargets}
          allOrders={allOrders}
          onSave={(targets) => { onUpdateSalesTargets(targets); setShowTargetModal(false); }}
          onClose={() => setShowTargetModal(false)}
        />
      )}
    </div>
  );
};

export default AdminDashboard;
