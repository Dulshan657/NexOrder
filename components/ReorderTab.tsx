import React, { useState, useMemo } from 'react';
import type { Order, Product, HoReCa, OrderItem } from '../types';
import { RotateCcw, ShoppingCart, Trash2, AlertTriangle, UserRound, Package } from 'lucide-react';
import { resolveHoReCaPrice } from '../pricing';
import OptimizedImage from './OptimizedImage';
import { Button, Modal } from './ui';

interface ReorderTabProps {
    lastOrder: Order | null;
    products: Product[];
    selectedHoReCa: HoReCa | null;
    cartonDiscountPercent: number;
    cartItemCount: number;
    onAddItems: (items: OrderItem[], mode: 'replace' | 'merge') => void;
}

const ReorderTab: React.FC<ReorderTabProps> = ({
    lastOrder,
    products,
    selectedHoReCa,
    cartonDiscountPercent,
    cartItemCount,
    onAddItems,
}) => {
    // Local editable copy of the order items
    const [editedItems, setEditedItems] = useState<(OrderItem & { removed: boolean })[]>(() => {
        if (!lastOrder) return [];
        return lastOrder.items.map(item => ({ ...item, removed: false }));
    });
    const [showMergePrompt, setShowMergePrompt] = useState<'replace' | 'merge' | null>(null);
    const [pendingItems, setPendingItems] = useState<OrderItem[]>([]);

    // Reset edited items when lastOrder changes
    const lastOrderId = lastOrder?.id;
    const [trackedOrderId, setTrackedOrderId] = useState(lastOrderId);
    if (lastOrderId !== trackedOrderId) {
        setTrackedOrderId(lastOrderId);
        setEditedItems(lastOrder ? lastOrder.items.map(item => ({ ...item, removed: false })) : []);
    }

    // Resolve items with current product data
    const resolvedItems = useMemo(() => {
        return editedItems.map(item => {
            const currentProduct = products.find(p => p.id === item.id);
            const isAvailable = !!currentProduct && currentProduct.available > 0;
            const isLowStock = !!currentProduct && currentProduct.available > 0 && currentProduct.available < 10;

            // Recalculate price with current pricing
            let currentPrice = item.price;
            if (currentProduct) {
                const unitPrice = resolveHoReCaPrice(currentProduct, selectedHoReCa);
                if (item.packSize === currentProduct.cartonSize) {
                    currentPrice = (unitPrice * currentProduct.cartonSize) * (1 - cartonDiscountPercent / 100);
                } else {
                    currentPrice = unitPrice;
                }
            }

            return {
                ...item,
                currentPrice,
                isAvailable,
                isLowStock,
                currentProduct,
            };
        });
    }, [editedItems, products, selectedHoReCa, cartonDiscountPercent]);

    const activeItems = resolvedItems.filter(i => !i.removed);
    const reorderTotal = activeItems.reduce((sum, item) => sum + item.currentPrice * item.quantity, 0);
    const unavailableCount = activeItems.filter(i => !i.isAvailable).length;

    const handleUpdateQuantity = (productId: number, packSize: number | undefined, newQty: number) => {
        setEditedItems(prev => prev.map(item =>
            (item.id === productId && item.packSize === packSize)
                ? { ...item, quantity: Math.max(1, newQty) }
                : item
        ));
    };

    const handleRemoveItem = (productId: number, packSize: number | undefined) => {
        setEditedItems(prev => prev.map(item =>
            (item.id === productId && item.packSize === packSize)
                ? { ...item, removed: true }
                : item
        ));
    };

    const handleRestoreItem = (productId: number, packSize: number | undefined) => {
        setEditedItems(prev => prev.map(item =>
            (item.id === productId && item.packSize === packSize)
                ? { ...item, removed: false }
                : item
        ));
    };

    const buildOrderItems = (): OrderItem[] => {
        return activeItems
            .filter(i => i.isAvailable)
            .map(({ removed, currentPrice, isAvailable, isLowStock, currentProduct, ...item }) => ({
                ...item,
                price: currentPrice,
            }));
    };

    const handleAddToOrder = (items: OrderItem[]) => {
        if (items.length === 0) return;
        if (cartItemCount > 0) {
            setPendingItems(items);
            setShowMergePrompt('replace'); // just open the prompt
        } else {
            onAddItems(items, 'replace');
        }
    };

    const handleMergeChoice = (mode: 'replace' | 'merge') => {
        onAddItems(pendingItems, mode);
        setShowMergePrompt(null);
        setPendingItems([]);
    };

    const handleAddSingleItem = (item: typeof resolvedItems[0]) => {
        if (!item.isAvailable) return;
        const { removed, currentPrice, isAvailable, isLowStock, currentProduct, ...orderItem } = item;
        const builtItem: OrderItem = { ...orderItem, price: currentPrice };
        handleAddToOrder([builtItem]);
    };

    // No customer guard
    if (!selectedHoReCa) {
        return (
            <div className="bg-white rounded-xl border border-stone-200 border-dashed p-12 text-center">
                <UserRound className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                <h3 className="text-xl font-display font-semibold text-stone-800">No HoReCa Selected</h3>
                <p className="text-stone-500 mt-2">Select a HoReCa from the order summary to reorder.</p>
            </div>
        );
    }

    // No previous orders
    if (!lastOrder) {
        return (
            <div className="bg-white rounded-xl border border-stone-200 border-dashed p-12 text-center">
                <Package className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                <h3 className="text-xl font-display font-semibold text-stone-800">No Previous Orders</h3>
                <p className="text-stone-500 mt-2 max-w-md mx-auto">
                    {selectedHoReCa.name} hasn't placed any orders yet. Browse the Catalogue to create their first order.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Merge/Replace Prompt — three outcomes, so a Modal rather than a ConfirmDialog. */}
            <Modal
                open={showMergePrompt !== null}
                onClose={() => { setShowMergePrompt(null); setPendingItems([]); }}
                size="sm"
                title="Cart has items"
            >
                <p className="text-sm text-stone-500 mb-5">
                    Your current order already has items. How would you like to add the reorder items?
                </p>
                <div className="space-y-2">
                    <Button className="w-full" onClick={() => handleMergeChoice('merge')}>
                        Add to existing order
                    </Button>
                    <Button variant="secondary" className="w-full" onClick={() => handleMergeChoice('replace')}>
                        Replace current order
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => { setShowMergePrompt(null); setPendingItems([]); }}
                    >
                        Cancel
                    </Button>
                </div>
            </Modal>

            {/* Header */}
            <div className="bg-white rounded-xl border border-stone-200 p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                        <h3 className="font-display font-semibold text-stone-900">
                            Reorder from {lastOrder.id}
                        </h3>
                        <p className="text-sm text-stone-500 mt-0.5">
                            {new Date(lastOrder.orderDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {' '}&middot;{' '}{selectedHoReCa.name}
                            {' '}&middot;{' '}{activeItems.length} item{activeItems.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {activeItems.length > 0 && (
                            <button
                                onClick={() => handleAddToOrder(buildOrderItems())}
                                disabled={activeItems.filter(i => i.isAvailable).length === 0}
                                className="flex items-center gap-1.5 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Reorder All (${reorderTotal.toFixed(2)})
                            </button>
                        )}
                    </div>
                </div>
                {unavailableCount > 0 && (
                    <div className="flex items-center gap-2 mt-3 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        {unavailableCount} item{unavailableCount !== 1 ? 's are' : ' is'} currently out of stock and will be skipped.
                    </div>
                )}
            </div>

            {/* Items List */}
            <div className="space-y-2">
                {resolvedItems.map((item) => {
                    const packLabel = item.packSize
                        ? `carton of ${item.packSize}`
                        : item.currentProduct?.unit ?? 'unit';

                    return (
                        <div
                            key={`${item.id}-${item.packSize}`}
                            className={`bg-white rounded-xl border p-4 transition-all duration-200 ${
                                item.removed
                                    ? 'border-stone-100 opacity-50'
                                    : !item.isAvailable
                                        ? 'border-red-200 bg-red-50/30'
                                        : 'border-stone-200 hover:shadow-md hover:border-stone-300'
                            }`}
                        >
                            {/* Out of stock banner */}
                            {!item.isAvailable && !item.removed && (
                                <div className="flex items-center gap-2 mb-3 text-xs font-medium text-red-700 bg-red-100 rounded-lg px-3 py-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    Out of Stock — will be skipped
                                </div>
                            )}

                            <div className="flex gap-4">
                                {/* Product Image */}
                                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
                                    <OptimizedImage
                                        src={item.imageUrl}
                                        alt={item.name}
                                        className="w-full h-full"
                                        transformWidth={128}
                                        fallback={
                                            <div className="w-full h-full flex items-center justify-center text-stone-300">
                                                <Package className="w-6 h-6" />
                                            </div>
                                        }
                                    />
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <h4 className={`font-display font-semibold truncate ${item.removed ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                                                {item.name}
                                            </h4>
                                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                <span className="text-xs text-stone-400">{item.sku}</span>
                                                <span className="text-xs text-stone-400">&middot;</span>
                                                <span className="text-xs text-stone-500">{packLabel}</span>
                                                {item.isLowStock && !item.removed && (
                                                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Low Stock</span>
                                                )}
                                            </div>
                                        </div>

                                        {item.removed ? (
                                            <button
                                                onClick={() => handleRestoreItem(item.id, item.packSize)}
                                                className="text-xs font-medium text-emerald-600 hover:text-emerald-800 transition-colors cursor-pointer px-2 py-1 rounded hover:bg-emerald-50"
                                            >
                                                Restore
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleRemoveItem(item.id, item.packSize)}
                                                className="text-stone-400 hover:text-red-500 transition-colors duration-200 p-2 -mr-1.5 rounded-md flex-shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500"
                                                aria-label={`Remove ${item.name}`}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>

                                    {/* Price & Quantity (only for non-removed, available items) */}
                                    {!item.removed && item.isAvailable && (
                                        <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-sm font-semibold text-stone-900">${item.currentPrice.toFixed(2)}</span>
                                                <span className="text-xs text-stone-400">/ {packLabel}</span>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                {/* Quantity Stepper */}
                                                <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden">
                                                    <button
                                                        onClick={() => handleUpdateQuantity(item.id, item.packSize, item.quantity - 1)}
                                                        className="px-2.5 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors text-sm font-medium cursor-pointer"
                                                    >
                                                        -
                                                    </button>
                                                    <span className="px-3 py-1 text-sm font-semibold text-stone-900 bg-stone-50 min-w-[2.5rem] text-center">
                                                        {item.quantity}
                                                    </span>
                                                    <button
                                                        onClick={() => handleUpdateQuantity(item.id, item.packSize, item.quantity + 1)}
                                                        className="px-2.5 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors text-sm font-medium cursor-pointer"
                                                    >
                                                        +
                                                    </button>
                                                </div>

                                                {/* Line total */}
                                                <span className="text-sm font-semibold text-stone-700 min-w-[4rem] text-right">
                                                    ${(item.currentPrice * item.quantity).toFixed(2)}
                                                </span>

                                                {/* Individual add */}
                                                <button
                                                    onClick={() => handleAddSingleItem(item)}
                                                    className="flex items-center gap-1 bg-emerald-600 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer"
                                                >
                                                    <ShoppingCart className="w-3 h-3" />
                                                    Add
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer summary */}
            {activeItems.length > 0 && (
                <div className="bg-stone-50 rounded-xl border border-stone-200 p-4 flex items-center justify-between">
                    <div>
                        <span className="text-sm text-stone-500">{activeItems.filter(i => i.isAvailable).length} available items</span>
                        {unavailableCount > 0 && <span className="text-sm text-red-500 ml-2">&middot; {unavailableCount} unavailable</span>}
                    </div>
                    <div className="text-right">
                        <span className="text-xs text-stone-500">Estimated total</span>
                        <p className="text-lg font-display font-bold text-stone-900">${reorderTotal.toFixed(2)}</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReorderTab;
