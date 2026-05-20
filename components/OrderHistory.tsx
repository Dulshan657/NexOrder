import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { Order, HoReCa, User, Invoice } from '../types';
import { UserRole } from '../types';
import StatusBadge from './StatusBadge';
import PaymentStatusBadge, {
  getPaymentDisplayState,
  getPaymentLabel,
  type PaymentDisplayState,
} from './PaymentStatusBadge';
import { RefreshCw, Eye, ChevronUp, ChevronDown, Copy, Check, Download } from 'lucide-react';
import { ORDER_STATUS_SEQUENCE } from '../constants';

type SortColumn = 'date' | 'total' | 'status' | 'horeca' | 'payment';
type PaymentFilterValue = 'all' | PaymentDisplayState;

// Sort priority: surface unpaid/late invoices ahead of paid ones in `asc` order.
const PAYMENT_SORT_RANK: Record<PaymentDisplayState, number> = {
  overdue: 0,
  pending: 1,
  not_invoiced: 2,
  paid: 3,
};

const PAYMENT_FILTER_OPTIONS: ReadonlyArray<{ value: PaymentFilterValue; label: string }> = [
  { value: 'all', label: 'All Payments' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'pending', label: 'Pending' },
  { value: 'not_invoiced', label: 'Not Invoiced' },
  { value: 'paid', label: 'Paid' },
];

interface OrderHistoryProps {
  orders: Order[];
  hoReCas: HoReCa[];
  invoices: Invoice[];
  currentUser: User;
  onReorder: (order: Order) => void;
  onBulkReorder?: (orders: Order[]) => void;
  onViewDetail: (orderId: string) => void;
  onBack: () => void;
}

const ITEMS_PER_PAGE = 20;

