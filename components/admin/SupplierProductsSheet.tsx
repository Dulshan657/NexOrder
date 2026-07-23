// "Which products does this supplier supply?" (mig 00070) — the per-supplier
// side of the product↔supplier links, for onboarding a supplier with dozens of
// SKUs without opening each product in turn.
//
// Saving writes one mutate-product `update` per CHANGED product, carrying only
// `product_suppliers` (the links-only path: mutate-product skips the column
// UPDATE when no products columns are present).
import React, { useEffect, useMemo, useState } from 'react';
import { Search, AlertTriangle } from 'lucide-react';
import type { Product, Supplier } from '../../types';
import { Sheet, Button } from '../ui';
import { linksForProduct } from '../../lib/productSuppliers';
import type { ProductSupplierLink } from '../../types';

interface SupplierProductsSheetProps {
    open: boolean;
    supplier: Supplier;
    products: Product[];
    onClose: () => void;
    /** Persist one product's full link list. Rejects surface as a toast upstream. */
    onSaveLinks: (productId: number, links: ProductSupplierLink[]) => Promise<void>;
}

// The editable state for one catalogue row, seeded from the product's links.
interface RowDraft {
    linked: boolean;
    supplierSku: string;
    costPrice: string;
}

const draftFor = (product: Product, supplierId: number): RowDraft => {
    const link = linksForProduct(product).find(l => l.supplierId === supplierId);
    return {
        linked: link != null,
        supplierSku: link?.supplierSku ?? '',
        costPrice: link?.costPrice != null ? String(link.costPrice) : '',
    };
};

/**
 * Is this supplier the product's ONLY supplier? Unticking that link would leave
 * the product with none, and `products.supplier_id` is NOT NULL — so the row is
 * locked and the operator is pointed at the product form instead. Silently
 * promoting some other supplier behind their back would be worse.
 */
const isOnlySupplier = (product: Product, supplierId: number): boolean => {
    const links = linksForProduct(product);
    return links.length === 1 && links[0].supplierId === supplierId;
};

const inputClasses = "block w-full rounded-md border-0 bg-white py-1.5 px-2 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 text-sm";

