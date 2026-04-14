// FIX: Implement the PurchaseOrderAdmin component.
import React, { useState } from 'react';
import type { PurchaseOrder, Supplier, Product, User } from '../types';
import PurchaseOrderForm from './PurchaseOrderForm';

interface PurchaseOrderAdminProps {
    purchaseOrders: PurchaseOrder[];
    suppliers: Supplier[];
    products: Product[];
    currentUser: User;
    onAddPurchaseOrder: (po: Omit<PurchaseOrder, 'id'>) => void;
    onUpdatePurchaseOrder: (po: PurchaseOrder) => void;
}

const PurchaseOrderAdmin: React.FC<PurchaseOrderAdminProps> = ({ purchaseOrders, suppliers, products, currentUser, onAddPurchaseOrder, onUpdatePurchaseOrder }) => {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [poToEdit, setPoToEdit] = useState<PurchaseOrder | null>(null);

     const handleSave = (poData: PurchaseOrder | Omit<PurchaseOrder, 'id'>) => {
        if ('id' in poData) {
            onUpdatePurchaseOrder(poData);
        } else {
            onAddPurchaseOrder(poData);
        }
        setIsFormOpen(false);
    };

    return (
        <div className="bg-white min-h-screen p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Manage Purchase Orders</h2>
                <button
                    onClick={() => { setPoToEdit(null); setIsFormOpen(true); }}
                    className="bg-stone-900 text-white font-medium py-2.5 px-5 rounded-lg hover:bg-stone-800 transition-colors shadow-sm"
                >
                    + Create New PO
                </button>
            </div>
             <div className="overflow-x-auto border border-stone-200 rounded-xl shadow-sm bg-white">
                <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-stone-50">
                        <tr>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">PO ID</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Supplier</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Total</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Status</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-stone-100">
                        {purchaseOrders.map((po) => (
                            <tr key={po.id} className="hover:bg-stone-50/50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-stone-900">{po.id}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-600">{po.supplier.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-600">${po.total.toFixed(2)}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                        po.status === 'Received' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 
                                        po.status === 'Ordered' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 
                                        'bg-stone-100 text-stone-800 border border-stone-200'
                                    }`}>
                                        {po.status}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {isFormOpen && <PurchaseOrderForm 
                poToEdit={poToEdit}
                suppliers={suppliers}
                products={products}
                currentUser={currentUser}
                onSave={handleSave}
                onClose={() => setIsFormOpen(false)}
            />}
        </div>
    );
}

export default PurchaseOrderAdmin;
