import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Product, HoReCa, Order, OrderItem, PantryItem, Category } from '../../types';
import { resolveHoReCaPrice } from '../../pricing';
import { usePantryFrequency } from '../../hooks/usePantryFrequency';
import { usePantryKeyboard } from '../../hooks/usePantryKeyboard';
import { getSubstitutes } from '../../services/pantrySubstitutes';
import PantryToolbar, { type PantrySortKey } from './PantryToolbar';
import PantryGroup from './PantryGroup';
import PantryRow from './PantryRow';
import PantryEmptyState from './PantryEmptyState';
import PantryAddDrawer from './PantryAddDrawer';
import PantryKeyboardHints from './PantryKeyboardHints';
import { ShoppingCart, X as XIcon } from 'lucide-react';

export interface PantryListProps {
    pantryItems: PantryItem[];
    products: Product[];
    categories: readonly Category[];
    selectedHoReCa: HoReCa | null;
    allOrders: Order[];
    currentCart: OrderItem[];
    cartonDiscountPercent: number;
    lowStockThreshold: number;
    onAddToOrder: (pantryItem: PantryItem) => void;
    onAddAllToOrder: () => void;
    onAddSelectedToOrder: (items: PantryItem[]) => void;
    onRemoveFromPantry: (productId: number) => void;
    onUpdatePantryItem: (productId: number, updates: Partial<Pick<PantryItem, 'preferredPackSize' | 'defaultQuantity'>>) => void;
    onAddToPantry: (productId: number) => void;
}

interface ResolvedItem {
    pantryItem: PantryItem;
    product: Product;
}

function getCollapseStorageKey(horecaId: number): string {
    return `pantry-collapsed-groups-${horecaId}`;
}

function readCollapsedGroups(horecaId: number | null): Set<string> {
    if (horecaId === null || typeof window === 'undefined') return new Set();
    try {
        const raw = window.localStorage.getItem(getCollapseStorageKey(horecaId));
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.map(String));
    } catch {
        /* ignore */
    }
    return new Set();
}

function writeCollapsedGroups(horecaId: number, groups: Set<string>): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(getCollapseStorageKey(horecaId), JSON.stringify(Array.from(groups)));
    } catch {
        /* ignore */
    }
}

