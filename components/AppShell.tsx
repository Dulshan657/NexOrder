/**
 * AppShell — owns UI/nav state, mounts OrderProvider + PantryProvider,
 * and delegates the render tree to AppShellInner (which consumes contexts).
 *
 * Architecture decision (P1.8):
 *   AppShell  = provider mounts + nav state
 *   AppShellInner = render tree, consumes useOrderContext / usePantryContext
 *
 * This avoids the circular dependency where AppShell would both mount a
 * provider AND call useOrderContext() at the same level.
 * onResetView is defined in AppShell and passed to OrderProvider.
 */
import React, {
    Suspense,
    useState,
    useMemo,
    useCallback,
    useEffect,
    useRef,
} from 'react';
import {
    UserRole,
    type AppSettings,
    type HoReCa,
    type Invoice,
    type Order,
    type OrderStatus,
    type Product,
    type Promotion,
    type SalesTarget,
    type ScheduledVisit,
    type Supplier,
    type ToastType,
    type User,
    type Visit,
} from '../types';
import type { QueryClient } from '@tanstack/react-query';
import { OrderProvider } from '../context/OrderContext';
import { PantryProvider } from '../context/PantryContext';
import { useOrderContext } from '../context/OrderContext';
import { usePantryContext } from '../context/PantryContext';
import { useOrderingState } from '../hooks/useOrderingState';
import type { usePlaceOrder } from '../hooks/queries/useOrders';
import { useUpdateOrderStatus } from '../hooks/queries/useOrders';
import { useUpdateInvoiceStatus } from '../hooks/queries/useInvoices';
import { useMarkNotificationRead, useMarkAllNotificationsRead } from '../hooks/queries/useNotifications';
import { useUpdateScheduledVisit, useCreateScheduledVisit } from '../hooks/queries/useScheduledVisits';
import { useCreateVisit } from '../hooks/queries/useVisits';
import { useUpdateSettings } from '../hooks/queries/useSettings';
import {
    useCreateProduct,
    useUpdateProduct,
    useDeleteProduct,
} from '../hooks/queries/useProducts';
import {
    useCreateHoReCa,
    useUpdateHoReCa,
    useDeleteHoReCa,
} from '../hooks/queries/useHoReCas';
import {
    useCreateSupplier,
    useUpdateSupplier,
    useDeleteSupplier,
} from '../hooks/queries/useSuppliers';
import {
    useCreatePromotion,
    useUpdatePromotion,
    useDeletePromotion,
} from '../hooks/queries/usePromotions';

import { type AdminTab } from './AdminView';
import UserProfile from './UserProfile';
import MobileCheckoutButton from './MobileCheckoutButton';
import OrderSummary from './OrderSummary';
import OrderConfirmation from './OrderConfirmation';
import OrdersHistoryView from '../views/OrdersHistoryView';
import RepDashboardView from '../views/RepDashboardView';
import ShopView from '../views/ShopView';
import NotificationCenter from './NotificationCenter';
import ProfileMenu from './auth/ProfileMenu';
import HoReCaListView from './HoReCaListView';
import AccountsAgingTable from './AccountsAgingTable';
import { LoadingSkeleton } from './Skeleton';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyWithRetry } from '../lib/lazyWithRetry';

// Lazy-loaded heavy chunks. The rep + customer hot paths (Shop, OrderHistory)
// don't render any of these on initial load, so keeping them out of the main
// bundle drops first-load JS substantially. lazyWithRetry recovers from stale
// chunk hashes after a redeploy (see lib/lazyWithRetry.ts).
const AdminView = lazyWithRetry(() => import('./AdminView'));
const OrderDetailView = lazyWithRetry(() => import('./OrderDetailView'));
const OrderVerificationModal = lazyWithRetry(() => import('./OrderVerificationModal'));
const BundleSelectModal = lazyWithRetry(() => import('./BundleSelectModal'));
const StockView = lazyWithRetry(() => import('./StockView'));
const ScheduledVisitsView = lazyWithRetry(() => import('./scheduled-visits/ScheduledVisitsView'));

import { inviteUser } from '../services/supabase/inviteUserService';
import { fromProduct, fromHoReCa, fromSupplier, fromPromotion, fromScheduledVisit, fromAppSettings } from '../lib/adapters';
import { numericIdToUuid } from '../lib/userIdMap';
import type { SortOption } from './ShopTopBar';
import type { OrderingTabKey } from './OrderingTabBar';

import {
    LayoutDashboard,
    ShoppingCart,
    ShoppingBag,
    History,
    Menu,
    X,
    Users as UsersIcon,
    Package,
    Settings,
    Truck,
    Wallet,
    BarChart3,
    Tag,
    MapPin,
    Warehouse,
    UserPlus,
    ScrollText,
    Mail,
    Inbox,
    BookOpen,
} from 'lucide-react';
import type { AppNotification } from '../types';

// ── Props for AppShell ────────────────────────────────────────────────────────

export interface AppShellProps {
    currentUser: User;
    currentUserUuid: string;
    products: Product[];
    hoReCas: HoReCa[];
    allOrders: Order[];
    invoices: Invoice[];
    suppliers: Supplier[];
    promotions: Promotion[];
    salesTargets: SalesTarget[];
    routes: ScheduledVisit[];
    visits: Visit[];
    users: User[];
    appSettings: AppSettings;
    notifications: AppNotification[];
    addToast: (message: string, type: ToastType) => void;
    placeOrderMutation: ReturnType<typeof usePlaceOrder>;
    queryClient: QueryClient;
}

// ── AppShellInner — consumes contexts, owns the render tree ──────────────────

