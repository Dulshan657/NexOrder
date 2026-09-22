// FIX: Implement the ProductAdmin component.
import React, { useState, useMemo } from 'react';
import { FileUp, Tag, X } from 'lucide-react';
import type { Category, Product, Supplier } from '../types';
import ProductForm from './ProductForm';
import ConfirmationDialog from './ConfirmationDialog';
import ProductImportModal from './admin/ProductImportModal';
import BulkBrandModal from './admin/BulkBrandModal';
import ProductAdminRow from './admin/ProductAdminRow';
import { ProductAdminFilters } from './admin/ProductAdminFilters';
import { PRODUCT_ROW_COLUMNS } from './admin/productAdminColumns';
import { categoryOptions } from '../lib/productTaxonomy';
import { matchesProductQuery } from '../lib/productSuppliers';
import { WarehousePicker } from './inventory/WarehousePicker';
import { useWarehouseScope } from '../context/WarehouseScopeContext';
import { useProductStockByWarehouse } from '../hooks/queries/useInventoryBalances';
import { useSettings } from '../hooks/queries/useSettings';
import { useFlagDeepLink } from '../hooks/useFlagDeepLink';

interface ProductAdminProps {
    products: Product[];
    suppliers: Supplier[];
    onAddProduct: (product: Omit<Product, 'id' | 'inventory'>) => Promise<void>;
    onUpdateProduct: (product: Product) => Promise<void>;
    onDeleteProduct: (productId: number) => void;
    addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const ProductAdmin: React.FC<ProductAdminProps> = ({ products, suppliers, onAddProduct, onUpdateProduct, onDeleteProduct, addToast }) => {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [productToEdit, setProductToEdit] = useState<Product | null>(null);
    const [productToDelete, setProductToDelete] = useState<Product | null>(null);
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [hideNotStockedHere, setHideNotStockedHere] = useState(false);
    // Bulk brand assign (mig 00114). Ids, not products: the selection has to
    // survive a refetch that replaces every Product object.
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isBrandOpen, setIsBrandOpen] = useState(false);

    // ?prodimport=1 — the setup checklist's "catalogue loaded" step.
    useFlagDeepLink('prodimport', () => setIsImportOpen(true));

    const { scope } = useWarehouseScope();
    const { data: siteStock } = useProductStockByWarehouse(scope === 'all' ? null : scope);
    const onHandBySite = useMemo(() => new Map(siteStock?.map(r => [r.productId, r.onHand]) ?? []), [siteStock]);
    const { data: settings } = useSettings();
    const globalThreshold = settings?.low_stock_threshold ?? 10;

