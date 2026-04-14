// FIX: Implement the PurchaseOrderForm component.
import React, { useState, useMemo, useEffect } from 'react';
import type { PurchaseOrder, PurchaseOrderItem, Supplier, Product, User } from '../types';
import { PurchaseOrderStatus } from '../types';

interface PurchaseOrderFormProps {
    poToEdit: PurchaseOrder | null;
    suppliers: Supplier[];
    products: Product[];
    currentUser: User;
    onSave: (poData: PurchaseOrder | Omit<PurchaseOrder, 'id'>) => void;
    onClose: () => void;
}

const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

const PurchaseOrderForm: React.FC<PurchaseOrderFormProps> = ({ poToEdit, suppliers, products, currentUser, onSave, onClose }) => {
    const [supplierId, setSupplierId] = useState<number | ''>('');
    const [items, setItems] = useState<PurchaseOrderItem[]>([]);
    const [productToAdd, setProductToAdd] = useState<string>('');
    
    useEffect(() => {
        if (poToEdit) {
            setSupplierId(poToEdit.supplier.id);
            setItems(poToEdit.items);
        } else {
            setSupplierId('');
            setItems([]);
        }
    }, [poToEdit]);

    const availableProducts = useMemo(() => {
        if (!supplierId) return [];
        return products.filter(p => 
            p.supplierId === supplierId &&
            !items.find(i => i.productId === p.id)
        );
    }, [products, items, supplierId]);

    const total = useMemo(() => items.reduce((acc, item) => acc + (item.quantity * item.cost), 0), [items]);

    const handleAddItem = () => {
        const productId = Number(productToAdd);
        if (!productId) return;

        const product = products.find(p => p.id === productId);
        if (product) {
            setItems(prev => [...prev, { productId: product.id, productName: product.name, quantity: 1, cost: product.price * 0.6 }]); // Assume 60% cost
            setProductToAdd('');
        }
    };
    
    const handleItemChange = (productId: number, field: 'quantity' | 'cost', value: string) => {
        const numericValue = field === 'quantity' ? parseInt(value, 10) : parseFloat(value);
        if (isNaN(numericValue) || numericValue < 0) return;
        setItems(prev => prev.map(item => item.productId === productId ? { ...item, [field]: numericValue } : item));
    };

    const handleRemoveItem = (productId: number) => {
        setItems(prev => prev.filter(item => item.productId !== productId));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const supplier = suppliers.find(s => s.id === supplierId);
        if (!supplier || items.length === 0) {
            alert('Please select a supplier and add items.');
            return;
        }
        
        const poData = {
            supplier,
            items,
            total,
            orderDate: new Date().toISOString(),
            status: poToEdit?.status || PurchaseOrderStatus.PENDING,
            submittedBy: currentUser,
        };

        if (poToEdit) {
            onSave({ ...poData, id: poToEdit.id });
        } else {
            onSave(poData);
        }
    };

    const handleSupplierChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSupplierId(Number(e.target.value));
        // Reset items if supplier changes, as the old items may not be valid
        setItems([]);
    };

    return (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-stone-200">
                <form onSubmit={handleSubmit}>
                    <h2 className="text-2xl font-display font-bold text-stone-900 mb-6 border-b border-stone-100 pb-3">{poToEdit ? 'Edit Purchase Order' : 'Create Purchase Order'}</h2>
                    
                    <div className="mb-5">
                        <label htmlFor="supplier" className="block text-sm font-medium text-stone-700 mb-1.5">Supplier</label>
                        <select id="supplier" value={supplierId} onChange={handleSupplierChange} required className={inputClasses}>
                            <option value="" disabled>Select a supplier</option>
                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>

                    <div className="mt-8 pt-6 border-t border-stone-100">
                        <h3 className="text-lg font-semibold text-stone-800 mb-4">Items</h3>
                        <div className="space-y-4">
                            {items.map(item => (
                                <div key={item.productId} className="grid grid-cols-12 gap-4 items-center bg-stone-50 p-4 rounded-lg border border-stone-200">
                                    <span className="col-span-4 font-medium text-stone-900">{item.productName}</span>
                                    <div className="col-span-3">
                                        <label className="text-xs font-medium text-stone-500 mb-1 block">Quantity</label>
                                        <input type="number" value={item.quantity} onChange={e => handleItemChange(item.productId, 'quantity', e.target.value)} min="1" className={inputClasses} />
                                    </div>
                                    <div className="col-span-3">
                                        <label className="text-xs font-medium text-stone-500 mb-1 block">Unit Cost ($)</label>
                                        <input type="number" value={item.cost} onChange={e => handleItemChange(item.productId, 'cost', e.target.value)} step="0.01" min="0" className={inputClasses} />
                                    </div>
                                    <span className="col-span-1 text-right font-medium text-stone-700">${(item.quantity * item.cost).toFixed(2)}</span>
                                    <button type="button" onClick={() => handleRemoveItem(item.productId)} className="col-span-1 text-red-500 hover:text-red-700 justify-self-center transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                         <div className="flex items-end gap-4 mt-6 pt-6 border-t border-stone-100">
                            <div className="flex-grow">
                                <label htmlFor="product-to-add" className="block text-sm font-medium text-stone-700 mb-1.5">Add Product</label>
                                <select id="product-to-add" value={productToAdd} onChange={e => setProductToAdd(e.target.value)} className={inputClasses} disabled={!supplierId}>
                                    <option value="" disabled>{supplierId ? 'Select a product to add...' : 'Please select a supplier first'}</option>
                                    {availableProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </div>
                            <button type="button" onClick={handleAddItem} disabled={!productToAdd} className="bg-stone-900 text-white font-medium py-2.5 px-5 rounded-lg hover:bg-stone-800 disabled:bg-stone-300 disabled:text-stone-500 transition-colors shadow-sm">Add</button>
                        </div>
                    </div>

                     <div className="mt-8 flex justify-between items-center font-bold text-xl text-stone-900 bg-stone-50 p-4 rounded-lg border border-stone-200">
                        <span>Total:</span>
                        <span>${total.toFixed(2)}</span>
                    </div>

                    <div className="mt-8 flex justify-end space-x-3 pt-4 border-t border-stone-100">
                        <button type="button" onClick={onClose} className="bg-white py-2.5 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">Cancel</button>
                        <button type="submit" className="inline-flex justify-center py-2.5 px-5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-600 transition-colors">Save Purchase Order</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PurchaseOrderForm;