interface AppShellInnerProps extends AppShellProps {
    // Nav state (owned by AppShell, passed down)
    view: 'ordering' | 'orders' | 'dashboard' | 'hoReCas' | 'stock' | 'accounts' | 'scheduled_visits';
    setView: React.Dispatch<React.SetStateAction<'ordering' | 'orders' | 'dashboard' | 'hoReCas' | 'stock' | 'accounts' | 'scheduled_visits'>>;
    adminView: AdminTab;
    setAdminView: React.Dispatch<React.SetStateAction<AdminTab>>;
    orderingTab: OrderingTabKey;
    setOrderingTab: React.Dispatch<React.SetStateAction<OrderingTabKey>>;
    selectedCategory: string;
    setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
    searchQuery: string;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    sortOption: SortOption;
    setSortOption: React.Dispatch<React.SetStateAction<SortOption>>;
    isCartOpen: boolean;
    setIsCartOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isSidebarOpen: boolean;
    setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isProfileOpen: boolean;
    setIsProfileOpen: React.Dispatch<React.SetStateAction<boolean>>;
    initialRouteId: string | null;
    setInitialRouteId: React.Dispatch<React.SetStateAction<string | null>>;
    selectedOrderId: string | null;
    setSelectedOrderId: React.Dispatch<React.SetStateAction<string | null>>;
    highlightOrderId: string | null;
    setHighlightOrderId: React.Dispatch<React.SetStateAction<string | null>>;
}

