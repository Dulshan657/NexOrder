// FIX: Implement the main App component to manage state and render the UI.
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { UserRole, Product, HoReCa, User, OrderItem, Order, Supplier, PurchaseOrder, PantryItem, AppSettings, OrderStatus, Invoice, AppNotification, DeliveryTimeSlot, OrderVerification, SalesTarget, Promotion, ScheduledVisit, Visit } from './types';
import OrderVerificationModal from './components/OrderVerificationModal';
import OrderSummary from './components/OrderSummary';
import BundleSelectModal from './components/BundleSelectModal';
import { applyCartPromotions } from './services/promotionService';
import { inviteUser } from './services/supabase/inviteUserService';
import OrderConfirmation from './components/OrderConfirmation';
import { useToasts } from './hooks/useToasts';
import ProfileMenu from './components/auth/ProfileMenu';
import { useAuth } from './hooks/useAuth';
import { profileToUser } from './lib/profileToUser';
import { useQueryClient } from '@tanstack/react-query';
import AdminView, { AdminTab } from './components/AdminView';
import OrderHistory from './components/OrderHistory';
import OrdersPage from './components/OrdersPage';
import UserProfile from './components/UserProfile';
import MobileCheckoutButton from './components/MobileCheckoutButton';
import RepDashboardV2 from './components/RepDashboardV2';
import type { OrderingTabKey } from './components/OrderingTabBar';
import OrderDetailView from './components/OrderDetailView';
import NotificationBell from './components/NotificationBell';
import NotificationPanel from './components/NotificationPanel';
import { USERS, CATEGORIES, DEFAULT_SETTINGS } from './constants';
import { getHoReCaOutstanding } from './services/accountingService';
import { useLocalStorage } from './hooks/useLocalStorage';
import { startScheduledVisit } from './services/scheduledVisitService';
import { resolveHoReCaPrice, getAllApplicablePromotions, isPromotionActive } from './pricing';
import { LayoutDashboard, ShoppingCart, ShoppingBag, History, Menu, X, Users as UsersIcon, Package, FileText, Settings, Truck, Wallet, BarChart3, Tag, MapPin, Warehouse, UserPlus } from 'lucide-react';
import OutstandingPayments from './components/OutstandingPayments';
import AccountsAgingTable from './components/AccountsAgingTable';
import StockView from './components/StockView';
import HoReCaListView from './components/HoReCaListView';
import ScheduledVisitsView from './components/scheduled-visits/ScheduledVisitsView';
import { getOrderingHints } from './services/buyingPatternsService';
import type { OrderingHint } from './types';
import type { SortOption } from './components/ShopTopBar';
import ShopView from './views/ShopView';

// ── Query hooks ───────────────────────────────────────────────────────────────
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct } from './hooks/queries/useProducts';
import { useHoReCas, useCreateHoReCa, useUpdateHoReCa, useDeleteHoReCa } from './hooks/queries/useHoReCas';
import { useOrders, usePlaceOrder, useUpdateOrderStatus } from './hooks/queries/useOrders';
import { useInvoices, useUpdateInvoiceStatus } from './hooks/queries/useInvoices';
import { useSuppliers, useCreateSupplier, useUpdateSupplier, useDeleteSupplier } from './hooks/queries/useSuppliers';
import { usePurchaseOrders, useCreatePurchaseOrder, useUpdatePurchaseOrder } from './hooks/queries/usePurchaseOrders';
import { usePromotions, useCreatePromotion, useUpdatePromotion, useDeletePromotion } from './hooks/queries/usePromotions';
import { useScheduledVisits, useUpdateScheduledVisit, useCreateScheduledVisit } from './hooks/queries/useScheduledVisits';
import { useVisits, useCreateVisit } from './hooks/queries/useVisits';
import { useSalesTargets } from './hooks/queries/useSalesTargets';
import { useSettings, useUpdateSettings } from './hooks/queries/useSettings';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from './hooks/queries/useNotifications';
import { usePantryItems, useUpsertPantryItem, useDeletePantryItem } from './hooks/queries/usePantry';
import { useProfiles } from './hooks/queries/useProfiles';
import { setUserIdMap, numericIdToUuid } from './lib/userIdMap';

// ── Adapters ──────────────────────────────────────────────────────────────────
import {
    toProduct, toHoReCa, toOrder, toInvoice, toSupplier, toPurchaseOrder,
    toPromotion, toScheduledVisit, toVisit, toSalesTarget, toAppSettings, toNotification,
    fromProduct, fromHoReCa, fromSupplier, fromPromotion, fromScheduledVisit, fromAppSettings,
} from './lib/adapters';

