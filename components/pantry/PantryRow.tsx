import React, { useState, useRef, useEffect } from 'react';
import type { Product, HoReCa, PantryItem } from '../../types';
import { ShoppingCart, Trash2, Minus, Plus, AlertTriangle, Sparkles, ChevronDown, ImageOff } from 'lucide-react';
import { resolveHoReCaPrice } from '../../pricing';
import type { PantryFrequencyEntry } from '../../hooks/usePantryFrequency';
import { daysUntil } from '../../hooks/usePantryFrequency';
import PantrySubstitutePopover from './PantrySubstitutePopover';
import OptimizedImage from '../OptimizedImage';

interface PantryRowProps {
    pantryItem: PantryItem;
    product: Product;
    selectedHoReCa: HoReCa | null;
    cartonDiscountPercent: number;
    frequency: PantryFrequencyEntry | undefined;
    inCartQty: number;
    isSelected: boolean;
    isFocused: boolean;
    onToggleSelect: () => void;
    onAddToOrder: () => void;
    onRemove: () => void;
    onUpdatePackSize: (packSize: number | undefined) => void;
    onUpdateQuantity: (quantity: number) => void;
    onSuggestSubstitute?: () => void;
    substituteOpen?: boolean;
    substituteSuggestions?: Product[];
    onCloseSubstitute?: () => void;
    onReplaceSubstitute?: (substitute: Product, addToPantry: boolean) => void;
    onFocus: () => void;
}

