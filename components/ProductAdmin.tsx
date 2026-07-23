// FIX: Implement the ProductAdmin component.
import React, { useState, useMemo } from 'react';
import { FileUp } from 'lucide-react';
import type { Product, Supplier } from '../types';
import ProductForm from './ProductForm';
import ConfirmationDialog from './ConfirmationDialog';
import ProductImportModal from './admin/ProductImportModal';
import ProductAdminRow from './admin/ProductAdminRow';
import { WarehousePicker } from './inventory/WarehousePicker';
import { useWarehouseScope } from '../context/WarehouseScopeContext';
import { useProductStockByWarehouse } from '../hooks/queries/useInventoryBalances';
import { useSettings } from '../hooks/queries/useSettings';

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

    const { scope } = useWarehouseScope();
    const { data: siteStock } = useProductStockByWarehouse(scope === 'all' ? null : scope);
    const onHandBySite = useMemo(() => new Map(siteStock?.map(r => [r.productId, r.onHand]) ?? []), [siteStock]);
    const { data: settings } = useSettings();
    const globalThreshold = settings?.low_stock_threshold ?? 10;

    const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s.name] as const)), [suppliers]);

    const visibleProducts = useMemo(() => {
        if (scope === 'all' || !hideNotStockedHere) return products;
        return products.filter(p => onHandBySite.has(p.id));
    }, [products, scope, hideNotStockedHere, onHandBySite]);

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
        <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
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
            <div className="overflow-x-auto border border-stone-200 rounded-xl shadow-sm">
                <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-stone-50">
                        <tr>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Image</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Product Name</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Supplier</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Category</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Price</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Inventory</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">m³</th>
                            <th scope="col" className="px-6 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-stone-200">
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
                            />
                        ))}
                    </tbody>
                </table>
            </div>

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
