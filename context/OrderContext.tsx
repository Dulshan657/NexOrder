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
import { isPromotionActive } from '../pricing';
import type { usePlaceOrder } from '../hooks/queries/useOrders';

type OrderErrors = { hoReCa?: string; emptyOrder?: string; api?: string };
type Confirmation = { order: Order; message: string };

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
    handleAddItem: (product: Product, options: { packSize?: number; price: number; unit: string }, quantity?: number) => void;
    handleApplyPromo: (promo: Promotion) => void;
    handleBundleConfirm: (rows: Array<{ product: Product; quantity: number; packSize?: number; price: number; unit: string }>) => void;
    handleUpdateQuantity: (productId: number, newQuantity: number, packSize?: number) => void;
    handleSubmitOrder: () => void;
    placeOrder: (verification?: OrderVerification) => void;
    handleReorder: (order: Order) => void;
    handleStartOrder: (hoReCaId: number) => void;
    resetOrder: () => void;
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

    const selectedHoReCa = useMemo(() => {
        if (currentUser.role === UserRole.CUSTOMER) {
            return hoReCas.find(c => c.id === currentUser.hoReCaId);
        }
        return hoReCas.find(c => c.id === selectedHoReCaId);
    }, [hoReCas, selectedHoReCaId, currentUser]);

    const total = useMemo(
        () => orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
        [orderItems],
    );

    const handleAddItem = useCallback(
        (product: Product, options: { packSize?: number; price: number; unit: string }, quantity: number = 1) => {
            const { packSize, price, unit } = options;
            setOrderItems(prevItems => {
                const existing = prevItems.find(item => item.id === product.id && item.packSize === packSize);
                if (existing) {
                    return prevItems.map(item =>
                        item.id === product.id && item.packSize === packSize
                            ? { ...item, quantity: item.quantity + quantity }
                            : item,
                    );
                }
                return [...prevItems, { ...product, quantity, price, packSize, unit }];
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
                    ? buyProduct.price * buyProduct.cartonSize * (1 - appSettings.cartonDiscountPercent / 100)
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

    const resetOrder = useCallback(() => {
        setOrderItems([]);
        setSelectedHoReCaId(null);
        setNotes('');
        setDeliveryDate('');
        setDeliveryTimeSlot('');
        setErrors({});
        setIsLoading(false);
        setConfirmation(null);
        onResetView?.();
    }, [onResetView]);

    const placeOrder = useCallback(
        (verification?: OrderVerification) => {
            setShowVerificationModal(false);
            setIsLoading(true);
            setErrors({});

            const hoReCaForOrder = selectedHoReCa;
            if (!hoReCaForOrder) {
                setErrors({ api: 'HoReCa information is missing.' });
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

            placeOrderMutation.mutate(
                {
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
                },
                {
                    onSuccess: result => {
                        const persistedOrder: Order = { ...newOrder, id: result.orderId, total: result.total };
                        setConfirmation({ order: persistedOrder, message: confirmationMessage });
                        addToast('Order submitted successfully!', 'success');
                        setIsLoading(false);
                    },
                    onError: err => {
                        setIsLoading(false);
                        setErrors({ api: err.message });
                        addToast(err.message, 'error');
                    },
                },
            );
        },
        [
            selectedHoReCa,
            orderItems,
            total,
            currentUser,
            notes,
            deliveryDate,
            deliveryTimeSlot,
            addToast,
            placeOrderMutation,
            appSettings.orderIdPrefix,
        ],
    );

    const handleSubmitOrder = useCallback(() => {
        const validationErrors: OrderErrors = {};
        if (
            (currentUser.role === UserRole.FIELD_REP || currentUser.role === UserRole.OFFICE_REP) &&
            !selectedHoReCaId
        ) {
            validationErrors.hoReCa = 'Please select a customer.';
        }
        if (orderItems.length === 0) {
            validationErrors.emptyOrder = 'Cannot submit an empty order.';
        }
        if (appSettings.minimumOrderValue > 0 && total < appSettings.minimumOrderValue) {
            validationErrors.api = `Minimum order value is $${appSettings.minimumOrderValue.toFixed(2)}.`;
        }

        if (selectedHoReCa) {
            const outstanding = getHoReCaOutstanding(selectedHoReCa.id, selectedHoReCa.name, invoices);
            if (outstanding.isBlocked && !isAdminOrManager) {
                validationErrors.api = 'Orders blocked: this HoReCa has payments overdue by 90+ days.';
            }
        }

        if (Object.keys(validationErrors).length > 0) {
            setErrors(validationErrors);
            return;
        }

        const hoReCaForOrder = selectedHoReCa;
        if (!hoReCaForOrder) {
            setErrors({ api: 'HoReCa information is missing. Please contact support.' });
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

        if (currentUser.role === UserRole.CUSTOMER) {
            placeOrder(undefined);
        } else {
            setShowVerificationModal(true);
        }
    }, [
        currentUser,
        selectedHoReCaId,
        orderItems,
        appSettings.minimumOrderValue,
        total,
        selectedHoReCa,
        invoices,
        isAdminOrManager,
        promotions,
        products,
        addToast,
        placeOrder,
    ]);

    const handleReorder = useCallback(
        (order: Order) => {
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
                    price = currentPrice * currentProduct.cartonSize * (1 - appSettings.cartonDiscountPercent / 100);
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

    const handleStartOrder = useCallback(
        (hoReCaId: number) => {
            resetOrder();
            setSelectedHoReCaId(hoReCaId);
        },
        [resetOrder],
    );

    const value: OrderContextValue = {
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
        handleStartOrder,
        resetOrder,
    };

    return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrderContext(): OrderContextValue {
    const ctx = useContext(OrderContext);
    if (!ctx) throw new Error('useOrderContext must be used within an OrderProvider');
    return ctx;
}