function formatRelativeDate(iso: string): string {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return '1d ago';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

const PantryRow: React.FC<PantryRowProps> = ({
    pantryItem,
    product,
    selectedHoReCa,
    cartonDiscountPercent,
    frequency,
    inCartQty,
    isSelected,
    isFocused,
    onToggleSelect,
    onAddToOrder,
    onRemove,
    onUpdatePackSize,
    onUpdateQuantity,
    onSuggestSubstitute,
    substituteOpen,
    substituteSuggestions,
    onCloseSubstitute,
    onReplaceSubstitute,
    onFocus,
}) => {
    const rowRef = useRef<HTMLDivElement>(null);
    const qtyInputRef = useRef<HTMLInputElement>(null);
    const [isEditingQty, setIsEditingQty] = useState(false);
    const [qtyDraft, setQtyDraft] = useState(String(pantryItem.defaultQuantity));
    const [presetsOpen, setPresetsOpen] = useState(false);

    useEffect(() => {
        if (isFocused) rowRef.current?.focus();
    }, [isFocused]);

    useEffect(() => {
        setQtyDraft(String(pantryItem.defaultQuantity));
    }, [pantryItem.defaultQuantity]);

    const unitPrice = resolveHoReCaPrice(product, selectedHoReCa);
    const isOutOfStock = product.available <= 0;
    const isLowStock = !isOutOfStock && product.available < 10;
    const isCarton = pantryItem.preferredPackSize === product.cartonSize;
    const discountMultiplier = 1 - cartonDiscountPercent / 100;
    const displayPrice = isCarton ? unitPrice * product.cartonSize * discountMultiplier : unitPrice;
    const lineTotal = displayPrice * pantryItem.defaultQuantity;
    const cartonSavings = isCarton ? unitPrice * product.cartonSize * pantryItem.defaultQuantity - lineTotal : 0;

    const dueDays = daysUntil(frequency?.predictedNextOrderDate ?? null);
    const showDueSoon = !!frequency?.dueSoon && dueDays !== null && dueDays >= -3 && !isOutOfStock;

    const presets: { label: string; qty: number }[] = [];
    if (pantryItem.defaultQuantity !== 1) presets.push({ label: 'Just 1', qty: 1 });
    if (frequency && frequency.count90d > 0) {
        // most common qty isn't tracked in PantryItem; use last-ordered fallback via average frequency
        const avg = frequency.count30d ? Math.max(1, Math.round(frequency.count30d / 1)) : null;
        if (avg && avg !== pantryItem.defaultQuantity) presets.push({ label: `30d avg: ${avg}`, qty: avg });
    }
    if (product.cartonSize > 1 && product.cartonSize !== pantryItem.defaultQuantity && !isCarton) {
        presets.push({ label: `Full carton: ${product.cartonSize}`, qty: product.cartonSize });
    }

    const commitQty = () => {
        const parsed = parseInt(qtyDraft, 10);
        if (!Number.isNaN(parsed) && parsed >= 1) {
            onUpdateQuantity(parsed);
        } else {
            setQtyDraft(String(pantryItem.defaultQuantity));
        }
        setIsEditingQty(false);
    };

    return (
        <div
            ref={rowRef}
            role="listitem"
            tabIndex={isFocused ? 0 : -1}
            onFocus={onFocus}
            aria-label={`${product.name}, ${pantryItem.defaultQuantity} ${isCarton ? 'cartons' : product.unit}`}
            data-product-id={product.id}
            className={[
                'group relative grid items-center gap-2 px-3 sm:px-4 py-3 transition-colors outline-none',
                'grid-cols-[24px_44px_minmax(0,1fr)_auto] lg:grid-cols-[24px_44px_minmax(0,1fr)_220px_180px_140px_72px]',
                isOutOfStock ? 'opacity-70 bg-stone-50/40' : 'hover:bg-stone-50/70',
                isSelected ? 'bg-emerald-50/40' : '',
                isFocused ? 'ring-2 ring-inset ring-nexgen-blue/40 bg-nexgen-blue/[0.03]' : '',
            ].join(' ')}
        >
            {/* Col 1: checkbox */}
            <div className="flex items-center justify-center">
                <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isOutOfStock}
                    onChange={onToggleSelect}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500/40 disabled:opacity-30"
                    aria-label={`Select ${product.name}`}
                />
            </div>

            {/* Col 2: thumbnail */}
            <div className="w-11 h-11 rounded-lg overflow-hidden bg-stone-100 ring-1 ring-stone-200/70 flex-shrink-0">
                <OptimizedImage
                    src={product.imageUrl}
                    alt=""
                    className="w-full h-full"
                    transformWidth={96}
                    fallback={
                        <div className="w-full h-full flex items-center justify-center text-stone-300">
                            <ImageOff className="w-4 h-4" aria-hidden />
                        </div>
                    }
                />
            </div>

            {/* Col 3: identity stack */}
            <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <p className="font-display font-medium text-stone-900 text-sm truncate tracking-tight">
                        {product.name}
                    </p>
                    {inCartQty > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-100 flex-shrink-0">
                            <span className="font-mono tabular-nums">+{inCartQty}</span>
                            <span>in cart</span>
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="font-mono text-[10.5px] text-stone-400">{product.sku}</span>
                    {frequency && frequency.count30d > 0 && (
                        <>
                            <span className="text-stone-300">·</span>
                            <span className="text-[10.5px] text-stone-500">
                                <span className="font-mono tabular-nums">{frequency.count30d}×</span> / 30d
                            </span>
                        </>
                    )}
                    {frequency?.lastOrderedDate && (
                        <>
                            <span className="text-stone-300">·</span>
                            <span className="text-[10.5px] text-stone-400">
                                last {formatRelativeDate(frequency.lastOrderedDate)}
                            </span>
                        </>
                    )}
                    {showDueSoon && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                            <Sparkles className="w-2.5 h-2.5" aria-hidden />
                            {dueDays !== null && dueDays > 0 ? `Due in ${dueDays}d` : dueDays === 0 ? 'Due today' : 'Overdue'}
                        </span>
                    )}
                    {isOutOfStock && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-100">
                            <AlertTriangle className="w-2.5 h-2.5" aria-hidden />
                            Out of stock
                        </span>
                    )}
                    {isLowStock && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                            <span className="font-mono tabular-nums">{product.available}</span> left
                        </span>
                    )}
                </div>
            </div>

            {/* Col 4: pack toggle (desktop only ≥ lg) */}
            <div className="hidden lg:flex items-center gap-1">
                <div className="inline-flex rounded-lg bg-stone-100 p-0.5 text-[11px] font-medium" role="group" aria-label="Pack size">
                    <button
                        type="button"
                        onClick={() => onUpdatePackSize(undefined)}
                        className={`px-2 py-1 rounded-md transition-colors ${!isCarton ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                    >
                        Unit
                    </button>
                    <button
                        type="button"
                        onClick={() => onUpdatePackSize(product.cartonSize)}
                        className={`px-2 py-1 rounded-md transition-colors ${isCarton ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                    >
                        <span>Carton</span>
                        <span className="ml-1 font-mono tabular-nums text-stone-400">×{product.cartonSize}</span>
                    </button>
                </div>
                {isCarton && cartonDiscountPercent > 0 && (
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                        −{cartonDiscountPercent}%
                    </span>
                )}
            </div>

            {/* Col 5: price + stepper (desktop only ≥ lg) */}
            <div className="hidden lg:flex items-center justify-end gap-2 relative">
                <div className="text-right">
                    <div className="text-sm font-mono tabular-nums text-stone-900">${displayPrice.toFixed(2)}</div>
                    <div className="text-[10px] text-stone-400">/ {isCarton ? 'carton' : product.unit}</div>
                </div>
                <div className="inline-flex items-center border border-stone-200 rounded-lg overflow-hidden bg-white">
                    <button
                        type="button"
                        onClick={() => onUpdateQuantity(Math.max(1, pantryItem.defaultQuantity - 1))}
                        disabled={pantryItem.defaultQuantity <= 1}
                        className="px-1.5 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors disabled:opacity-30"
                        aria-label="Decrease quantity"
                    >
                        <Minus className="w-3 h-3" />
                    </button>
                    {isEditingQty ? (
                        <input
                            ref={qtyInputRef}
                            type="number"
                            min={1}
                            value={qtyDraft}
                            onChange={e => setQtyDraft(e.target.value)}
                            onBlur={commitQty}
                            onKeyDown={e => {
                                if (e.key === 'Enter') commitQty();
                                if (e.key === 'Escape') {
                                    setQtyDraft(String(pantryItem.defaultQuantity));
                                    setIsEditingQty(false);
                                }
                            }}
                            autoFocus
                            className="w-10 text-center text-sm font-mono tabular-nums font-semibold text-stone-900 bg-stone-50 py-0.5 border-0 focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={() => setIsEditingQty(true)}
                            className="w-10 text-center text-sm font-mono tabular-nums font-semibold text-stone-900 py-0.5 hover:bg-stone-50 transition-colors"
                            title="Click to type"
                        >
                            {pantryItem.defaultQuantity}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onUpdateQuantity(pantryItem.defaultQuantity + 1)}
                        className="px-1.5 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors"
                        aria-label="Increase quantity"
                    >
                        <Plus className="w-3 h-3" />
                    </button>
                </div>
                {presets.length > 0 && (
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setPresetsOpen(o => !o)}
                            className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                            aria-label="Quantity presets"
                            aria-expanded={presetsOpen}
                        >
                            <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        {presetsOpen && (
                            <div
                                className="absolute right-0 top-full mt-1 z-20 bg-white border border-stone-200 rounded-lg shadow-card-hover p-1 min-w-[140px]"
                                onMouseLeave={() => setPresetsOpen(false)}
                            >
                                {presets.map(p => (
                                    <button
                                        key={p.label}
                                        type="button"
                                        onClick={() => {
                                            onUpdateQuantity(p.qty);
                                            setPresetsOpen(false);
                                        }}
                                        className="w-full text-left px-2.5 py-1.5 rounded-md text-xs text-stone-600 hover:bg-stone-100 transition-colors"
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Col 6: line total (desktop only ≥ lg) */}
            <div className="hidden lg:block text-right">
                {isOutOfStock ? (
                    <span className="text-stone-300 font-mono">—</span>
                ) : (
                    <>
                        <div className="text-sm font-mono tabular-nums font-semibold text-stone-900">${lineTotal.toFixed(2)}</div>
                        {cartonSavings > 0 && (
                            <div className="text-[10px] font-medium text-emerald-600 font-mono">
                                save ${cartonSavings.toFixed(2)}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Col 7: actions (desktop) + collapsed mobile actions */}
            <div className="flex items-center justify-end gap-1 col-start-4 lg:col-start-7 relative">
                {isOutOfStock ? (
                    onSuggestSubstitute && (
                        <button
                            type="button"
                            onClick={onSuggestSubstitute}
                            className="text-[11px] font-medium text-amber-700 hover:text-amber-900 underline-offset-2 hover:underline px-2"
                        >
                            Substitute
                        </button>
                    )
                ) : (
                    <button
                        type="button"
                        onClick={onAddToOrder}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-nexgen-blue/10 text-nexgen-blue hover:bg-nexgen-blue hover:text-white transition-colors btn-press"
                        aria-label={`Add ${product.name} to order`}
                        title="Add to order"
                    >
                        <ShoppingCart className="w-4 h-4" />
                    </button>
                )}
                <button
                    type="button"
                    onClick={onRemove}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    aria-label={`Remove ${product.name} from pantry`}
                    title="Remove from pantry"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
                {substituteOpen && onCloseSubstitute && onReplaceSubstitute && (
                    <PantrySubstitutePopover
                        target={product}
                        suggestions={substituteSuggestions ?? []}
                        selectedHoReCa={selectedHoReCa}
                        onClose={onCloseSubstitute}
                        onReplace={onReplaceSubstitute}
                    />
                )}
            </div>

            {/* Compact mobile/tablet readout (visible < lg) */}
            <div className="col-span-4 lg:hidden grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-stone-100">
                <div className="flex items-center gap-1">
                    <div className="inline-flex rounded-lg bg-stone-100 p-0.5 text-[11px] font-medium" role="group" aria-label="Pack size">
                        <button
                            type="button"
                            onClick={() => onUpdatePackSize(undefined)}
                            className={`px-2 py-1 rounded-md transition-colors ${!isCarton ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`}
                        >
                            Unit
                        </button>
                        <button
                            type="button"
                            onClick={() => onUpdatePackSize(product.cartonSize)}
                            className={`px-2 py-1 rounded-md transition-colors ${isCarton ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`}
                        >
                            Carton
                        </button>
                    </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                    <span className="text-xs font-mono tabular-nums text-stone-500">
                        ${displayPrice.toFixed(2)} <span className="text-stone-400">×</span> {pantryItem.defaultQuantity}
                    </span>
                    <div className="inline-flex items-center border border-stone-200 rounded-lg overflow-hidden">
                        <button
                            type="button"
                            onClick={() => onUpdateQuantity(Math.max(1, pantryItem.defaultQuantity - 1))}
                            disabled={pantryItem.defaultQuantity <= 1}
                            className="px-1.5 py-1 text-stone-500 disabled:opacity-30"
                            aria-label="Decrease quantity"
                        >
                            <Minus className="w-3 h-3" />
                        </button>
                        <span className="px-2 text-xs font-mono tabular-nums font-semibold text-stone-900">
                            {pantryItem.defaultQuantity}
                        </span>
                        <button
                            type="button"
                            onClick={() => onUpdateQuantity(pantryItem.defaultQuantity + 1)}
                            className="px-1.5 py-1 text-stone-500"
                            aria-label="Increase quantity"
                        >
                            <Plus className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PantryRow;
