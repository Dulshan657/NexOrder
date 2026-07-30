import React, { useMemo, useState } from 'react';
import type { Order, Product, HoReCa, User, Invoice, SalesTarget } from '../types';
import { UserRole } from '../types';
import { CATEGORIES } from '../constants';
import { Target, DollarSign, ShoppingBag, Users } from 'lucide-react';
import SalesTargetModal from './SalesTargetModal';
import OptimizedImage from './OptimizedImage';
import { computeTargetProgress, dayRange, filterOrders } from '../lib/semantic';
import { useMetric, useMetricContext } from '../hooks/useMetrics';
import type {
    CategoryRevenue, CustomerRevenue, DateRevenue, ProductUnits, RepRevenue, StatusCount,
} from '../lib/semantic';

// Helper function to format date for input fields
const formatDateForInput = (date: Date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// --- Reusable Chart Components ---

const SalesLineChart: React.FC<{ data: { date: string; revenue: number }[] }> = ({ data }) => {
    const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; revenue: number } | null>(null);
    const width = 500;
    const height = 250;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };

    const maxRevenue = Math.max(...data.map(d => d.revenue), 0);
    const yMax = maxRevenue > 0 ? maxRevenue * 1.1 : 100;

    const getX = (index: number) => padding.left + (index / (data.length - 1)) * (width - padding.left - padding.right);
    const getY = (revenue: number) => height - padding.bottom - (revenue / yMax) * (height - padding.top - padding.bottom);

    if (data.length < 2) {
        return (
            <div style={{ height: `${height}px`}} className="flex items-center justify-center text-stone-500">
                Not enough data to display trend.
            </div>
        );
    }
    
    const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.revenue)}`).join(' ');
    const areaPath = linePath + ` L ${getX(data.length - 1)} ${height - padding.bottom} L ${getX(0)} ${height - padding.bottom} Z`;

    return (
        <div className="relative">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
                {/* Gradient Definition */}
                <defs>
                    <linearGradient id="salesGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.4}/>
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                </defs>

                {/* Y-axis */}
                <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#e7e5e4" />
                <text x={padding.left - 8} y={padding.top} textAnchor="end" fontSize="10" fill="#78716c">${yMax.toFixed(0)}</text>
                <text x={padding.left - 8} y={height - padding.bottom} textAnchor="end" fontSize="10" fill="#78716c">$0</text>
                
                {/* X-axis */}
                <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#e7e5e4" />
                <text x={padding.left} y={height - padding.bottom + 15} textAnchor="start" fontSize="10" fill="#78716c">{new Date(data[0].date).toLocaleDateString()}</text>
                <text x={width - padding.right} y={height - padding.bottom + 15} textAnchor="end" fontSize="10" fill="#78716c">{new Date(data[data.length - 1].date).toLocaleDateString()}</text>

                {/* Area and Line */}
                <path d={areaPath} fill="url(#salesGradient)" />
                <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2" />

                {/* Hover targets and points */}
                {data.map((d, i) => (
                    <g key={i}>
                        <circle cx={getX(i)} cy={getY(d.revenue)} r="3" fill="#10b981" />
                        <rect 
                            x={getX(i) - 10} y={0} width={20} height={height} fill="transparent"
                            onMouseMove={() => setTooltip({ x: getX(i), y: getY(d.revenue), date: d.date, revenue: d.revenue })}
                            onMouseLeave={() => setTooltip(null)}
                        />
                    </g>
                ))}

                {/* Tooltip */}
                {tooltip && (
                    <g transform={`translate(${tooltip.x}, ${tooltip.y})`}>
                        <circle r="5" fill="#059669" stroke="white" strokeWidth="2"/>
                        <g transform={`translate(${tooltip.x > width / 2 ? -140 : 20}, -10)`}>
                            <rect x="0" y="-22" width="120" height="40" fill="#1c1917" fillOpacity="0.9" rx="4" />
                            <text x="10" y="0" fill="white" fontSize="11">
                                <tspan x="10" dy="-0.5em">{new Date(tooltip.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</tspan>
                                <tspan x="10" dy="1.2em" fontWeight="bold">${tooltip.revenue.toFixed(2)}</tspan>
                            </text>
                        </g>
                    </g>
                )}
            </svg>
        </div>
    );
};

const HorizontalBarChart: React.FC<{ title: string; data: { label: string; value: number; formattedValue: string }[] }> = ({ title, data }) => {
    const width = 500;
    const barHeight = 30;
    const padding = { top: 20, right: 80, bottom: 20, left: 120 };
    const height = data.length * barHeight + padding.top + padding.bottom;
    
    const maxValue = Math.max(...data.map(d => d.value), 0);
    const xScale = (value: number) => (value / maxValue) * (width - padding.left - padding.right);

    if (data.length === 0) {
        return (
             <div className="flex items-center justify-center h-48 text-stone-500">
                <p>No data available for "{title}"</p>
            </div>
        );
    }

    return (
        <div className="w-full">
            <h3 className="font-bold text-stone-800 text-lg mb-2">{title}</h3>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
                {data.map((d, i) => (
                    <g key={d.label} transform={`translate(${padding.left}, ${padding.top + i * barHeight})`}>
                        <text x="-10" y={barHeight / 2} dy=".35em" textAnchor="end" fontSize="12" fill="#44403c" className="truncate">{d.label}</text>
                        <rect 
                            y="2"
                            width={xScale(d.value)} 
                            height={barHeight - 4} 
                            fill="#34d399" 
                            rx="3"
                        />
                        <text x={xScale(d.value) + 5} y={barHeight / 2} dy=".35em" fontSize="12" fontWeight="500" fill="#064e3b">{d.formattedValue}</text>
                    </g>
                ))}
            </svg>
        </div>
    )
};

const TopPerformersList: React.FC<{ title: string, data: { name: string; value: string; avatarUrl?: string }[] }> = ({ title, data }) => (
    <div className="h-full flex flex-col">
        <h3 className="font-bold text-stone-800 text-lg mb-3">{title}</h3>
        {data.length > 0 ? (
            <ul className="space-y-3">
                {data.map((item, index) => (
                    <li key={index} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {item.avatarUrl && <OptimizedImage src={item.avatarUrl} alt={item.name} className="h-9 w-9 rounded-full border border-stone-200" transformWidth={128} />}
                            <span className="font-medium text-stone-700 text-sm">{item.name}</span>
                        </div>
                        <span className="font-bold text-stone-800 text-sm">{item.value}</span>
                    </li>
                ))}
            </ul>
        ) : (
             <div className="flex-grow flex items-center justify-center text-stone-500">
                <p>No data available.</p>
             </div>
        )}
    </div>
);


// --- Main Dashboard Component ---

// FIX: Define SalesDashboardProps interface to pass props to the component.
interface SalesDashboardProps {
    allOrders: Order[];
    products: Product[];
    hoReCas: HoReCa[];
    users: User[];
    lowStockThreshold?: number;
    invoices?: Invoice[];
    salesTargets?: SalesTarget[];
    onUpdateSalesTargets?: (targets: SalesTarget[]) => void;
    currentUser?: User;
}

const SalesDashboard: React.FC<SalesDashboardProps> = ({ allOrders, products, hoReCas, users, lowStockThreshold = 10, invoices = [], salesTargets = [], onUpdateSalesTargets, currentUser }) => {
    const [showTargetModal, setShowTargetModal] = useState(false);
    const [filters, setFilters] = useState({
        startDate: formatDateForInput(new Date(new Date().setMonth(new Date().getMonth() - 1))),
        endDate: formatDateForInput(new Date()),
        hoReCaId: 'all',
        userRole: 'all',
        category: 'all'
    });

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFilters(prev => ({...prev, [name]: value}));
    };

    const resetFilters = () => {
         setFilters({
            startDate: formatDateForInput(new Date(new Date().setMonth(new Date().getMonth() - 1))),
            endDate: formatDateForInput(new Date()),
            hoReCaId: 'all',
            userRole: 'all',
            category: 'all'
        });
    };

    // One filter object describes every scope this screen offers, and the
    // semantic layer applies it. `category` is a LINE-level scope: it narrows each
    // order's items and switches the revenue basis to the surviving lines, which
    // is what the old `total: items.reduce(...)` rewrite was doing by hand.
    const metricFilter = useMemo(() => ({
        ...dayRange(filters.startDate, filters.endDate),
        horecaId: filters.hoReCaId !== 'all' ? parseInt(filters.hoReCaId) : undefined,
        userRole: filters.userRole !== 'all' ? (filters.userRole as UserRole) : undefined,
        category: filters.category !== 'all' ? filters.category : undefined,
    }), [filters]);

    const metricCtx = useMetricContext({ orders: allOrders, products, lowStockThreshold });

    const filteredOrders = useMemo(
        () => filterOrders(allOrders, metricFilter),
        [allOrders, metricFilter],
    );

    const totalRevenue = useMetric<number>('sales.scopedRevenue', metricCtx, metricFilter);
    const totalOrders = useMetric<number>('sales.orderCount', metricCtx, metricFilter);
    const avgOrderValue = useMetric<number>('sales.averageOrderValue', metricCtx, metricFilter);
    const lowStockItems = useMetric<readonly Product[]>('inventory.lowStockProducts', metricCtx);
    const revenueByDate = useMetric<readonly DateRevenue[]>('sales.revenueByDate', metricCtx, metricFilter);
    const unitsByProduct = useMetric<readonly ProductUnits[]>('sales.unitsByProduct', metricCtx, metricFilter);
    const revenueByCategory = useMetric<readonly CategoryRevenue[]>('sales.revenueByCategory', metricCtx, metricFilter);
    const revenueByCustomer = useMetric<readonly CustomerRevenue[]>('sales.revenueByCustomer', metricCtx, metricFilter);
    const revenueByRep = useMetric<readonly RepRevenue[]>('sales.revenueByRep', metricCtx, metricFilter);
    const ordersByStatus = useMetric<readonly StatusCount[]>('sales.ordersByStatus', metricCtx, metricFilter);

    // Only the presentation is left here: the top-N cut, the currency formatting,
    // and filling the chart's date gaps (which needs the axis this screen drew).
    const { topProductsData, topCategoriesData, salesOverTimeData, topHoReCaData, topRepsData } = useMemo(() => {
        const salesByDate = new Map(revenueByDate.map(row => [row.date, row.revenue]));

        const filledSalesData = [];
        try {
            const [startYear, startMonth, startDay] = filters.startDate.split('-').map(Number);
            const loopStartDate = new Date(startYear, startMonth - 1, startDay);
            const [endYear, endMonth, endDay] = filters.endDate.split('-').map(Number);
            const loopEndDate = new Date(endYear, endMonth - 1, endDay);

            if (loopStartDate <= loopEndDate) {
                for (let d = new Date(loopStartDate); d <= loopEndDate; d.setDate(d.getDate() + 1)) {
                    const dateString = formatDateForInput(d);
                    filledSalesData.push({ date: dateString, revenue: salesByDate.get(dateString) || 0 });
                }
            }
        } catch (error) { console.error("Error generating chart data:", error); }

        return {
            salesOverTimeData: filledSalesData,
            topProductsData: unitsByProduct.slice(0, 5)
                .map(row => ({ label: row.name, value: row.units, formattedValue: `${row.units} units` })),
            topCategoriesData: revenueByCategory.slice(0, 5)
                .map(row => ({ label: row.category, value: row.revenue, formattedValue: `$${row.revenue.toFixed(2)}` })),
            topHoReCaData: revenueByCustomer.slice(0, 5)
                .map(row => ({ name: row.name, value: `$${row.revenue.toFixed(2)}` })),
            topRepsData: revenueByRep.slice(0, 3)
                .map(row => ({ name: row.name, value: `$${row.revenue.toFixed(2)}`, avatarUrl: row.avatarUrl })),
        };
    }, [filters, revenueByDate, unitsByProduct, revenueByCategory, revenueByCustomer, revenueByRep]);
    
    const handleExportCSV = () => {
        const headers = ["Order ID", "Date", "HoReCa Name", "Submitted By", "Status", "Delivery Date", "Product Name", "Category", "Quantity", "Unit Price", "Row Total", "Order Notes"];
        const rows = filteredOrders.flatMap(order =>
            order.items.map(item => [
                order.id, new Date(order.orderDate).toLocaleString(), order.hoReCa.name, order.submittedBy.name,
                order.status || 'N/A', order.deliveryDate || 'N/A',
                item.name, item.category, item.quantity, item.price, (item.quantity * item.price), order.notes || ''
            ].map(String))
        );
        let csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", `sales_report_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-end">
                    <div><label className="text-sm font-medium text-stone-700 mb-1.5 block">Start Date</label><input type="date" name="startDate" value={filters.startDate} onChange={handleFilterChange} className={inputClasses} /></div>
                    <div><label className="text-sm font-medium text-stone-700 mb-1.5 block">End Date</label><input type="date" name="endDate" value={filters.endDate} onChange={handleFilterChange} className={inputClasses} /></div>
                    <div><label className="text-sm font-medium text-stone-700 mb-1.5 block">HoReCa</label><select name="hoReCaId" value={filters.hoReCaId} onChange={handleFilterChange} className={inputClasses}><option value="all">All HoReCa</option>{hoReCas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                    <div><label className="text-sm font-medium text-stone-700 mb-1.5 block">User Role</label><select name="userRole" value={filters.userRole} onChange={handleFilterChange} className={`${inputClasses} capitalize`}><option value="all">All Roles</option>{Object.values(UserRole).map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                    <div><label className="text-sm font-medium text-stone-700 mb-1.5 block">Category</label><select name="category" value={filters.category} onChange={handleFilterChange} className={inputClasses}><option value="all">All Categories</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                    <div className="flex gap-2"><button onClick={resetFilters} className="w-full bg-stone-100 text-stone-700 border border-stone-200 rounded-lg py-2.5 px-4 text-sm font-semibold hover:bg-stone-200 transition-colors">Reset</button></div>
                </div>
            </div>

            <div className="flex justify-between items-center">
                <h3 className="text-xl font-display font-bold text-stone-900">Filtered Results</h3>
                <button onClick={handleExportCSV} disabled={filteredOrders.length === 0} className="bg-nexgen-blue text-white font-semibold py-2 px-4 rounded-lg hover:bg-nexgen-blue-dark disabled:bg-stone-300 disabled:text-stone-500 flex items-center gap-2 transition-colors shadow-sm cursor-pointer">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    Export to CSV
                </button>
            </div>
            
            {filteredOrders.length > 0 ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm"><p className="text-sm text-stone-500 font-medium">Total Revenue</p><p className="text-3xl font-bold text-stone-900 mt-1">${totalRevenue.toFixed(2)}</p></div>
                        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm"><p className="text-sm text-stone-500 font-medium">Total Orders</p><p className="text-3xl font-bold text-stone-900 mt-1">{totalOrders}</p></div>
                        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm"><p className="text-sm text-stone-500 font-medium">Avg. Order Value</p><p className="text-3xl font-bold text-stone-900 mt-1">${avgOrderValue.toFixed(2)}</p></div>
                        <div className="bg-orange-50 p-5 rounded-xl border border-orange-200"><h3 className="font-bold text-orange-900">Low Stock Alerts</h3>{lowStockItems.length > 0 ? (<ul className="space-y-1 text-sm mt-2"><li key={lowStockItems[0].id} className="text-orange-800">{lowStockItems[0].name}: <span className="font-bold">{lowStockItems[0].inventory}</span> left</li>{lowStockItems.length > 1 && <li className="text-orange-700 font-medium">and {lowStockItems.length - 1} more...</li>}</ul>) : ( <p className="text-sm text-emerald-700 font-medium mt-2">All stock levels are healthy!</p> )}</div>
                    </div>

                    {/* Order Status Distribution & Payment Metrics */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
                            <h3 className="font-bold text-stone-900 mb-3">Orders by Status</h3>
                            <div className="space-y-2">
                                {ordersByStatus.map(({ status, label, count }) => {
                                    const pct = totalOrders > 0 ? (count / totalOrders) * 100 : 0;
                                    const colors: Record<string, string> = { processing: 'bg-blue-500', processed: 'bg-amber-500', picked: 'bg-indigo-500', packed: 'bg-purple-500', dispatched: 'bg-cyan-500', delivered: 'bg-emerald-500' };
                                    return (
                                        <div key={status} className="flex items-center gap-3">
                                            <span className="text-xs text-stone-500 w-20">{label}</span>
                                            <div className="flex-1 bg-stone-100 rounded-full h-2"><div className={`h-2 rounded-full ${colors[status]}`} style={{ width: `${pct}%` }} /></div>
                                            <span className="text-xs font-semibold text-stone-700 w-8 text-right">{count}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
                            <h3 className="font-bold text-stone-900 mb-3">Payment Collection</h3>
                            {(() => {
                                const totalInvoiced = invoices.reduce((s, i) => s + i.amount, 0);
                                const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
                                const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
                                const collectionRate = totalInvoiced > 0 ? (totalPaid / totalInvoiced) * 100 : 0;
                                return (
                                    <div className="space-y-3">
                                        <div>
                                            <div className="flex justify-between text-sm mb-1"><span className="text-stone-500">Collection Rate</span><span className="font-bold text-stone-900">{collectionRate.toFixed(0)}%</span></div>
                                            <div className="bg-stone-100 rounded-full h-3"><div className="h-3 rounded-full bg-emerald-500" style={{ width: `${collectionRate}%` }} /></div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            <div className="bg-emerald-50 rounded-lg p-2"><p className="text-xs text-emerald-600">Collected</p><p className="font-bold text-emerald-800">${totalPaid.toFixed(2)}</p></div>
                                            <div className="bg-red-50 rounded-lg p-2"><p className="text-xs text-red-600">Overdue</p><p className="font-bold text-red-800">${totalOverdue.toFixed(2)}</p></div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
                            <h3 className="font-bold text-stone-900 mb-3">Active Customers</h3>
                            {(() => {
                                const thirtyDaysAgo = Date.now() - 30 * 86400000;
                                const activeCustomers = new Set(allOrders.filter(o => new Date(o.orderDate).getTime() > thirtyDaysAgo).map(o => o.hoReCa.id));
                                return (
                                    <div className="text-center">
                                        <p className="text-4xl font-bold text-stone-900">{activeCustomers.size}</p>
                                        <p className="text-sm text-stone-500 mt-1">ordered in last 30 days</p>
                                        <p className="text-xs text-stone-400 mt-2">out of {hoReCas.length} total hoReCas</p>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                            <h3 className="font-bold text-stone-900 text-lg mb-4">Sales Trend</h3>
                            <SalesLineChart data={salesOverTimeData} />
                        </div>
                        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                            <TopPerformersList title="Top Sales Reps" data={topRepsData} />
                        </div>
                        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                            <HorizontalBarChart title="Top Selling Products" data={topProductsData} />
                        </div>
                        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                            <TopPerformersList title="Top HoReCa by Revenue" data={topHoReCaData} />
                        </div>
                         <div className="lg:col-span-3 bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                            <HorizontalBarChart title="Top Categories by Revenue" data={topCategoriesData} />
                        </div>
                    </div>
                </>
            ) : (
                 <div className="text-center p-12 bg-white rounded-xl border border-stone-200 shadow-sm">
                    <h3 className="text-xl font-semibold text-stone-800">No Orders Found</h3>
                    <p className="text-stone-500 mt-2">No orders match your current filter criteria. Try expanding the date range or resetting filters.</p>
                </div>
            )}

            {/* My Targets (Admin/Manager personal) */}
            {currentUser && onUpdateSalesTargets && (() => {
                const myTargets = salesTargets.filter(t => t.userId === currentUser.id);
                const formatDateShort = (dateStr: string) => {
                    const d = new Date(dateStr + 'T00:00:00');
                    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
                };

                const targetProgress = myTargets.map(target => {
                    // Attainment comes from the registry, which composes the same
                    // metrics this screen displays elsewhere. This block used to
                    // re-derive all three target types with its own window bound.
                    const { achieved, percent } = computeTargetProgress(
                        { ...target, userId: currentUser.id },
                        metricCtx,
                    );
                    const labelMap = { revenue: 'Revenue', orders: 'Orders', new_horecas: 'New HoReCa' } as const;
                    const iconMap = { revenue: DollarSign, orders: ShoppingBag, new_horecas: Users } as const;
                    const formatAchieved = target.type === 'revenue' ? `$${achieved.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : String(achieved);
                    const formatTargetVal = target.type === 'revenue' ? `$${target.targetValue.toLocaleString()}` : String(target.targetValue);

                    return { ...target, achieved, percent, label: labelMap[target.type], Icon: iconMap[target.type], formatAchieved, formatTarget: formatTargetVal };
                });

                return (
                    <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-6 mt-6">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600">
                                    <Target className="w-4.5 h-4.5" />
                                </div>
                                <h3 className="text-lg font-semibold text-stone-900">My Targets</h3>
                            </div>
                            <button
                                onClick={() => setShowTargetModal(true)}
                                className="text-sm font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer"
                            >
                                <Target className="w-4 h-4" />
                                {myTargets.length > 0 ? 'Edit Targets' : 'Set Targets'}
                            </button>
                        </div>

                        {targetProgress.length > 0 ? (
                            <div className="space-y-4">
                                {targetProgress.map(tp => {
                                    const barGradient = tp.percent >= 60
                                        ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                                        : tp.percent >= 30
                                            ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                                            : 'bg-gradient-to-r from-red-300 to-red-400';
                                    return (
                                        <div key={tp.id}>
                                            <div className="flex items-center justify-between mb-1.5">
                                                <div className="flex items-center gap-2">
                                                    <tp.Icon className="w-4 h-4 text-stone-400" />
                                                    <span className="text-sm font-medium text-stone-700">{tp.label}</span>
                                                    <span className="text-xs text-stone-400">{formatDateShort(tp.startDate)} – {formatDateShort(tp.endDate)}</span>
                                                </div>
                                                <span className="text-sm font-semibold text-stone-900">{tp.formatAchieved} <span className="text-stone-400 font-normal">/ {tp.formatTarget}</span></span>
                                            </div>
                                            <div className="w-full bg-stone-100 rounded-full h-5 overflow-hidden relative">
                                                <div className={`h-full rounded-full transition-all duration-700 ease-out ${barGradient}`} style={{ width: `${Math.max(tp.percent, 1)}%` }} />
                                                <span className={`absolute inset-0 flex items-center pl-3 text-xs font-bold ${tp.percent > 15 ? 'text-white' : 'text-stone-600'}`} style={tp.percent <= 15 ? { left: `${Math.max(tp.percent, 1)}%` } : undefined}>
                                                    {tp.percent.toFixed(0)}%
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-center py-4 text-stone-400 text-sm">
                                <p>No targets set. Click "Set Targets" to define your goals.</p>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Team Targets */}
            {salesTargets.length > 0 && (() => {
                const targetsByUser: Record<number, { user: User | undefined; targets: SalesTarget[] }> = {};
                salesTargets.forEach(t => {
                    if (!targetsByUser[t.userId]) {
                        targetsByUser[t.userId] = { user: users.find(u => u.id === t.userId), targets: [] };
                    }
                    targetsByUser[t.userId].targets.push(t);
                });

                const formatDateShort = (dateStr: string) => {
                    const d = new Date(dateStr + 'T00:00:00');
                    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
                };

                return (
                    <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-6 mt-6">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                                <Users className="w-4.5 h-4.5" />
                            </div>
                            <h3 className="text-lg font-semibold text-stone-900">Team Targets</h3>
                        </div>

                        <div className="space-y-6">
                            {Object.values(targetsByUser).map(({ user: teamUser, targets }) => {
                                if (!teamUser) return null;
                                return (
                                    <div key={teamUser.id} className="border border-stone-100 rounded-xl p-4 bg-stone-50/30">
                                        <div className="flex items-center gap-3 mb-3">
                                            {teamUser.avatarUrl ? (
                                                <OptimizedImage src={teamUser.avatarUrl} alt="" className="w-8 h-8 rounded-full" transformWidth={128} />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-stone-500 text-sm font-medium">
                                                    {teamUser.name.charAt(0)}
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-sm font-semibold text-stone-900">{teamUser.name}</p>
                                                <p className="text-xs text-stone-500">{teamUser.role}</p>
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            {targets.map(target => {
                                                // Same registry call as the personal-targets block above,
                                                // scoped to this team member instead of the viewer.
                                                const { achieved, percent } = computeTargetProgress(
                                                    { ...target, userId: teamUser.id },
                                                    metricCtx,
                                                );
                                                const labelMap = { revenue: 'Revenue', orders: 'Orders', new_horecas: 'New HoReCa' } as const;
                                                const iconMap = { revenue: DollarSign, orders: ShoppingBag, new_horecas: Users } as const;
                                                const Icon = iconMap[target.type];
                                                const formatAchieved = target.type === 'revenue' ? `$${achieved.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : String(achieved);
                                                const formatTargetVal = target.type === 'revenue' ? `$${target.targetValue.toLocaleString()}` : String(target.targetValue);
                                                const barGradient = percent >= 60
                                                    ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                                                    : percent >= 30
                                                        ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                                                        : 'bg-gradient-to-r from-red-300 to-red-400';

                                                return (
                                                    <div key={target.id}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <div className="flex items-center gap-2">
                                                                <Icon className="w-3.5 h-3.5 text-stone-400" />
                                                                <span className="text-xs font-medium text-stone-600">{labelMap[target.type]}</span>
                                                                <span className="text-[10px] text-stone-400">{formatDateShort(target.startDate)} – {formatDateShort(target.endDate)}</span>
                                                            </div>
                                                            <span className="text-xs font-semibold text-stone-700">{formatAchieved} / {formatTargetVal}</span>
                                                        </div>
                                                        <div className="w-full bg-stone-100 rounded-full h-3.5 overflow-hidden relative">
                                                            <div className={`h-full rounded-full transition-all duration-700 ease-out ${barGradient}`} style={{ width: `${Math.max(percent, 1)}%` }} />
                                                            <span className={`absolute inset-0 flex items-center pl-2 text-[10px] font-bold ${percent > 20 ? 'text-white' : 'text-stone-500'}`} style={percent <= 20 ? { left: `${Math.max(percent, 1)}%` } : undefined}>
                                                                {percent.toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {currentUser && onUpdateSalesTargets && (
                <SalesTargetModal
                    isOpen={showTargetModal}
                    onClose={() => setShowTargetModal(false)}
                    existingTargets={salesTargets}
                    userId={currentUser.id}
                    onSave={onUpdateSalesTargets}
                />
            )}
        </div>
    );
};

export default SalesDashboard;
// Re-export chart components from their new locations for backward compatibility
export { default as SalesLineChart } from './charts/SalesLineChart';
export { default as HorizontalBarChart } from './charts/HorizontalBarChart';