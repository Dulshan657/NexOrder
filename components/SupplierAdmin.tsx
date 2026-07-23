// FIX: Implement the SupplierAdmin component.
import React, { useState } from 'react';
import type { Product, ProductSupplierLink, Supplier } from '../types';
import SupplierForm from './SupplierForm';
import ConfirmationDialog from './ConfirmationDialog';
import SupplierProductsSheet from './admin/SupplierProductsSheet';
import { linksForProduct } from '../lib/productSuppliers';

interface SupplierAdminProps {
    suppliers: Supplier[];
    /** Catalogue, for the per-supplier "Products" panel (mig 00070). */
    products?: Product[];
    onAddSupplier: (supplier: Omit<Supplier, 'id'>) => void;
    onUpdateSupplier: (supplier: Supplier) => void;
    onDeleteSupplier: (supplierId: number) => void;
    /** Persist one product's full supplier-link list. Omitted ⇒ panel hidden. */
    onSaveProductSupplierLinks?: (productId: number, links: ProductSupplierLink[]) => Promise<void>;
}

const SupplierAdmin: React.FC<SupplierAdminProps> = ({
    suppliers, products, onAddSupplier, onUpdateSupplier, onDeleteSupplier, onSaveProductSupplierLinks,
}) => {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [supplierToEdit, setSupplierToEdit] = useState<Supplier | null>(null);
    const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
    const [supplierForProducts, setSupplierForProducts] = useState<Supplier | null>(null);

    const canEditProducts = products != null && onSaveProductSupplierLinks != null;
    const productCountFor = (supplierId: number): number =>
        (products ?? []).filter(p => linksForProduct(p).some(l => l.supplierId === supplierId)).length;

    const handleOpenFormForEdit = (supplier: Supplier) => {
        setSupplierToEdit(supplier);
        setIsFormOpen(true);
    };

    const handleOpenFormForNew = () => {
        setSupplierToEdit(null);
        setIsFormOpen(true);
    };

    const handleSaveSupplier = (supplierData: Supplier | Omit<Supplier, 'id'>) => {
        if ('id' in supplierData) {
            onUpdateSupplier(supplierData);
        } else {
            onAddSupplier(supplierData);
        }
        setIsFormOpen(false);
    };

    const confirmDelete = () => {
        if (supplierToDelete) {
            onDeleteSupplier(supplierToDelete.id);
            setSupplierToDelete(null);
        }
    };

    return (
        <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Manage Suppliers</h2>
                <button
                    onClick={handleOpenFormForNew}
                    className="bg-stone-900 text-white font-medium py-2.5 px-5 rounded-lg hover:bg-stone-800 transition-colors shadow-sm"
                >
                    + Add New Supplier
                </button>
            </div>
            <div className="overflow-x-auto border border-stone-200 rounded-xl shadow-sm bg-white">
                <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-stone-50">
                        <tr>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Supplier Name</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Contact</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Email</th>
                            {canEditProducts && (
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Products</th>
                            )}
                            <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-stone-100">
                        {suppliers.map((supplier) => (
                            <tr key={supplier.id} className="hover:bg-stone-50/50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-stone-900">{supplier.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-600">{supplier.contactPerson}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-600">{supplier.email}</td>
                                {canEditProducts && (
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        <button
                                            onClick={() => setSupplierForProducts(supplier)}
                                            className="text-stone-600 hover:text-stone-900 transition-colors underline decoration-stone-300 underline-offset-2"
                                        >
                                            {productCountFor(supplier.id)} product{productCountFor(supplier.id) === 1 ? '' : 's'}
                                        </button>
                                    </td>
                                )}
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
                                    <button onClick={() => handleOpenFormForEdit(supplier)} className="text-emerald-600 hover:text-emerald-800 transition-colors">Edit</button>
                                    <button onClick={() => setSupplierToDelete(supplier)} className="text-red-600 hover:text-red-800 transition-colors">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isFormOpen && (
                <SupplierForm
                    supplierToEdit={supplierToEdit}
                    onSave={handleSaveSupplier}
                    onClose={() => setIsFormOpen(false)}
                />
            )}

            {canEditProducts && supplierForProducts && (
                <SupplierProductsSheet
                    open
                    supplier={supplierForProducts}
                    products={products}
                    onClose={() => setSupplierForProducts(null)}
                    onSaveLinks={onSaveProductSupplierLinks}
                />
            )}

            <ConfirmationDialog
                isOpen={!!supplierToDelete}
                title="Delete Supplier"
                message={`Are you sure you want to delete the supplier "${supplierToDelete?.name}"? This action cannot be undone.`}
                onConfirm={confirmDelete}
                onCancel={() => setSupplierToDelete(null)}
            />
        </div>
    );
};

export default SupplierAdmin;
