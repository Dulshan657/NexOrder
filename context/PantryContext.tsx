import React, { createContext, useCallback, useContext, useMemo } from 'react';
import type { AppSettings, Order, PantryItem, Product, ToastType } from '../types';
import { resolveHoReCaPrice } from '../pricing';
import { usePantryItems, useUpsertPantryItem, useDeletePantryItem } from '../hooks/queries/usePantry';
import { useOrderContext } from './OrderContext';

type PantryRow = { product_id: number; preferred_pack_size: number | null; default_quantity: number };

export interface PantryContextValue {
    currentPantryItems: PantryItem[];
    pantryEstTotal: number;
    getLastOrderedQuantity: (hoReCaId: number, productId: number, packSize?: number) => number;
    handleTogglePantry: (productId: number) => void;
    handleRemoveFromPantry: (productId: number) => void;
    handleUpdatePantryItem: (
        productId: number,
        updates: Partial<Pick<PantryItem, 'preferredPackSize' | 'defaultQuantity'>>,
    ) => void;
    handleAddPantryItemToOrder: (pantryItem: PantryItem) => void;
    handleAddAllPantryToOrder: () => void;
    handleAddSelectedPantryToOrder: (items: PantryItem[]) => void;
}

interface PantryProviderProps {
    children: React.ReactNode;
    products: Product[];
    allOrders: Order[];
    appSettings: AppSettings;
    addToast: (message: string, type: ToastType) => void;
}

const PantryContext = createContext<PantryContextValue | null>(null);

export function PantryProvider({ children, products, allOrders, appSettings, addToast }: PantryProviderProps) {
    const { selectedHoReCa, handleAddItem } = useOrderContext();

    const { data: rawPantryRows = [] } = usePantryItems(selectedHoReCa?.id ?? null);
    const upsertPantryItemMutation = useUpsertPantryItem();
    const deletePantryItemMutation = useDeletePantryItem();

    const currentPantryItems: PantryItem[] = useMemo(
        () =>
            (rawPantryRows as PantryRow[]).map(row => ({
                productId: row.product_id,
                preferredPackSize: row.preferred_pack_size ?? undefined,
                defaultQuantity: row.default_quantity,
            })),
        [rawPantryRows],
    );

    const getLastOrderedQuantity = useCallback(
        (hoReCaId: number, productId: number, packSize?: number): number => {
            const hoReCaOrders = allOrders
                .filter(o => o.hoReCa.id === hoReCaId)
                .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
            for (const order of hoReCaOrders) {
                const item = order.items.find(i => i.id === productId && i.packSize === packSize);
                if (item) return item.quantity;
            }
            return 1;
        },
        [allOrders],
    );

    const handleTogglePantry = useCallback(
        (productId: number) => {
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
        },
        [selectedHoReCa, currentPantryItems, getLastOrderedQuantity, upsertPantryItemMutation, deletePantryItemMutation],
    );

    const handleRemoveFromPantry = useCallback(
        (productId: number) => {
            const custId = selectedHoReCa?.id;
            if (!custId) return;
            deletePantryItemMutation.mutate({ horecaId: custId, productId });
        },
        [selectedHoReCa, deletePantryItemMutation],
    );

    const handleUpdatePantryItem = useCallback(
        (productId: number, updates: Partial<Pick<PantryItem, 'preferredPackSize' | 'defaultQuantity'>>) => {
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
        },
        [selectedHoReCa, currentPantryItems, upsertPantryItemMutation],
    );

    const handleAddPantryItemToOrder = useCallback(
        (pantryItem: PantryItem) => {
            const product = products.find(p => p.id === pantryItem.productId);
            if (!product) return;

            const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);

            let price: number;
            let unit: string;
            if (pantryItem.preferredPackSize === product.cartonSize) {
                const discountMultiplier = 1 - appSettings.cartonDiscountPercent / 100;
                price = unitPrice * product.cartonSize * discountMultiplier;
                unit = `carton of ${product.cartonSize}`;
            } else {
                price = unitPrice;
                unit = product.unit;
            }

            handleAddItem(
                product,
                { packSize: pantryItem.preferredPackSize, price, unit },
                pantryItem.defaultQuantity,
            );
        },
        [products, selectedHoReCa, handleAddItem, appSettings.cartonDiscountPercent],
    );

    const pantryEstTotal = useMemo(() => {
        let total = 0;
        for (const pantryItem of currentPantryItems) {
            const product = products.find(p => p.id === pantryItem.productId);
            if (!product || product.available <= 0) continue;
            const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);
            if (pantryItem.preferredPackSize === product.cartonSize) {
                total +=
                    unitPrice *
                    product.cartonSize *
                    (1 - appSettings.cartonDiscountPercent / 100) *
                    pantryItem.defaultQuantity;
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

    const handleAddSelectedPantryToOrder = useCallback(
        (items: PantryItem[]) => {
            items.forEach(item => handleAddPantryItemToOrder(item));
            addToast(`${items.length} item${items.length !== 1 ? 's' : ''} added to order!`, 'success');
        },
        [handleAddPantryItemToOrder, addToast],
    );

    const value: PantryContextValue = {
        currentPantryItems,
        pantryEstTotal,
        getLastOrderedQuantity,
        handleTogglePantry,
        handleRemoveFromPantry,
        handleUpdatePantryItem,
        handleAddPantryItemToOrder,
        handleAddAllPantryToOrder,
        handleAddSelectedPantryToOrder,
    };

    return <PantryContext.Provider value={value}>{children}</PantryContext.Provider>;
}

export function usePantryContext(): PantryContextValue {
    const ctx = useContext(PantryContext);
    if (!ctx) throw new Error('usePantryContext must be used within a PantryProvider');
    return ctx;
}
