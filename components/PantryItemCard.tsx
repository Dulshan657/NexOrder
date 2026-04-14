import React, { useState } from 'react';
import type { Product, HoReCa, PantryItem } from '../types';
import { ShoppingCart, Trash2, AlertTriangle, Clock } from 'lucide-react';
import { resolveHoReCaPrice } from '../pricing';

interface PantryItemCardProps {
    pantryItem: PantryItem;
    product: Product;
    selectedHoReCa: HoReCa | null;
    cartonDiscountPercent: number;
    lastOrderedDate?: string | null;
    isSelected?: boolean;
    onToggleSelect?: () => void;
    onAddToOrder: () => void;
    onRemove: () => void;
    onUpdatePackSize: (packSize: number | undefined) => void;
    onUpdateQuantity: (quantity: number) => void;
}

const getPackLabel = (packSize: number | undefined, cartonSize: number): string => {
    if (packSize === cartonSize) return `Carton (x${cartonSize})`;
    return 'Unit';
};

const formatRelativeDate = (isoDate: string): string => {
    const diff = Date.now() - new Date(isoDate).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
};

const PantryItemCard: React.FC<PantryItemCardProps> = ({
    pantryItem,
    product,
    selectedHoReCa,
    cartonDiscountPercent,
    lastOrderedDate,
    isSelected,
    onToggleSelect,
    onAddToOrder,
    onRemove,
    onUpdatePackSize,
    onUpdateQuantity,
}) => {
    const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);
    const isOutOfStock = product.inventory <= 0;
    const isLowStock = product.inventory > 0 && product.inventory < 10;
    const [isEditingQty, setIsEditingQty] = useState(false);
    const [editQtyValue, setEditQtyValue] = useState(String(pantryItem.defaultQuantity));

    const discountMultiplier = 1 - (cartonDiscountPercent / 100);
    const isCarton = pantryItem.preferredPackSize === product.cartonSize;

    const getDisplayPrice = (packSize: number | undefined): number => {
        if (packSize === product.cartonSize) return (unitPrice * product.cartonSize) * discountMultiplier;
        return unitPrice;
    };

    const displayPrice = getDisplayPrice(pantryItem.preferredPackSize);
    const lineTotal = displayPrice * pantryItem.defaultQuantity;

    const cartonSavings = isCarton
        ? (unitPrice * product.cartonSize * pantryItem.defaultQuantity) - lineTotal
        : 0;

    const packSizeOptions: { value: number | undefined; label: string }[] = [
        { value: undefined, label: 'Unit' },
        { value: product.cartonSize, label: `Carton (x${product.cartonSize})` },
    ];

    const handleQtyBlur = () => {
        const parsed = parseInt(editQtyValue, 10);
        if (!isNaN(parsed) && parsed >= 1) {
            onUpdateQuantity(parsed);
        } else {
            setEditQtyValue(String(pantryItem.defaultQuantity));
        }
        setIsEditingQty(false);
    };

    const handleQtyKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleQtyBlur();
        if (e.key === 'Escape') {
            setEditQtyValue(String(pantryItem.defaultQuantity));
            setIsEditingQty(false);
        }
    };

    return (
        <div className={`bg-white rounded-xl border transition-all duration-200 ${
            isOutOfStock
                ? 'border-red-200 bg-red-50/30'
                : isSelected
                    ? 'border-emerald-400 ring-2 ring-emerald-100 shadow-md'
                    : 'border-stone-200 hover:shadow-md hover:border-stone-300'
        }`}>
            {/* Out of stock / Low stock banner */}
            {(isOutOfStock || isLowStock) && (
                <div className={`flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-t-xl ${
                    isOutOfStock ? 'bg-red-100 text-red-700' : 'bg-amber-50 text-amber-700'
                }`}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {isOutOfStock ? 'Out of Stock' : `Low Stock — ${product.inventory} remaining`}
                </div>
            )}

            <div className={`p-4 ${isOutOfStock ? 'opacity-60' : ''}`}>
                <div className="flex gap-4">
                    {/* Checkbox + Product Image */}
                    <div className="flex flex-col items-center gap-2 flex-shrink-0">
                        {onToggleSelect && (
                            <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={onToggleSelect}
                                disabled={isOutOfStock}
                                className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                            />
                        )}
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-stone-100">
                            {product.imageUrl ? (
                                <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-stone-400">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Product Info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h4 className="font-display font-semibold text-stone-900 truncate">{product.name}</h4>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <p className="text-xs text-stone-400">{product.sku}</p>
                                    {lastOrderedDate && (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
                                            <Clock className="w-3 h-3" />
                                            {formatRelativeDate(lastOrderedDate)}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={onRemove}
                                className="text-stone-400 hover:text-red-500 transition-colors duration-200 p-2 -mr-1.5 rounded-md flex-shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500"
                                aria-label={`Remove ${product.name} from pantry`}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Pack Size Selector */}
                        <div className="flex gap-1 mt-2.5 flex-wrap">
                            {packSizeOptions.map(opt => (
                                <button
                                    key={String(opt.value)}
                                    onClick={() => onUpdatePackSize(opt.value)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                        pantryItem.preferredPackSize === opt.value
                                            ? 'bg-stone-900 text-white'
                                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                            {isCarton && cartonDiscountPercent > 0 && (
                                <span className="px-2 py-1 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Save {cartonDiscountPercent}%
                                </span>
                            )}
                        </div>

                        {/* Price & Quantity Row */}
                        <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
                            <div className="flex items-baseline gap-1">
                                <span className="text-sm font-semibold text-stone-900">${displayPrice.toFixed(2)}</span>
                                <span className="text-xs text-stone-400">/ {getPackLabel(pantryItem.preferredPackSize, product.cartonSize).toLowerCase()}</span>
                            </div>

                            {/* Quantity Stepper with editable input */}
                            <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden">
                                <button
                                    onClick={() => onUpdateQuantity(Math.max(1, pantryItem.defaultQuantity - 1))}
                                    className="px-2.5 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors text-sm font-medium"
                                >
                                    -
                                </button>
                                {isEditingQty ? (
                                    <input
                                        type="number"
                                        min="1"
                                        value={editQtyValue}
                                        onChange={e => setEditQtyValue(e.target.value)}
                                        onBlur={handleQtyBlur}
                                        onKeyDown={handleQtyKeyDown}
                                        className="w-12 text-center text-sm font-semibold text-stone-900 bg-stone-50 py-1 border-0 focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        autoFocus
                                    />
                                ) : (
                                    <button
                                        onClick={() => {
                                            setEditQtyValue(String(pantryItem.defaultQuantity));
                                            setIsEditingQty(true);
                                        }}
                                        className="px-3 py-1 text-sm font-semibold text-stone-900 bg-stone-50 min-w-[2.5rem] text-center hover:bg-stone-100 transition-colors cursor-text"
                                        title="Click to type quantity"
                                    >
                                        {pantryItem.defaultQuantity}
                                    </button>
                                )}
                                <button
                                    onClick={() => onUpdateQuantity(pantryItem.defaultQuantity + 1)}
                                    className="px-2.5 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors text-sm font-medium"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        {/* Line Total & Add Button */}
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100">
                            <div>
                                <span className="text-sm font-semibold text-stone-700">
                                    Total: <span className="text-stone-900">${lineTotal.toFixed(2)}</span>
                                </span>
                                {cartonSavings > 0 && (
                                    <span className="ml-2 text-[10px] font-medium text-emerald-600">
                                        (saving ${cartonSavings.toFixed(2)})
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={onAddToOrder}
                                disabled={isOutOfStock}
                                className="flex items-center gap-1.5 bg-nexgen-blue text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-nexgen-blue-dark transition-colors disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed"
                            >
                                <ShoppingCart className="w-3.5 h-3.5" />
                                Add
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PantryItemCard;
