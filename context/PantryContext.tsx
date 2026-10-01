import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppSettings, Order, PantryItem, Product, ToastType } from '../types';
import { resolveHoReCaPrice } from '../pricing';
import { usePantryItems, useUpsertPantryItem, useDeletePantryItem, pantryKeys } from '../hooks/queries/usePantry';
import { resolvePantryUpdate, type PantryCacheRow, type PantryUpdate } from '../lib/pantryCache';
import { useOrderContext } from './OrderContext';

type PantryRow = { product_id: number; preferred_pack_size: number | null; default_quantity: number };

export interface PantryContextValue {
    currentPantryItems: PantryItem[];
    pantryEstTotal: number;
    getLastOrderedQuantity: (hoReCaId: number, productId: number, packSize?: number) => number;
    handleTogglePantry: (productId: number) => void;
    handleRemoveFromPantry: (productId: number) => void;
    /** `quantityDelta` is applied to the latest cached quantity, so quick
     *  repeated +/- clicks accumulate instead of each sending the same value. */
    handleUpdatePantryItem: (productId: number, updates: PantryUpdate) => void;
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
    // The last row this provider SENT per product, used while pantry writes
    // are in flight. The optimistic cache write lands a microtask after
    // mutate(), so a burst of clicks in one tick would otherwise all read the
    // pre-click quantity. Once nothing is pending the cache is the truth again
    // (it may since have taken a change made elsewhere).
    const lastSentRef = useRef(new Map<string, PantryCacheRow>());
    const pantryWriteOptions = {
        onWriteError: (_error: Error, { horecaId, productId }: { horecaId: number; productId: number }) => {
            // The refused value must not be the base for the next click.
            lastSentRef.current.delete(`${horecaId}:${productId}`);
            addToast("Couldn't save a pantry change. Showing what's saved.", 'error');
        },
    };
    const upsertPantryItemMutation = useUpsertPantryItem(pantryWriteOptions);
    const deletePantryItemMutation = useDeletePantryItem(pantryWriteOptions);
    const queryClient = useQueryClient();

    // Edits resolve against the CACHE at click time, not the rows captured at
    // the last render: the pantry writes are optimistic, so the cache already
    // holds every earlier click even before React has re-rendered.
    const cachedRow = useCallback(
        (horecaId: number, productId: number): PantryCacheRow | undefined =>
            queryClient
                .getQueryData<PantryCacheRow[]>(pantryKeys.byHoReCa(horecaId))
                ?.find(row => row.product_id === productId),
        [queryClient],
    );

    const latestRow = useCallback(
        (horecaId: number, productId: number): PantryCacheRow | undefined => {
            const key = `${horecaId}:${productId}`;
            if (queryClient.isMutating({ mutationKey: pantryKeys.all }) === 0) {
                lastSentRef.current.delete(key);
                return cachedRow(horecaId, productId);
            }
            return lastSentRef.current.get(key) ?? cachedRow(horecaId, productId);
        },
        [queryClient, cachedRow],
    );

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
            if (cachedRow(custId, productId)) {
                lastSentRef.current.delete(`${custId}:${productId}`);
                deletePantryItemMutation.mutate({ horecaId: custId, productId });
                return;
            }
            const added = {
                horeca_id: custId,
                product_id: productId,
                preferred_pack_size: null,
                default_quantity: getLastOrderedQuantity(custId, productId),
            };
            // Recorded so a quantity click in the same tick finds the new row.
            lastSentRef.current.set(`${custId}:${productId}`, added);
            upsertPantryItemMutation.mutate(added);
        },
        [selectedHoReCa, cachedRow, getLastOrderedQuantity, upsertPantryItemMutation, deletePantryItemMutation],
    );

    const handleRemoveFromPantry = useCallback(
        (productId: number) => {
            const custId = selectedHoReCa?.id;
            if (!custId) return;
            lastSentRef.current.delete(`${custId}:${productId}`);
            deletePantryItemMutation.mutate({ horecaId: custId, productId });
        },
        [selectedHoReCa, deletePantryItemMutation],
    );

    const handleUpdatePantryItem = useCallback(
        (productId: number, updates: PantryUpdate) => {
            const custId = selectedHoReCa?.id;
            if (!custId) return;
            const existing = latestRow(custId, productId);
            if (!existing) return;
            const next = resolvePantryUpdate(existing, updates);
            lastSentRef.current.set(`${custId}:${productId}`, { ...existing, ...next });
            upsertPantryItemMutation.mutate({
                horeca_id: custId,
                product_id: productId,
                ...next,
            });
        },
        [selectedHoReCa, latestRow, upsertPantryItemMutation],
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

    // Memoized: AppShell re-renders on every keystroke of its search box,
    // and a fresh value object re-rendered every consumer with it.
    const value = useMemo<PantryContextValue>(() => ({
        currentPantryItems,
        pantryEstTotal,
        getLastOrderedQuantity,
        handleTogglePantry,
        handleRemoveFromPantry,
        handleUpdatePantryItem,
        handleAddPantryItemToOrder,
        handleAddAllPantryToOrder,
        handleAddSelectedPantryToOrder,
    }), [
        currentPantryItems, pantryEstTotal, getLastOrderedQuantity, handleTogglePantry,
        handleRemoveFromPantry, handleUpdatePantryItem, handleAddPantryItemToOrder,
        handleAddAllPantryToOrder, handleAddSelectedPantryToOrder,
    ]);

    return <PantryContext.Provider value={value}>{children}</PantryContext.Provider>;
}

export function usePantryContext(): PantryContextValue {
    const ctx = useContext(PantryContext);
    if (!ctx) throw new Error('usePantryContext must be used within a PantryProvider');
    return ctx;
}
