import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { Order, HoReCa, User, OrderStatus } from '../types';
import { UserRole } from '../types';
import StatusBadge from './StatusBadge';
import { ORDER_STATUS_SEQUENCE, ORDER_STATUS_LABELS } from '../constants';
import { downloadCsv } from '../lib/csvExport';
import {
  Search,
  Eye,
  RefreshCw,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrdersPageProps {
  orders: Order[];
  hoReCas: HoReCa[];
  currentUser: User;
  onReorder: (order: Order) => void;
  onBulkReorder?: (orders: Order[]) => void;
  onViewDetail: (orderId: string) => void;
  onUpdateStatus: (orderId: string, newStatus: OrderStatus, note?: string) => void;
  onBack: () => void;
}

type ActiveTab = 'received' | 'process' | 'confirmed';
type SortColumn = 'date' | 'total' | 'status' | 'horeca';
type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ITEMS_PER_PAGE = 20;

const TAB_STATUSES: Record<ActiveTab, OrderStatus[]> = {
  received: ['processing', 'confirmed'],
  process: ['packed', 'shipped'],
  confirmed: ['delivered'],
};

const TAB_LABELS: Record<ActiveTab, string> = {
  received: 'Received',
  process: 'Process',
  confirmed: 'Confirmed',
};

const ALL_TABS: ActiveTab[] = ['received', 'process', 'confirmed'];

const INPUT_CLASSES =
  'block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm transition-all hover:ring-stone-300';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNextStatus(order: Order): OrderStatus | null {
  const idx = ORDER_STATUS_SEQUENCE.indexOf(order.status);
  if (idx === -1 || idx === ORDER_STATUS_SEQUENCE.length - 1) return null;
  return ORDER_STATUS_SEQUENCE[idx + 1];
}

function canAdvanceStatus(user: User): boolean {
  return user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
}

const ORDERS_CSV_HEADERS = ['Order ID', 'HoReCa', 'Date', 'Status', 'Items', 'Total'];

function ordersToCsvRows(ordersToExport: Order[]): string[][] {
  return ordersToExport.map((o) => [
    o.id,
    o.hoReCa.name,
    new Date(o.orderDate).toLocaleDateString(),
    o.status,
    String(o.items.reduce((acc, i) => acc + i.quantity, 0)),
    o.total.toFixed(2),
  ]);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SortHeaderProps {
  column: SortColumn;
  label: string;
  align?: 'left' | 'right';
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (col: SortColumn) => void;
}

function SortHeader({ column, label, align = 'left', sortColumn, sortDirection, onSort }: SortHeaderProps) {
  const isActive = sortColumn === column;
  return (
    <th
      className={`px-4 py-3 font-semibold text-stone-600 cursor-pointer select-none hover:text-stone-900 transition-colors text-sm ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(column)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end w-full' : ''}`}>
        {label}
        {isActive ? (
          sortDirection === 'asc' ? (
            <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
          )
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 flex-shrink-0 opacity-30" />
        )}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const OrdersPage: React.FC<OrdersPageProps> = ({
  orders,
  hoReCas,
  currentUser,
  onReorder,
  onBulkReorder,
  onViewDetail,
  onUpdateStatus,
  onBack,
}) => {
  // Tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('received');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterHoReCaId, setFilterHoReCaId] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Sort
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Expandable rows
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const isAdminOrManager = canAdvanceStatus(currentUser);
  const isCustomer = currentUser.role === UserRole.CUSTOMER;

  // ---------------------------------------------------------------------------
  // Tab counts — unfiltered, show totals across all orders for each tab group
  // ---------------------------------------------------------------------------

  const tabCounts = useMemo<Record<ActiveTab, number>>(() => {
    return {
      received: orders.filter((o) => TAB_STATUSES.received.includes(o.status)).length,
      process: orders.filter((o) => TAB_STATUSES.process.includes(o.status)).length,
      confirmed: orders.filter((o) => TAB_STATUSES.confirmed.includes(o.status)).length,
    };
  }, [orders]);

  // ---------------------------------------------------------------------------
  // Orders for the active tab (pre-filter by status)
  // ---------------------------------------------------------------------------

  const tabOrders = useMemo(
    () => orders.filter((o) => TAB_STATUSES[activeTab].includes(o.status)),
    [orders, activeTab],
  );

  // ---------------------------------------------------------------------------
  // Apply search + filter within the active tab
  // ---------------------------------------------------------------------------

  const filteredOrders = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return tabOrders.filter((order) => {
      const searchMatch =
        !query ||
        order.id.toLowerCase().includes(query) ||
        order.hoReCa.name.toLowerCase().includes(query);

      const hoReCaMatch =
        filterHoReCaId === 'all' || order.hoReCa.id === parseInt(filterHoReCaId, 10);

      const orderDate = new Date(order.orderDate);
      const startMatch = !filterStartDate || orderDate >= new Date(filterStartDate);
      const endMatch =
        !filterEndDate ||
        orderDate <
          new Date(new Date(filterEndDate).setDate(new Date(filterEndDate).getDate() + 1));

      return searchMatch && hoReCaMatch && startMatch && endMatch;
    });
  }, [tabOrders, searchQuery, filterHoReCaId, filterStartDate, filterEndDate]);

  // ---------------------------------------------------------------------------
  // Sort
  // ---------------------------------------------------------------------------

  const sortedOrders = useMemo(() => {
    const copy = [...filteredOrders];
    copy.sort((a, b) => {
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
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredOrders, sortColumn, sortDirection]);

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / ITEMS_PER_PAGE));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedOrders.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedOrders, currentPage]);
  const showingStart = sortedOrders.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const showingEnd = Math.min(currentPage * ITEMS_PER_PAGE, sortedOrders.length);

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------

  const allPageIds = paginatedOrders.map((o) => o.id);
  const allPageSelected =
    allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const somePageSelected = allPageIds.some((id) => selectedIds.has(id));

  // ---------------------------------------------------------------------------
  // Reset page + selection on filter/tab change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [searchQuery, filterHoReCaId, filterStartDate, filterEndDate, activeTab]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSort = useCallback(
    (column: SortColumn) => {
      if (sortColumn === column) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(column);
        setSortDirection('asc');
      }
      setCurrentPage(1);
    },
    [sortColumn],
  );

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    setSearchQuery('');
    setFilterHoReCaId('all');
    setFilterStartDate('');
    setFilterEndDate('');
    setSortColumn('date');
    setSortDirection('desc');
    setExpandedIds(new Set());
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        allPageIds.forEach((id) => next.delete(id));
      } else {
        allPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [allPageIds, allPageSelected]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExportAll = useCallback(() => {
    downloadCsv(ORDERS_CSV_HEADERS, ordersToCsvRows(sortedOrders), `orders-${activeTab}-export.csv`);
  }, [sortedOrders, activeTab]);

  const handleExportSelected = useCallback(() => {
    const selected = sortedOrders.filter((o) => selectedIds.has(o.id));
    downloadCsv(ORDERS_CSV_HEADERS, ordersToCsvRows(selected), `orders-${activeTab}-selected-export.csv`);
  }, [sortedOrders, selectedIds, activeTab]);

  const handleBulkReorder = useCallback(() => {
    const selected = sortedOrders.filter((o) => selectedIds.has(o.id));
    if (onBulkReorder) {
      onBulkReorder(selected);
    } else if (selected.length > 0) {
      onReorder(selected[0]);
    }
    setSelectedIds(new Set());
  }, [sortedOrders, selectedIds, onBulkReorder, onReorder]);

  const handleAdvanceStatus = useCallback(
    (order: Order) => {
      const next = getNextStatus(order);
      if (next) {
        onUpdateStatus(order.id, next);
      }
    },
    [onUpdateStatus],
  );

  const resetFilters = useCallback(() => {
    setSearchQuery('');
    setFilterHoReCaId('all');
    setFilterStartDate('');
    setFilterEndDate('');
  }, []);

  const hasActiveFilters =
    searchQuery !== '' ||
    filterHoReCaId !== 'all' ||
    filterStartDate !== '' ||
    filterEndDate !== '';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6 font-sans">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900 tracking-tight">
          Orders
        </h1>
        {!isCustomer && (
          <button
            onClick={onBack}
            className="text-sm font-medium text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
          >
            &larr; Back
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-stone-200">
        <nav className="-mb-px flex gap-0" aria-label="Order workflow tabs">
          {ALL_TABS.map((tab) => {
            const isActive = activeTab === tab;
            const count = tabCounts[tab];
            return (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`
                  relative px-5 py-3 text-sm font-medium border-b-2 transition-colors duration-150 cursor-pointer whitespace-nowrap
                  ${isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300'}
                `}
                aria-selected={isActive}
                role="tab"
              >
                <span className="inline-flex items-center gap-2">
                  {TAB_LABELS[tab]}
                  <span
                    className={`inline-flex items-center justify-center rounded-full text-xs font-semibold px-2 py-0.5 min-w-[20px] tabular-nums
                      ${isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-stone-200 text-stone-600'}
                    `}
                  >
                    {count}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Filters */}
      <div className="bg-white p-5 rounded-xl border border-stone-200/60 shadow-sm">

        {/* Search */}
        <div className="mb-4 relative">
          <label htmlFor="orders-search" className="sr-only">
            Search by Order ID or HoReCa Name
          </label>
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            <Search className="h-4 w-4 text-stone-400" />
          </div>
          <input
            type="text"
            id="orders-search"
            className="block w-full rounded-lg border-0 bg-stone-50 py-3 pl-11 pr-4 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm transition-all hover:ring-stone-300"
            placeholder="Search by Order ID or HoReCa name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Filter row */}
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 ${
            !isCustomer ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
          } gap-4 items-end`}
        >
          {!isCustomer && (
            <div>
              <label
                htmlFor="horeca-filter"
                className="block text-xs font-medium text-stone-600 mb-1.5 uppercase tracking-wide"
              >
                HoReCa
              </label>
              <select
                id="horeca-filter"
                value={filterHoReCaId}
                onChange={(e) => setFilterHoReCaId(e.target.value)}
                className={INPUT_CLASSES}
              >
                <option value="all">All HoReCa</option>
                {hoReCas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor="start-date"
              className="block text-xs font-medium text-stone-600 mb-1.5 uppercase tracking-wide"
            >
              Start Date
            </label>
            <input
              type="date"
              id="start-date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className={INPUT_CLASSES}
            />
          </div>

          <div>
            <label
              htmlFor="end-date"
              className="block text-xs font-medium text-stone-600 mb-1.5 uppercase tracking-wide"
            >
              End Date
            </label>
            <input
              type="date"
              id="end-date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className={INPUT_CLASSES}
            />
          </div>

          <button
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className="w-full bg-white text-stone-700 border border-stone-300 rounded-lg py-2.5 px-4 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset Filters
          </button>

          <button
            onClick={handleExportAll}
            disabled={sortedOrders.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-white text-stone-700 border border-stone-300 rounded-lg py-2.5 px-4 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-stone-900 text-white rounded-xl p-4 flex items-center justify-between gap-4">
          <span className="text-sm font-medium">
            {selectedIds.size} order{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleExportSelected}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Selected
            </button>
            <button
              onClick={handleBulkReorder}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Bulk Reorder
            </button>
          </div>
        </div>
      )}

      {/* Table / Empty states */}
      {orders.length === 0 ? (
        <div className="text-center py-20 px-4 bg-white rounded-xl border border-stone-200/60 border-dashed shadow-sm">
          <h3 className="text-lg font-display font-semibold text-stone-800">No Orders Yet</h3>
          <p className="text-stone-500 mt-2 text-sm">
            Orders will appear here once they have been placed.
          </p>
        </div>
      ) : tabOrders.length === 0 ? (
        <div className="text-center py-20 px-4 bg-white rounded-xl border border-stone-200/60 border-dashed shadow-sm">
          <h3 className="text-lg font-display font-semibold text-stone-800">
            No {TAB_LABELS[activeTab]} Orders
          </h3>
          <p className="text-stone-500 mt-2 text-sm">
            There are no orders in the {TAB_LABELS[activeTab].toLowerCase()} stage at the moment.
          </p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-20 px-4 bg-white rounded-xl border border-stone-200/60 border-dashed shadow-sm">
          <h3 className="text-lg font-display font-semibold text-stone-800">No Orders Found</h3>
          <p className="text-stone-500 mt-2 text-sm">
            No orders match your current filter criteria.
          </p>
          <button
            onClick={resetFilters}
            className="mt-4 text-sm text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200/60 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[800px]">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50/70">
                  {/* Checkbox */}
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected && !allPageSelected;
                      }}
                      onChange={toggleSelectAll}
                      className="rounded border-stone-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                      aria-label="Select all on page"
                    />
                  </th>

                  {/* Order ID */}
                  <th className="px-4 py-3 font-semibold text-stone-600 text-sm whitespace-nowrap">
                    Order ID
                  </th>

                  {/* HoReCa sortable */}
                  <SortHeader
                    column="horeca"
                    label="HoReCa"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />

                  {/* Items count — static */}
                  <th className="px-4 py-3 font-semibold text-stone-600 text-sm text-right">
                    Items
                  </th>

                  {/* Total sortable */}
                  <SortHeader
                    column="total"
                    label="Total"
                    align="right"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />

                  {/* Status sortable */}
                  <SortHeader
                    column="status"
                    label="Status"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />

                  {/* Date sortable */}
                  <SortHeader
                    column="date"
                    label="Date"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />

                  {/* Actions */}
                  <th className="px-4 py-3 font-semibold text-stone-600 text-sm text-right whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-stone-100">
                {paginatedOrders.map((order) => {
                  const isSelected = selectedIds.has(order.id);
                  const isExpanded = expandedIds.has(order.id);
                  const nextStatus = getNextStatus(order);
                  const itemCount = order.items.reduce((acc, i) => acc + i.quantity, 0);

                  return (
                    <React.Fragment key={order.id}>
                      <tr
                        className={`transition-colors ${
                          isSelected
                            ? 'bg-blue-50/60'
                            : 'hover:bg-stone-50'
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-3 align-middle">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(order.id)}
                            className="rounded border-stone-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                            aria-label={`Select order ${order.id}`}
                          />
                        </td>

                        {/* Order ID — clicking expands */}
                        <td className="px-4 py-3 align-middle whitespace-nowrap">
                          <button
                            onClick={() => toggleExpand(order.id)}
                            className="font-mono text-xs font-semibold text-stone-900 hover:text-blue-700 transition-colors cursor-pointer inline-flex items-center gap-1"
                            title="Toggle order items"
                          >
                            {order.id}
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3 text-stone-400" />
                            ) : (
                              <ChevronDown className="w-3 h-3 text-stone-400" />
                            )}
                          </button>
                        </td>

                        {/* HoReCa */}
                        <td className="px-4 py-3 align-middle text-stone-700 max-w-[200px] truncate">
                          {order.hoReCa.name}
                        </td>

                        {/* Items count */}
                        <td className="px-4 py-3 align-middle text-right text-stone-500 tabular-nums">
                          {itemCount}
                        </td>

                        {/* Total */}
                        <td className="px-4 py-3 align-middle text-right font-semibold text-stone-900 tabular-nums whitespace-nowrap">
                          ${order.total.toFixed(2)}
                        </td>

                        {/* Status badge */}
                        <td className="px-4 py-3 align-middle whitespace-nowrap">
                          <StatusBadge status={order.status} />
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3 align-middle text-stone-500 whitespace-nowrap text-xs">
                          {new Date(order.orderDate).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1 justify-end">
                            {/* View detail */}
                            <button
                              onClick={() => onViewDetail(order.id)}
                              className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                              title="View Details"
                              aria-label={`View details for order ${order.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            {/* Advance status */}
                            {isAdminOrManager && nextStatus && (
                              <button
                                onClick={() => handleAdvanceStatus(order)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 hover:border-stone-400 transition-colors cursor-pointer whitespace-nowrap"
                                title={`Advance to ${ORDER_STATUS_LABELS[nextStatus]}`}
                                aria-label={`Mark order ${order.id} as ${ORDER_STATUS_LABELS[nextStatus]}`}
                              >
                                {ORDER_STATUS_LABELS[nextStatus]}
                              </button>
                            )}

                            {/* Reorder */}
                            <button
                              onClick={() => onReorder(order)}
                              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                              title="Reorder"
                              aria-label={`Reorder order ${order.id}`}
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded items row */}
                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 pb-4 pt-0 bg-stone-50/60 border-t-0"
                          >
                            <div className="ml-6 mt-2 rounded-lg border border-stone-200 bg-white overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-stone-100 bg-stone-50">
                                    <th className="px-3 py-2 text-left font-semibold text-stone-500 uppercase tracking-wide">
                                      Product
                                    </th>
                                    <th className="px-3 py-2 text-right font-semibold text-stone-500 uppercase tracking-wide">
                                      Qty
                                    </th>
                                    <th className="px-3 py-2 text-right font-semibold text-stone-500 uppercase tracking-wide">
                                      Unit Price
                                    </th>
                                    <th className="px-3 py-2 text-right font-semibold text-stone-500 uppercase tracking-wide">
                                      Subtotal
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                  {order.items.map((item, i) => (
                                    <tr key={`${item.id}-${i}`} className="hover:bg-stone-50/50">
                                      <td className="px-3 py-2 text-stone-700">{item.name}</td>
                                      <td className="px-3 py-2 text-right text-stone-500 tabular-nums">
                                        {item.quantity}
                                      </td>
                                      <td className="px-3 py-2 text-right text-stone-500 tabular-nums">
                                        ${item.price.toFixed(2)}
                                      </td>
                                      <td className="px-3 py-2 text-right font-medium text-stone-900 tabular-nums">
                                        ${(item.price * item.quantity).toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t border-stone-200 bg-stone-50">
                                    <td
                                      colSpan={3}
                                      className="px-3 py-2 text-right text-stone-600 font-semibold"
                                    >
                                      Order Total
                                    </td>
                                    <td className="px-3 py-2 text-right font-bold text-stone-900 tabular-nums">
                                      ${order.total.toFixed(2)}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="flex flex-wrap items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50/40 gap-3">
            <p className="text-sm text-stone-500">
              {sortedOrders.length === 0 ? (
                'No orders'
              ) : (
                <>
                  Showing{' '}
                  <span className="font-medium text-stone-700 tabular-nums">{showingStart}</span>
                  {' '}–{' '}
                  <span className="font-medium text-stone-700 tabular-nums">{showingEnd}</span>
                  {' '}of{' '}
                  <span className="font-medium text-stone-700 tabular-nums">
                    {sortedOrders.length}
                  </span>{' '}
                  orders
                </>
              )}
            </p>

            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg border border-stone-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="First page"
                aria-label="First page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Previous
              </button>

              <span className="text-sm text-stone-600 tabular-nums px-1">
                Page{' '}
                <span className="font-semibold text-stone-900">{currentPage}</span>
                {' '}of{' '}
                <span className="font-semibold text-stone-900">{totalPages}</span>
              </span>

              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Next
              </button>

              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg border border-stone-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Last page"
                aria-label="Last page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersPage;
