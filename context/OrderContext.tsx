import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
    UserRole,
    type AppSettings,
    type DeliveryTimeSlot,
    type HoReCa,
    type Invoice,
    type Order,
    type OrderItem,
    type OrderVerification,
    type Product,
    type Promotion,
    type ToastType,
    type User,
} from '../types';
import { applyCartPromotions } from '../services/promotionService';
import { getHoReCaOutstanding } from '../services/accountingService';
import { isPromotionActive, cartonPrice as calcCartonPrice } from '../pricing';
import type { usePlaceOrder } from '../hooks/queries/useOrders';
import { useSubmitQrRequest } from '../hooks/queries/useQrOrderRequests';
import { MODULE_SHOP } from '../lib/modules';
import { isQrStaffRole, isVenueUser } from '../lib/venueUser';
import { handleQrSessionEnded } from '../lib/qr/qrSessionEnd';

type OrderErrors = { hoReCa?: string; emptyOrder?: string; api?: string };
type Confirmation = { order: Order; message: string };

/** How a submit ended. `error` is worded for a person; the cart shows it too via `errors`. */
export type SubmitResult = { ok: true } | { ok: false; error: string };

const roundCents = (n: number): number => Math.round(n * 100) / 100;
const sumItems = (items: OrderItem[]): number =>
    roundCents(items.reduce((sum, item) => sum + item.price * item.quantity, 0));

/** The lines and extras of one submit, whether they came from the cart or straight from a screen. */
interface SubmitArgs {
    items: OrderItem[];
    notes: string;
    deliveryDate: string;
    deliveryTimeSlot: DeliveryTimeSlot | '';
}

export interface OrderContextValue {
    // State
    orderItems: OrderItem[];
    selectedHoReCaId: number | null;
    selectedHoReCa: HoReCa | undefined;
    notes: string;
    deliveryDate: string;
    deliveryTimeSlot: DeliveryTimeSlot | '';
    isLoading: boolean;
    errors: OrderErrors;
    confirmation: Confirmation | null;
    showVerificationModal: boolean;
    bundleModalPromo: Promotion | null;
    total: number;

    // Setters needed by forms / modals
    setSelectedHoReCaId: (id: number | null) => void;
    setNotes: (v: string) => void;
    setDeliveryDate: (v: string) => void;
    setDeliveryTimeSlot: (v: DeliveryTimeSlot | '') => void;
    setShowVerificationModal: (v: boolean) => void;
    setBundleModalPromo: (v: Promotion | null) => void;
    setConfirmation: (v: Confirmation | null) => void;
    setErrors: (v: OrderErrors) => void;

    // Handlers
    handleAddItem: (product: Product, options: { packSize?: number; price: number; unit: string; uomId?: number }, quantity?: number) => void;
    handleApplyPromo: (promo: Promotion) => void;
    handleBundleConfirm: (rows: Array<{ product: Product; quantity: number; packSize?: number; price: number; unit: string }>) => void;
    handleUpdateQuantity: (productId: number, newQuantity: number, packSize?: number) => void;
    handleSubmitOrder: () => void;
    placeOrder: (verification?: OrderVerification) => void;
    handleReorder: (order: Order) => void;
    handleReorderItems: (items: OrderItem[], mode: 'replace' | 'merge') => void;
    handleStartOrder: (hoReCaId: number) => void;
    resetOrder: () => void;

    /**
     * Order exactly these lines now, bypassing the cart (the Kitchen screen's
     * "Order same again"). Takes the SAME path the cart's Submit does, so the same
     * checks apply: a QR Staff login files a request that waits for approval, a
     * Customer login places the order. Venue logins only -- anyone else resolves
     * `{ ok: false }`, because a rep's order needs a customer chosen and a
     * verification step this shortcut does not have.
     */
    orderItemsNow: (items: OrderItem[], options?: { notes?: string }) => Promise<SubmitResult>;
    /** Checkout files a request for approval instead of placing an order (QR Staff). */
    holdsForApproval: boolean;
}

interface OrderProviderProps {
    children: React.ReactNode;
    currentUser: User;
    products: Product[];
    hoReCas: HoReCa[];
    promotions: Promotion[];
    invoices: Invoice[];
    appSettings: AppSettings;
    addToast: (message: string, type: ToastType) => void;
    placeOrderMutation: ReturnType<typeof usePlaceOrder>;
    onResetView?: () => void;
    /** A kitchen request was filed (the cart already cleared if it came from the cart). */
    onQrSubmitted?: () => void;
}