    const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s.name] as const)), [suppliers]);

    // Search and category live HERE, not inside ProductAdminFilters, and that is
    // load-bearing rather than a preference — `selectedProducts` below
    // intersects the selection with what is visible, so a filter this component
    // could not see would let `applyBrand` re-brand rows the operator has
    // narrowed away. Same reason the warehouse filter lives here.
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<Category | 'All'>('All');

    // Built-ins first, then any operator-created category — filtered to the ones
    // actually present so the list doesn't offer empty categories.
    const activeCategories = useMemo(() => {
        const present = new Set(products.map(p => p.category));
        return categoryOptions(products).filter(c => present.has(c));
    }, [products]);

    const scopedProducts = useMemo(() => {
        if (scope === 'all' || !hideNotStockedHere) return products;
        // `has`, never `?? 0`: a product with a zero-quantity row IS stocked
        // here and one with no row at all is not, and the two must not merge.
        return products.filter(p => onHandBySite.has(p.id));
    }, [products, scope, hideNotStockedHere, onHandBySite]);

    const visibleProducts = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return scopedProducts.filter(p => {
            if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
            // `matchesProductQuery` already covers name / SKU / barcode /
            // supplier SKU — a strictly better match set than a hand-rolled
            // name-and-SKU test, and one definition rather than two.
            return !q || matchesProductQuery(p, q);
        });
    }, [scopedProducts, searchQuery, categoryFilter]);

    // Only ever act on what is ON SCREEN. A selection made before the operator
    // narrowed the list by warehouse must not quietly re-brand rows they can no
    // longer see, so the effective selection is intersected with what is visible.
    const selectedProducts = useMemo(
        () => visibleProducts.filter(p => selectedIds.has(p.id)),
        [visibleProducts, selectedIds],
    );
    const allVisibleSelected = visibleProducts.length > 0
        && selectedProducts.length === visibleProducts.length;

    const toggleOne = (id: number, next: boolean) => {
        setSelectedIds(prev => {
            const copy = new Set(prev);
            if (next) copy.add(id); else copy.delete(id);
            return copy;
        });
    };
    const toggleAllVisible = (next: boolean) => {
        setSelectedIds(next ? new Set(visibleProducts.map(p => p.id)) : new Set());
    };

    const applyBrand = async (brand: string | null) => {
        // One update per product through the existing mutation: it already
        // carries the optimistic cache handling, and the row count here is a
        // screenful, not a catalogue. (An earlier version of this comment
        // claimed the server had a bulk-set-brand action. It does not, and
        // until 2026-09-04 `mutate-product` dropped `brand` altogether, so
        // this modal reported success and changed nothing.)
        for (const p of selectedProducts) {
            // '' NOT undefined for a clear. `Product.brand` is `string | undefined`
            // and `lib/adapters.ts` skips every undefined key, so `?? undefined`
            // dropped the clear on the floor and the toast still said it worked.
            // '' is the spelling the adapter maps to null (its comment says so).
            await onUpdateProduct({ ...p, brand: brand ?? '' });
        }
        addToast?.(
            brand
                ? `Set ${selectedProducts.length} product(s) to ${brand}`
                : `Cleared the brand on ${selectedProducts.length} product(s)`,
            'success',
        );
        setSelectedIds(new Set());
    };

    const handleOpenFormForEdit = (product: Product) => {
        setProductToEdit(product);
        setIsFormOpen(true);
    };

    const handleOpenFormForNew = () => {
        setProductToEdit(null);
        setIsFormOpen(true);
    };

    const handleSaveProduct = async (productData: Product | Omit<Product, 'id' | 'inventory'>) => {
        try {
            if ('id' in productData) {
                await onUpdateProduct(productData);
            } else {
                await onAddProduct(productData);
            }
            // Only close on success — on failure the toast (raised by the caller)
            // explains why, and the operator can fix the form without re-entering data.
            setIsFormOpen(false);
        } catch {
            // Swallow: the caller is responsible for surfacing the error (toast).
            // Keep the modal open so the operator's input isn't lost.
        }
    };
    
    const confirmDelete = () => {
        if (productToDelete) {
            onDeleteProduct(productToDelete.id);
            setProductToDelete(null);
        }
    };
    
    return (
        <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Manage Products</h2>
                <div className="flex flex-wrap items-center gap-2">
                    <WarehousePicker />
                    {scope !== 'all' && (
                        <label className="inline-flex items-center gap-1.5 text-sm text-stone-600 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={hideNotStockedHere}
                                onChange={(e) => setHideNotStockedHere(e.target.checked)}
                                className="rounded border-stone-300 text-nexgen-blue focus:ring-nexgen-blue/30"
                            />
                            Hide not stocked here
                        </label>
                    )}
                    <button
                        onClick={() => setIsImportOpen(true)}
                        className="inline-flex items-center gap-1.5 border border-stone-300 text-stone-700 font-medium py-2 px-4 rounded-lg hover:bg-stone-50 transition-colors btn-press"
                    >
                        <FileUp className="w-4 h-4" /> Import
                    </button>
                    <button
                        onClick={handleOpenFormForNew}
                        className="bg-stone-900 text-white font-medium py-2 px-4 rounded-lg hover:bg-stone-800 transition-colors shadow-sm btn-press"
                    >
                        Add New Product
                    </button>
                </div>
            </div>
            {selectedProducts.length > 0 && (
                <div
                    role="status"
                    // Toasts are `role="status"` too, so the role alone cannot
                    // name this bar from a test — and a selection that silently
                    // survives a filter is exactly the bug worth pinning.
                    data-testid="bulk-selection-bar"
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2"
                >
                    <span className="text-sm text-stone-700">
                        <span className="font-mono tabular-nums">{selectedProducts.length}</span> selected
                    </span>
                    <button
                        onClick={() => setIsBrandOpen(true)}
                        className="btn-press inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white"
                    >
                        <Tag className="w-3.5 h-3.5" /> Set brand
                    </button>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        className="btn-press inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 ml-auto"
                    >
                        <X className="w-3.5 h-3.5" /> Clear selection
                    </button>
                </div>
            )}
            <ProductAdminFilters
                query={searchQuery}
                onQueryChange={setSearchQuery}
                category={categoryFilter}
                onCategoryChange={setCategoryFilter}
                categories={activeCategories}
                shown={visibleProducts.length}
                total={scopedProducts.length}
            />

            {/* Select-all sits ABOVE the list, once, at every width. It used to
                be the table head's first cell, which at 360px would have meant
                either hiding it or rendering a second copy — and two controls
                with one accessible name is the duplicate the single-render rule
                exists to prevent. */}
            <label className="touch-target-y inline-flex cursor-pointer select-none items-center gap-2 text-sm text-stone-700">
                <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => toggleAllVisible(e.target.checked)}
                    className="rounded border-stone-300 text-nexgen-blue focus:ring-2 focus:ring-nexgen-blue-dark"
                    aria-label="Select all visible products"
                />
                Select all visible
            </label>

            {visibleProducts.length === 0 ? (
                <div className="glass-card rounded-xl p-10 text-center">
                    <p className="text-sm text-stone-700">No products match those filters</p>
                    <p className="mt-1 text-xs text-stone-600">
                        {scopedProducts.length} {scopedProducts.length === 1 ? 'product is' : 'products are'} in the catalogue at this scope.
                    </p>
                </div>
            ) : (
                /* One `@container` for the heading strip AND the rows, so the two
                   cannot disagree about which layout is showing. */
                <div className="@container overflow-hidden rounded-xl border border-stone-200 shadow-sm">
                    <div
                        className={
                            'hidden border-b border-stone-200 bg-stone-50 px-3 py-3 text-xs font-medium uppercase tracking-wider text-stone-600 ' +
                            `@min-[1000px]:grid @min-[1000px]:gap-x-3 ${PRODUCT_ROW_COLUMNS}`
                        }
                        aria-hidden="true"
                    >
                        <span />
                        <span>Image</span>
                        <span>Product Name</span>
                        <span>Supplier</span>
                        <span>Category</span>
                        <span>Brand</span>
                        <span>Price</span>
                        <span>Inventory</span>
                        <span>m³</span>
                        <span className="text-right">Actions</span>
                    </div>
                    <ul className="divide-y divide-stone-200 bg-white">
                        {visibleProducts.map((product) => (
                            <ProductAdminRow
                                key={product.id}
                                product={product}
                                supplierName={supplierMap.get(product.supplierId) || 'N/A'}
                                scope={scope}
                                siteOnHand={onHandBySite.get(product.id)}
                                globalThreshold={globalThreshold}
                                onEdit={handleOpenFormForEdit}
                                onDelete={setProductToDelete}
                                selected={selectedIds.has(product.id)}
                                onToggleSelected={toggleOne}
                            />
                        ))}
                    </ul>
                </div>
            )}

            <BulkBrandModal
                open={isBrandOpen}
                onClose={() => setIsBrandOpen(false)}
                products={selectedProducts}
                catalog={products}
                onApply={applyBrand}
            />

            {isFormOpen && (
                <ProductForm
                    productToEdit={productToEdit}
                    suppliers={suppliers}
                    catalog={products}
                    onSave={handleSaveProduct}
                    onClose={() => setIsFormOpen(false)}
                />
            )}

            <ConfirmationDialog
                isOpen={!!productToDelete}
                title="Delete Product"
                message={`Are you sure you want to delete the product "${productToDelete?.name}"? This action cannot be undone.`}
                onConfirm={confirmDelete}
                onCancel={() => setProductToDelete(null)}
            />

            {isImportOpen && (
                <ProductImportModal
                    suppliers={suppliers}
                    catalog={products}
                    addToast={addToast}
                    onClose={() => setIsImportOpen(false)}
                />
            )}
        </div>
    );
};

export default ProductAdmin;
