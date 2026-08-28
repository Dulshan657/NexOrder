import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Order, HoReCa, User, OrderStatus, Invoice, InvoiceStatus } from '../types';
import { UserRole } from '../types';
import StatusBadge from './StatusBadge';
import PaymentStatusBadge, {
  getPaymentDisplayState,
  getPaymentLabel,
  type PaymentDisplayState,
} from './PaymentStatusBadge';
import PaymentActionModal from './PaymentActionModal';
import OrderSourceBadge from './OrderSourceBadge';
import { getOrderSource, getInboundApproval, type OrderSourceKey } from '../lib/orderSource';
import { getDemoPersona } from '../lib/demoAccounts';
import StockAssignmentModal from './StockAssignmentModal';
import { useUpdateInvoiceStatus } from '../hooks/queries/useInvoices';
import { useGeneratePickSlip, useGenerateDispatchAdvice } from '../hooks/queries/usePickQueue';
import { useOrderDocuments, useOrderDocumentUrl } from '../hooks/queries/useOrderDocuments';
import type { OrderDocumentView } from '../services/supabase/orderDocumentService';
import { useDocumentViewer } from '../context/DocumentViewerContext';
import type { OrderDocumentType } from '../types';
import { useToasts } from '../hooks/useToasts';
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
  MoreVertical,
  Sparkles,
  FileText,
  ExternalLink,
  Truck,
} from 'lucide-react';
import { SortableHeader } from './ui/SortableHeader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderImportPageProps {
  orders: Order[];
  hoReCas: HoReCa[];
  invoices: Invoice[];
  currentUser: User;
  onReorder: (order: Order) => void;
  onBulkReorder?: (orders: Order[]) => void;
  onViewDetail: (orderId: string) => void;
  onUpdateStatus: (orderId: string, newStatus: OrderStatus, note?: string, opts?: { locationId?: number; locationPref?: number[] }) => void;
  onBack: () => void;
  /** Order id to scroll into view and flash with a brief emerald ring. */
  highlightOrderId?: string | null;
  onClearHighlightOrderId?: () => void;
}

type ActiveTab = 'received' | 'inProgress' | 'completed';
type SortColumn = 'date' | 'total' | 'status' | 'horeca' | 'payment';
type SortDirection = 'asc' | 'desc';
type PaymentFilterValue = 'all' | PaymentDisplayState;
type SourceFilterValue = 'all' | OrderSourceKey;