const SupplierProductsSheet: React.FC<SupplierProductsSheetProps> = ({
    open, supplier, products, onClose, onSaveLinks,
}) => {
    const [search, setSearch] = useState('');
    const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reseed whenever the sheet opens (or the catalogue refetches under it), so
    // a reopened sheet never shows another supplier's stale ticks.
    useEffect(() => {
        if (!open) return;
        const seeded: Record<number, RowDraft> = {};
        for (const p of products) seeded[p.id] = draftFor(p, supplier.id);
        setDrafts(seeded);
        setSearch('');
        setError(null);
    }, [open, supplier.id, products]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return products;
        return products.filter(p =>
            p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
        );
    }, [products, search]);

    const update = (productId: number, patch: Partial<RowDraft>) => {
        setDrafts(prev => ({ ...prev, [productId]: { ...prev[productId], ...patch } }));
    };

    // Only products whose link actually changed are written.
    const changed = useMemo(() => products.filter(p => {
        const before = draftFor(p, supplier.id);
        const after = drafts[p.id];
        if (!after) return false;
        return before.linked !== after.linked
            || before.supplierSku !== after.supplierSku
            || before.costPrice !== after.costPrice;
    }), [products, drafts, supplier.id]);

    const linkedCount = useMemo(
        () => products.filter(p => drafts[p.id]?.linked).length,
        [products, drafts],
    );

    // Rebuild a product's FULL link list with this supplier added/updated/removed.
    // set_product_suppliers replaces the list wholesale, so the untouched links
    // must be sent back verbatim or they'd be deleted.
    const nextLinksFor = (product: Product): ProductSupplierLink[] => {
        const draft = drafts[product.id];
        const others = linksForProduct(product).filter(l => l.supplierId !== supplier.id);
        if (!draft.linked) return others;

        const existing = linksForProduct(product).find(l => l.supplierId === supplier.id);
        const cost = draft.costPrice.trim();
        const sku = draft.supplierSku.trim();
        const link: ProductSupplierLink = {
            supplierId: supplier.id,
            supplierSku: sku === '' ? undefined : sku,
            costPrice: cost === '' ? undefined : Number(cost),
            // A newly ticked product that had no other supplier becomes primary;
            // otherwise the existing primary is left alone.
            isPrimary: existing?.isPrimary ?? others.length === 0,
            sortOrder: existing?.sortOrder ?? others.length,
        };
        return [...others, link];
    };

    const handleSave = async () => {
        setError(null);

        const badCost = changed.find(p => {
            const raw = drafts[p.id].costPrice.trim();
            return raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0);
        });
        if (badCost) {
            setError(`"${badCost.name}" has an invalid cost price.`);
            return;
        }

        setSaving(true);
        try {
            // Sequential, not parallel: mutate-product is rate-limited to 30/min
            // per user, and a burst of concurrent invokes would trip it.
            for (const product of changed) {
                await onSaveLinks(product.id, nextLinksFor(product));
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save supplier products.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title={`Products from ${supplier.name}`}
            description={`${linkedCount} of ${products.length} products linked. Tick what this supplier supplies, and record their own part number so goods-in can match a delivery docket.`}
            width="xl"
            dirty={changed.length > 0}
            discardConfirm={{
                title: 'Discard changes?',
                message: 'Your supplier product changes have not been saved.',
            }}
            footer={({ requestClose }) => (
                <div className="flex items-center justify-between gap-3 w-full">
                    <span className="text-xs text-stone-500">
                        {changed.length === 0
                            ? 'No changes'
                            : `${changed.length} product${changed.length === 1 ? '' : 's'} changed`}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={requestClose} disabled={saving}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving || changed.length === 0}>
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </div>
            )}
        >
            <div className="space-y-3">
                {error && (
                    <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5">
                        {error}
                    </div>
                )}

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Filter by product name or SKU…"
                        aria-label="Filter products"
                        className="w-full pl-10 pr-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600"
                    />
                </div>

                <div className="hidden sm:grid grid-cols-[auto_1.8fr_1.1fr_0.9fr] gap-2 text-[11px] font-medium text-stone-500 px-0.5">
                    <span className="w-4"></span><span>Product</span><span>Their part no.</span><span>Cost / unit</span>
                </div>

                <ul className="divide-y divide-stone-100">
                    {visible.map(product => {
                        const draft = drafts[product.id];
                        if (!draft) return null;
                        const locked = draft.linked && isOnlySupplier(product, supplier.id);
                        return (
                            <li key={product.id} className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1.8fr_1.1fr_0.9fr] gap-2 items-center py-2">
                                <input
                                    type="checkbox"
                                    checked={draft.linked}
                                    disabled={locked}
                                    onChange={e => update(product.id, { linked: e.target.checked })}
                                    aria-label={`${supplier.name} supplies ${product.name}`}
                                    className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-600 disabled:opacity-50"
                                />
                                <div className="min-w-0">
                                    <p className="text-sm text-stone-800 truncate">{product.name}</p>
                                    <p className="text-xs text-stone-400 font-mono">{product.sku}</p>
                                    {locked && (
                                        <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-0.5">
                                            <AlertTriangle className="w-3 h-3 shrink-0" />
                                            Only supplier — set another as primary in the product first.
                                        </p>
                                    )}
                                </div>
                                <input
                                    type="text"
                                    value={draft.supplierSku}
                                    disabled={!draft.linked}
                                    onChange={e => update(product.id, { supplierSku: e.target.value })}
                                    placeholder="optional"
                                    aria-label={`${supplier.name} part number for ${product.name}`}
                                    className={`${inputClasses} disabled:bg-stone-50 disabled:text-stone-400`}
                                />
                                <input
                                    type="number" min="0" step="0.01"
                                    value={draft.costPrice}
                                    disabled={!draft.linked}
                                    onChange={e => update(product.id, { costPrice: e.target.value })}
                                    placeholder="optional"
                                    aria-label={`${supplier.name} cost price for ${product.name}`}
                                    className={`${inputClasses} disabled:bg-stone-50 disabled:text-stone-400`}
                                />
                            </li>
                        );
                    })}
                </ul>

                {visible.length === 0 && (
                    <p className="text-sm text-stone-500 text-center py-8">No products match “{search}”.</p>
                )}
            </div>
        </Sheet>
    );
};

export default SupplierProductsSheet;
