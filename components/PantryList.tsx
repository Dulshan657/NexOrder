import React, { useState, useMemo, useCallback } from 'react';
import type { Product, HoReCa, Order, PantryItem, Category } from '../types';
import { ShoppingCart, Search, Plus, ClipboardList, UserRound, AlertTriangle, X, Minus, Trash2 } from 'lucide-react';
import { resolveHoReCaPrice } from '../pricing';

interface PantryListProps {
    pantryItems: PantryItem[];
    products: Product[];
    categories: readonly Category[];
    selectedHoReCa: HoReCa | null;
    allOrders: Order[];
    cartonDiscountPercent: number;
    onAddToOrder: (pantryItem: PantryItem) => void;
    onAddAllToOrder: () => void;
    onAddSelectedToOrder: (items: PantryItem[]) => void;
    onRemoveFromPantry: (productId: number) => void;
    onUpdatePantryItem: (productId: number, updates: Partial<Pick<PantryItem, 'preferredPackSize' | 'defaultQuantity'>>) => void;
    onAddToPantry: (productId: number) => void;
}

function getStockStatus(inventory: number): { label: string; className: string } {
    if (inventory <= 0) return { label: 'Out of Stock', className: 'bg-red-100 text-red-700' };
    if (inventory <= 10) return { label: 'Low Stock', className: 'bg-amber-100 text-amber-700' };
    return { label: 'In Stock', className: 'bg-emerald-100 text-emerald-700' };
}

function daysAgo(dateStr: string): string {
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
}

