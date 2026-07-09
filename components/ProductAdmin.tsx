// FIX: Implement the ProductAdmin component.
import React, { useState, useMemo } from 'react';
import { FileUp } from 'lucide-react';
import type { Product, Supplier } from '../types';
import ProductForm from './ProductForm';
import ConfirmationDialog from './ConfirmationDialog';
import OptimizedImage from './OptimizedImage';
import ProductImportModal from './admin/ProductImportModal';

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

    const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s.name] as const)), [suppliers]);

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
    
    const getInventoryClass = (inventory: number) => {
        if (inventory <= 0) return 'text-red-600 font-semibold';
        if (inventory < 10) return 'text-amber-600 font-bold';
        return 'text-stone-500';
    }

    return (
        <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Manage Products</h2>
                <div className="flex items-center gap-2">
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
                        {products.map((product) => (
                            <tr key={product.id} className={product.inventory > 0 && product.inventory < 10 ? 'bg-amber-50/50' : 'hover:bg-stone-50 transition-colors'}>
                                <td className="px-6 py-4">
                                    <div className="w-12 h-12 bg-stone-100 rounded-lg flex items-center justify-center border border-stone-200 overflow-hidden">
                                        <OptimizedImage
                                            src={product.imageUrl}
                                            alt={product.name}
                                            className="w-full h-full"
                                            transformWidth={96}
                                            fallback={
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                    </svg>
                                                </div>
                                            }
                                        />
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-stone-900">{product.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">{supplierMap.get(product.supplierId) || 'N/A'}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">{product.category}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">${product.price.toFixed(2)}</td>
                                <td className={`px-6 py-4 whitespace-nowrap text-sm ${getInventoryClass(product.inventory)}`}>
                                    {product.inventory}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-xs text-stone-500">
                                    {product.cubicMetersUnit != null && (
                                        <div>
                                            <span className="font-medium text-stone-700">{product.cubicMetersUnit.toFixed(4)}</span>
                                            <span className="text-stone-400"> /unit</span>
                                        </div>
                                    )}
                                    {product.cubicMetersCarton != null && (
                                        <div>
                                            <span className="font-medium text-stone-700">{product.cubicMetersCarton.toFixed(4)}</span>
                                            <span className="text-stone-400"> /ctn</span>
                                        </div>
                                    )}
                                    {product.cubicMetersUnit == null && product.cubicMetersCarton == null && '—'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                                    <button onClick={() => handleOpenFormForEdit(product)} className="text-emerald-600 hover:text-emerald-900 transition-colors">Edit</button>
                                    <button onClick={() => setProductToDelete(product)} className="text-red-600 hover:text-red-900 transition-colors">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isFormOpen && (
                <ProductForm
                    productToEdit={productToEdit}
                    suppliers={suppliers}
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
                    addToast={addToast}
                    onClose={() => setIsImportOpen(false)}
                />
            )}
        </div>
    );
};

export default ProductAdmin;
