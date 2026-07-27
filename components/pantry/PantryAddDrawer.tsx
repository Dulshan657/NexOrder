import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Product, HoReCa, PantryItem, Category } from '../../types';
import { resolveHoReCaPrice } from '../../pricing';
import { Search, Plus, Check, ImageOff } from 'lucide-react';
import OptimizedImage from '../OptimizedImage';
import { Sheet } from '../ui';

interface PantryAddDrawerProps {
    open: boolean;
    onClose: () => void;
    products: Product[];
    pantryItems: PantryItem[];
    categories: readonly Category[];
    selectedHoReCa: HoReCa | null;
    onAddToPantry: (productId: number) => void;
}

const DEBOUNCE_MS = 150;

const PantryAddDrawer: React.FC<PantryAddDrawerProps> = ({
    open,
    onClose,
    products,
    pantryItems,
    categories,
    selectedHoReCa,
    onAddToPantry,
}) => {
    const [rawQuery, setRawQuery] = useState('');
    const [query, setQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<Category | null>(null);
    const [pulse, setPulse] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Debounce filter
    useEffect(() => {
        const id = window.setTimeout(() => setQuery(rawQuery), DEBOUNCE_MS);
        return () => window.clearTimeout(id);
    }, [rawQuery]);

    const pantryProductIds = useMemo(() => new Set(pantryItems.map(i => i.productId)), [pantryItems]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return products.filter(p => {
            if (activeCategory && p.category !== activeCategory) return false;
            if (!q) return true;
            return (
                p.name.toLowerCase().includes(q) ||
                p.sku.toLowerCase().includes(q) ||
                p.description.toLowerCase().includes(q)
            );
        });
    }, [products, query, activeCategory]);

    const grouped = useMemo(() => {
        const map = new Map<string, Product[]>();
        for (const p of filtered) {
            const arr = map.get(p.category) ?? [];
            arr.push(p);
            map.set(p.category, arr);
        }
        return (categories as readonly string[])
            .filter(c => map.has(c))
            .map(c => ({ category: c, items: map.get(c) ?? [] }));
    }, [filtered, categories]);

    // Stable identity: Overlay keys its "entrance settled" effect on this, so an
    // inline arrow would re-arm it every render and keep yanking focus back here.
    const focusSearch = useCallback(() => inputRef.current?.focus(), []);

    const handleAdd = (product: Product) => {
        onAddToPantry(product.id);
        setPulse(product.id);
        window.setTimeout(() => setPulse(null), 700);
    };

    return (
        <Sheet
            open={open}
            onClose={onClose}
            width="xl"
            mobile="full"
            title="Add to pantry"
            description={
                selectedHoReCa
                    ? `Curating ${selectedHoReCa.name}'s go-to list`
                    : 'Pick a HoReCa first'
            }
            // The focus trap lands on the header's close button; the search box is
            // what the operator actually wants to type into, same as before.
            onEntered={focusSearch}
            // Not a single vertical scroller: the search + category filter stay
            // pinned while only the product list scrolls under them.
            bodyClassName="flex-1 min-h-0 flex flex-col p-0"
            footer={
                <div className="flex items-center justify-between gap-3 w-full text-[11px] text-stone-500">
                    <span>{filtered.length} {filtered.length === 1 ? 'product' : 'products'} matching</span>
                    <span>
                        Press <kbd className="px-1.5 py-0.5 mx-1 rounded bg-white border border-stone-200 text-[10px] font-mono text-stone-500">Esc</kbd> to close
                    </span>
                </div>
            }
        >
            {/* Filters — pinned above the list */}
            <div className="shrink-0 px-5 py-4 border-b border-stone-100">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" aria-hidden />
                    <input
                        ref={inputRef}
                        type="text"
                        value={rawQuery}
                        onChange={e => setRawQuery(e.target.value)}
                        placeholder="Search by name, SKU, description…"
                        aria-label="Search products"
                        className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30 focus:border-nexgen-blue/60"
                    />
                </div>

                <div className="flex flex-wrap gap-1 mt-3">
                    <button
                        type="button"
                        onClick={() => setActiveCategory(null)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                            activeCategory === null
                                ? 'bg-stone-900 text-white'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                    >
                        All
                    </button>
                    {categories.map(cat => (
                        <button
                            key={cat}
                            type="button"
                            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                                activeCategory === cat
                                    ? 'bg-stone-900 text-white'
                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                            }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            {/* Results */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
                {grouped.length === 0 && (
                    <p className="text-center text-sm text-stone-400 py-12">
                        No products match this filter.
                    </p>
                )}
                {grouped.map(({ category, items }) => (
                    <section key={category} className="mb-4">
                        <h3 className="px-3 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                            {category}
                        </h3>
                        <ul>
                            {items.map(product => {
                                const inPantry = pantryProductIds.has(product.id);
                                const oos = product.available <= 0;
                                const price = resolveHoReCaPrice(product, selectedHoReCa);
                                const justAdded = pulse === product.id;
                                return (
                                    <li key={product.id}>
                                        <div
                                            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                                                justAdded ? 'bg-emerald-50' : 'hover:bg-stone-50'
                                            }`}
                                        >
                                            <div className="w-10 h-10 rounded-md overflow-hidden bg-stone-100 ring-1 ring-stone-200/70 flex-shrink-0">
                                                <OptimizedImage
                                                    src={product.imageUrl}
                                                    alt=""
                                                    className="w-full h-full"
                                                    transformWidth={96}
                                                    fallback={
                                                        <div className="w-full h-full flex items-center justify-center text-stone-300">
                                                            <ImageOff className="w-3.5 h-3.5" aria-hidden />
                                                        </div>
                                                    }
                                                />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-stone-900 truncate">{product.name}</p>
                                                <p className="text-[11px] text-stone-500 flex items-center gap-1.5">
                                                    <span className="font-mono tabular-nums">${price.toFixed(2)}</span>
                                                    <span className="text-stone-300">/</span>
                                                    <span>{product.unit}</span>
                                                    <span className="text-stone-300">·</span>
                                                    <span className="font-mono text-[10px] text-stone-400">{product.sku}</span>
                                                    {oos && (
                                                        <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-50 text-red-700">OOS</span>
                                                    )}
                                                </p>
                                            </div>
                                            {inPantry ? (
                                                <span
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-100"
                                                    title="Already in pantry"
                                                >
                                                    <Check className="w-3 h-3" />
                                                    In pantry
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleAdd(product)}
                                                    disabled={!selectedHoReCa}
                                                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-nexgen-blue/10 text-nexgen-blue hover:bg-nexgen-blue hover:text-white transition-colors btn-press disabled:opacity-30 disabled:cursor-not-allowed"
                                                    aria-label={`Add ${product.name} to pantry`}
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
            </div>
        </Sheet>
    );
};

export default PantryAddDrawer;