const PantryList: React.FC<PantryListProps> = ({
    pantryItems,
    products,
    categories,
    selectedHoReCa,
    allOrders,
    cartonDiscountPercent,
    onAddToOrder,
    onAddAllToOrder,
    onAddSelectedToOrder,
    onRemoveFromPantry,
    onUpdatePantryItem,
    onAddToPantry,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchCategory, setSearchCategory] = useState<Category | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    // No customer guard
    if (!selectedHoReCa) {
        return (
            <div className="bg-white rounded-xl border border-stone-200 border-dashed p-12 text-center">
                <UserRound className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                <h3 className="text-xl font-display font-semibold text-stone-800">No HoReCa Selected</h3>
                <p className="text-stone-500 mt-2">Select a HoReCa from the order summary to view their Pantry List.</p>
            </div>
        );
    }

    // Resolve pantry items to full products
    const resolvedItems = useMemo(() => {
        return pantryItems
            .map(item => ({
                pantryItem: item,
                product: products.find(p => p.id === item.productId),
            }))
            .filter((entry): entry is { pantryItem: PantryItem; product: Product } => entry.product !== undefined);
    }, [pantryItems, products]);

    // Last ordered dates per product for this customer
    const lastOrderedDates = useMemo(() => {
        const dates: Record<number, string> = {};
        if (!selectedHoReCa) return dates;
        const hoReCaOrders = allOrders
            .filter(o => o.hoReCa.id === selectedHoReCa.id)
            .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
        for (const order of hoReCaOrders) {
            for (const item of order.items) {
                if (!(item.id in dates)) {
                    dates[item.id] = order.orderDate;
                }
            }
        }
        return dates;
    }, [allOrders, selectedHoReCa]);

    // Savings summary
    const { pantryTotal, totalSavings, outOfStockCount } = useMemo(() => {
        let total = 0;
        let savings = 0;
        let oos = 0;
        for (const { pantryItem, product } of resolvedItems) {
            if (product.inventory <= 0) { oos++; continue; }
            const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);
            const isCarton = pantryItem.preferredPackSize === product.cartonSize;
            const discountMultiplier = 1 - (cartonDiscountPercent / 100);
            if (isCarton) {
                const discountedPrice = (unitPrice * product.cartonSize) * discountMultiplier;
                total += discountedPrice * pantryItem.defaultQuantity;
                savings += (unitPrice * product.cartonSize * pantryItem.defaultQuantity) - (discountedPrice * pantryItem.defaultQuantity);
            } else {
                total += unitPrice * pantryItem.defaultQuantity;
            }
        }
        return { pantryTotal: total, totalSavings: savings, outOfStockCount: oos };
    }, [resolvedItems, selectedHoReCa, cartonDiscountPercent]);

    // Search
    const pantryProductIds = useMemo(() => new Set(pantryItems.map(i => i.productId)), [pantryItems]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim() && !searchCategory) return [];
        const q = searchQuery.toLowerCase();
        return products.filter(p => {
            if (pantryProductIds.has(p.id)) return false;
            if (searchCategory && p.category !== searchCategory) return false;
            if (q && !p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [products, pantryProductIds, searchQuery, searchCategory]);

    // Selection handlers
    const toggleSelect = useCallback((productId: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId);
            else next.add(productId);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        const inStockIds = resolvedItems
            .filter(({ product }) => product.inventory > 0)
            .map(({ pantryItem }) => pantryItem.productId);
        setSelectedIds(new Set(inStockIds));
    }, [resolvedItems]);

    const deselectAll = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const handleAddSelected = useCallback(() => {
        const items = pantryItems.filter(i => selectedIds.has(i.productId));
        onAddSelectedToOrder(items);
        setSelectedIds(new Set());
    }, [pantryItems, selectedIds, onAddSelectedToOrder]);

    const allInStockSelected = useMemo(() => {
        const inStockIds = resolvedItems
            .filter(({ product }) => product.inventory > 0)
            .map(({ pantryItem }) => pantryItem.productId);
        return inStockIds.length > 0 && inStockIds.every(id => selectedIds.has(id));
    }, [resolvedItems, selectedIds]);

    // Compute line totals for each row
    const getLineTotal = (pantryItem: PantryItem, product: Product) => {
        const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);
        const isCarton = pantryItem.preferredPackSize === product.cartonSize;
        const discountMultiplier = 1 - (cartonDiscountPercent / 100);
        if (isCarton) {
            return (unitPrice * product.cartonSize) * discountMultiplier * pantryItem.defaultQuantity;
        }
        return unitPrice * pantryItem.defaultQuantity;
    };

    const getDisplayPrice = (pantryItem: PantryItem, product: Product) => {
        const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);
        const isCarton = pantryItem.preferredPackSize === product.cartonSize;
        if (isCarton) {
            const discountMultiplier = 1 - (cartonDiscountPercent / 100);
            return (unitPrice * product.cartonSize) * discountMultiplier;
        }
        return unitPrice;
    };

    // Empty state
    if (resolvedItems.length === 0 && !isSearchOpen) {
        return (
            <div className="space-y-4">
                <div className="bg-white rounded-xl border border-stone-200 border-dashed p-12 text-center">
                    <ClipboardList className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                    <h3 className="text-xl font-display font-semibold text-stone-800">No Pantry Items Yet</h3>
                    <p className="text-stone-500 mt-2 max-w-md mx-auto">
                        Add {selectedHoReCa.name}'s frequently ordered products from the Catalogue tab, or search below.
                    </p>
                    <button
                        onClick={() => setIsSearchOpen(true)}
                        className="mt-5 inline-flex items-center gap-2 bg-stone-900 text-white font-medium px-5 py-2.5 rounded-lg hover:bg-stone-800 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Add Products
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Out of stock warning banner */}
            {outOfStockCount > 0 && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span><strong>{outOfStockCount}</strong> pantry item{outOfStockCount !== 1 ? 's are' : ' is'} currently out of stock and will be skipped when adding to order.</span>
                </div>
            )}

            {/* Header with actions */}
            <div className="bg-white rounded-xl border border-stone-200 p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                        <h3 className="font-display font-semibold text-stone-900">
                            {selectedHoReCa.name}'s Pantry
                        </h3>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            <p className="text-sm text-stone-500">{resolvedItems.length} item{resolvedItems.length !== 1 ? 's' : ''}</p>
                            <span className="text-stone-300">|</span>
                            <p className="text-sm text-stone-500">Est. total: <span className="font-semibold text-stone-700">${pantryTotal.toFixed(2)}</span></p>
                            {totalSavings > 0 && (
                                <>
                                    <span className="text-stone-300">|</span>
                                    <p className="text-sm text-emerald-600 font-medium">Saving ${totalSavings.toFixed(2)} with cartons</p>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={() => setIsSearchOpen(!isSearchOpen)}
                            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg transition-colors ${
                                isSearchOpen
                                    ? 'bg-stone-200 text-stone-700'
                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                            }`}
                        >
                            <Plus className="w-4 h-4" />
                            Add Items
                        </button>
                        {selectedIds.size > 0 ? (
                            <button
                                onClick={handleAddSelected}
                                className="flex items-center gap-1.5 bg-nexgen-blue text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-nexgen-blue-dark transition-colors"
                            >
                                <ShoppingCart className="w-4 h-4" />
                                Add Selected ({selectedIds.size})
                            </button>
                        ) : resolvedItems.length > 0 ? (
                            <button
                                onClick={onAddAllToOrder}
                                className="flex items-center gap-1.5 bg-nexgen-blue text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-nexgen-blue-dark transition-colors"
                            >
                                <ShoppingCart className="w-4 h-4" />
                                Add All ({resolvedItems.length - outOfStockCount})
                            </button>
                        ) : null}
                    </div>
                </div>

                {/* Inline product search with category filter */}
                {isSearchOpen && (
                    <div className="mt-4 pt-4 border-t border-stone-100">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search products to add to pantry..."
                                className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                autoFocus
                            />
                        </div>
                        {/* Category pills */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            <button
                                onClick={() => setSearchCategory(null)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                    !searchCategory ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                All
                            </button>
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setSearchCategory(searchCategory === cat ? null : cat)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                        searchCategory === cat ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                    }`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                        {(searchQuery.trim() || searchCategory) && searchResults.length > 0 && (
                            <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-stone-200 divide-y divide-stone-100">
                                {searchResults.slice(0, 20).map(product => (
                                    <div key={product.id} className="flex items-center justify-between p-3 hover:bg-stone-50 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 rounded-md overflow-hidden bg-stone-100 flex-shrink-0">
                                                {product.imageUrl ? (
                                                    <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-stone-300 text-xs">N/A</div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-stone-900 truncate">{product.name}</p>
                                                <p className="text-xs text-stone-500">
                                                    ${(resolveHoReCaPrice(product, selectedHoReCa)).toFixed(2)} / {product.unit}
                                                    <span className="ml-2 text-stone-400">{product.category}</span>
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => onAddToPantry(product.id)}
                                            className="flex-shrink-0 ml-2 p-1.5 bg-emerald-50 text-emerald-600 rounded-md hover:bg-emerald-100 transition-colors"
                                            title="Add to pantry"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                                {searchResults.length > 20 && (
                                    <p className="text-xs text-stone-400 text-center py-2">Showing 20 of {searchResults.length} results. Refine your search.</p>
                                )}
                            </div>
                        )}
                        {(searchQuery.trim() || searchCategory) && searchResults.length === 0 && (
                            <p className="mt-3 text-sm text-stone-500 text-center py-3">No matching products found.</p>
                        )}
                    </div>
                )}
            </div>

            {/* Pantry Table */}
            <div className="overflow-x-auto border border-stone-200 rounded-xl shadow-sm">
                <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-stone-50">
                        <tr>
                            <th scope="col" className="pl-4 pr-2 py-3.5 w-10">
                                <input
                                    type="checkbox"
                                    checked={allInStockSelected}
                                    onChange={allInStockSelected ? deselectAll : selectAll}
                                    className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                                    title="Select all in-stock items"
                                />
                            </th>
                            <th scope="col" className="px-4 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Product</th>
                            <th scope="col" className="px-4 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden sm:table-cell">SKU</th>
                            <th scope="col" className="px-4 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden md:table-cell">Category</th>
                            <th scope="col" className="px-4 py-3.5 text-center text-xs font-medium text-stone-500 uppercase tracking-wider w-28">Qty</th>
                            <th scope="col" className="px-4 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">Price</th>
                            <th scope="col" className="px-4 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">Total</th>
                            <th scope="col" className="px-4 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden lg:table-cell">Last Ordered</th>
                            <th scope="col" className="px-4 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden md:table-cell">Stock</th>
                            <th scope="col" className="px-4 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider w-20">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-stone-200">
                        {resolvedItems.map(({ pantryItem, product }) => {
                            const isOutOfStock = product.inventory <= 0;
                            const stock = getStockStatus(product.inventory);
                            const lastOrdered = lastOrderedDates[product.id];
                            const price = getDisplayPrice(pantryItem, product);
                            const lineTotal = getLineTotal(pantryItem, product);
                            const isCarton = pantryItem.preferredPackSize === product.cartonSize;
                            const isSelected = selectedIds.has(pantryItem.productId);

                            return (
                                <tr
                                    key={pantryItem.productId}
                                    className={`transition-colors ${isOutOfStock ? 'opacity-50 bg-stone-50' : 'hover:bg-stone-50'}`}
                                >
                                    <td className="pl-4 pr-2 py-3">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelect(pantryItem.productId)}
                                            disabled={isOutOfStock}
                                            className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-30"
                                        />
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-md overflow-hidden bg-stone-100 flex-shrink-0">
                                                {product.imageUrl ? (
                                                    <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-stone-300 text-[10px]">N/A</div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-stone-900 truncate max-w-[180px]">{product.name}</p>
                                                {isCarton && (
                                                    <p className="text-[10px] text-emerald-600 font-medium">Carton of {product.cartonSize}</p>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 hidden sm:table-cell">{product.sku}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 hidden md:table-cell">{product.category}</td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="flex items-center justify-center gap-1">
                                            <button
                                                onClick={() => {
                                                    if (pantryItem.defaultQuantity > 1) {
                                                        onUpdatePantryItem(pantryItem.productId, { defaultQuantity: pantryItem.defaultQuantity - 1 });
                                                    }
                                                }}
                                                disabled={pantryItem.defaultQuantity <= 1}
                                                className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                                <Minus className="w-3.5 h-3.5" />
                                            </button>
                                            <span className="w-8 text-center text-sm font-medium text-stone-900">{pantryItem.defaultQuantity}</span>
                                            <button
                                                onClick={() => onUpdatePantryItem(pantryItem.productId, { defaultQuantity: pantryItem.defaultQuantity + 1 })}
                                                className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-stone-600">
                                        ${price.toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-stone-900">
                                        {isOutOfStock ? '—' : `$${lineTotal.toFixed(2)}`}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 hidden lg:table-cell">
                                        {lastOrdered ? daysAgo(lastOrdered) : <span className="text-stone-400">Never</span>}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap hidden md:table-cell">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${stock.className}`}>
                                            {stock.label}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => onAddToOrder(pantryItem)}
                                                disabled={isOutOfStock}
                                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                title="Add to order"
                                            >
                                                <ShoppingCart className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => onRemoveFromPantry(pantryItem.productId)}
                                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                                title="Remove from pantry"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="bg-stone-50 border-t-2 border-stone-300">
                            <td colSpan={6} className="px-4 py-3 text-sm font-bold text-stone-900 text-right">
                                Pantry Total
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-bold text-stone-900">
                                ${pantryTotal.toFixed(2)}
                            </td>
                            <td colSpan={3} />
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};

export default PantryList;