const OrderContext = createContext<OrderContextValue | null>(null);

export function OrderProvider({
    children,
    currentUser,
    products,
    hoReCas,
    promotions,
    invoices,
    appSettings,
    addToast,
    placeOrderMutation,
    onResetView,
    onQrSubmitted,
}: OrderProviderProps) {
    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
    const [selectedHoReCaId, setSelectedHoReCaId] = useState<number | null>(null);
    const [notes, setNotes] = useState('');
    const [deliveryDate, setDeliveryDate] = useState('');
    const [deliveryTimeSlot, setDeliveryTimeSlot] = useState<DeliveryTimeSlot | ''>('');
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<OrderErrors>({});
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [showVerificationModal, setShowVerificationModal] = useState(false);
    const [bundleModalPromo, setBundleModalPromo] = useState<Promotion | null>(null);

    const isAdminOrManager =
        currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.MANAGER;

    // A venue login (Customer or kitchen QR Staff) is fixed to its own HoReCa; a
    // rep or admin picks one.
    const isVenueLogin = isVenueUser(currentUser.role);
    const isQrStaff = isQrStaffRole(currentUser.role);
    // Checkout files a held request for approval instead of placing an order.
    // `MODULE_SHOP` is a build constant, so on a tenant without the Shop this is
    // `false`, the mutation below is `null`, and none of the QR client ships.
    const holdsForApproval = MODULE_SHOP && isQrStaff;
    // Called under a build constant, so the number of hooks is fixed per bundle.
    const submitQrMutation = MODULE_SHOP ? useSubmitQrRequest() : null;

    const selectedHoReCa = useMemo(() => {
        if (isVenueLogin) {
            return hoReCas.find(c => c.id === currentUser.hoReCaId);
        }
        return hoReCas.find(c => c.id === selectedHoReCaId);
    }, [hoReCas, selectedHoReCaId, currentUser, isVenueLogin]);

    const total = useMemo(
        () => Math.round(orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100,
        [orderItems],
    );

    const handleAddItem = useCallback(
        (product: Product, options: { packSize?: number; price: number; unit: string; uomId?: number }, quantity: number = 1) => {
            const { packSize, price, unit, uomId } = options;
            // Dedup on uomId as well as packSize (mig 00067): two UOMs can share a
            // factor but have different explicit prices, so they're distinct lines.
            const sameLine = (item: OrderItem) =>
                item.id === product.id && item.packSize === packSize && item.uomId === uomId;
            setOrderItems(prevItems => {
                const existing = prevItems.find(sameLine);
                if (existing) {
                    return prevItems.map(item =>
                        sameLine(item) ? { ...item, quantity: item.quantity + quantity } : item,
                    );
                }
                return [...prevItems, { ...product, quantity, price, packSize, unit, uomId }];
            });
            addToast(`${product.name} (${unit}) added to order.`, 'info');
        },
        [addToast],
    );

    const handleApplyPromo = useCallback(
        (promo: Promotion) => {
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
                    ? calcCartonPrice(buyProduct.price, buyProduct.cartonSize, appSettings.cartonDiscountPercent)
                    : buyProduct.price;
                handleAddItem(buyProduct, { packSize, price, unit }, promo.bogoConfig.buyQuantity);
                addToast(`Promo applied: ${promo.name}. Free items will be added automatically.`, 'success');
            }
        },
        [products, appSettings.cartonDiscountPercent, addToast, handleAddItem],
    );

    const handleBundleConfirm = useCallback(
        (rows: Array<{ product: Product; quantity: number; packSize?: number; price: number; unit: string }>) => {
            rows.forEach(r => handleAddItem(r.product, { packSize: r.packSize, price: r.price, unit: r.unit }, r.quantity));
        },
        [handleAddItem],
    );

    const handleUpdateQuantity = useCallback((productId: number, newQuantity: number, packSize?: number) => {
        if (newQuantity <= 0) {
            setOrderItems(prev => prev.filter(item => !(item.id === productId && item.packSize === packSize)));
        } else {
            setOrderItems(prev =>
                prev.map(item =>
                    item.id === productId && item.packSize === packSize ? { ...item, quantity: newQuantity } : item,
                ),
            );
        }
    }, []);

    // The cart's own state, without the navigation `onResetView` does. A kitchen
    // request clears the cart and then goes to the Kitchen screen, not the Shop.
    const clearCart = useCallback(() => {
        setOrderItems([]);
        setSelectedHoReCaId(null);
        setNotes('');
        setDeliveryDate('');
        setDeliveryTimeSlot('');
        setErrors({});
        setIsLoading(false);
        setConfirmation(null);
    }, []);

    const resetOrder = useCallback(() => {
        clearCart();
        onResetView?.();
    }, [clearCart, onResetView]);

    // Place a real order from `args.items`. Shared by the cart's Submit, the
    // verification modal's Confirm and the Kitchen screen's "Order same again", so
    // the three can never place an order in three slightly different ways.
    const runPlaceOrder = useCallback(
        (args: SubmitArgs & { verification?: OrderVerification }): Promise<SubmitResult> => {
            setShowVerificationModal(false);
            setIsLoading(true);
            setErrors({});

            const hoReCaForOrder = selectedHoReCa;
            if (!hoReCaForOrder) {
                const error = 'HoReCa information is missing.';
                setErrors({ api: error });
                setIsLoading(false);
                return Promise.resolve({ ok: false, error });
            }

            const now = new Date().toISOString();
            const newOrder: Order = {
                id: `${appSettings.orderIdPrefix}-${Date.now()}`,
                hoReCa: hoReCaForOrder,
                items: args.items,
                total: sumItems(args.items),
                orderDate: now,
                submittedBy: currentUser,
                notes: args.notes,
                status: 'processing' as const,
                statusHistory: [{ status: 'processing' as const, timestamp: now }],
                deliveryDate: args.deliveryDate || undefined,
                deliveryTimeSlot: (args.deliveryTimeSlot || undefined) as DeliveryTimeSlot | undefined,
                verification: args.verification,
            };

            const confirmationMessage = `Your order has been sent to OrderStream for fulfillment.`;

            return new Promise<SubmitResult>(resolve => {
                placeOrderMutation.mutate(
                    {
                        hoReCaId: hoReCaForOrder.id,
                        items: args.items.map(item => ({
                            productId: item.id,
                            quantity: item.quantity,
                            packSize: item.packSize ?? null,
                            uomId: item.uomId ?? null,
                        })),
                        notes: args.notes || null,
                        deliveryDate: args.deliveryDate || null,
                        deliveryTimeSlot: (args.deliveryTimeSlot || null) as 'AM' | 'PM' | null,
                        verification: (args.verification ?? null) as unknown as Record<string, unknown> | null,
                    },
                    {
                        onSuccess: result => {
                            const persistedOrder: Order = { ...newOrder, id: result.orderId, total: result.total };
                            setConfirmation({ order: persistedOrder, message: confirmationMessage });
                            addToast('Order submitted successfully!', 'success');
                            setIsLoading(false);
                            resolve({ ok: true });
                        },
                        onError: err => {
                            setIsLoading(false);
                            setErrors({ api: err.message });
                            addToast(err.message, 'error');
                            resolve({ ok: false, error: err.message });
                        },
                    },
                );
            });
        },
        [selectedHoReCa, currentUser, addToast, placeOrderMutation, appSettings.orderIdPrefix],
    );

    // File a kitchen request for approval. NEVER place-order: that function
    // rejects the QR Staff role, and a request must not reserve stock or become an
    // order until a person approves it. `fromCart` clears the cart on success; the
    // Kitchen screen's "same again" did not touch the cart and must not empty it.
    const runSubmitForApproval = useCallback(
        (args: SubmitArgs, fromCart: boolean): Promise<SubmitResult> => {
            if (!submitQrMutation) {
                const error = 'Ordering from the kitchen is not available.';
                setErrors({ api: error });
                return Promise.resolve({ ok: false, error });
            }
            setShowVerificationModal(false);
            setIsLoading(true);
            setErrors({});

            return new Promise<SubmitResult>(resolve => {
                submitQrMutation.mutate(
                    {
                        items: args.items.map(item => ({
                            productId: item.id,
                            quantity: item.quantity,
                            packSize: item.packSize ?? null,
                            uomId: item.uomId ?? null,
                        })),
                        notes: args.notes || null,
                        deliveryDate: args.deliveryDate || null,
                        deliveryTimeSlot: args.deliveryTimeSlot || null,
                    },
                    {
                        onSuccess: () => {
                            addToast('Sent for approval', 'success');
                            if (fromCart) clearCart();
                            setIsLoading(false);
                            onQrSubmitted?.();
                            resolve({ ok: true });
                        },
                        onError: err => {
                            setIsLoading(false);
                            // The 2-hour unlock ran out (or the login was removed): back to the PIN pad.
                            if (err.sessionEnded) {
                                void handleQrSessionEnded();
                                resolve({ ok: false, error: err.message });
                                return;
                            }
                            setErrors({ api: err.message });
                            addToast(err.message, 'error');
                            resolve({ ok: false, error: err.message });
                        },
                    },
                );
            });
        },
        [submitQrMutation, addToast, clearCart, onQrSubmitted],
    );

    // Called by the verification modal. A QR Staff login never reaches it (its
    // checkout does not open one), and if it somehow did, the request is filed
    // instead -- there is no path from this role to place-order.
    const placeOrder = useCallback(
        (verification?: OrderVerification) => {
            const args: SubmitArgs = { items: orderItems, notes, deliveryDate, deliveryTimeSlot };
            if (isQrStaff) {
                void runSubmitForApproval(args, true);
                return;
            }
            void runPlaceOrder({ ...args, verification });
        },
        [isQrStaff, orderItems, notes, deliveryDate, deliveryTimeSlot, runSubmitForApproval, runPlaceOrder],
    );

    // Everything a submit checks before it goes anywhere. `items` may be the cart
    // or lines handed in by a screen; either way the same rules apply.
    const submitItems = useCallback(
        (args: SubmitArgs, fromCart: boolean): Promise<SubmitResult> => {
            const itemsTotal = sumItems(args.items);
            const validationErrors: OrderErrors = {};
            if (
                (currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP) &&
                !selectedHoReCaId
            ) {
                validationErrors.hoReCa = 'Please select a customer.';
            }
            if (args.items.length === 0) {
                validationErrors.emptyOrder = 'Cannot submit an empty order.';
            }
            // A held kitchen request is not checked against the minimum or the
            // credit limit here: those are the approver's call, made with the
            // real numbers in front of them, and a kitchen cannot act on them.
            if (!holdsForApproval && appSettings.minimumOrderValue > 0 && itemsTotal < appSettings.minimumOrderValue) {
                validationErrors.api = `Minimum order value is $${appSettings.minimumOrderValue.toFixed(2)}.`;
            }

            if (selectedHoReCa && !holdsForApproval) {
                const outstanding = getHoReCaOutstanding(selectedHoReCa.id, selectedHoReCa.name, invoices);
                if (outstanding.isBlocked && !isAdminOrManager) {
                    validationErrors.api = 'Orders blocked: this HoReCa has payments overdue by 90+ days.';
                }
            }

            if (Object.keys(validationErrors).length > 0) {
                setErrors(validationErrors);
                const error =
                    validationErrors.api ?? validationErrors.emptyOrder ?? validationErrors.hoReCa ?? 'This order cannot be submitted.';
                return Promise.resolve({ ok: false, error });
            }

            const hoReCaForOrder = selectedHoReCa;
            if (!hoReCaForOrder) {
                const error = 'HoReCa information is missing. Please contact support.';
                setErrors({ api: error });
                return Promise.resolve({ ok: false, error });
            }

            // Re-validate promotions: warn for any that are no longer active/applicable.
            const now = new Date();
            const stillActive = promotions.filter(p => isPromotionActive(p, now));
            const previousResult = applyCartPromotions(args.items, promotions, hoReCaForOrder, currentUser, products);
            const currentResult = applyCartPromotions(args.items, stillActive, hoReCaForOrder, currentUser, products);
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

            if (holdsForApproval) return runSubmitForApproval(args, fromCart);
            if (currentUser.role === UserRole.CUSTOMER) return runPlaceOrder(args);

            // Reps and admins verify the order first. Only the cart has a modal for it.
            if (fromCart) setShowVerificationModal(true);
            return Promise.resolve({ ok: false, error: 'Verification is needed before this order can be placed.' });
        },
        [
            currentUser,
            selectedHoReCaId,
            appSettings.minimumOrderValue,
            holdsForApproval,
            selectedHoReCa,
            invoices,
            isAdminOrManager,
            promotions,
            products,
            addToast,
            runSubmitForApproval,
            runPlaceOrder,
        ],
    );

    const handleSubmitOrder = useCallback(() => {
        void submitItems({ items: orderItems, notes, deliveryDate, deliveryTimeSlot }, true);
    }, [submitItems, orderItems, notes, deliveryDate, deliveryTimeSlot]);

    const orderItemsNow = useCallback(
        (items: OrderItem[], options?: { notes?: string }): Promise<SubmitResult> => {
            if (!isVenueLogin) {
                return Promise.resolve({ ok: false, error: 'This shortcut is for a venue login.' });
            }
            return submitItems(
                { items, notes: options?.notes ?? '', deliveryDate: '', deliveryTimeSlot: '' },
                false,
            );
        },
        [isVenueLogin, submitItems],
    );

    const handleReorder = useCallback(
        (order: Order) => {
            resetOrder();
            const validItems: OrderItem[] = [];
            const skippedItems: string[] = [];
            const hoReCa = hoReCas.find(c => c.id === order.hoReCa.id);

            for (const item of order.items) {
                const currentProduct = products.find(p => p.id === item.id);
                if (!currentProduct || currentProduct.available <= 0) {
                    skippedItems.push(item.name);
                    continue;
                }
                const currentPrice = hoReCa?.pricing?.[currentProduct.id] ?? currentProduct.price;
                let price = currentPrice;
                let unit = currentProduct.unit;
                if (item.packSize === currentProduct.cartonSize) {
                    price = calcCartonPrice(currentPrice, currentProduct.cartonSize, appSettings.cartonDiscountPercent);
                    unit = `carton of ${currentProduct.cartonSize}`;
                }
                validItems.push({ ...currentProduct, quantity: item.quantity, price, packSize: item.packSize, unit });
            }

            if (validItems.length === 0) {
                addToast('All items from this order are no longer available.', 'error');
                return;
            }

            setOrderItems(validItems);
            if (
                (currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP) &&
                hoReCas.some(c => c.id === order.hoReCa.id)
            ) {
                setSelectedHoReCaId(order.hoReCa.id);
            }
            setNotes(order.notes || '');

            if (skippedItems.length > 0) {
                addToast(`Skipped unavailable: ${skippedItems.join(', ')}`, 'info');
            } else {
                addToast(`Reordering from ${order.id}.`, 'info');
            }
        },
        [resetOrder, hoReCas, products, appSettings.cartonDiscountPercent, currentUser.role, addToast],
    );

    const handleReorderItems = useCallback(
        (items: OrderItem[], mode: 'replace' | 'merge') => {
            if (mode === 'replace') {
                setOrderItems(items);
            } else {
                // Never mutate a cart line in place: `prev` is React state, and a
                // line shared with a past render must not change under it.
                setOrderItems(prev =>
                    items.reduce<OrderItem[]>((merged, newItem) => {
                        const at = merged.findIndex(
                            i => i.id === newItem.id && i.packSize === newItem.packSize,
                        );
                        if (at === -1) return [...merged, newItem];
                        return merged.map((line, n) =>
                            n === at ? { ...line, quantity: line.quantity + newItem.quantity } : line,
                        );
                    }, prev),
                );
            }
            addToast(`${items.length} item${items.length !== 1 ? 's' : ''} added to order!`, 'success');
        },
        [addToast],
    );

    const handleStartOrder = useCallback(
        (hoReCaId: number) => {
            resetOrder();
            setSelectedHoReCaId(hoReCaId);
        },
        [resetOrder],
    );

    // Memoized: AppShell re-renders on every keystroke of its search box,
    // and a fresh value object re-rendered every consumer with it.
    const value = useMemo<OrderContextValue>(() => ({
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
        setErrors,
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
        orderItemsNow,
        holdsForApproval,
    }), [
        orderItems, selectedHoReCaId, selectedHoReCa, notes, deliveryDate, deliveryTimeSlot,
        isLoading, errors, confirmation, showVerificationModal, bundleModalPromo, total,
        setSelectedHoReCaId, setNotes, setDeliveryDate, setDeliveryTimeSlot,
        setShowVerificationModal, setBundleModalPromo, setConfirmation, setErrors, handleAddItem,
        handleApplyPromo, handleBundleConfirm, handleUpdateQuantity, handleSubmitOrder, placeOrder,
        handleReorder, handleReorderItems, handleStartOrder, resetOrder, orderItemsNow, holdsForApproval,
    ]);

    return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrderContext(): OrderContextValue {
    const ctx = useContext(OrderContext);
    if (!ctx) throw new Error('useOrderContext must be used within an OrderProvider');
    return ctx;
}