const SOURCE_FILTER_OPTIONS: ReadonlyArray<{ value: SourceFilterValue; label: string }> = [
  { value: 'all', label: 'All Sources' },
  { value: 'email_inbound', label: 'Email PO' },
  { value: 'customer_web', label: 'Customer Web' },
  { value: 'rep_field', label: 'Field Rep' },
  { value: 'rep_office', label: 'Office Rep' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
];

const PAYMENT_SORT_RANK: Record<PaymentDisplayState, number> = {
  overdue: 0,
  pending: 1,
  not_invoiced: 2,
  paid: 3,
  // Last: a cancelled invoice is owed by nobody, so it never competes for
  // attention with one that is merely unpaid.
  cancelled: 4,
};

const PAYMENT_FILTER_OPTIONS: ReadonlyArray<{ value: PaymentFilterValue; label: string }> = [
  { value: 'all', label: 'All Payments' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'pending', label: 'Pending' },
  { value: 'not_invoiced', label: 'Not Invoiced' },
  { value: 'paid', label: 'Paid' },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ITEMS_PER_PAGE = 20;

const TAB_STATUSES: Record<ActiveTab, OrderStatus[]> = {
  received: ['processing'],
  inProgress: ['processed', 'picked', 'packed'],
  // Cancelled sits with Completed, never with In Progress: the tab name is a
  // claim about whether anyone still owes work on the order, and nobody does.
  completed: ['dispatched', 'delivered', 'cancelled'],
};

const TAB_LABELS: Record<ActiveTab, string> = {
  received: 'Received',
  inProgress: 'In Progress',
  completed: 'Completed',
};

const ALL_TABS: ActiveTab[] = ['received', 'inProgress', 'completed'];

const INPUT_CLASSES =
  'block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-500 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm transition-all hover:ring-stone-300';

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

const ordersCsvHeaders = (customerLabel: string): string[] =>
  ['Order ID', customerLabel, 'Date', 'Status', 'Payment', 'Items', 'Total'];

function ordersToCsvRows(
  ordersToExport: Order[],
  invoicesByOrderId: Map<string, Invoice>,
): string[][] {
  return ordersToExport.map((o) => [
    o.id,
    o.hoReCa.name,
    new Date(o.orderDate).toLocaleDateString(),
    o.status,
    getPaymentLabel(invoicesByOrderId.get(o.id), true),
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
  // Delegates to the shared primitive: a real <button> for the click and focus,
  // `aria-sort` on the <th> for the state.
  return (
    <SortableHeader
      column={column}
      label={label}
      align={align}
      activeColumn={sortColumn}
      direction={sortDirection}
      onSort={(c) => onSort(c as SortColumn)}
      className={`px-4 py-3 font-semibold text-stone-600 text-sm ${align === 'right' ? 'text-right' : ''}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const OrderImportPage: React.FC<OrderImportPageProps> = ({
  orders,
  hoReCas,
  invoices,
  currentUser,
  onReorder,
  onBulkReorder,
  onViewDetail,
  onUpdateStatus,
  onBack,
  highlightOrderId = null,
  onClearHighlightOrderId,
}) => {
  // Demo persona: relabel "HoReCa" → the client's word and hide pre-seeded orders.
  const demoPersona = getDemoPersona(currentUser);
  const customerLabel = demoPersona?.customerLabelSingular ?? 'HoReCa';
  const customerLabelPlural = demoPersona?.customerLabelPlural ?? 'HoReCa';

  // Tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('received');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterHoReCaId, setFilterHoReCaId] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<PaymentFilterValue>('all');
  const [filterSource, setFilterSource] = useState<SourceFilterValue>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Sort
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Expandable rows
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Payment-action menu (admin/manager only): which row's dropdown is open.
  const [paymentMenuOrderId, setPaymentMenuOrderId] = useState<string | null>(null);
  const [paymentAction, setPaymentAction] = useState<{ orderId: string; targetStatus: InvoiceStatus } | null>(null);
  const [paymentError, setPaymentError] = useState<string | undefined>(undefined);

  // Stock-assignment modal: which Receiving order is staff currently processing.
  const [processingOrder, setProcessingOrder] = useState<Order | null>(null);

  const isAdminOrManager = canAdvanceStatus(currentUser);
  const isCustomer = currentUser.role === UserRole.CUSTOMER;
  const isManager = currentUser.role === UserRole.MANAGER;

  const updateInvoiceStatus = useUpdateInvoiceStatus();
  const { addToast } = useToasts();
  const generatePickSlip = useGeneratePickSlip();
  const generateDispatchAdvice = useGenerateDispatchAdvice();

  // Generated pick slips / dispatch advices, fetched ONCE for the page (ops
  // only — gated so reps/customers never fire an RLS-rejected query) and grouped
  // by order id so each expanded row can show its documents without a per-row hook.
  const orderDocuments = useOrderDocuments(undefined, isAdminOrManager);
  const getDocUrl = useOrderDocumentUrl();
  const { previewDocument } = useDocumentViewer();
  const docsByOrder = useMemo(() => {
    const map = new Map<string, OrderDocumentView[]>();
    for (const d of orderDocuments.data ?? []) {
      const arr = map.get(d.doc.orderId) ?? [];
      arr.push(d);
      map.set(d.doc.orderId, arr);
    }
    return map;
  }, [orderDocuments.data]);

  const openOrderDoc = (id: number, orderId: string, docType: OrderDocumentType) => {
    const label = docType === 'dispatch_advice' ? 'Dispatch advice' : 'Pick slip';
    previewDocument(() => getDocUrl.mutateAsync(id), `${orderId} · ${label}`, `${orderId}-${docType}.pdf`);
  };

  // Recovery for dispatched orders that have no dispatch advice (dispatched
  // before auto-generation existed, or a failed auto-gen). The hook invalidates
  // the documents query on success so the new doc appears without a refresh.
  const handleGenerateDispatchAdvice = (orderId: string) => {
    generateDispatchAdvice.mutate(orderId, {
      onSuccess: () => addToast('Dispatch advice generated', 'success'),
      onError: (err) => addToast(err instanceof Error ? err.message : 'Failed to generate dispatch advice', 'error'),
    });
  };

  // orderId → Invoice lookup
  const invoicesByOrderId = useMemo(() => {
    const map = new Map<string, Invoice>();
    for (const inv of invoices ?? []) map.set(inv.orderId, inv);
    return map;
  }, [invoices]);

  // Dismiss the payment dropdown on outside click / escape
  const tableRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!paymentMenuOrderId) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && tableRef.current && !tableRef.current.contains(target)) {
        setPaymentMenuOrderId(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPaymentMenuOrderId(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [paymentMenuOrderId]);

  // ---------------------------------------------------------------------------
  // Visible orders — for a demo persona, hide pre-seeded orders (placed on/before
  // the cutoff) so the screen starts clean; live-approved POs (later orderDate) show.
  // ---------------------------------------------------------------------------

  const visibleOrders = useMemo(() => {
    if (!demoPersona) return orders;
    return orders.filter((o) => o.orderDate > demoPersona.orderImportCutoffIso);
  }, [orders, demoPersona]);

  // ---------------------------------------------------------------------------
  // Tab counts — unfiltered, show totals across all orders for each tab group
  // ---------------------------------------------------------------------------

  const tabCounts = useMemo<Record<ActiveTab, number>>(() => {
    return ALL_TABS.reduce((acc, tab) => {
      acc[tab] = visibleOrders.filter((o) => TAB_STATUSES[tab].includes(o.status)).length;
      return acc;
    }, {} as Record<ActiveTab, number>);
  }, [visibleOrders]);

  // ---------------------------------------------------------------------------
  // Orders for the active tab (pre-filter by status)
  // ---------------------------------------------------------------------------

  const tabOrders = useMemo(
    () => visibleOrders.filter((o) => TAB_STATUSES[activeTab].includes(o.status)),
    [visibleOrders, activeTab],
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

      const paymentMatch =
        filterPaymentStatus === 'all' ||
        getPaymentDisplayState(invoicesByOrderId.get(order.id)) === filterPaymentStatus;

      const sourceMatch =
        filterSource === 'all' || getOrderSource(order).key === filterSource;

      return searchMatch && hoReCaMatch && startMatch && endMatch && paymentMatch && sourceMatch;
    });
  }, [tabOrders, searchQuery, filterHoReCaId, filterStartDate, filterEndDate, filterPaymentStatus, filterSource, invoicesByOrderId]);

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
        case 'payment': {
          const sa = PAYMENT_SORT_RANK[getPaymentDisplayState(invoicesByOrderId.get(a.id))];
          const sb = PAYMENT_SORT_RANK[getPaymentDisplayState(invoicesByOrderId.get(b.id))];
          cmp = sa - sb;
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredOrders, sortColumn, sortDirection, invoicesByOrderId]);

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
  }, [searchQuery, filterHoReCaId, filterStartDate, filterEndDate, filterPaymentStatus, filterSource, activeTab]);

  // Highlight + scroll-into-view the deep-linked order, then auto-clear.
  // Auto-clear after 3s matches the visual fade duration of the emerald ring.
  const highlightTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!highlightOrderId) return;
    const row = document.getElementById(`order-row-${highlightOrderId}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      onClearHighlightOrderId?.();
    }, 3000);
    return () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, [highlightOrderId, onClearHighlightOrderId]);

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
    setFilterSource('all');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterPaymentStatus('all');
    setSortColumn('date');
    setSortDirection('desc');
    setExpandedIds(new Set());
    setPaymentMenuOrderId(null);
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
    downloadCsv(ordersCsvHeaders(customerLabel), ordersToCsvRows(sortedOrders, invoicesByOrderId), `orders-${activeTab}-export.csv`);
  }, [sortedOrders, activeTab, invoicesByOrderId, customerLabel]);

  const handleExportSelected = useCallback(() => {
    const selected = sortedOrders.filter((o) => selectedIds.has(o.id));
    downloadCsv(ordersCsvHeaders(customerLabel), ordersToCsvRows(selected, invoicesByOrderId), `orders-${activeTab}-selected-export.csv`);
  }, [sortedOrders, selectedIds, activeTab, invoicesByOrderId, customerLabel]);

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
    setFilterPaymentStatus('all');
    setFilterSource('all');
  }, []);

  // Active filters living in the collapsible "advanced" tray (everything except
  // the always-visible search box).
  const activeAdvancedFilterCount =
    (filterHoReCaId !== 'all' ? 1 : 0) +
    (filterStartDate !== '' ? 1 : 0) +
    (filterEndDate !== '' ? 1 : 0) +
    (filterSource !== 'all' ? 1 : 0) +
    (filterPaymentStatus !== 'all' ? 1 : 0);

  const hasActiveFilters = searchQuery !== '' || activeAdvancedFilterCount > 0;

  // ---------------------------------------------------------------------------
  // Payment-status mutation handlers
  // ---------------------------------------------------------------------------

  const openPaymentAction = useCallback((orderId: string, targetStatus: InvoiceStatus) => {
    // Diagnostic — remove once payment-modal flow is confirmed working live.
    console.debug('[payment-action] open (OrderImportPage)', orderId, targetStatus);
    setPaymentMenuOrderId(null);
    setPaymentError(undefined);
    setPaymentAction({ orderId, targetStatus });
  }, []);

  const closePaymentAction = useCallback(() => {
    setPaymentAction(null);
    setPaymentError(undefined);
  }, []);

  const submitPaymentAction = useCallback((reason?: string) => {
    if (!paymentAction) return;
    setPaymentError(undefined);
    updateInvoiceStatus.mutate(
      { orderId: paymentAction.orderId, status: paymentAction.targetStatus, reason },
      {
        onSuccess: () => {
          addToast(`Order ${paymentAction.orderId} marked as ${paymentAction.targetStatus}`, 'success');
          closePaymentAction();
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : 'Failed to update payment status';
          setPaymentError(msg);
        },
      },
    );
  }, [paymentAction, updateInvoiceStatus, addToast, closePaymentAction]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6 font-sans">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900 tracking-tight">
          Order Import
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
        <nav className="-mb-px flex justify-center gap-0" aria-label="Order workflow tabs">
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
      <div className="bg-white rounded-xl border border-stone-200/60 shadow-card overflow-hidden">

        {/* Zone 1 — command bar: search + result count + actions */}
        <div className="p-5 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1">
            <label htmlFor="orders-search" className="sr-only">
              {`Search by Order ID or ${customerLabel} Name`}
            </label>
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <Search className="h-4 w-4 text-stone-500" />
            </div>
            <input
              type="text"
              id="orders-search"
              className="block w-full rounded-lg border-0 bg-stone-50 py-3 pl-11 pr-4 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-500 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm transition-all hover:ring-stone-300"
              placeholder={`Search by Order ID or ${customerLabel.toLowerCase()} name...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              aria-expanded={showAdvancedFilters}
              aria-controls="orders-advanced-filters"
              className="flex-1 lg:flex-none lg:w-32 whitespace-nowrap flex items-center justify-center gap-1.5 bg-white text-stone-700 border border-stone-300 rounded-lg py-2 px-3 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors cursor-pointer btn-press"
            >
              Filters
              {activeAdvancedFilterCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold">
                  {activeAdvancedFilterCount}
                </span>
              )}
              {showAdvancedFilters ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={resetFilters}
              disabled={!hasActiveFilters}
              className="flex-1 lg:flex-none lg:w-32 whitespace-nowrap flex items-center justify-center bg-white text-stone-700 border border-stone-300 rounded-lg py-2 px-3 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed btn-press"
            >
              Reset
            </button>

            <button
              onClick={handleExportAll}
              disabled={sortedOrders.length === 0}
              className="flex-1 lg:flex-none lg:w-32 whitespace-nowrap flex items-center justify-center gap-1.5 bg-white text-stone-700 border border-stone-300 rounded-lg py-2 px-3 text-sm font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed btn-press"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Zone 2 — filter tray (collapsible advanced filters) */}
        {showAdvancedFilters && (
        <div id="orders-advanced-filters" className="border-t border-stone-200/60 bg-stone-50/40 px-5 py-4">
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
                  {customerLabel}
                </label>
                <select
                  id="horeca-filter"
                  value={filterHoReCaId}
                  onChange={(e) => setFilterHoReCaId(e.target.value)}
                  className={INPUT_CLASSES}
                >
                  <option value="all">{`All ${customerLabelPlural}`}</option>
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
                htmlFor="payment-filter"
                className="block text-xs font-medium text-stone-600 mb-1.5 uppercase tracking-wide"
              >
                Payment
              </label>
              <select
                id="payment-filter"
                value={filterPaymentStatus}
                onChange={(e) => setFilterPaymentStatus(e.target.value as PaymentFilterValue)}
                className={INPUT_CLASSES}
              >
                {PAYMENT_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="source-filter"
                className="block text-xs font-medium text-stone-600 mb-1.5 uppercase tracking-wide"
              >
                Source
              </label>
              <select
                id="source-filter"
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as SourceFilterValue)}
                className={INPUT_CLASSES}
              >
                {SOURCE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

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
          </div>
        </div>
        )}
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
      {visibleOrders.length === 0 ? (
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
        <div ref={tableRef} className="bg-white rounded-xl border border-stone-200/60 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[960px]">
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
                    label={customerLabel}
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

                  {/* Payment sortable */}
                  <SortHeader
                    column="payment"
                    label="Payment"
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

                  const isHighlighted = highlightOrderId === order.id;
                  return (
                    <React.Fragment key={order.id}>
                      <tr
                        id={`order-row-${order.id}`}
                        className={`transition-colors ${
                          isHighlighted
                            ? 'bg-emerald-50 ring-2 ring-emerald-400/70 ring-inset animate-pulse'
                            : isSelected
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
                              <ChevronUp className="w-3 h-3 text-stone-500" />
                            ) : (
                              <ChevronDown className="w-3 h-3 text-stone-500" />
                            )}
                          </button>
                        </td>

                        {/* HoReCa */}
                        <td className="px-4 py-3 align-middle text-stone-700 max-w-[220px]">
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="truncate">{order.hoReCa.name}</span>
                            <OrderSourceBadge order={order} />
                          </div>
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

                        {/* Payment status */}
                        <td className="px-4 py-3 align-middle whitespace-nowrap">
                          {isAdminOrManager ? (
                            <div className="relative inline-block">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPaymentMenuOrderId((prev) => (prev === order.id ? null : order.id));
                                }}
                                className="inline-flex items-center gap-1 rounded-full hover:ring-2 hover:ring-stone-200 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all cursor-pointer"
                                aria-haspopup="menu"
                                aria-expanded={paymentMenuOrderId === order.id}
                                aria-label={`Change payment status for order ${order.id}`}
                              >
                                <PaymentStatusBadge invoice={invoicesByOrderId.get(order.id)} compact />
                                <MoreVertical className="w-3.5 h-3.5 text-stone-500" />
                              </button>
                              {paymentMenuOrderId === order.id && (
                                <div
                                  role="menu"
                                  className="absolute z-20 mt-1 left-0 w-44 rounded-lg border border-stone-200 bg-white shadow-lg py-1"
                                >
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => openPaymentAction(order.id, 'paid')}
                                    className="block w-full text-left px-3 py-1.5 text-sm text-stone-700 hover:bg-emerald-50 hover:text-emerald-800 cursor-pointer"
                                  >
                                    Mark as Paid
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => openPaymentAction(order.id, 'overdue')}
                                    className="block w-full text-left px-3 py-1.5 text-sm text-stone-700 hover:bg-rose-50 hover:text-rose-800 cursor-pointer"
                                  >
                                    Mark as Overdue
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => openPaymentAction(order.id, 'pending')}
                                    className="block w-full text-left px-3 py-1.5 text-sm text-stone-700 hover:bg-amber-50 hover:text-amber-800 cursor-pointer"
                                  >
                                    Mark as Pending
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <PaymentStatusBadge invoice={invoicesByOrderId.get(order.id)} compact />
                          )}
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

                            {/* Process (Receiving tab, processing-status orders) replaces the
                                generic Advance button so staff confirm warehouse stock before
                                the order moves on. v1 assumes a single warehouse. */}
                            {isAdminOrManager && activeTab === 'received' && order.status === 'processing' ? (
                              <button
                                onClick={() => setProcessingOrder(order)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-800 text-white hover:bg-blue-900 transition-colors cursor-pointer whitespace-nowrap"
                                title="Confirm stock and process"
                                aria-label={`Process order ${order.id}`}
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                Process
                              </button>
                            ) : (
                              isAdminOrManager && nextStatus && (
                                <button
                                  onClick={() => handleAdvanceStatus(order)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-stone-300 text-stone-700 bg-white hover:bg-stone-50 hover:border-stone-400 transition-colors cursor-pointer whitespace-nowrap"
                                  title={`Advance to ${ORDER_STATUS_LABELS[nextStatus]}`}
                                  aria-label={`Mark order ${order.id} as ${ORDER_STATUS_LABELS[nextStatus]}`}
                                >
                                  {ORDER_STATUS_LABELS[nextStatus]}
                                </button>
                              )
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
                            colSpan={9}
                            className="px-4 pb-4 pt-0 bg-stone-50/60 border-t-0"
                          >
                            {(() => {
                              const approval = getInboundApproval(order);
                              if (!approval) return null;
                              return (
                                <div className="ml-6 mt-2 mb-2 flex items-center gap-1.5 text-xs text-teal-700">
                                  <span className="font-semibold">
                                    {approval.auto ? 'Auto-approved (system)' : `Approved by ${approval.name ?? 'Unknown'}`}
                                  </span>
                                  <span className="text-stone-500">· via PO Inbox</span>
                                </div>
                              );
                            })()}
                            <div className="ml-6 mt-2 rounded-lg border border-stone-200 bg-white overflow-hidden">
                              <div className="overflow-x-auto">
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
                            </div>

                            {/* Generated documents for this order (pick slip / dispatch advice) */}
                            {(() => {
                              const docs = docsByOrder.get(order.id) ?? [];
                              const hasDispatchAdvice = docs.some(({ doc }) => doc.docType === 'dispatch_advice');
                              const isDispatchedOrLater = order.status === 'dispatched' || order.status === 'delivered';
                              const needsAdvice = isAdminOrManager && isDispatchedOrLater && !hasDispatchAdvice;
                              if (docs.length === 0 && !needsAdvice) return null;
                              return (
                                <div className="ml-6 mt-3 flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-stone-500">
                                    <FileText className="w-3.5 h-3.5" /> Documents:
                                  </span>
                                  {docs.map(({ doc }) => {
                                    const isDispatch = doc.docType === 'dispatch_advice';
                                    return (
                                      <button
                                        key={doc.id}
                                        onClick={() => openOrderDoc(doc.id, doc.orderId, doc.docType)}
                                        disabled={getDocUrl.isPending}
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium btn-press disabled:opacity-50 ${isDispatch ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-nexgen-blue/10 text-nexgen-blue hover:bg-nexgen-blue/20'}`}
                                        title="Open document"
                                      >
                                        {isDispatch ? <Truck className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                                        {isDispatch ? 'Dispatch advice' : 'Pick slip'}
                                        <ExternalLink className="w-3 h-3 opacity-60" />
                                      </button>
                                    );
                                  })}
                                  {needsAdvice && (
                                    <button
                                      onClick={() => handleGenerateDispatchAdvice(order.id)}
                                      disabled={generateDispatchAdvice.isPending}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium btn-press disabled:opacity-50 border border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                      title="No dispatch advice exists for this order — generate one"
                                    >
                                      <Truck className="w-3 h-3" /> Generate dispatch advice
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
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

      {/* Payment status action modal (Admin/Manager) */}
      {paymentAction && (
        <PaymentActionModal
          isOpen
          orderId={paymentAction.orderId}
          targetStatus={paymentAction.targetStatus}
          reasonRequired={isManager}
          isSubmitting={updateInvoiceStatus.isPending}
          errorMessage={paymentError}
          onConfirm={submitPaymentAction}
          onCancel={closePaymentAction}
        />
      )}

      {/* Stock assignment modal (Admin/Manager, Receiving tab) */}
      <StockAssignmentModal
        order={processingOrder}
        onCancel={() => setProcessingOrder(null)}
        onConfirm={({ note, locationPref }) => {
          if (!processingOrder) return;
          const processedId = processingOrder.id;
          onUpdateStatus(processedId, 'processed', note, locationPref ? { locationPref } : undefined);
          setProcessingOrder(null);
          addToast('Order processed', 'success');
          // Auto-generate the pick slip so the warehouse can start picking
          // immediately. Fire-and-forget — failure is non-fatal (it can be
          // regenerated from the Pick Queue).
          generatePickSlip.mutate(processedId, {
            onSuccess: () => addToast('Pick slip generated', 'success'),
            onError: () => addToast('Order processed, but pick slip generation failed — retry from the Pick Queue', 'error'),
          });
        }}
      />
    </div>
  );
};

export default OrderImportPage;