const PantryList: React.FC<PantryListProps> = ({
    pantryItems,
    products,
    categories,
    selectedHoReCa,
    allOrders,
    currentCart,
    cartonDiscountPercent,
    lowStockThreshold,
    onAddToOrder,
    onAddAllToOrder,
    onAddSelectedToOrder,
    onRemoveFromPantry,
    onUpdatePantryItem,
    onAddToPantry,
}) => {
    const [filterQuery, setFilterQuery] = useState('');
    const [sort, setSort] = useState<PantrySortKey>('frequency');
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [activeChip, setActiveChip] = useState<'all' | 'oos' | 'due' | 'savings'>('all');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => readCollapsedGroups(selectedHoReCa?.id ?? null));
    const [focusedProductId, setFocusedProductId] = useState<number | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [substituteForId, setSubstituteForId] = useState<number | null>(null);

    const filterRef = useRef<HTMLInputElement>(null);

    // Cmd/Ctrl+K opens the add drawer; ignored when drawer is already open or another modal/input is in focus consuming the key.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                if (!selectedHoReCa) return;
                e.preventDefault();
                setDrawerOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedHoReCa]);

    useEffect(() => {
        setCollapsedGroups(readCollapsedGroups(selectedHoReCa?.id ?? null));
        setSelectedIds(new Set());
        setFilterQuery('');
        setActiveChip('all');
        setFocusedProductId(null);
    }, [selectedHoReCa?.id]);

    const frequency = usePantryFrequency(allOrders, selectedHoReCa?.id ?? null);

    const cartQtyByProduct = useMemo(() => {
        const map: Record<number, number> = {};
        for (const item of currentCart) {
            map[item.id] = (map[item.id] ?? 0) + item.quantity;
        }
        return map;
    }, [currentCart]);

    const resolvedItems = useMemo<ResolvedItem[]>(() => {
        const productMap = new Map<number, Product>(products.map(p => [p.id, p] as const));
        const out: ResolvedItem[] = [];
        for (const pi of pantryItems) {
            const product = productMap.get(pi.productId);
            if (product) out.push({ pantryItem: pi, product });
        }
        return out;
    }, [pantryItems, products]);

    const lineMath = useCallback((entry: ResolvedItem) => {
        const unitPrice = resolveHoReCaPrice(entry.product, selectedHoReCa);
        const isCarton = entry.pantryItem.preferredPackSize === entry.product.cartonSize;
        const discountMultiplier = 1 - cartonDiscountPercent / 100;
        const display = isCarton ? unitPrice * entry.product.cartonSize * discountMultiplier : unitPrice;
        const lineTotal = display * entry.pantryItem.defaultQuantity;
        const baseline = isCarton ? unitPrice * entry.product.cartonSize * entry.pantryItem.defaultQuantity : lineTotal;
        const savings = isCarton ? baseline - lineTotal : 0;
        return { display, lineTotal, savings, isCarton };
    }, [selectedHoReCa, cartonDiscountPercent]);

    // Aggregate stats
    const stats = useMemo(() => {
        let total = 0;
        let savings = 0;
        let oos = 0;
        let due = 0;
        for (const entry of resolvedItems) {
            if (entry.product.available <= 0) {
                oos += 1;
                continue;
            }
            const m = lineMath(entry);
            total += m.lineTotal;
            savings += m.savings;
            if (frequency[entry.product.id]?.dueSoon) due += 1;
        }
        return { total, savings, oos, due };
    }, [resolvedItems, frequency, lineMath]);

    // Filter -> sort -> group
    const visibleItems = useMemo(() => {
        const q = filterQuery.trim().toLowerCase();
        return resolvedItems.filter(entry => {
            if (activeChip === 'oos' && entry.product.available > 0) return false;
            if (activeChip === 'due' && !frequency[entry.product.id]?.dueSoon) return false;
            if (activeChip === 'savings' && !(entry.pantryItem.preferredPackSize === entry.product.cartonSize && cartonDiscountPercent > 0)) return false;
            if (!q) return true;
            const hay = `${entry.product.name} ${entry.product.sku} ${entry.product.category}`.toLowerCase();
            return hay.includes(q);
        });
    }, [resolvedItems, frequency, filterQuery, activeChip, cartonDiscountPercent]);

    const sortedItems = useMemo(() => {
        const sorter = (a: ResolvedItem, b: ResolvedItem): number => {
            switch (sort) {
                case 'frequency': {
                    const fa = frequency[a.product.id]?.count90d ?? 0;
                    const fb = frequency[b.product.id]?.count90d ?? 0;
                    if (fb !== fa) return fb - fa;
                    return a.product.name.localeCompare(b.product.name);
                }
                case 'recency': {
                    const ta = frequency[a.product.id]?.lastOrderedDate ? new Date(frequency[a.product.id]!.lastOrderedDate!).getTime() : 0;
                    const tb = frequency[b.product.id]?.lastOrderedDate ? new Date(frequency[b.product.id]!.lastOrderedDate!).getTime() : 0;
                    if (tb !== ta) return tb - ta;
                    return a.product.name.localeCompare(b.product.name);
                }
                case 'priceDesc': {
                    const pa = lineMath(a).display;
                    const pb = lineMath(b).display;
                    if (pb !== pa) return pb - pa;
                    return a.product.name.localeCompare(b.product.name);
                }
                case 'alphabetical':
                default:
                    return a.product.name.localeCompare(b.product.name);
            }
        };
        return [...visibleItems].sort(sorter);
    }, [visibleItems, sort, frequency, lineMath]);

    const groups = useMemo(() => {
        const buckets = new Map<string, ResolvedItem[]>();
        for (const entry of sortedItems) {
            const key = entry.product.category;
            const arr = buckets.get(key) ?? [];
            arr.push(entry);
            buckets.set(key, arr);
        }
        const orderedKeys = (categories as readonly string[]).filter(c => buckets.has(c));
        // Append any unknown categories defensively
        for (const k of buckets.keys()) {
            if (!orderedKeys.includes(k)) orderedKeys.push(k);
        }
        return orderedKeys.map(category => {
            const entries = buckets.get(category) ?? [];
            const groupTotal = entries.reduce((sum, e) => {
                if (e.product.available <= 0) return sum;
                return sum + lineMath(e).lineTotal;
            }, 0);
            return { category, entries, groupTotal };
        });
    }, [sortedItems, categories, lineMath]);

    const inStockCountAll = useMemo(
        () => resolvedItems.filter(e => e.product.available > 0).length,
        [resolvedItems],
    );

    // Flat ordered list of productIds that are currently rendered (skipping collapsed groups).
    const visibleProductIds = useMemo(() => {
        const ids: number[] = [];
        for (const g of groups) {
            if (collapsedGroups.has(g.category)) continue;
            for (const e of g.entries) ids.push(e.product.id);
        }
        return ids;
    }, [groups, collapsedGroups]);

    const toggleSelect = useCallback((productId: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId);
            else next.add(productId);
            return next;
        });
    }, []);

    const handleAddSelected = useCallback(() => {
        const items = pantryItems.filter(i => selectedIds.has(i.productId));
        onAddSelectedToOrder(items);
        setSelectedIds(new Set());
    }, [pantryItems, selectedIds, onAddSelectedToOrder]);

    const handleAddGroup = useCallback((groupEntries: ResolvedItem[]) => {
        const items = groupEntries
            .filter(e => e.product.available > 0)
            .map(e => e.pantryItem);
        if (items.length > 0) onAddSelectedToOrder(items);
    }, [onAddSelectedToOrder]);

    const handleToggleGroup = useCallback((category: string) => {
        if (!selectedHoReCa) return;
        setCollapsedGroups(prev => {
            const next = new Set<string>(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            writeCollapsedGroups(selectedHoReCa.id, next);
            return next;
        });
    }, [selectedHoReCa]);

    const focusFilter = useCallback(() => filterRef.current?.focus(), []);
    const openDrawer = useCallback(() => setDrawerOpen(true), []);
    const closeDrawer = useCallback(() => setDrawerOpen(false), []);

    const pantryAndCartIds = useMemo(() => {
        const set = new Set<number>(pantryItems.map(i => i.productId));
        for (const o of currentCart) set.add(o.id);
        return set;
    }, [pantryItems, currentCart]);

    const handleReplaceSubstitute = useCallback((substitute: Product, addToPantry: boolean) => {
        // Add the substitute as a default-quantity-1 unit to the order via the existing add path.
        const synthetic: PantryItem = {
            productId: substitute.id,
            preferredPackSize: undefined,
            defaultQuantity: 1,
        };
        onAddToOrder(synthetic);
        if (addToPantry && !pantryAndCartIds.has(substitute.id)) {
            onAddToPantry(substitute.id);
        }
        setSubstituteForId(null);
    }, [onAddToOrder, onAddToPantry, pantryAndCartIds]);

    // Per-product fast lookup; used by keyboard handlers for "act on focused row".
    const productById = useMemo(() => {
        const map = new Map<number, Product>();
        for (const p of products) map.set(p.id, p);
        return map;
    }, [products]);
    const pantryItemById = useMemo(() => {
        const map = new Map<number, PantryItem>();
        for (const p of pantryItems) map.set(p.productId, p);
        return map;
    }, [pantryItems]);

    const onAddFocused = useCallback((productId: number) => {
        const pi = pantryItemById.get(productId);
        const p = productById.get(productId);
        if (!pi || !p || p.available <= 0) return;
        onAddToOrder(pi);
    }, [pantryItemById, productById, onAddToOrder]);

    const onIncQty = useCallback((productId: number) => {
        const pi = pantryItemById.get(productId);
        if (!pi) return;
        onUpdatePantryItem(productId, { defaultQuantity: pi.defaultQuantity + 1 });
    }, [pantryItemById, onUpdatePantryItem]);

    const onDecQty = useCallback((productId: number) => {
        const pi = pantryItemById.get(productId);
        if (!pi) return;
        onUpdatePantryItem(productId, { defaultQuantity: Math.max(1, pi.defaultQuantity - 1) });
    }, [pantryItemById, onUpdatePantryItem]);

    const onTogglePackSize = useCallback((productId: number) => {
        const pi = pantryItemById.get(productId);
        const p = productById.get(productId);
        if (!pi || !p) return;
        const next = pi.preferredPackSize === p.cartonSize ? undefined : p.cartonSize;
        onUpdatePantryItem(productId, { preferredPackSize: next });
    }, [pantryItemById, productById, onUpdatePantryItem]);

    const onAddAllVisible = useCallback((ids: number[]) => {
        const items = ids
            .map(id => pantryItemById.get(id))
            .filter((p): p is PantryItem => !!p)
            .filter(p => (productById.get(p.productId)?.available ?? 0) > 0);
        if (items.length > 0) onAddSelectedToOrder(items);
    }, [pantryItemById, productById, onAddSelectedToOrder]);

    const onCloseAll = useCallback(() => {
        if (drawerOpen) setDrawerOpen(false);
        if (substituteForId !== null) setSubstituteForId(null);
    }, [drawerOpen, substituteForId]);

    usePantryKeyboard({
        enabled: !drawerOpen && !!selectedHoReCa,
        productIds: visibleProductIds,
        focusedProductId,
        setFocusedProductId,
        focusFilter,
        onSelectToggle: toggleSelect,
        onAddFocused,
        onIncQty,
        onDecQty,
        onTogglePackSize,
        onAddSelected: handleAddSelected,
        onAddAllVisible,
        onCloseAll,
    });

    // Guard: no HoReCa
    if (!selectedHoReCa) {
        return <PantryEmptyState variant="no-horeca" />;
    }

    // Guard: no items
    if (resolvedItems.length === 0) {
        return (
            <>
                <PantryEmptyState
                    variant="no-items"
                    horecaName={selectedHoReCa.name}
                    onOpenAddDrawer={openDrawer}
                />
                <PantryAddDrawer
                    open={drawerOpen}
                    onClose={closeDrawer}
                    products={products}
                    pantryItems={pantryItems}
                    categories={categories}
                    selectedHoReCa={selectedHoReCa}
                    onAddToPantry={onAddToPantry}
                />
            </>
        );
    }

    const chips = [
        {
            label: 'Total',
            value: `$${stats.total.toFixed(2)}`,
            tone: 'neutral' as const,
        },
        ...(stats.savings > 0
            ? [{
                  label: 'Carton savings',
                  value: `$${stats.savings.toFixed(2)}`,
                  tone: 'success' as const,
                  active: activeChip === 'savings',
                  onClick: () => setActiveChip(activeChip === 'savings' ? 'all' : 'savings'),
              }]
            : []),
        ...(stats.due > 0
            ? [{
                  label: 'Due soon',
                  value: String(stats.due),
                  tone: 'success' as const,
                  active: activeChip === 'due',
                  onClick: () => setActiveChip(activeChip === 'due' ? 'all' : 'due'),
              }]
            : []),
        ...(stats.oos > 0
            ? [{
                  label: 'Out of stock',
                  value: String(stats.oos),
                  tone: 'danger' as const,
                  active: activeChip === 'oos',
                  onClick: () => setActiveChip(activeChip === 'oos' ? 'all' : 'oos'),
              }]
            : []),
    ];

    const noFilterMatches = sortedItems.length === 0;

    return (
        <div className="space-y-3">
            <PantryToolbar
                ref={filterRef}
                horecaName={selectedHoReCa.name}
                itemCount={resolvedItems.length}
                filterQuery={filterQuery}
                onFilterChange={setFilterQuery}
                sort={sort}
                onSortChange={setSort}
                chips={chips}
                selectedCount={selectedIds.size}
                inStockCount={inStockCountAll}
                onAddSelected={handleAddSelected}
                onAddAll={onAddAllToOrder}
                onOpenAddDrawer={openDrawer}
            />

            <PantryAddDrawer
                open={drawerOpen}
                onClose={closeDrawer}
                products={products}
                pantryItems={pantryItems}
                categories={categories}
                selectedHoReCa={selectedHoReCa}
                onAddToPantry={onAddToPantry}
            />

            {noFilterMatches ? (
                <PantryEmptyState
                    variant="no-filter-match"
                    onClearFilter={() => {
                        setFilterQuery('');
                        setActiveChip('all');
                    }}
                />
            ) : (
                <div className="bg-white rounded-xl border border-stone-200/70 shadow-card overflow-hidden">
                    {groups.map(({ category, entries, groupTotal }) => {
                        const isCollapsed = collapsedGroups.has(category);
                        const groupHasInStock = entries.some(e => e.product.inventory > 0);
                        return (
                            <PantryGroup
                                key={category}
                                category={category}
                                itemCount={entries.length}
                                estTotal={groupTotal}
                                isCollapsed={isCollapsed}
                                onToggleCollapse={() => handleToggleGroup(category)}
                                onAddAll={() => handleAddGroup(entries)}
                                canAddAll={groupHasInStock}
                            >
                                {entries.map(entry => {
                                    const productId = entry.product.id;
                                    const subOpen = substituteForId === productId;
                                    const suggestions = subOpen
                                        ? getSubstitutes(entry.product, products, frequency, pantryAndCartIds)
                                        : undefined;
                                    return (
                                        <PantryRow
                                            key={entry.pantryItem.productId}
                                            pantryItem={entry.pantryItem}
                                            product={entry.product}
                                            selectedHoReCa={selectedHoReCa}
                                            cartonDiscountPercent={cartonDiscountPercent}
                                            lowStockThreshold={lowStockThreshold}
                                            frequency={frequency[productId]}
                                            inCartQty={cartQtyByProduct[productId] ?? 0}
                                            isSelected={selectedIds.has(entry.pantryItem.productId)}
                                            isFocused={focusedProductId === entry.pantryItem.productId}
                                            onToggleSelect={() => toggleSelect(entry.pantryItem.productId)}
                                            onAddToOrder={() => onAddToOrder(entry.pantryItem)}
                                            onRemove={() => onRemoveFromPantry(entry.pantryItem.productId)}
                                            onUpdatePackSize={ps => onUpdatePantryItem(entry.pantryItem.productId, { preferredPackSize: ps })}
                                            onUpdateQuantity={qty => onUpdatePantryItem(entry.pantryItem.productId, { defaultQuantity: qty })}
                                            onSuggestSubstitute={() => setSubstituteForId(subOpen ? null : productId)}
                                            substituteOpen={subOpen}
                                            substituteSuggestions={suggestions}
                                            onCloseSubstitute={() => setSubstituteForId(null)}
                                            onReplaceSubstitute={handleReplaceSubstitute}
                                            onFocus={() => setFocusedProductId(entry.pantryItem.productId)}
                                        />
                                    );
                                })}
                            </PantryGroup>
                        );
                    })}
                </div>
            )}

            <PantryKeyboardHints />

            {/* Sticky mobile action bar — appears when ≥1 selected, only below lg */}
            {selectedIds.size > 0 && (
                <div
                    className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-stone-200 px-4 py-3 flex items-center gap-3 shadow-[0_-8px_20px_rgba(15,23,42,0.04)]"
                    style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                >
                    <button
                        type="button"
                        onClick={() => setSelectedIds(new Set())}
                        className="p-2 rounded-lg text-stone-500 hover:bg-stone-100"
                        aria-label="Clear selection"
                    >
                        <XIcon className="w-4 h-4" />
                    </button>
                    <div className="flex-1 text-sm text-stone-700">
                        <span className="font-mono tabular-nums font-semibold">{selectedIds.size}</span>
                        <span className="text-stone-500"> selected</span>
                    </div>
                    <button
                        type="button"
                        onClick={handleAddSelected}
                        className="inline-flex items-center gap-1.5 bg-nexgen-blue text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-nexgen-blue-dark transition-colors btn-press"
                    >
                        <ShoppingCart className="w-4 h-4" />
                        Add to order
                    </button>
                </div>
            )}
        </div>
    );
};

export default PantryList;