const App: React.FC = () => {
    // ── Auth ────────────────────────────────────────────────────────────────
    // currentUser is derived from the real logged-in profile. AuthGate above
    // this component guarantees user + profile are non-null by the time App
    // renders, so the non-null assertions are safe here.
    const auth = useAuth();
    const currentUser = useMemo(() => profileToUser(auth.profile!), [auth.profile]);
    const currentUserUuid = auth.user?.id ?? '';
    const queryClient = useQueryClient();

    // ── UI-only / client state ────────────────────────────────────────────────
    // appLogo now persisted in app_settings.companyLogoUrl (Supabase Storage URL).

    // Pantry kept in localStorage — complex keyed structure, migrated later
    // Pantry now persisted in Supabase per HoReCa via usePantryItems below.

    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
    const [selectedHoReCaId, setSelectedHoReCaId] = useState<number | null>(null);
    const [notes, setNotes] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortOption, setSortOption] = useState<SortOption>('');
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<{hoReCa?: string; emptyOrder?: string, api?: string}>({});
    const [confirmation, setConfirmation] = useState<{order: Order, message: string} | null>(null);
    const [view, setView] = useState<'ordering' | 'orders' | 'dashboard' | 'hoReCas' | 'stock' | 'accounts' | 'scheduled_visits'>('dashboard');
    const [adminView, setAdminView] = useState<AdminTab>('Dashboard');
    const [orderingTab, setOrderingTab] = useState<'catalogue' | 'pantry' | 'reorder'>('catalogue');
    const [deliveryDate, setDeliveryDate] = useState('');
    const [deliveryTimeSlot, setDeliveryTimeSlot] = useState<DeliveryTimeSlot | ''>('');
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [showVerificationModal, setShowVerificationModal] = useState(false);
    const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [initialRouteId, setInitialRouteId] = useState<string | null>(null);

    // ── Server state — Supabase query hooks ──────────────────────────────────
    const { data: rawProducts = [] } = useProducts();
    const { data: rawHoReCas = [] } = useHoReCas();
    const { data: rawOrders = [] } = useOrders();
    const { data: rawInvoices = [] } = useInvoices();
    const { data: rawSuppliers = [] } = useSuppliers();
    const { data: rawPurchaseOrders = [] } = usePurchaseOrders();

    const { data: rawPromotions = [] } = usePromotions();
    const { data: rawRoutes = [] } = useScheduledVisits();
    const { data: rawVisits = [] } = useVisits();
    const { data: rawProfiles = [] } = useProfiles();

    // Populate the numeric-id → real-profile-UUID registry used by adapters
    // (scheduled_visits, etc). Falls back to deterministic UUIDs if profiles
    // haven't loaded yet. See lib/userIdMap.ts for the rationale.
    useEffect(() => {
        if (!rawProfiles.length) return;
        const byEmail = new Map(rawProfiles.map(p => [p.email, p.id]));
        const entries: Array<[number, string]> = [];
        for (const u of USERS) {
            const uuid = byEmail.get(u.email);
            if (uuid) entries.push([u.id, uuid]);
        }
        setUserIdMap(entries);
    }, [rawProfiles]);
    const { data: rawSalesTargets = [] } = useSalesTargets();
    const { data: rawSettings } = useSettings();
    const { data: rawNotifications = [] } = useNotifications(currentUserUuid, currentUser.role);

    // ── Adapt DB rows → frontend types ───────────────────────────────────────
    const products = useMemo(() => rawProducts.map(toProduct), [rawProducts]);
    const hoReCas = useMemo(() => rawHoReCas.map(toHoReCa), [rawHoReCas]);
    const suppliers = useMemo(() => rawSuppliers.map(toSupplier), [rawSuppliers]);
    const promotions = useMemo(() => rawPromotions.map(toPromotion), [rawPromotions]);
    const routes = useMemo(() => rawRoutes.map(toScheduledVisit), [rawRoutes]);
    const visits = useMemo(() => rawVisits.map(toVisit), [rawVisits]);
    const salesTargets = useMemo(() => rawSalesTargets.map(toSalesTarget), [rawSalesTargets]);
    const invoices = useMemo(() => rawInvoices.map(toInvoice), [rawInvoices]);
    const notifications = useMemo(() => rawNotifications.map(toNotification), [rawNotifications]);
    const appSettings = useMemo(() => rawSettings ? toAppSettings(rawSettings) : DEFAULT_SETTINGS, [rawSettings]);

    // Users are derived from real profiles loaded from Supabase. Seeded
    // profiles map back to their numeric USERS id via profileToUser;
    // unknown profiles get a stable high-range id. Falls back to mock USERS
    // during the brief boot window before profiles have loaded.
    const users = useMemo(
        () => (rawProfiles.length > 0 ? rawProfiles.map(profileToUser) : USERS),
        [rawProfiles],
    );

    // Orders embed hoReCa, user, and product objects
    const allOrders = useMemo(
        () => rawOrders.map(o => toOrder(o, hoReCas, users, products)),
        [rawOrders, hoReCas, users, products]
    );

    // Purchase orders embed supplier and user objects
    const purchaseOrders = useMemo(
        () => rawPurchaseOrders.map(po => toPurchaseOrder(po, suppliers, users)),
        [rawPurchaseOrders, suppliers, users]
    );

    // ── Mutation hooks ────────────────────────────────────────────────────────
    const createProductMutation = useCreateProduct();
    const updateProductMutation = useUpdateProduct();
    const deleteProductMutation = useDeleteProduct();

    const createHoReCaMutation = useCreateHoReCa();
    const updateHoReCaMutation = useUpdateHoReCa();
    const deleteHoReCaMutation = useDeleteHoReCa();

    const createSupplierMutation = useCreateSupplier();
    const updateSupplierMutation = useUpdateSupplier();
    const deleteSupplierMutation = useDeleteSupplier();

    const placeOrderMutation = usePlaceOrder();
    const updateOrderStatusMutation = useUpdateOrderStatus();

    const updateInvoiceStatusMutation = useUpdateInvoiceStatus();

    const createPurchaseOrderMutation = useCreatePurchaseOrder();
    const updatePurchaseOrderMutation = useUpdatePurchaseOrder();

    const createPromotionMutation = useCreatePromotion();
    const updatePromotionMutation = useUpdatePromotion();
    const deletePromotionMutation = useDeletePromotion();

    const updateRouteMutation = useUpdateScheduledVisit();
    const createRouteMutation = useCreateScheduledVisit();

    const markNotificationReadMutation = useMarkNotificationRead();
    const markAllNotificationsReadMutation = useMarkAllNotificationsRead();

    const updateSettingsMutation = useUpdateSettings();

    const { addToast } = useToasts();

    // ── Memoized derived state ────────────────────────────────────────────────
    const selectedHoReCa = useMemo(() => {
        if (currentUser.role === UserRole.CUSTOMER) {
            return hoReCas.find(c => c.id === currentUser.hoReCaId);
        }
        return hoReCas.find(c => c.id === selectedHoReCaId);
    }, [hoReCas, selectedHoReCaId, currentUser]);

    // ── Pantry (per HoReCa, persisted in Supabase) ────────────────────────────
    const { data: rawPantryRows = [] } = usePantryItems(selectedHoReCa?.id ?? null);
    const upsertPantryItemMutation = useUpsertPantryItem();
    const deletePantryItemMutation = useDeletePantryItem();

    const total = useMemo(() => orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0), [orderItems]);

    const orderingHints = useMemo(() => {
        if (!selectedHoReCa) return [];
        const cartProductIds = orderItems.map(item => item.id);
        return getOrderingHints(allOrders, selectedHoReCa.id, cartProductIds);
    }, [allOrders, selectedHoReCa, orderItems]);

    const hintsPerProduct = useMemo(() => {
        const map = new Map<number, OrderingHint[]>();
        for (const hint of orderingHints) {
            if (hint.type === 'missing_from_usual') continue;
            const existing = map.get(hint.productId) ?? [];
            map.set(hint.productId, [...existing, hint]);
        }
        return map;
    }, [orderingHints]);

    const missingItemHints = useMemo(
        () => orderingHints.filter(h => h.type === 'missing_from_usual'),
        [orderingHints]
    );

    const filteredProducts = useMemo(() => {
        let categoryFiltered;
        if (selectedCategory === 'All') {
            categoryFiltered = products;
        } else if (selectedCategory === 'Deals') {
            categoryFiltered = products.filter(p =>
                getAllApplicablePromotions(p, selectedHoReCa, currentUser, promotions).length > 0
            );
        } else {
            categoryFiltered = products.filter(p => p.category === selectedCategory);
        }

        let result = categoryFiltered;
        if (searchQuery.trim()) {
            const lowercasedQuery = searchQuery.toLowerCase();
            result = result.filter(p =>
                p.name.toLowerCase().includes(lowercasedQuery) ||
                p.description.toLowerCase().includes(lowercasedQuery)
            );
        }

        // Sort
        if (sortOption === 'price-asc') {
            result = [...result].sort((a, b) => resolveHoReCaPrice(a, selectedHoReCa) - resolveHoReCaPrice(b, selectedHoReCa));
        } else if (sortOption === 'price-desc') {
            result = [...result].sort((a, b) => resolveHoReCaPrice(b, selectedHoReCa) - resolveHoReCaPrice(a, selectedHoReCa));
        } else if (sortOption === 'name-asc') {
            result = [...result].sort((a, b) => a.name.localeCompare(b.name));
        } else if (sortOption === 'name-desc') {
            result = [...result].sort((a, b) => b.name.localeCompare(a.name));
        } else if (sortOption === 'newest') {
            result = [...result].sort((a, b) => b.id - a.id);
        } else if (sortOption === 'popularity') {
            const freq = new Map<number, number>();
            for (const order of allOrders) {
                for (const item of order.items) {
                    freq.set(item.id, (freq.get(item.id) ?? 0) + item.quantity);
                }
            }
            result = [...result].sort((a, b) => (freq.get(b.id) ?? 0) - (freq.get(a.id) ?? 0));
        }

        return result;
    }, [products, selectedCategory, searchQuery, selectedHoReCa, currentUser, promotions, sortOption, allOrders]);

    const recentHoReCaProducts = useMemo(() => {
        if (!selectedHoReCa) return [];
        const hoReCaOrders = allOrders
            .filter(o => o.hoReCa.id === selectedHoReCa.id)
            .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
        const seen = new Set<number>();
        const result: Product[] = [];
        for (const order of hoReCaOrders) {
            for (const item of order.items) {
                if (!seen.has(item.id)) {
                    const product = products.find(p => p.id === item.id);
                    if (product) {
                        seen.add(item.id);
                        result.push(product);
                        if (result.length >= 3) return result;
                    }
                }
            }
        }
        return result;
    }, [allOrders, selectedHoReCa, products]);

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleAddItem = (product: Product, options: { packSize?: number; price: number; unit: string; }, quantity: number = 1) => {
        const { packSize, price, unit } = options;
        setOrderItems(prevItems => {
            const existingItem = prevItems.find(item => item.id === product.id && item.packSize === packSize);

            if (existingItem) {
                return prevItems.map(item =>
                    (item.id === product.id && item.packSize === packSize)
                        ? { ...item, quantity: item.quantity + quantity }
                        : item
                );
            }

            return [...prevItems, { ...product, quantity, price, packSize, unit }];
        });
        addToast(`${product.name} (${unit}) added to order.`, 'info');
    };

    const [bundleModalPromo, setBundleModalPromo] = useState<Promotion | null>(null);

    const handleApplyPromo = (promo: Promotion) => {
        if (promo.type === 'bundle' && promo.bundleConfig) {
            setBundleModalPromo(promo);
            return;
        }
        if (promo.type === 'bogo' && promo.bogoConfig) {
            const buyProduct = products.find(p => p.id === promo.bogoConfig!.buyProductId);
            if (!buyProduct) {
                addToast('Promo product not found.', 'error');
                return;
            }
            const isCarton = (promo.appliesTo ?? 'unit') === 'carton';
            const packSize = isCarton ? buyProduct.cartonSize : undefined;
            const unit = isCarton ? `Carton (x${buyProduct.cartonSize})` : buyProduct.unit;
            const price = isCarton
                ? buyProduct.price * buyProduct.cartonSize * (1 - appSettings.cartonDiscountPercent / 100)
                : buyProduct.price;
            handleAddItem(buyProduct, { packSize, price, unit }, promo.bogoConfig.buyQuantity);
            addToast(`Promo applied: ${promo.name}. Free items will be added automatically.`, 'success');
        }
    };

    const handleBundleConfirm = (rows: Array<{ product: Product; quantity: number; packSize?: number; price: number; unit: string }>) => {
        rows.forEach(r => handleAddItem(r.product, { packSize: r.packSize, price: r.price, unit: r.unit }, r.quantity));
    };

    const handleUpdateQuantity = (productId: number, newQuantity: number, packSize?: number) => {
        if (newQuantity <= 0) {
            setOrderItems(prev => prev.filter(item => !(item.id === productId && item.packSize === packSize)));
        } else {
            setOrderItems(prev => prev.map(item =>
                (item.id === productId && item.packSize === packSize)
                    ? { ...item, quantity: newQuantity }
                    : item
            ));
        }
    };

    // ── Pantry handlers (Supabase-backed) ─────────────────────────────────────
    const currentPantryItems: PantryItem[] = useMemo(() => {
        type PantryRow = { product_id: number; preferred_pack_size: number | null; default_quantity: number }
        return (rawPantryRows as PantryRow[]).map(row => ({
            productId: row.product_id,
            preferredPackSize: row.preferred_pack_size ?? undefined,
            defaultQuantity: row.default_quantity,
        }));
    }, [rawPantryRows]);

    const getLastOrderedQuantity = useCallback((hoReCaId: number, productId: number, packSize?: number): number => {
        const hoReCaOrders = allOrders
            .filter(o => o.hoReCa.id === hoReCaId)
            .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
        for (const order of hoReCaOrders) {
            const item = order.items.find(i => i.id === productId && i.packSize === packSize);
            if (item) return item.quantity;
        }
        return 1;
    }, [allOrders]);

    const handleTogglePantry = useCallback((productId: number) => {
        const custId = selectedHoReCa?.id;
        if (!custId) return;
        const exists = currentPantryItems.some(item => item.productId === productId);
        if (exists) {
            deletePantryItemMutation.mutate({ horecaId: custId, productId });
            return;
        }
        const defaultQuantity = getLastOrderedQuantity(custId, productId);
        upsertPantryItemMutation.mutate({
            horeca_id: custId,
            product_id: productId,
            preferred_pack_size: null,
            default_quantity: defaultQuantity,
        });
    }, [selectedHoReCa, currentPantryItems, getLastOrderedQuantity, upsertPantryItemMutation, deletePantryItemMutation]);

    const handleRemoveFromPantry = useCallback((productId: number) => {
        const custId = selectedHoReCa?.id;
        if (!custId) return;
        deletePantryItemMutation.mutate({ horecaId: custId, productId });
    }, [selectedHoReCa, deletePantryItemMutation]);

    const handleUpdatePantryItem = useCallback((productId: number, updates: Partial<Pick<PantryItem, 'preferredPackSize' | 'defaultQuantity'>>) => {
        const custId = selectedHoReCa?.id;
        if (!custId) return;
        const existing = currentPantryItems.find(i => i.productId === productId);
        if (!existing) return;
        const merged = { ...existing, ...updates };
        upsertPantryItemMutation.mutate({
            horeca_id: custId,
            product_id: productId,
            preferred_pack_size: merged.preferredPackSize ?? null,
            default_quantity: merged.defaultQuantity,
        });
    }, [selectedHoReCa, currentPantryItems, upsertPantryItemMutation]);

    const handleAddPantryItemToOrder = useCallback((pantryItem: PantryItem) => {
        const product = products.find(p => p.id === pantryItem.productId);
        if (!product) return;

        const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);

        let price: number;
        let unit: string;
        if (pantryItem.preferredPackSize === product.cartonSize) {
            const discountMultiplier = 1 - (appSettings.cartonDiscountPercent / 100);
            price = (unitPrice * product.cartonSize) * discountMultiplier;
            unit = `carton of ${product.cartonSize}`;
        } else {
            price = unitPrice;
            unit = product.unit;
        }

        handleAddItem(product, { packSize: pantryItem.preferredPackSize, price, unit }, pantryItem.defaultQuantity);
    }, [products, selectedHoReCa, handleAddItem, appSettings.cartonDiscountPercent]);

    const pantryEstTotal = useMemo(() => {
        let total = 0;
        for (const pantryItem of currentPantryItems) {
            const product = products.find(p => p.id === pantryItem.productId);
            if (!product || product.inventory <= 0) continue;
            const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);
            if (pantryItem.preferredPackSize === product.cartonSize) {
                total += (unitPrice * product.cartonSize) * (1 - appSettings.cartonDiscountPercent / 100) * pantryItem.defaultQuantity;
            } else {
                total += unitPrice * pantryItem.defaultQuantity;
            }
        }
        return total;
    }, [currentPantryItems, products, selectedHoReCa, appSettings.cartonDiscountPercent]);

    const handleAddAllPantryToOrder = useCallback(() => {
        currentPantryItems.forEach(item => handleAddPantryItemToOrder(item));
        addToast('All pantry items added to order!', 'success');
    }, [currentPantryItems, handleAddPantryItemToOrder, addToast]);

    const handleAddSelectedPantryToOrder = useCallback((items: PantryItem[]) => {
        items.forEach(item => handleAddPantryItemToOrder(item));
        addToast(`${items.length} item${items.length !== 1 ? 's' : ''} added to order!`, 'success');
    }, [handleAddPantryItemToOrder, addToast]);

    // Last order for the selected HoReCa (for reorder tab)
    const lastOrderForHoReCa = useMemo(() => {
        const custId = selectedHoReCa?.id ?? (currentUser.role === UserRole.CUSTOMER ? currentUser.hoReCaId : null);
        if (!custId) return null;
        const hoReCaOrders = allOrders
            .filter(o => o.hoReCa.id === custId)
            .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
        return hoReCaOrders[0] ?? null;
    }, [allOrders, selectedHoReCa, currentUser]);

    const handleReorderItems = useCallback((items: OrderItem[], mode: 'replace' | 'merge') => {
        if (mode === 'replace') {
            setOrderItems(items);
        } else {
            setOrderItems(prev => {
                const merged = [...prev];
                for (const newItem of items) {
                    const existing = merged.find(i => i.id === newItem.id && i.packSize === newItem.packSize);
                    if (existing) {
                        existing.quantity += newItem.quantity;
                    } else {
                        merged.push(newItem);
                    }
                }
                return merged;
            });
        }
        addToast(`${items.length} item${items.length !== 1 ? 's' : ''} added to order!`, 'success');
    }, [addToast]);

    const resetOrder = useCallback(() => {
        setOrderItems([]);
        setSelectedHoReCaId(null);
        setNotes('');
        setDeliveryDate('');
        setDeliveryTimeSlot('');
        setErrors({});
        setIsLoading(false);
        setConfirmation(null);
        setView('ordering');
        setIsCartOpen(false);
        setOrderingTab('catalogue');
    }, []);

    const handleSubmitOrder = () => {
        let validationErrors: {hoReCa?: string, emptyOrder?: string, api?: string} = {};
        if ((currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP) && !selectedHoReCaId) {
            validationErrors.hoReCa = "Please select a customer.";
        }
        if (orderItems.length === 0) {
            validationErrors.emptyOrder = "Cannot submit an empty order.";
        }
        if (appSettings.minimumOrderValue > 0 && total < appSettings.minimumOrderValue) {
            validationErrors.api = `Minimum order value is $${appSettings.minimumOrderValue.toFixed(2)}.`;
        }
        setErrors(validationErrors);

        // Check outstanding payment block (90+ days)
        if (selectedHoReCa) {
            const outstanding = getHoReCaOutstanding(selectedHoReCa.id, selectedHoReCa.name, invoices);
            if (outstanding.isBlocked && !isAdminOrManager) {
                validationErrors.api = "Orders blocked: this HoReCa has payments overdue by 90+ days.";
            }
        }

        if (Object.keys(validationErrors).length > 0) {
            setErrors(validationErrors);
            return;
        }

        const hoReCaForOrder = selectedHoReCa;
        if (!hoReCaForOrder) {
             setErrors({ api: "HoReCa information is missing. Please contact support." });
             return;
        }

        // Re-validate promotions: warn for any that are no longer active/applicable.
        const now = new Date();
        const stillActive = promotions.filter(p => isPromotionActive(p, now));
        const previousResult = applyCartPromotions(orderItems, promotions, hoReCaForOrder, currentUser, products);
        const currentResult = applyCartPromotions(orderItems, stillActive, hoReCaForOrder, currentUser, products);
        const droppedPromoNames = new Set<string>();
        previousResult.bogoFreeItems.forEach(b => {
            if (!currentResult.bogoFreeItems.some(c => c.promoId === b.promoId)) droppedPromoNames.add(b.promoName);
        });
        previousResult.bundleDiscounts.forEach(b => {
            if (!currentResult.bundleDiscounts.some(c => c.promoId === b.promoId)) droppedPromoNames.add(b.promoName);
        });
        droppedPromoNames.forEach(name => {
            addToast(`Promo "${name}" is no longer available — it has been removed from your order.`, 'info');
        });

        // HoReCa users skip verification; all staff roles require it
        if (currentUser.role === UserRole.CUSTOMER) {
            placeOrder(undefined);
        } else {
            setShowVerificationModal(true);
        }
    };

    const placeOrder = useCallback((verification?: OrderVerification) => {
        setShowVerificationModal(false);
        setIsLoading(true);
        setErrors({});

        const hoReCaForOrder = selectedHoReCa;
        if (!hoReCaForOrder) {
            setErrors({ api: "HoReCa information is missing." });
            setIsLoading(false);
            return;
        }

        const now = new Date().toISOString();
        const newOrder: Order = {
            id: `${appSettings.orderIdPrefix}-${Date.now()}`,
            hoReCa: hoReCaForOrder,
            items: orderItems,
            total,
            orderDate: now,
            submittedBy: currentUser,
            notes,
            status: 'processing' as const,
            statusHistory: [{ status: 'processing' as const, timestamp: now }],
            deliveryDate: deliveryDate || undefined,
            deliveryTimeSlot: (deliveryTimeSlot || undefined) as DeliveryTimeSlot | undefined,
            verification,
        };

        const confirmationMessage = `Your order has been sent to OrderStream for fulfillment.`;

        // Persist the order to Supabase via the place-order Edge Function.
        // Server recomputes prices, applies promotions, checks stock + credit.
        placeOrderMutation.mutate({
            hoReCaId: hoReCaForOrder.id,
            items: orderItems.map(item => ({
                productId: item.id,
                quantity: item.quantity,
                packSize: item.packSize ?? null,
            })),
            notes: notes || null,
            deliveryDate: deliveryDate || null,
            deliveryTimeSlot: (deliveryTimeSlot || null) as 'AM' | 'PM' | null,
            verification: (verification ?? null) as unknown as Record<string, unknown> | null,
        }, {
            onSuccess: (result) => {
                const persistedOrder: Order = { ...newOrder, id: result.orderId, total: result.total };
                setConfirmation({ order: persistedOrder, message: confirmationMessage });
                addToast('Order submitted successfully!', 'success');
                setIsLoading(false);
            },
            onError: (err) => {
                setIsLoading(false);
                setErrors({ api: err.message });
                addToast(err.message, 'error');
            },
        });
    }, [selectedHoReCa, orderItems, total, currentUser, notes, deliveryDate, deliveryTimeSlot, addToast, placeOrderMutation]);

    const handleReorder = (order: Order) => {
        resetOrder();
        const validItems: OrderItem[] = [];
        const skippedItems: string[] = [];
        const hoReCa = hoReCas.find(c => c.id === order.hoReCa.id);

        for (const item of order.items) {
            const currentProduct = products.find(p => p.id === item.id);
            if (!currentProduct || currentProduct.inventory <= 0) {
                skippedItems.push(item.name);
                continue;
            }
            const currentPrice = hoReCa?.pricing?.[currentProduct.id] ?? currentProduct.price;
            let price = currentPrice;
            let unit = currentProduct.unit;
            if (item.packSize === currentProduct.cartonSize) {
                price = (currentPrice * currentProduct.cartonSize) * (1 - appSettings.cartonDiscountPercent / 100);
                unit = `carton of ${currentProduct.cartonSize}`;
            }
            validItems.push({ ...currentProduct, quantity: item.quantity, price, packSize: item.packSize, unit });
        }

        if (validItems.length === 0) {
            addToast('All items from this order are no longer available.', 'error');
            return;
        }

        setOrderItems(validItems);
        if ((currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP) && hoReCas.some(c => c.id === order.hoReCa.id)) {
            setSelectedHoReCaId(order.hoReCa.id);
        }
        setNotes(order.notes || '');
        setView('ordering');

        if (skippedItems.length > 0) {
            addToast(`Skipped unavailable: ${skippedItems.join(', ')}`, 'info');
        } else {
            addToast(`Reordering from ${order.id}.`, 'info');
        }
    };

    const handleStartOrder = (hoReCaId: number) => {
        resetOrder();
        setSelectedHoReCaId(hoReCaId);
        setView('ordering');
    };

    // ── Order status management ───────────────────────────────────────────────
    const handleUpdateOrderStatus = useCallback((orderId: string, newStatus: OrderStatus, note?: string) => {
        updateOrderStatusMutation.mutate({ id: orderId, status: newStatus, note }, {
            onSuccess: () => {
                addToast(`Order ${orderId} updated to ${newStatus}.`, 'success');
            },
            onError: (err) => {
                addToast(`Error updating order: ${err.message}`, 'error');
            },
        });
    }, [updateOrderStatusMutation, addToast]);

    // ── Invoice management ────────────────────────────────────────────────────
    const handleUpdateInvoiceStatus = useCallback((invoiceId: string, status: Invoice['status']) => {
        updateInvoiceStatusMutation.mutate(
            {
                id: invoiceId,
                status,
                paidDate: status === 'paid' ? new Date().toISOString() : undefined,
            },
            {
                onSuccess: () => addToast(`Invoice ${invoiceId} marked as ${status}.`, 'success'),
                onError: (err) => addToast(`Error updating invoice: ${err.message}`, 'error'),
            }
        );
    }, [updateInvoiceStatusMutation, addToast]);

    // ── Notification management ───────────────────────────────────────────────
    const handleMarkNotificationRead = useCallback((id: string) => {
        markNotificationReadMutation.mutate(id);
    }, [markNotificationReadMutation]);

    const handleMarkAllNotificationsRead = useCallback(() => {
        markAllNotificationsReadMutation.mutate(currentUserUuid);
    }, [markAllNotificationsReadMutation, currentUser.id]);

    // ── setRoutes shim — child components that accept setRoutes as a prop ─────
    // ScheduledVisitsView and AdminView pass setRoutes to update route state. Since routes
    // are now in Supabase we intercept the setter pattern and fire mutations instead.
    // We support the two write patterns used in child components:
    //   (prev) => prev.map(r => r.id === id ? updated : r)   → updateScheduledVisit
    //   (prev) => [...prev, newRoute]                        → createScheduledVisit
    const setRoutes = useCallback((updater: ScheduledVisit[] | ((prev: ScheduledVisit[]) => ScheduledVisit[])) => {
        const next = typeof updater === 'function' ? updater(routes) : updater;
        // Detect which routes changed
        const prevIds = new Set(routes.map(r => r.id));
        const nextIds = new Set(next.map(r => r.id));

        // Create: routes present in next but not in prev
        for (const r of next) {
            if (!prevIds.has(r.id)) {
                createRouteMutation.mutate(fromScheduledVisit(r) as any);
            }
        }

        // Update: routes present in both but modified
        for (const r of next) {
            if (prevIds.has(r.id)) {
                const prev = routes.find(pr => pr.id === r.id);
                if (prev && JSON.stringify(prev) !== JSON.stringify(r)) {
                    updateRouteMutation.mutate({ id: r.id, updates: fromScheduledVisit(r) as any });
                }
            }
        }
        // Note: deletes are not needed for the current call sites
    }, [routes, createRouteMutation, updateRouteMutation]);

    // ── setVisits shim — child components that accept setVisits as a prop ─────
    // Visits are append-only in the current codebase (setVisits(prev => [...prev, newVisit]))
    const createVisitMutation = useCreateVisit();
    const setVisits = useCallback((updater: Visit[] | ((prev: Visit[]) => Visit[])) => {
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
    }, [visits, createVisitMutation]);

    // ── setSalesTargets shim — AdminView and RepDashboard pass this prop ──────
    // Not yet migrated — keep as a no-op that shows a toast. The DB version is
    // handled through useSalesTargets; the UI currently just reads salesTargets.
    const setSalesTargets = useCallback((_updater: SalesTarget[] | ((prev: SalesTarget[]) => SalesTarget[])) => {
        // Sales target writes will be handled by dedicated mutation hooks in a
        // future task. For now the data is read-only from Supabase.
    }, []);

    // ── Low stock detection ───────────────────────────────────────────────────
    // Notifications are now in Supabase so we skip the local setNotifications
    // write. Low-stock notifications will be generated server-side via a trigger.
    const lowStockAlertedRef = useRef<Set<number>>(new Set());
    useEffect(() => {
        if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.MANAGER) return;
        const threshold = appSettings.lowStockThreshold;
        for (const product of products) {
            if (product.inventory > 0 && product.inventory <= threshold && !lowStockAlertedRef.current.has(product.id)) {
                lowStockAlertedRef.current.add(product.id);
                // Low-stock toasts remain client-side for immediate feedback
                addToast(`Low stock: ${product.name} has only ${product.inventory} units remaining`, 'info');
            }
        }
    }, [products, appSettings.lowStockThreshold, currentUser.role, addToast]);

    // ── Derived state ─────────────────────────────────────────────────────────
    const selectedOrder = useMemo(() => {
        if (!selectedOrderId) return null;
        return allOrders.find(o => o.id === selectedOrderId) ?? null;
    }, [selectedOrderId, allOrders]);

    const selectedOrderInvoice = useMemo(() => {
        if (!selectedOrderId) return undefined;
        return invoices.find(inv => inv.orderId === selectedOrderId);
    }, [selectedOrderId, invoices]);

    const userNotifications = useMemo(() => {
        return notifications.filter(n => !n.targetRoles || n.targetRoles.includes(currentUser.role));
    }, [notifications, currentUser.role]);

    const unreadNotificationCount = useMemo(() => {
        return userNotifications.filter(n => !n.read).length;
    }, [userNotifications]);

    const isRep = currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP;
    const isFieldRep = currentUser.role === UserRole.FIELD_REP;
    const isHoReCaUser = currentUser.role === UserRole.CUSTOMER;
    const isAdminOrManager = currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER;

    // Badge count: walk-in customers awaiting admin review
    const walkInReviewCount = useMemo(
        () => hoReCas.filter(h => h.isTemporary && !h.reviewedAt).length,
        [hoReCas],
    );

    // Badge count: newly assigned routes (within 48h, still planned)
    const newAssignmentCount = useMemo(() => {
      if (!isFieldRep) return 0;
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      return routes.filter(r =>
        r.assignedTo === currentUser.id &&
        r.status === 'planned' &&
        r.assignedAt &&
        new Date(r.assignedAt).getTime() > cutoff
      ).length;
    }, [routes, currentUser.id, isFieldRep]);

    const showStockTab = (() => {
        if (!isHoReCaUser) return true;
        if (selectedHoReCa?.showStockTab !== undefined) return selectedHoReCa.showStockTab;
        return appSettings.showStockToHoReCa;
    })();

    useEffect(() => {
        if (!showStockTab && view === 'stock' && isHoReCaUser) {
            setView('ordering');
        }
    }, [showStockTab, view, isHoReCaUser]);

    const ordersForHistory = useMemo(() => {
        if (isHoReCaUser) {
            return allOrders.filter(o => o.hoReCa.id === currentUser.hoReCaId);
        }
        // Reps, Admins, Managers see all orders
        return allOrders;
    }, [allOrders, currentUser, isHoReCaUser]);


    if (confirmation) {
        return <OrderConfirmation order={confirmation.order} confirmationMessage={confirmation.message} onClose={resetOrder} />;
    }

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
                        <div className="relative">
                            <NotificationBell unreadCount={unreadNotificationCount} onClick={() => setIsNotificationPanelOpen(!isNotificationPanelOpen)} />
                            {isNotificationPanelOpen && (
                                <NotificationPanel
                                    notifications={userNotifications}
                                    onMarkRead={handleMarkNotificationRead}
                                    onMarkAllRead={handleMarkAllNotificationsRead}
                                    onClose={() => setIsNotificationPanelOpen(false)}
                                />
                            )}
                        </div>
                        <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-stone-400 hover:text-stone-700 cursor-pointer">
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

                            {/* Orders */}
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
                                <History className="w-5 h-5 mr-3" /> Orders
                            </button>
                            <button
                                onClick={() => { setView('accounts'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${view === 'accounts' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Wallet className="w-5 h-5 mr-3" /> Accounts
                            </button>

                            {/* Field */}
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
                                                <span className="ml-auto text-xs font-bold text-white bg-teal-500 px-1.5 py-0.5 rounded-full min-w-[20px] text-center">{newAssignmentCount}</span>
                                            )}
                                        </button>
                                    )}
                                </>
                            )}

                            {/* Catalogue */}
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

                            {/* Sales & Orders */}
                            <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nexgen-blue">Sales & Orders</p>
                            <button
                                onClick={() => { setAdminView('Shop'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Shop' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <ShoppingBag className="w-5 h-5 mr-3" /> Shop
                            </button>
                            <button
                                onClick={() => { setAdminView('Orders'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Orders' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <ShoppingCart className="w-5 h-5 mr-3" /> Orders
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

                            {/* Field Ops */}
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

                            {/* Catalogue */}
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

                            {/* System */}
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
                                onClick={() => { setAdminView('Purchase Orders'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Purchase Orders' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <FileText className="w-5 h-5 mr-3" /> Purchase Orders
                            </button>
                            <button
                                onClick={() => { setAdminView('Settings'); setIsSidebarOpen(false); }}
                                className={`flex items-center w-full px-3 py-2.5 rounded-lg text-sm btn-press ${adminView === 'Settings' ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 hover:text-stone-900'}`}
                            >
                                <Settings className="w-5 h-5 mr-3" /> Settings
                            </button>
                        </>
                    )}
                </nav>
                <ProfileMenu currentUser={currentUser} />
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
                {/* Mobile menu button */}
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
                            <AdminView
                                activeTab={adminView}
                                currentUser={currentUser}
                                products={products}
                                hoReCas={hoReCas}
                                users={users}
                                suppliers={suppliers}
                                purchaseOrders={purchaseOrders}
                                allOrders={allOrders}
                                onAddProduct={(p) => {
                                    createProductMutation.mutate(fromProduct(p) as any, {
                                        onSuccess: () => addToast('Product added!', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdateProduct={(p) => {
                                    updateProductMutation.mutate({ id: p.id, updates: fromProduct(p) as any }, {
                                        onSuccess: () => addToast('Product updated!', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onDeleteProduct={(id) => {
                                    deleteProductMutation.mutate(id, {
                                        onSuccess: () => addToast('Product deleted', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onAddHoReCa={(c) => {
                                    createHoReCaMutation.mutate(fromHoReCa(c) as any, {
                                        onSuccess: () => addToast('HoReCa added', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdateHoReCa={(c) => {
                                    updateHoReCaMutation.mutate({ id: c.id, updates: fromHoReCa(c) as any }, {
                                        onSuccess: () => addToast('HoReCa updated', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onDeleteHoReCa={(id) => {
                                    deleteHoReCaMutation.mutate(id, {
                                        onSuccess: () => addToast('HoReCa deleted', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onAddUser={(u) => {
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
                                        .catch((err) => addToast(`Invite failed: ${err.message}`, 'error'));
                                }}
                                onUpdateUser={(u) => {
                                    addToast('User editing not yet supported via the secure path.', 'info');
                                }}
                                onDeleteUser={(id) => {
                                    addToast('User deletion not yet supported via the secure path.', 'info');
                                }}
                                onAddSupplier={(s) => {
                                    createSupplierMutation.mutate(fromSupplier(s) as any, {
                                        onSuccess: () => addToast('Supplier added', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdateSupplier={(s) => {
                                    updateSupplierMutation.mutate({ id: s.id, updates: fromSupplier(s) as any }, {
                                        onSuccess: () => addToast('Supplier updated', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onDeleteSupplier={(id) => {
                                    deleteSupplierMutation.mutate(id, {
                                        onSuccess: () => addToast('Supplier deleted', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onAddPurchaseOrder={(po) => {
                                    createPurchaseOrderMutation.mutate({
                                        po: {
                                            supplier_id: po.supplier.id,
                                            submitted_by: currentUserUuid,
                                            total: po.total,
                                            order_date: po.orderDate,
                                            status: po.status,
                                        },
                                        items: po.items.map(i => ({
                                            product_id: i.productId,
                                            product_name: i.productName,
                                            quantity: i.quantity,
                                            cost: i.cost,
                                        })),
                                    } as any, {
                                        onSuccess: () => addToast('PO created', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdatePurchaseOrder={(po) => {
                                    updatePurchaseOrderMutation.mutate({ id: po.id, updates: { status: po.status } as any }, {
                                        onSuccess: () => addToast('PO updated', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                invoices={invoices}
                                salesTargets={salesTargets}
                                onUpdateSalesTargets={setSalesTargets}
                                promotions={promotions}
                                onAddPromotion={(p) => {
                                    createPromotionMutation.mutate(fromPromotion(p) as any, {
                                        onSuccess: () => addToast('Promotion created!', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdatePromotion={(p) => {
                                    updatePromotionMutation.mutate({ id: p.id, updates: fromPromotion(p) as any }, {
                                        onSuccess: () => addToast('Promotion updated!', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onDeletePromotion={(id) => {
                                    deletePromotionMutation.mutate(id, {
                                        onSuccess: () => addToast('Promotion deleted', 'success'),
                                        onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                    });
                                }}
                                onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
                                onUpdateOrderStatus={handleUpdateOrderStatus}
                                onReorder={handleReorder}
                                onViewOrderDetail={setSelectedOrderId}
                                visits={visits}
                                routes={routes}
                                onSetRoutes={setRoutes}
                                addToast={addToast}
                                onSetAdminView={setAdminView}
                                appLogo={appSettings.companyLogoUrl ?? null}
                                appSettings={appSettings}
                                onUpdateLogo={(logo) => {
                                    updateSettingsMutation.mutate(fromAppSettings({ companyLogoUrl: logo }) as any, {
                                        onError: (err) => addToast(`Error saving logo: ${err.message}`, 'error'),
                                    });
                                }}
                                onSaveSettings={(s) => {
                                    updateSettingsMutation.mutate(fromAppSettings(s) as any, {
                                        onSuccess: () => addToast('Settings saved!', 'success'),
                                        onError: (err) => addToast(`Error saving settings: ${err.message}`, 'error'),
                                    });
                                }}
                            />
                        )}
                        {(isRep || isHoReCaUser) && (
                            <div>
                                {view === 'dashboard' && isRep && (
                                    <RepDashboardV2
                                        currentUser={currentUser}
                                        hoReCas={hoReCas}
                                        products={products}
                                        orders={allOrders}
                                        onStartOrder={handleStartOrder}
                                        invoices={invoices}
                                        salesTargets={salesTargets}
                                        onUpdateSalesTargets={setSalesTargets}
                                        visits={visits}
                                        setVisits={setVisits}
                                        routes={routes}
                                        onStartRoute={(route) => {
                                            const started = startScheduledVisit(route);
                                            updateRouteMutation.mutate({ id: started.id, updates: fromScheduledVisit(started) as any }, {
                                                onError: (err) => addToast(`Error starting scheduled visit: ${err.message}`, 'error'),
                                            });
                                            setInitialRouteId(started.id);
                                            setView('scheduled_visits');
                                        }}
                                        onViewRoute={(scheduledVisitId) => {
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
                                    isHoReCaUser
                                        ? <OrderHistory orders={ordersForHistory} hoReCas={hoReCas} currentUser={currentUser} onReorder={handleReorder} onBulkReorder={(selectedOrders) => {
                                            resetOrder();
                                            const allItems: OrderItem[] = [];
                                            for (const order of selectedOrders) {
                                                for (const item of order.items) {
                                                    const existing = allItems.find(i => i.id === item.id && i.packSize === item.packSize);
                                                    if (existing) { existing.quantity += item.quantity; }
                                                    else { allItems.push({ ...item }); }
                                                }
                                            }
                                            handleReorderItems(allItems, 'replace');
                                            setView('ordering');
                                        }} onViewDetail={setSelectedOrderId} onBack={() => setView('ordering')} />
                                        : <OrdersPage orders={ordersForHistory} hoReCas={hoReCas} currentUser={currentUser} onReorder={handleReorder} onBulkReorder={(selectedOrders) => {
                                            resetOrder();
                                            const allItems: OrderItem[] = [];
                                            for (const order of selectedOrders) {
                                                for (const item of order.items) {
                                                    const existing = allItems.find(i => i.id === item.id && i.packSize === item.packSize);
                                                    if (existing) { existing.quantity += item.quantity; }
                                                    else { allItems.push({ ...item }); }
                                                }
                                            }
                                            handleReorderItems(allItems, 'replace');
                                            setView('ordering');
                                        }} onViewDetail={setSelectedOrderId} onUpdateStatus={handleUpdateOrderStatus} onBack={() => setView(isRep ? 'dashboard' : 'ordering')} />
                                )}
                                {view === 'hoReCas' && isRep && (
                                    <HoReCaListView
                                        hoReCas={hoReCas}
                                        orders={allOrders}
                                        invoices={invoices}
                                        currentUser={currentUser}
                                        visits={visits}
                                        onAddHoReCa={(c) => {
                                            createHoReCaMutation.mutate(fromHoReCa(c) as any, {
                                                onSuccess: () => addToast('HoReCa added', 'success'),
                                                onError: (err) => addToast(`Error: ${err.message}`, 'error'),
                                            });
                                        }}
                                        onStartOrder={handleStartOrder}
                                        setVisits={setVisits}
                                    />
                                )}
                                {view === 'stock' && (
                                    <StockView
                                        products={products}
                                        currentUser={currentUser}
                                    />
                                )}
                                {view === 'accounts' && (
                                    <AccountsAgingTable invoices={invoices} hoReCas={hoReCas} currentUser={currentUser} />
                                )}
                                {view === 'scheduled_visits' && isFieldRep && (
                                    <ScheduledVisitsView
                                        currentUser={currentUser}
                                        hoReCas={hoReCas}
                                        routes={routes}
                                        setRoutes={setRoutes}
                                        visits={visits}
                                        setVisits={setVisits}
                                        orders={allOrders}
                                        users={users}
                                        onStartOrder={handleStartOrder}
                                        initialSelectedRouteId={initialRouteId}
                                        onClearInitialRoute={() => setInitialRouteId(null)}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>
            {isProfileOpen && (
                    <UserProfile
                        user={currentUser}
                        onClose={() => setIsProfileOpen(false)}
                        onSave={async (updatedUser) => {
                            try {
                                const { supabase } = await import('./lib/supabase');
                                const { error } = await supabase
                                    .from('profiles')
                                    .update({ name: updatedUser.name, email: updatedUser.email })
                                    .eq('id', currentUserUuid);
                                if (error) throw error;
                                queryClient.invalidateQueries({ queryKey: ['profiles'] });
                                addToast('Profile updated!', 'success');
                            } catch (err) {
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
                <OrderDetailView
                    order={selectedOrder}
                    currentUser={currentUser}
                    invoice={selectedOrderInvoice}
                    onUpdateStatus={isAdminOrManager ? handleUpdateOrderStatus : undefined}
                    onClose={() => setSelectedOrderId(null)}
                />
            )}

            {/* Order Verification Modal */}
            {showVerificationModal && (
                <OrderVerificationModal
                    userRole={currentUser.role}
                    onConfirm={(verification) => placeOrder(verification)}
                    onCancel={() => setShowVerificationModal(false)}
                />
            )}

            {/* Bundle Promo Selector */}
            {bundleModalPromo && (
                <BundleSelectModal
                    promotion={bundleModalPromo}
                    products={products}
                    cartonDiscountPercent={appSettings.cartonDiscountPercent}
                    onClose={() => setBundleModalPromo(null)}
                    onConfirm={handleBundleConfirm}
                />
            )}

        </div>
    );
};

export default App;