const OrderHistory: React.FC<OrderHistoryProps> = ({ orders, hoReCas, invoices, currentUser, onReorder, onBulkReorder, onViewDetail, onBack }) => {
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterHoReCaId, setFilterHoReCaId] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<PaymentFilterValue>('all');

  // Lookup: orderId → invoice
  const invoicesByOrderId = useMemo(() => {
    const map = new Map<string, Invoice>();
    for (const inv of invoices ?? []) map.set(inv.orderId, inv);
    return map;
  }, [invoices]);

  // Sort
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Inline expand
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Reset page + selection when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [searchQuery, filterHoReCaId, filterStartDate, filterEndDate, filterPaymentStatus]);

  const displayedHoReCa = useMemo(() => {
    if (currentUser.role === UserRole.CUSTOMER && currentUser.hoReCaId) {
      return hoReCas.find(c => c.id === currentUser.hoReCaId);
    } else if (filterHoReCaId !== 'all') {
      return hoReCas.find(c => c.id === parseInt(filterHoReCaId, 10));
    }
    return null;
  }, [currentUser, filterHoReCaId, hoReCas]);

  const filteredOrders = useMemo(() => {
    const lowercasedQuery = searchQuery.toLowerCase().trim();
    return orders.filter(order => {
      const searchMatch = !lowercasedQuery ||
        order.id.toLowerCase().includes(lowercasedQuery) ||
        order.hoReCa.name.toLowerCase().includes(lowercasedQuery);
      const orderDate = new Date(order.orderDate);
      const hoReCaMatch = filterHoReCaId === 'all' || order.hoReCa.id === parseInt(filterHoReCaId, 10);
      const startDateMatch = !filterStartDate || orderDate >= new Date(filterStartDate);
      const endDateMatch = !filterEndDate || orderDate < new Date(new Date(filterEndDate).setDate(new Date(filterEndDate).getDate() + 1));
      const paymentMatch = filterPaymentStatus === 'all'
        || getPaymentDisplayState(invoicesByOrderId.get(order.id)) === filterPaymentStatus;
      return searchMatch && hoReCaMatch && startDateMatch && endDateMatch && paymentMatch;
    });
  }, [orders, searchQuery, filterHoReCaId, filterStartDate, filterEndDate, filterPaymentStatus, invoicesByOrderId]);

  const sortedOrders = useMemo(() => {
    const sorted = [...filteredOrders];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'date':
          cmp = new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime();
          break;
        case 'total':
          cmp = a.total - b.total;
          break;
        case 'status':
          cmp = ORDER_STATUS_SEQUENCE.indexOf(a.status) - ORDER_STATUS_SEQUENCE.indexOf(b.status);
          break;
        case 'horeca':
          cmp = a.hoReCa.name.localeCompare(b.hoReCa.name);
          break;
        case 'payment': {
          const sa = PAYMENT_SORT_RANK[getPaymentDisplayState(invoicesByOrderId.get(a.id))];
          const sb = PAYMENT_SORT_RANK[getPaymentDisplayState(invoicesByOrderId.get(b.id))];
          cmp = sa - sb;
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredOrders, sortColumn, sortDirection, invoicesByOrderId]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / ITEMS_PER_PAGE));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedOrders.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedOrders, currentPage]);
  const showingStart = sortedOrders.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const showingEnd = Math.min(currentPage * ITEMS_PER_PAGE, sortedOrders.length);

  // Selection helpers
  const allPageIds = paginatedOrders.map(o => o.id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every(id => selectedIds.has(id));
  const somePageSelected = allPageIds.some(id => selectedIds.has(id));

  // Handlers
  const handleSort = useCallback((column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  }, [sortColumn]);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allPageSelected) {
        allPageIds.forEach(id => next.delete(id));
      } else {
        allPageIds.forEach(id => next.add(id));
      }
      return next;
    });
  }, [allPageIds, allPageSelected]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCopyId = useCallback(async (orderId: string) => {
    await navigator.clipboard.writeText(orderId);
    setCopiedId(orderId);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const generateCsv = useCallback((ordersToExport: Order[]): string => {
    const headers = ['Order ID', 'HoReCa', 'Date', 'Status', 'Payment', 'Total', 'Items'];
    const rows = ordersToExport.map(o => [
      o.id,
      o.hoReCa.name,
      new Date(o.orderDate).toLocaleDateString(),
      o.status,
      getPaymentLabel(invoicesByOrderId.get(o.id), true),
      o.total.toFixed(2),
      o.items.map(i => `${i.name} x${i.quantity}`).join('; '),
    ]);
    const escape = (val: string) => `"${val.replace(/"/g, '""')}"`;
    return [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
  }, [invoicesByOrderId]);

  const downloadCsv = useCallback((ordersToExport: Order[], filename: string) => {
    const csv = generateCsv(ordersToExport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [generateCsv]);

  const handleExportAll = useCallback(() => {
    downloadCsv(sortedOrders, 'orders-export.csv');
  }, [sortedOrders, downloadCsv]);

  const handleExportSelected = useCallback(() => {
    const selected = sortedOrders.filter(o => selectedIds.has(o.id));
    downloadCsv(selected, 'orders-selected-export.csv');
  }, [sortedOrders, selectedIds, downloadCsv]);

  const handleBulkReorder = useCallback(() => {
    const selected = sortedOrders.filter(o => selectedIds.has(o.id));
    if (onBulkReorder) {
      onBulkReorder(selected);
    } else if (selected.length > 0) {
      onReorder(selected[0]);
    }
    setSelectedIds(new Set());
  }, [sortedOrders, selectedIds, onBulkReorder, onReorder]);

  const resetFilters = () => {
    setSearchQuery('');
    setFilterHoReCaId('all');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterPaymentStatus('all');
  };

  const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

  const SortHeader: React.FC<{ column: SortColumn; label: string; align?: 'left' | 'right' }> = ({ column, label, align = 'left' }) => (
    <th
      className={`px-4 py-3 font-semibold text-stone-600 cursor-pointer select-none hover:text-stone-900 transition-colors ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => handleSort(column)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {sortColumn === column ? (
          sortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 opacity-0" />
        )}
      </span>
    </th>
  );

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Order History</h1>
        {currentUser.role !== UserRole.FIELD_REP && currentUser.role !== UserRole.OFFICE_REP && (
          <button onClick={onBack} className="text-sm font-medium text-stone-500 hover:text-stone-900 transition-colors cursor-pointer">
            &larr; Back
          </button>
        )}
      </div>

      {displayedHoReCa && displayedHoReCa.creditLimit !== undefined && (
        <div className="bg-white p-5 rounded-xl border border-stone-200/60 shadow-card mb-8 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-display font-semibold text-stone-900">Available Credit</h3>
            <p className="text-sm text-stone-500">{displayedHoReCa.name}</p>
          </div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums">
            ${displayedHoReCa.creditLimit.toFixed(2)}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-5 rounded-xl border border-stone-200/60 shadow-card mb-6">
        <div className="mb-5 relative">
          <label htmlFor="order-search" className="sr-only">Search by Order ID or HoReCa Name</label>
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-stone-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            id="order-search"
            className="block w-full rounded-lg border-0 bg-stone-50 py-3 pl-11 pr-4 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300"
            placeholder="Search by Order ID or HoReCa Name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${currentUser.role === UserRole.CUSTOMER ? 'lg:grid-cols-5' : 'lg:grid-cols-6'} gap-5 items-end`}>
          {currentUser.role !== UserRole.CUSTOMER && (
            <div>
              <label htmlFor="customer-filter" className="block text-sm font-medium text-stone-700 mb-1.5">Filter by HoReCa</label>
              <select id="customer-filter" value={filterHoReCaId} onChange={e => setFilterHoReCaId(e.target.value)} className={inputClasses}>
                <option value="all">All HoReCa</option>
                {hoReCas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="payment-filter" className="block text-sm font-medium text-stone-700 mb-1.5">Payment</label>
            <select
              id="payment-filter"
              value={filterPaymentStatus}
              onChange={e => setFilterPaymentStatus(e.target.value as PaymentFilterValue)}
              className={inputClasses}
            >
              {PAYMENT_FILTER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="start-date" className="block text-sm font-medium text-stone-700 mb-1.5">Start Date</label>
            <input type="date" id="start-date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className={inputClasses} />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-sm font-medium text-stone-700 mb-1.5">End Date</label>
            <input type="date" id="end-date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className={inputClasses} />
          </div>
          <button onClick={resetFilters} className="w-full bg-white text-stone-700 border border-stone-300 rounded-lg py-2.5 px-4 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 btn-press shadow-card cursor-pointer">
            Reset Filters
          </button>
          <button onClick={handleExportAll} disabled={sortedOrders.length === 0} className="w-full flex items-center justify-center gap-2 bg-white text-stone-700 border border-stone-300 rounded-lg py-2.5 px-4 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 btn-press shadow-card cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-stone-900 text-white rounded-xl p-4 mb-4 flex items-center justify-between">
          <span className="text-sm font-medium">{selectedIds.size} order{selectedIds.size > 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-3">
            <button onClick={handleExportSelected} className="text-sm font-medium px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer btn-press">
              Export Selected
            </button>
            <button onClick={handleBulkReorder} className="text-sm font-medium px-3 py-1.5 rounded-lg bg-nexgen-blue hover:bg-nexgen-blue-dark transition-colors cursor-pointer btn-press">
              Reorder Selected
            </button>
          </div>
        </div>
      )}

      {/* Table / Empty states */}
      {orders.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-xl shadow-card border border-stone-200/60 border-dashed">
          <h3 className="text-xl font-display font-semibold text-stone-800">No Orders Placed Yet</h3>
          <p className="text-stone-500 mt-2">Your submitted orders will appear here.</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-xl shadow-card border border-stone-200/60 border-dashed">
          <h3 className="text-xl font-display font-semibold text-stone-800">No Orders Found</h3>
          <p className="text-stone-500 mt-2">No orders match your current filter criteria.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200/60 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[860px]">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50/50">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                      onChange={toggleSelectAll}
                      className="rounded border-stone-300 text-nexgen-blue focus:ring-nexgen-blue cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold text-stone-600 whitespace-nowrap">Order ID</th>
                  <SortHeader column="horeca" label="HoReCa" />
                  <SortHeader column="date" label="Date" />
                  <SortHeader column="status" label="Status" />
                  <SortHeader column="payment" label="Payment" />
                  <SortHeader column="total" label="Total" align="right" />
                  <th className="px-4 py-3 font-semibold text-stone-600 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedOrders.map(order => (
                  <React.Fragment key={order.id}>
                    <tr className={`hover:bg-stone-50/50 transition-colors ${selectedIds.has(order.id) ? 'bg-nexgen-blue/5' : ''}`}>
                      <td className="px-4 py-3 align-middle">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(order.id)}
                          onChange={() => toggleSelect(order.id)}
                          className="rounded border-stone-300 text-nexgen-blue focus:ring-nexgen-blue cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 align-middle whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-medium text-stone-900">{order.id}</span>
                          <button onClick={() => handleCopyId(order.id)} className="text-stone-400 hover:text-stone-600 transition-colors cursor-pointer" title="Copy Order ID">
                            {copiedId === order.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle text-stone-700">{order.hoReCa.name}</td>
                      <td className="px-4 py-3 align-middle text-stone-500 whitespace-nowrap">{new Date(order.orderDate).toLocaleDateString()}</td>
                      <td className="px-4 py-3 align-middle whitespace-nowrap"><StatusBadge status={order.status} /></td>
                      <td className="px-4 py-3 align-middle whitespace-nowrap">
                        <PaymentStatusBadge invoice={invoicesByOrderId.get(order.id)} compact />
                      </td>
                      <td className="px-4 py-3 align-middle text-right font-semibold text-stone-900 tabular-nums whitespace-nowrap">${order.total.toFixed(2)}</td>
                      <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => onViewDetail(order.id)} className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer" title="View Details">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => toggleExpand(order.id)} className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer" title="Toggle Items">
                            {expandedIds.has(order.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                          <button onClick={() => onReorder(order)} className="p-1.5 text-nexgen-blue hover:text-nexgen-blue-dark hover:bg-nexgen-blue-light rounded-lg transition-colors cursor-pointer" title="Reorder">
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedIds.has(order.id) && (
                      <tr>
                        <td colSpan={8} className="px-4 py-3 bg-stone-50/50">
                          <ul className="divide-y divide-stone-100 max-w-2xl">
                            {order.items.map((item, i) => (
                              <li key={`${item.id}-${i}`} className="flex justify-between py-2 text-sm">
                                <span>{item.name} <span className="text-stone-400 ml-1">x {item.quantity}</span></span>
                                <span className="text-stone-600 tabular-nums">${(item.price * item.quantity).toFixed(2)}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50/30">
            <p className="text-sm text-stone-500">
              Showing {showingStart}&#8211;{showingEnd} of {sortedOrders.length} orders
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => p - 1)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed btn-press cursor-pointer"
              >
                Previous
              </button>
              <span className="text-sm text-stone-600 tabular-nums">Page {currentPage} of {totalPages}</span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed btn-press cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderHistory;
