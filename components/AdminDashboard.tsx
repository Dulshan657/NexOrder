import React, { useMemo, useState } from 'react';
import type { Order, Product, HoReCa, User, Invoice, SalesTarget, Promotion, Visit, ScheduledVisit, DashboardTimePeriod } from '../types';
import { UserRole } from '../types';
import { DollarSign, ShoppingBag, BarChart3, Wallet, AlertTriangle, CreditCard, Users, Package, Target, Download, TrendingUp } from 'lucide-react';
import KPICard from './dashboard/KPICard';
import AlertBanner from './dashboard/AlertBanner';
import TimePeriodToggle from './dashboard/TimePeriodToggle';
import ExpandableSection from './dashboard/ExpandableSection';
import SalesLineChart from './charts/SalesLineChart';
import HorizontalBarChart from './charts/HorizontalBarChart';
import SalesTargetModal from './SalesTargetModal';
import SegmentBadge from './SegmentBadge';
import { getAllOutstanding, getOverduePaymentsSummary } from '../services/accountingService';
import { getRestockAlerts, getDaysToStockout } from '../services/productMovementService';
import { computeAllHoReCaInsights } from '../services/buyingPatternsService';
import { getPromotionROI } from '../services/promotionROIService';
import { computeRepProductivity } from '../services/repProductivityService';

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

  // Filtered orders for the selected period
  const { filteredOrders, previousOrders } = useMemo(() => {
    const filtered = allOrders.filter(o => {
      const d = new Date(o.orderDate).getTime();
      return d >= dateRange.start.getTime() && d <= dateRange.end.getTime();
    });

    // Previous period for delta calculation
    const periodMs = dateRange.end.getTime() - dateRange.start.getTime();
    const prevStart = new Date(dateRange.start.getTime() - periodMs);
    const prevEnd = dateRange.start;
    const previous = allOrders.filter(o => {
      const d = new Date(o.orderDate).getTime();
      return d >= prevStart.getTime() && d < prevEnd.getTime();
    });

    return { filteredOrders: filtered, previousOrders: previous };
  }, [allOrders, dateRange]);

  // Revenue metrics
  const metrics = useMemo(() => {
    const revenue = filteredOrders.reduce((s, o) => s + o.total, 0);
    const prevRevenue = previousOrders.reduce((s, o) => s + o.total, 0);
    const orders = filteredOrders.length;
    const prevOrders = previousOrders.length;
    const aov = orders > 0 ? revenue / orders : 0;
    const prevAov = prevOrders > 0 ? prevRevenue / prevOrders : 0;

    const totalInvoiced = invoices.reduce((s, i) => s + i.amount, 0);
    const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
    const collectionRate = totalInvoiced > 0 ? (totalPaid / totalInvoiced) * 100 : 0;

    const delta = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0;

    return {
      revenue, prevRevenue, revenueDelta: delta(revenue, prevRevenue),
      orders, prevOrders, ordersDelta: delta(orders, prevOrders),
      aov, prevAov, aovDelta: delta(aov, prevAov),
      collectionRate, totalOverdue,
    };
  }, [filteredOrders, previousOrders, invoices]);

  // Alerts
  const alerts = useMemo(() => {
    const overdue = getOverduePaymentsSummary(invoices);
    const outstanding = getAllOutstanding(invoices, hoReCas);
    const restockAlerts = getRestockAlerts(allOrders, products);
    const stockoutData = getDaysToStockout(allOrders, products).filter(d => (d.daysRemaining ?? Infinity) <= 30);
    const lowStock = products.filter(p => p.inventory > 0 && p.inventory < lowStockThreshold);
    const outOfStock = products.filter(p => p.inventory <= 0);

    const allInsights = computeAllHoReCaInsights(allOrders, hoReCas);
    const atRisk = allInsights.filter(i => i.segment === 'at_risk' || i.segment === 'declining');

    return { overdue, outstanding, restockAlerts, stockoutData, lowStock, outOfStock, atRisk };
  }, [invoices, hoReCas, allOrders, products, lowStockThreshold]);

  // Sales trend chart data
  const salesOverTimeData = useMemo(() => {
    const salesByDate = new Map<string, number>();
    filteredOrders.forEach(order => {
      const date = order.orderDate.split('T')[0];
      salesByDate.set(date, (salesByDate.get(date) || 0) + order.total);
    });

    const data: { date: string; revenue: number }[] = [];
    const d = new Date(dateRange.start);
    while (d <= dateRange.end) {
      const dateString = formatDateForInput(d);
      data.push({ date: dateString, revenue: salesByDate.get(dateString) || 0 });
      d.setDate(d.getDate() + 1);
    }
    return data;
  }, [filteredOrders, dateRange]);

  // Top data
  const { topProducts, topCustomers, topReps } = useMemo(() => {
    const productSales = new Map<string, number>();
    filteredOrders.forEach(o => o.items.forEach(item => {
      productSales.set(item.name, (productSales.get(item.name) || 0) + item.quantity);
    }));
    const topProd = [...productSales.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([label, value]) => ({ label, value, formattedValue: `${value} units` }));

    const customerSales = new Map<string, number>();
    filteredOrders.forEach(o => {
      customerSales.set(o.hoReCa.name, (customerSales.get(o.hoReCa.name) || 0) + o.total);
    });
    const topCust = [...customerSales.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, value]) => ({ name, value: `$${value.toFixed(2)}` }));

    const repSales = new Map<string, { revenue: number; avatarUrl?: string }>();
    filteredOrders.forEach(o => {
      if (o.submittedBy.role === UserRole.FIELD_REP || o.submittedBy.role === UserRole.OFFICE_REP) {
        const curr = repSales.get(o.submittedBy.name) || { revenue: 0, avatarUrl: o.submittedBy.avatarUrl };
        repSales.set(o.submittedBy.name, { revenue: curr.revenue + o.total, avatarUrl: curr.avatarUrl });
      }
    });
    const topR = [...repSales.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5)
      .map(([name, data]) => ({ name, value: `$${data.revenue.toFixed(2)}`, avatarUrl: data.avatarUrl }));

    return { topProducts: topProd, topCustomers: topCust, topReps: topR };
  }, [filteredOrders]);

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
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
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
              <span className="text-stone-400 text-xs">to</span>
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
      {(alerts.overdue.count > 0 || alerts.lowStock.length + alerts.outOfStock.length > 0 || alerts.atRisk.length > 0) ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <AlertBanner icon={CreditCard} label="Overdue Payments" count={alerts.overdue.count}
            severity="critical" subtitle={`$${alerts.overdue.totalAmount.toFixed(2)}`}
            onViewAll={onNavigateTab ? () => onNavigateTab('Accounts') : undefined}>
            <div className="space-y-2">
              {alerts.outstanding.slice(0, 5).map(o => (
                <div key={o.hoReCaId} className="flex items-center justify-between text-sm">
                  <span className="text-stone-700">{o.hoReCaName}</span>
                  <span className={`font-semibold ${o.isBlocked ? 'text-red-600' : 'text-amber-600'}`}>
                    ${o.totalOutstanding.toFixed(2)} {o.isBlocked && '(Blocked)'}
                  </span>
                </div>
              ))}
            </div>
          </AlertBanner>

          <AlertBanner icon={Package} label="Low / Out of Stock"
            count={alerts.lowStock.length + alerts.outOfStock.length}
            severity="warning"
            onViewAll={onNavigateTab ? () => onNavigateTab('Products') : undefined}>
            <div className="space-y-2">
              {alerts.outOfStock.slice(0, 3).map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-stone-700">{p.name}</span>
                  <span className="text-red-600 font-semibold">Out of stock</span>
                </div>
              ))}
              {alerts.stockoutData.slice(0, 3).map(s => (
                <div key={s.productId} className="flex items-center justify-between text-sm">
                  <span className="text-stone-700">{s.productName}</span>
                  <span className="text-amber-600 font-semibold">{s.currentStock} left ({s.daysRemaining}d)</span>
                </div>
              ))}
            </div>
          </AlertBanner>

          <AlertBanner icon={AlertTriangle} label="At-Risk Customers" count={alerts.atRisk.length}
            severity="warning"
            onViewAll={onNavigateTab ? () => onNavigateTab('HoReCa Insights') : undefined}>
            <div className="space-y-2">
              {alerts.atRisk.slice(0, 5).map(c => (
                <div key={c.hoReCaId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-stone-700">{c.hoReCaName}</span>
                    <SegmentBadge segment={c.segment} />
                  </div>
                  <span className="text-orange-600 text-xs">{c.daysSinceLastOrder}d ago</span>
                </div>
              ))}
            </div>
          </AlertBanner>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm text-emerald-700 font-medium">All clear — no urgent alerts</span>
        </div>
      )}

      {/* C. Revenue Snapshot KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon={DollarSign} label="Revenue" value={`$${metrics.revenue.toFixed(2)}`} delta={metrics.revenueDelta} />
        <KPICard icon={ShoppingBag} label="Orders" value={String(metrics.orders)} delta={metrics.ordersDelta} />
        <KPICard icon={BarChart3} label="Avg Order Value" value={`$${metrics.aov.toFixed(2)}`} delta={metrics.aovDelta} />
        <KPICard icon={Wallet} label="Collection Rate" value={`${metrics.collectionRate.toFixed(0)}%`}
          subtitle={metrics.totalOverdue > 0 ? `$${metrics.totalOverdue.toFixed(2)} overdue` : undefined} />
      </div>

      {/* D. Sales Trend + Team Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-900 mb-4">Sales Trend</h3>
          <SalesLineChart data={salesOverTimeData} />
        </div>
        <div className="glass-card rounded-xl p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-stone-900 mb-3">Top Reps</h3>
            {topReps.length > 0 ? (
              <ul className="space-y-2.5">
                {topReps.map((rep, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {rep.avatarUrl && <img src={rep.avatarUrl} alt={rep.name} className="h-7 w-7 rounded-full border border-stone-200" />}
                      <span className="text-sm text-stone-700">{rep.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-nexgen-blue">{rep.value}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-stone-400">No rep data</p>}
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
          ) : <p className="text-sm text-stone-400">No customer data</p>}

          <div className="border-t border-stone-200 mt-4 pt-4">
            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Customer Segments</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(segmentDistribution).map(([seg, count]) => (
                <div key={seg} className="flex items-center gap-1.5">
                  <SegmentBadge segment={seg as any} />
                  <span className="text-xs text-stone-400">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* F. Promotional ROI */}
      {promoROI.length > 0 && (
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
      {currentUser && onUpdateSalesTargets && (
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
                const startMs = new Date(target.startDate).getTime();
                const endMs = new Date(target.endDate + 'T23:59:59').getTime();
                const ordersInRange = allOrders.filter(o =>
                  o.submittedBy.id === currentUser.id &&
                  new Date(o.orderDate).getTime() >= startMs &&
                  new Date(o.orderDate).getTime() <= endMs
                );

                let achieved = 0;
                if (target.type === 'revenue') {
                  achieved = ordersInRange.reduce((sum, o) => sum + o.total, 0);
                } else if (target.type === 'orders') {
                  achieved = ordersInRange.length;
                } else {
                  const allMyOrders = allOrders.filter(o => o.submittedBy.id === currentUser.id);
                  const firstOrderByHoReCa: Record<number, number> = {};
                  allMyOrders.forEach(o => {
                    const t = new Date(o.orderDate).getTime();
                    if (!firstOrderByHoReCa[o.hoReCa.id] || t < firstOrderByHoReCa[o.hoReCa.id]) {
                      firstOrderByHoReCa[o.hoReCa.id] = t;
                    }
                  });
                  achieved = Object.values(firstOrderByHoReCa).filter(t => t >= startMs && t <= endMs).length;
                }

                const percent = target.targetValue > 0 ? Math.min((achieved / target.targetValue) * 100, 100) : 0;
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
                      <span className="text-xs text-stone-400">
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
            <p className="text-sm text-stone-400">No targets set. Click &quot;Set Targets&quot; to get started.</p>
          )}
        </ExpandableSection>
      )}

      {showTargetModal && onUpdateSalesTargets && (
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