const AppShellInner: React.FC<AppShellInnerProps> = ({
    // Data
    currentUser,
    currentUserUuid,
    products,
    hoReCas,
    allOrders,
    invoices,
    suppliers,
    promotions,
    salesTargets,
    routes,
    visits,
    users,
    appSettings,
    notifications,
    addToast,
    queryClient,
    // Nav state
    view,
    setView,
    adminView,
    setAdminView,
    orderingTab,
    setOrderingTab,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    sortOption,
    setSortOption,
    isCartOpen,
    setIsCartOpen,
    isSidebarOpen,
    setIsSidebarOpen,
    isProfileOpen,
    setIsProfileOpen,
    initialRouteId,
    setInitialRouteId,
    selectedOrderId,
    setSelectedOrderId,
    highlightOrderId,
    setHighlightOrderId,
}) => {
    // ── Context consumption ───────────────────────────────────────────────────
    const {
        orderItems,
        selectedHoReCaId,
        selectedHoReCa,
        notes,
        deliveryDate,
        deliveryTimeSlot,
        isLoading,
        errors,
        confirmation,
        showVerificationModal,
        bundleModalPromo,
        total,
        setSelectedHoReCaId,
        setNotes,
        setDeliveryDate,
        setDeliveryTimeSlot,
        setShowVerificationModal,
        setBundleModalPromo,
        setConfirmation,
        handleAddItem,
        handleApplyPromo,
        handleBundleConfirm,
        handleUpdateQuantity,
        handleSubmitOrder,
        placeOrder,
        handleReorder,
        handleReorderItems,
        handleStartOrder,
        resetOrder,
    } = useOrderContext();

    // ── Pantry context consumption ────────────────────────────────────────────
    const {
        currentPantryItems,
        pantryEstTotal,
        handleTogglePantry,
        handleRemoveFromPantry,
        handleUpdatePantryItem,
        handleAddPantryItemToOrder,
        handleAddAllPantryToOrder,
        handleAddSelectedPantryToOrder,
    } = usePantryContext();

    // ── Mutation hooks (non-cart) ─────────────────────────────────────────────
    const updateOrderStatusMutation = useUpdateOrderStatus();
    const updateInvoiceStatusMutation = useUpdateInvoiceStatus();
    const markNotificationReadMutation = useMarkNotificationRead();
    const markAllNotificationsReadMutation = useMarkAllNotificationsRead();
    const updateRouteMutation = useUpdateScheduledVisit();
    const createRouteMutation = useCreateScheduledVisit();
    const createVisitMutation = useCreateVisit();
    const updateSettingsMutation = useUpdateSettings();

    const createProductMutation = useCreateProduct();
    const updateProductMutation = useUpdateProduct();
    const deleteProductMutation = useDeleteProduct();
    const createHoReCaMutation = useCreateHoReCa();
    const updateHoReCaMutation = useUpdateHoReCa();
    const deleteHoReCaMutation = useDeleteHoReCa();
    const createSupplierMutation = useCreateSupplier();
    const updateSupplierMutation = useUpdateSupplier();
    const deleteSupplierMutation = useDeleteSupplier();
    const createPromotionMutation = useCreatePromotion();
    const updatePromotionMutation = useUpdatePromotion();
    const deletePromotionMutation = useDeletePromotion();

    // ── Derived booleans ──────────────────────────────────────────────────────
    const isRep = currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP;
    const isFieldRep = currentUser.role === UserRole.FIELD_REP;
    const isHoReCaUser = currentUser.role === UserRole.CUSTOMER;
    const isAdminOrManager = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER;
    const isAdmin = currentUser.role === UserRole.ADMIN;

    // ── Derived notification state ────────────────────────────────────────────
    // Role-filtered notifications; NotificationCenter derives the unread count
    // (and merges in the PO-inbox count) for the combined badge.
    const userNotifications = useMemo(
        () => notifications.filter(n => !n.targetRoles || n.targetRoles.includes(currentUser.role)),
        [notifications, currentUser.role],
    );

    // ── Derived order/selection state ─────────────────────────────────────────
    const selectedOrder = useMemo(
        () => (selectedOrderId ? allOrders.find(o => o.id === selectedOrderId) ?? null : null),
        [selectedOrderId, allOrders],
    );

    const selectedOrderInvoice = useMemo(
        () => (selectedOrderId ? invoices.find(inv => inv.orderId === selectedOrderId) : undefined),
        [selectedOrderId, invoices],
    );

    const ordersForHistory = useMemo(() => {
        if (isHoReCaUser) {
            return allOrders.filter(o => o.hoReCa.id === currentUser.hoReCaId);
        }
        return allOrders;
    }, [allOrders, currentUser, isHoReCaUser]);

    // ── Badge counts ──────────────────────────────────────────────────────────
    const walkInReviewCount = useMemo(
        () => hoReCas.filter(h => h.isTemporary && !h.reviewedAt).length,
        [hoReCas],
    );

    const newAssignmentCount = useMemo(() => {
        if (!isFieldRep) return 0;
        const cutoff = Date.now() - 48 * 60 * 60 * 1000;
        return routes.filter(
            r =>
                r.assignedTo === currentUser.id &&
                r.status === 'planned' &&
                r.assignedAt &&
                new Date(r.assignedAt).getTime() > cutoff,
        ).length;
    }, [routes, currentUser.id, isFieldRep]);

    const showStockTab = (() => {
        if (!isHoReCaUser) return true;
        if (selectedHoReCa?.showStockTab !== undefined) return selectedHoReCa.showStockTab;
        return appSettings.showStockToHoReCa;
    })();

    // ── Effects ───────────────────────────────────────────────────────────────
    // Stock-tab redirect: if the tab becomes hidden while the user is on it
    useEffect(() => {
        if (!showStockTab && view === 'stock' && isHoReCaUser) {
            setView('ordering');
        }
    }, [showStockTab, view, isHoReCaUser, setView]);

    // Low stock detection (client-side toast, server will also generate notifications)
    const lowStockAlertedRef = useRef<Set<number>>(new Set());
    useEffect(() => {
        if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.MANAGER) return;
        const threshold = appSettings.lowStockThreshold;
        for (const product of products) {
            if (
                product.inventory > 0 &&
                product.inventory <= threshold &&
                !lowStockAlertedRef.current.has(product.id)
            ) {
                lowStockAlertedRef.current.add(product.id);
                addToast(`Low stock: ${product.name} has only ${product.inventory} units remaining`, 'info');
            }
        }
    }, [products, appSettings.lowStockThreshold, currentUser.role, addToast]);

    // ── Derived shop memos (via useOrderingState) ─────────────────────────────
    const {
        filteredProducts,
        hintsPerProduct,
        missingItemHints,
        recentHoReCaProducts,
        lastOrderForHoReCa,
    } = useOrderingState({
        products,
        selectedHoReCa,
        currentUser,
        promotions,
        selectedCategory,
        searchQuery,
        sortOption,
        allOrders,
        orderItems,
    });

    // ── Non-cart handlers ─────────────────────────────────────────────────────
    const handleUpdateOrderStatus = useCallback(
        (orderId: string, newStatus: OrderStatus, note?: string) => {
            updateOrderStatusMutation.mutate(
                { id: orderId, status: newStatus, note },
                {
                    onSuccess: () => addToast(`Order ${orderId} updated to ${newStatus}.`, 'success'),
                    onError: err => addToast(`Error updating order: ${err.message}`, 'error'),
                },
            );
        },
        [updateOrderStatusMutation, addToast],
    );

    const handleUpdateInvoiceStatus = useCallback(
        (invoiceId: string, status: Invoice['status']) => {
            const target = invoices.find(inv => inv.id === invoiceId);
            if (!target) {
                addToast(`Invoice ${invoiceId} not found`, 'error');
                return;
            }
            updateInvoiceStatusMutation.mutate(
                { orderId: target.orderId, status },
                {
                    onSuccess: () => addToast(`Invoice ${invoiceId} marked as ${status}.`, 'success'),
                    onError: err => addToast(`Error updating invoice: ${err.message}`, 'error'),
                },
            );
        },
        [updateInvoiceStatusMutation, addToast, invoices],
    );

    const handleMarkNotificationRead = useCallback(
        (id: string) => {
            markNotificationReadMutation.mutate(id);
        },
        [markNotificationReadMutation],
    );

    const handleMarkAllNotificationsRead = useCallback(() => {
        markAllNotificationsReadMutation.mutate(currentUserUuid);
    }, [markAllNotificationsReadMutation, currentUserUuid]);

    // ── setRoutes shim ────────────────────────────────────────────────────────
    const setRoutes = useCallback(
        (updater: ScheduledVisit[] | ((prev: ScheduledVisit[]) => ScheduledVisit[])) => {
            const next = typeof updater === 'function' ? updater(routes) : updater;
            const prevIds = new Set(routes.map(r => r.id));

            for (const r of next) {
                if (!prevIds.has(r.id)) {
                    createRouteMutation.mutate(fromScheduledVisit(r) as any);
                }
            }

            for (const r of next) {
                if (prevIds.has(r.id)) {
                    const prev = routes.find(pr => pr.id === r.id);
                    if (prev && JSON.stringify(prev) !== JSON.stringify(r)) {
                        updateRouteMutation.mutate({ id: r.id, updates: fromScheduledVisit(r) as any });
                    }
                }
            }
        },
        [routes, createRouteMutation, updateRouteMutation],
    );

    // ── setVisits shim ────────────────────────────────────────────────────────
    const setVisits = useCallback(
        (updater: Visit[] | ((prev: Visit[]) => Visit[])) => {
            const next = typeof updater === 'function' ? updater(visits) : updater;
            const prevIds = new Set(visits.map(v => v.id));
            for (const v of next) {
                if (!prevIds.has(v.id)) {
                    createVisitMutation.mutate({
                        horeca_id: v.hoReCaId,
                        user_id: numericIdToUuid(v.userId),
                        scheduled_visit_id: v.scheduledVisitId ?? null,
                        arrival_time: v.arrivalTime,
                        departure_time: v.departureTime ?? null,
                        outcome: v.outcome ?? null,
                        notes: v.notes ?? null,
                        competitor_notes: v.competitorNotes ?? null,
                        stock_check_notes: v.stockCheckNotes ?? null,
                        next_visit_recommendation: v.nextVisitRecommendation ?? null,
                        photos: v.photos ?? [],
                    } as any);
                }
            }
        },
        [visits, createVisitMutation],
    );

    // ── setSalesTargets shim ──────────────────────────────────────────────────
    const setSalesTargets = useCallback(
        (_updater: SalesTarget[] | ((prev: SalesTarget[]) => SalesTarget[])) => {
            // Sales target writes handled by dedicated mutation hooks in a future task.
        },
        [],
    );

    // ── Wrap handleReorder / handleStartOrder with nav reset ─────────────────
    // In App.tsx, handleReorder and handleStartOrder called setView('ordering').
    // Those view setters now live here, so we wrap them.
    const handleReorderWithNav = useCallback(
        (order: Order) => {
            handleReorder(order);
            setView('ordering');
        },
        [handleReorder, setView],
    );

    const handleStartOrderWithNav = useCallback(
        (hoReCaId: number) => {
            handleStartOrder(hoReCaId);
            setView('ordering');
        },
        [handleStartOrder, setView],
    );

    // ── Early return: order confirmation screen ───────────────────────────────
    if (confirmation) {
        return (
            <OrderConfirmation
                order={confirmation.order}
                confirmationMessage={confirmation.message}
                onClose={resetOrder}
            />
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex h-screen bg-white font-sans overflow-hidden">
            {/* Sidebar Overlay for Mobile */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-stone-900/50 z-40 md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`fixed md:static inset-y-0 left-0 z-50 w-52 bg-white/80 backdrop-blur-md text-stone-600 border-r border-stone-200/50 flex flex-col transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
                <div className="h-[73px] flex items-center justify-between px-6 bg-white/80 border-b border-stone-200">
                    <div className="flex items-center">
                        <img src="/assets/Nex-Order-no-bg-logo.png" alt="Nex Order" className="h-16 object-contain" />
                    </div>
                    <div className="flex items-center gap-2">
                        <NotificationCenter
                            notifications={userNotifications}
                            onMarkRead={handleMarkNotificationRead}
                            onMarkAllRead={handleMarkAllNotificationsRead}
                            isAdminOrManager={isAdminOrManager}
                            onOpenPoInbox={() => {
                                if (typeof window !== 'undefined') {
                                    const params = new URLSearchParams(window.location.search);
                                    params.set('subtab', 'queue');
                                    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
                                }
                                setAdminView('PO Inbox');
                                setIsSidebarOpen(false);
                            }}
                        />
                        <button
                            onClick={() => setIsSidebarOpen(false)}
                            className="md:hidden text-stone-400 hover:text-stone-700 cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
                    {(isRep || isHoReCaUser) && (
                        <>
                            {isRep && (
                                <button
                                    onClick={() => { setView('dashboard'); setIsSidebarOpen(false); }}
                                    className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${view === 'dashboard' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                                >
                                    <LayoutDashboard className="w-5 h-5 mr-3" /> Dashboard
                                </button>
                            )}

                            <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">Orders</p>
                            <button
                                onClick={() => {
                                    if (view !== 'ordering') { resetOrder(); setView('ordering'); }
                                    setIsSidebarOpen(false);
                                }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${view === 'ordering' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <ShoppingCart className="w-5 h-5 mr-3" /> Shop
                            </button>
                            <button
                                onClick={() => { setView('orders'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${view === 'orders' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <History className="w-5 h-5 mr-3" /> Order Import
                            </button>
                            <button
                                onClick={() => { setView('accounts'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${view === 'accounts' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Wallet className="w-5 h-5 mr-3" /> Accounts
                            </button>

                            {isRep && (
                                <>
                                    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">Field</p>
                                    <button
                                        onClick={() => { setView('hoReCas'); setIsSidebarOpen(false); }}
                                        className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${view === 'hoReCas' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                                    >
                                        <UsersIcon className="w-5 h-5 mr-3" /> HoReCa
                                    </button>
                                    {isFieldRep && (
                                        <button
                                            onClick={() => { setView('scheduled_visits'); setIsSidebarOpen(false); }}
                                            className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${view === 'scheduled_visits' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                                        >
                                            <MapPin className="w-5 h-5 mr-3" /> Scheduled Visits
                                            {newAssignmentCount > 0 && (
                                                <span className="ml-auto text-xs font-bold text-white bg-teal-500 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                                                    {newAssignmentCount}
                                                </span>
                                            )}
                                        </button>
                                    )}
                                </>
                            )}

                            {showStockTab && (
                                <>
                                    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">Catalogue</p>
                                    <button
                                        onClick={() => { setView('stock'); setIsSidebarOpen(false); }}
                                        className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${view === 'stock' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                                    >
                                        <Package className="w-5 h-5 mr-3" /> Stock
                                    </button>
                                </>
                            )}
                        </>
                    )}
                    {isAdminOrManager && (
                        <>
                            <button
                                onClick={() => { setAdminView('Dashboard'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Dashboard' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <LayoutDashboard className="w-5 h-5 mr-3" /> Dashboard
                            </button>

                            <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">Sales & Orders</p>
                            <button
                                onClick={() => { setAdminView('Shop'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Shop' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <ShoppingBag className="w-5 h-5 mr-3" /> Shop
                            </button>
                            <button
                                onClick={() => { setAdminView('Order Import'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Order Import' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <ShoppingCart className="w-5 h-5 mr-3" /> Order Import
                            </button>
                            <button
                                onClick={() => { setAdminView('PO Inbox'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'PO Inbox' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Inbox className="w-5 h-5 mr-3" /> PO Inbox
                            </button>
                            <button
                                onClick={() => { setAdminView('Accounts'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Accounts' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Wallet className="w-5 h-5 mr-3" /> Accounts
                            </button>
                            <button
                                onClick={() => { setAdminView('Promotions'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Promotions' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Tag className="w-5 h-5 mr-3" /> Promotions
                            </button>

                            <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">Field Ops</p>
                            <button
                                onClick={() => { setAdminView('HoReCa'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'HoReCa' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <UsersIcon className="w-5 h-5 mr-3" /> HoReCa
                            </button>
                            <button
                                onClick={() => { setAdminView('HoReCa Insights'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'HoReCa Insights' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <BarChart3 className="w-5 h-5 mr-3" /> HoReCa Insights
                            </button>
                            <button
                                onClick={() => { setAdminView('Scheduled Visits'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Scheduled Visits' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <MapPin className="w-5 h-5 mr-3" /> Scheduled Visits
                            </button>
                            <button
                                onClick={() => { setAdminView('Walk-in Review'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Walk-in Review' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <UserPlus className="w-5 h-5 mr-3" />
                                <span className="flex-1 text-left">Walk-in Review</span>
                                {walkInReviewCount > 0 && (
                                    <span className="text-[10px] font-bold bg-amber-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                                        {walkInReviewCount}
                                    </span>
                                )}
                            </button>

                            <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">Catalogue</p>
                            <button
                                onClick={() => { setAdminView('Products'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Products' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Package className="w-5 h-5 mr-3" /> Products
                            </button>
                            <button
                                onClick={() => { setAdminView('Stock'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Stock' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Warehouse className="w-5 h-5 mr-3" /> Stock
                            </button>

                            <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">System</p>
                            <button
                                onClick={() => { setAdminView('Users'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Users' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <UsersIcon className="w-5 h-5 mr-3" /> Users
                            </button>
                            <button
                                onClick={() => { setAdminView('Suppliers'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Suppliers' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Truck className="w-5 h-5 mr-3" /> Suppliers
                            </button>
                            <button
                                onClick={() => { setAdminView('Settings'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Settings' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Settings className="w-5 h-5 mr-3" /> Settings
                            </button>
                            {isAdmin && (
                                <button
                                    onClick={() => { setAdminView('Audit Log'); setIsSidebarOpen(false); }}
                                    className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Audit Log' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                                >
                                    <ScrollText className="w-5 h-5 mr-3" /> Audit Log
                                </button>
                            )}
                        </>
                    )}
                </nav>
                <ProfileMenu currentUser={currentUser} />
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
                <button
                    onClick={() => setIsSidebarOpen(true)}
                    className="md:hidden fixed top-4 left-4 z-30 p-2 bg-white rounded-lg shadow-md border border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors cursor-pointer"
                    aria-label="Open menu"
                >
                    <Menu className="w-5 h-5" />
                </button>
                <main className="flex-1 overflow-y-auto">
                    <div>
                        {isAdminOrManager && adminView === 'Shop' && (
                            <ShopView
                                products={products}
                                hoReCas={hoReCas}
                                promotions={promotions}
                                invoices={invoices}
                                allOrders={allOrders}
                                currentUser={currentUser}
                                appSettings={appSettings}
                                orderItems={orderItems}
                                selectedHoReCa={selectedHoReCa}
                                selectedHoReCaId={selectedHoReCaId}
                                notes={notes}
                                deliveryDate={deliveryDate}
                                deliveryTimeSlot={deliveryTimeSlot}
                                isLoading={isLoading}
                                errors={errors}
                                total={total}
                                isAdminOrManager={isAdminOrManager}
                                currentPantryItems={currentPantryItems}
                                pantryEstTotal={pantryEstTotal}
                                filteredProducts={filteredProducts}
                                hintsPerProduct={hintsPerProduct}
                                missingItemHints={missingItemHints}
                                recentHoReCaProducts={recentHoReCaProducts}
                                lastOrderForHoReCa={lastOrderForHoReCa}
                                orderingTab={orderingTab}
                                onOrderingTabChange={setOrderingTab as (t: OrderingTabKey) => void}
                                selectedCategory={selectedCategory}
                                onSelectedCategoryChange={setSelectedCategory}
                                searchQuery={searchQuery}
                                onSearchQueryChange={setSearchQuery}
                                sortOption={sortOption}
                                onSortOptionChange={setSortOption}
                                isCartOpen={isCartOpen}
                                onCartOpenChange={setIsCartOpen}
                                onAddItem={handleAddItem}
                                onApplyPromo={handleApplyPromo}
                                onUpdateQuantity={handleUpdateQuantity}
                                onSubmitOrder={handleSubmitOrder}
                                onSelectHoReCa={setSelectedHoReCaId}
                                onNotesChange={setNotes}
                                onDeliveryDateChange={setDeliveryDate}
                                onDeliveryTimeSlotChange={setDeliveryTimeSlot}
                                onReorderItems={handleReorderItems}
                                onTogglePantry={handleTogglePantry}
                                onAddPantryItemToOrder={handleAddPantryItemToOrder}
                                onAddAllPantryToOrder={handleAddAllPantryToOrder}
                                onAddSelectedPantryToOrder={handleAddSelectedPantryToOrder}
                                onRemoveFromPantry={handleRemoveFromPantry}
                                onUpdatePantryItem={handleUpdatePantryItem}
                            />
                        )}
                        {isAdminOrManager && adminView !== 'Shop' && (
                            <ErrorBoundary label="Admin view">
                            <Suspense fallback={<LoadingSkeleton />}>
                            <AdminView
                                activeTab={adminView}
                                currentUser={currentUser}
                                products={products}
                                hoReCas={hoReCas}
                                users={users}
                                suppliers={suppliers}
                                allOrders={allOrders}
                                onAddProduct={p => {
                                    createProductMutation.mutate(fromProduct(p) as any, {
                                        onSuccess: () => addToast('Product added!', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdateProduct={p => {
                                    updateProductMutation.mutate({ id: p.id, updates: fromProduct(p) as any }, {
                                        onSuccess: () => addToast('Product updated!', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onDeleteProduct={id => {
                                    deleteProductMutation.mutate(id, {
                                        onSuccess: () => addToast('Product deleted', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onAddHoReCa={(c, reason) => {
                                    createHoReCaMutation.mutate({ horeca: fromHoReCa(c) as any, reason }, {
                                        onSuccess: () => addToast('HoReCa added', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdateHoReCa={(c, reason) => {
                                    updateHoReCaMutation.mutate({ id: c.id, updates: fromHoReCa(c) as any, reason }, {
                                        onSuccess: () => addToast('HoReCa updated', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onDeleteHoReCa={id => {
                                    deleteHoReCaMutation.mutate(id, {
                                        onSuccess: () => addToast('HoReCa deleted', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onAddUser={u => {
                                    inviteUser({
                                        email: u.email,
                                        name: u.name,
                                        role: u.role as 'Admin' | 'Manager' | 'Field Sales Rep' | 'Office Sales Rep' | 'Restaurant/Hotel Customer',
                                        hoReCaId: u.hoReCaId ?? null,
                                        avatarUrl: u.avatarUrl ?? null,
                                    })
                                        .then(() => {
                                            addToast(`Invite sent to ${u.email}`, 'success');
                                            queryClient.invalidateQueries({ queryKey: ['profiles'] });
                                        })
                                        .catch(err => addToast(`Invite failed: ${err.message}`, 'error'));
                                }}
                                onUpdateUser={() => {
                                    addToast('User editing not yet supported via the secure path.', 'info');
                                }}
                                onDeleteUser={() => {
                                    addToast('User deletion not yet supported via the secure path.', 'info');
                                }}
                                onAddSupplier={s => {
                                    createSupplierMutation.mutate(fromSupplier(s) as any, {
                                        onSuccess: () => addToast('Supplier added', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdateSupplier={s => {
                                    updateSupplierMutation.mutate({ id: s.id, updates: fromSupplier(s) as any }, {
                                        onSuccess: () => addToast('Supplier updated', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onDeleteSupplier={id => {
                                    deleteSupplierMutation.mutate(id, {
                                        onSuccess: () => addToast('Supplier deleted', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                invoices={invoices}
                                salesTargets={salesTargets}
                                onUpdateSalesTargets={setSalesTargets}
                                promotions={promotions}
                                onAddPromotion={p => {
                                    createPromotionMutation.mutate(fromPromotion(p) as any, {
                                        onSuccess: () => addToast('Promotion created!', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdatePromotion={p => {
                                    updatePromotionMutation.mutate({ id: p.id, updates: fromPromotion(p) as any }, {
                                        onSuccess: () => addToast('Promotion updated!', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onDeletePromotion={id => {
                                    deletePromotionMutation.mutate(id, {
                                        onSuccess: () => addToast('Promotion deleted', 'success'),
                                        onError: err => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
                                onUpdateOrderStatus={handleUpdateOrderStatus}
                                onReorder={handleReorderWithNav}
                                onViewOrderDetail={setSelectedOrderId}
                                visits={visits}
                                routes={routes}
                                onSetRoutes={setRoutes}
                                addToast={addToast}
                                onSetAdminView={setAdminView}
                                highlightOrderId={highlightOrderId}
                                onClearHighlightOrderId={() => setHighlightOrderId(null)}
                                onViewInOrderImport={(orderId) => {
                                    setHighlightOrderId(orderId);
                                    setAdminView('Order Import');
                                }}
                                appLogo={appSettings.companyLogoUrl ?? null}
                                appSettings={appSettings}
                                onUpdateLogo={logo => {
                                    updateSettingsMutation.mutate(fromAppSettings({ companyLogoUrl: logo }) as any, {
                                        onError: err => addToast(`Error saving logo: ${err.message}`, 'error'),
                                    });
                                }}
                                onSaveSettings={s => {
                                    updateSettingsMutation.mutate(fromAppSettings(s) as any, {
                                        onSuccess: () => addToast('Settings saved!', 'success'),
                                        onError: err => addToast(`Error saving settings: ${err.message}`, 'error'),
                                    });
                                }}
                            />
                            </Suspense>
                            </ErrorBoundary>
                        )}
                        {(isRep || isHoReCaUser) && (
                            <div>
                                {view === 'dashboard' && isRep && (
                                    <RepDashboardView
                                        currentUser={currentUser}
                                        hoReCas={hoReCas}
                                        products={products}
                                        orders={allOrders}
                                        invoices={invoices}
                                        salesTargets={salesTargets}
                                        visits={visits}
                                        routes={routes}
                                        onStartOrder={handleStartOrderWithNav}
                                        onUpdateSalesTargets={setSalesTargets}
                                        onSetVisits={setVisits}
                                        onUpdateRoute={started => {
                                            updateRouteMutation.mutate(
                                                { id: started.id, updates: fromScheduledVisit(started) as any },
                                                { onError: err => addToast(`Error starting scheduled visit: ${err.message}`, 'error') },
                                            );
                                        }}
                                        onSelectRoute={scheduledVisitId => {
                                            setInitialRouteId(scheduledVisitId);
                                            setView('scheduled_visits');
                                        }}
                                    />
                                )}
                                {view === 'ordering' && (
                                    <ShopView
                                        products={products}
                                        hoReCas={hoReCas}
                                        promotions={promotions}
                                        invoices={invoices}
                                        allOrders={allOrders}
                                        currentUser={currentUser}
                                        appSettings={appSettings}
                                        orderItems={orderItems}
                                        selectedHoReCa={selectedHoReCa}
                                        selectedHoReCaId={selectedHoReCaId}
                                        notes={notes}
                                        deliveryDate={deliveryDate}
                                        deliveryTimeSlot={deliveryTimeSlot}
                                        isLoading={isLoading}
                                        errors={errors}
                                        total={total}
                                        isAdminOrManager={isAdminOrManager}
                                        currentPantryItems={currentPantryItems}
                                        pantryEstTotal={pantryEstTotal}
                                        filteredProducts={filteredProducts}
                                        hintsPerProduct={hintsPerProduct}
                                        missingItemHints={missingItemHints}
                                        recentHoReCaProducts={recentHoReCaProducts}
                                        lastOrderForHoReCa={lastOrderForHoReCa}
                                        orderingTab={orderingTab}
                                        onOrderingTabChange={setOrderingTab as (t: OrderingTabKey) => void}
                                        selectedCategory={selectedCategory}
                                        onSelectedCategoryChange={setSelectedCategory}
                                        searchQuery={searchQuery}
                                        onSearchQueryChange={setSearchQuery}
                                        sortOption={sortOption}
                                        onSortOptionChange={setSortOption}
                                        isCartOpen={isCartOpen}
                                        onCartOpenChange={setIsCartOpen}
                                        onAddItem={handleAddItem}
                                        onApplyPromo={handleApplyPromo}
                                        onUpdateQuantity={handleUpdateQuantity}
                                        onSubmitOrder={handleSubmitOrder}
                                        onSelectHoReCa={setSelectedHoReCaId}
                                        onNotesChange={setNotes}
                                        onDeliveryDateChange={setDeliveryDate}
                                        onDeliveryTimeSlotChange={setDeliveryTimeSlot}
                                        onReorderItems={handleReorderItems}
                                        onTogglePantry={handleTogglePantry}
                                        onAddPantryItemToOrder={handleAddPantryItemToOrder}
                                        onAddAllPantryToOrder={handleAddAllPantryToOrder}
                                        onAddSelectedPantryToOrder={handleAddSelectedPantryToOrder}
                                        onRemoveFromPantry={handleRemoveFromPantry}
                                        onUpdatePantryItem={handleUpdatePantryItem}
                                    />
                                )}
                                {view === 'orders' && (
                                    <OrdersHistoryView
                                        orders={ordersForHistory}
                                        hoReCas={hoReCas}
                                        invoices={invoices}
                                        currentUser={currentUser}
                                        onReorder={handleReorderWithNav}
                                        onReorderItems={handleReorderItems}
                                        onResetOrder={resetOrder}
                                        onSelectOrder={setSelectedOrderId}
                                        onUpdateStatus={handleUpdateOrderStatus}
                                        onNavigateToShop={() => setView('ordering')}
                                        onNavigateBack={() => setView(isRep ? 'dashboard' : 'ordering')}
                                    />
                                )}
                                {view === 'hoReCas' && isRep && (
                                    <HoReCaListView
                                        hoReCas={hoReCas}
                                        orders={allOrders}
                                        invoices={invoices}
                                        currentUser={currentUser}
                                        visits={visits}
                                        onAddHoReCa={(c, reason) => {
                                            createHoReCaMutation.mutate({ horeca: fromHoReCa(c) as any, reason }, {
                                                onSuccess: () => addToast('HoReCa added', 'success'),
                                                onError: err => addToast(`Error: ${err.message}`, 'error'),
                                            });
                                        }}
                                        onStartOrder={handleStartOrderWithNav}
                                        setVisits={setVisits}
                                    />
                                )}
                                {view === 'stock' && (
                                    <ErrorBoundary label="Stock view">
                                        <Suspense fallback={<LoadingSkeleton />}>
                                            <StockView
                                                products={products}
                                                currentUser={currentUser}
                                            />
                                        </Suspense>
                                    </ErrorBoundary>
                                )}
                                {view === 'accounts' && (
                                    <AccountsAgingTable invoices={invoices} hoReCas={hoReCas} currentUser={currentUser} />
                                )}
                                {view === 'scheduled_visits' && isFieldRep && (
                                    <ErrorBoundary label="Scheduled visits">
                                        <Suspense fallback={<LoadingSkeleton />}>
                                            <ScheduledVisitsView
                                                currentUser={currentUser}
                                                hoReCas={hoReCas}
                                                routes={routes}
                                                setRoutes={setRoutes}
                                                visits={visits}
                                                setVisits={setVisits}
                                                orders={allOrders}
                                                users={users}
                                                onStartOrder={handleStartOrderWithNav}
                                                initialSelectedRouteId={initialRouteId}
                                                onClearInitialRoute={() => setInitialRouteId(null)}
                                            />
                                        </Suspense>
                                    </ErrorBoundary>
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* User Profile Modal */}
            {isProfileOpen && (
                <UserProfile
                    user={currentUser}
                    onClose={() => setIsProfileOpen(false)}
                    onSave={async updatedUser => {
                        try {
                            const { supabase } = await import('../lib/supabase');
                            const { error } = await supabase
                                .from('profiles')
                                .update({ name: updatedUser.name, email: updatedUser.email })
                                .eq('id', currentUserUuid);
                            if (error) throw error;
                            queryClient.invalidateQueries({ queryKey: ['profiles'] });
                            addToast('Profile updated!', 'success');
                        } catch {
                            addToast('Could not update profile.', 'error');
                        } finally {
                            setIsProfileOpen(false);
                        }
                    }}
                />
            )}

            {/* Mobile Checkout Button & Modal */}
            {(isRep || isHoReCaUser) && view === 'ordering' && (
                <>
                    <MobileCheckoutButton
                        itemCount={orderItems.reduce((sum, item) => sum + item.quantity, 0)}
                        onClick={() => setIsCartOpen(true)}
                    />
                    {isCartOpen && (
                        <div className="fixed inset-0 z-50 lg:hidden">
                            <OrderSummary
                                items={orderItems}
                                total={total}
                                currentUser={currentUser}
                                userRole={currentUser.role}
                                hoReCas={hoReCas}
                                selectedHoReCaId={selectedHoReCaId}
                                notes={notes}
                                deliveryDate={deliveryDate}
                                deliveryTimeSlot={deliveryTimeSlot}
                                onSelectHoReCa={setSelectedHoReCaId}
                                onUpdateQuantity={handleUpdateQuantity}
                                onSubmitOrder={handleSubmitOrder}
                                onNotesChange={setNotes}
                                onDeliveryDateChange={setDeliveryDate}
                                onDeliveryTimeSlotChange={setDeliveryTimeSlot}
                                isLoading={isLoading}
                                errors={errors}
                                onClose={() => setIsCartOpen(false)}
                                invoices={invoices}
                                isAdminOrManager={isAdminOrManager}
                                promotions={promotions}
                                products={products}
                            />
                        </div>
                    )}
                </>
            )}

            {/* Order Detail Modal */}
            {selectedOrder && (
                <ErrorBoundary label="Order detail">
                    <Suspense fallback={<LoadingSkeleton />}>
                        <OrderDetailView
                            order={selectedOrder}
                            currentUser={currentUser}
                            invoice={selectedOrderInvoice}
                            onUpdateStatus={isAdminOrManager ? handleUpdateOrderStatus : undefined}
                            onClose={() => setSelectedOrderId(null)}
                        />
                    </Suspense>
                </ErrorBoundary>
            )}

            {/* Order Verification Modal */}
            {showVerificationModal && (
                <ErrorBoundary label="Order verification">
                    <Suspense fallback={<LoadingSkeleton />}>
                        <OrderVerificationModal
                            userRole={currentUser.role}
                            onConfirm={verification => placeOrder(verification)}
                            onCancel={() => setShowVerificationModal(false)}
                        />
                    </Suspense>
                </ErrorBoundary>
            )}

            {/* Bundle Promo Selector */}
            {bundleModalPromo && (
                <ErrorBoundary label="Bundle selector">
                    <Suspense fallback={<LoadingSkeleton />}>
                        <BundleSelectModal
                            promotion={bundleModalPromo}
                            products={products}
                            cartonDiscountPercent={appSettings.cartonDiscountPercent}
                            onClose={() => setBundleModalPromo(null)}
                            onConfirm={handleBundleConfirm}
                        />
                    </Suspense>
                </ErrorBoundary>
            )}
        </div>
    );
};

// ── AppShell — owns UI/nav state, mounts providers ────────────────────────────

const AppShell: React.FC<AppShellProps> = props => {
    const { products, hoReCas, promotions, invoices, appSettings, allOrders, addToast, placeOrderMutation, currentUser, currentUserUuid, users, queryClient } = props;

    // ── UI / nav state ────────────────────────────────────────────────────────
    // Customers have no dashboard route — land them on Shop. Reps land on Dashboard.
    const [view, setView] = useState<
        'ordering' | 'orders' | 'dashboard' | 'hoReCas' | 'stock' | 'accounts' | 'scheduled_visits'
    >(currentUser.role === UserRole.CUSTOMER ? 'ordering' : 'dashboard');
    const [adminView, setAdminView] = useState<AdminTab>(() => {
        if (typeof window === 'undefined') return 'Dashboard';
        const params = new URLSearchParams(window.location.search);
        // After the OAuth callback, route to the consolidated PO Inbox tab.
        // POInboxView reads the ?connected / ?connect_error params, toasts the
        // result, and opens the Mailboxes popover so the operator sees their
        // new connection in context.
        if (params.has('connected') || params.has('connect_error')) {
            params.set('subtab', 'queue');
            window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
            return 'PO Inbox';
        }
        return 'Dashboard';
    });
    const [highlightOrderId, setHighlightOrderId] = useState<string | null>(null);
    const [orderingTab, setOrderingTab] = useState<OrderingTabKey>('catalogue');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortOption, setSortOption] = useState<SortOption>('');
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [initialRouteId, setInitialRouteId] = useState<string | null>(null);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

    // ── onResetView — clears nav state when an order is confirmed/reset ───────
    const onResetView = useCallback(() => {
        setView('ordering');
        setIsCartOpen(false);
        setOrderingTab('catalogue');
    }, []);

    const navState = {
        view, setView,
        adminView, setAdminView,
        orderingTab, setOrderingTab,
        selectedCategory, setSelectedCategory,
        searchQuery, setSearchQuery,
        sortOption, setSortOption,
        isCartOpen, setIsCartOpen,
        isSidebarOpen, setIsSidebarOpen,
        isProfileOpen, setIsProfileOpen,
        initialRouteId, setInitialRouteId,
        selectedOrderId, setSelectedOrderId,
        highlightOrderId, setHighlightOrderId,
    };

    return (
        <OrderProvider
            currentUser={currentUser}
            products={products}
            hoReCas={hoReCas}
            promotions={promotions}
            invoices={invoices}
            appSettings={appSettings}
            addToast={addToast}
            placeOrderMutation={placeOrderMutation}
            onResetView={onResetView}
        >
            <PantryProvider
                products={products}
                allOrders={allOrders}
                appSettings={appSettings}
                addToast={addToast}
            >
                <AppShellInner
                    {...props}
                    {...navState}
                />
            </PantryProvider>
        </OrderProvider>
    );
};

export default AppShell;
