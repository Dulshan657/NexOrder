import React, { useState, useEffect } from 'react';
import type { HoReCa, PaymentMethod } from '../types';

interface HoReCaFormProps {
    hoReCaToEdit: HoReCa | null;
    onSave: (customerData: HoReCa | Omit<HoReCa, 'id'>) => void;
    onClose: () => void;
}

const HoReCaForm: React.FC<HoReCaFormProps> = ({ hoReCaToEdit, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        name: '',
        address: '',
        creditLimit: '',
    });
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
    const [editingMethod, setEditingMethod] = useState<Partial<PaymentMethod> | null>(null);

    useEffect(() => {
        if (hoReCaToEdit) {
            setFormData({
                name: hoReCaToEdit.name,
                address: hoReCaToEdit.address,
                creditLimit: hoReCaToEdit.creditLimit !== undefined ? String(hoReCaToEdit.creditLimit) : '',
            });
            setPaymentMethods(hoReCaToEdit.paymentMethods || []);
        } else {
            // Reset form for new customer
            setFormData({ name: '', address: '', creditLimit: '' });
            setPaymentMethods([]);
        }
        setEditingMethod(null);
    }, [hoReCaToEdit]);

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleSavePaymentMethod = (methodToSave: Partial<PaymentMethod>) => {
        if (!methodToSave.type || !methodToSave.details) {
            alert('Payment method type and details are required.');
            return;
        }

        setPaymentMethods(prevMethods => {
            let newMethods = [...prevMethods];
            // If setting a method as default, unset others
            if (methodToSave.isDefault) {
                newMethods = newMethods.map(m => ({ ...m, isDefault: false }));
            }

            if (methodToSave.id) { // Editing existing
                newMethods = newMethods.map(m => m.id === methodToSave.id ? { ...m, ...methodToSave } as PaymentMethod : m);
            } else { // Adding new
                newMethods.push({ ...methodToSave, id: Date.now() } as PaymentMethod);
            }
            
            // Ensure at least one is default if there are any methods
            if (newMethods.length > 0 && !newMethods.some(m => m.isDefault)) {
                newMethods[0].isDefault = true;
            }

            return newMethods;
        });

        setEditingMethod(null);
    };

    const handleDeletePaymentMethod = (methodId: number) => {
        setPaymentMethods(prev => prev.filter(m => m.id !== methodId));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.address) {
            alert('Please fill all fields.');
            return;
        }

        const customerData = {
            name: formData.name,
            address: formData.address,
            creditLimit: formData.creditLimit ? parseFloat(formData.creditLimit) : undefined,
            pricing: hoReCaToEdit?.pricing,
            discountPercent: hoReCaToEdit?.discountPercent,
            paymentMethods: paymentMethods.length > 0 ? paymentMethods : undefined,
        };

        if (hoReCaToEdit) {
            onSave({ ...customerData, id: hoReCaToEdit.id });
        } else {
            onSave(customerData);
        }
    };

    const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

    return (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-start p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-3xl my-8 max-h-[90vh] overflow-y-auto border border-stone-200">
                <form onSubmit={handleSubmit}>
                    <h2 className="text-2xl font-display font-bold text-stone-900 mb-6 border-b border-stone-100 pb-3">{hoReCaToEdit ? 'Edit HoReCa' : 'Add New HoReCa'}</h2>
                    
                    <div className="space-y-5">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1.5">HoReCa Name</label>
                            <input type="text" name="name" id="name" value={formData.name} onChange={handleFormChange} required className={inputClasses} />
                        </div>
                        <div>
                            <label htmlFor="address" className="block text-sm font-medium text-stone-700 mb-1.5">Address</label>
                            <input type="text" name="address" id="address" value={formData.address} onChange={handleFormChange} required className={inputClasses} />
                        </div>
                        <div>
                            <label htmlFor="creditLimit" className="block text-sm font-medium text-stone-700 mb-1.5">Credit Limit ($)</label>
                            <input type="number" name="creditLimit" id="creditLimit" value={formData.creditLimit} onChange={handleFormChange} min="0" step="0.01" className={inputClasses} placeholder="e.g., 5000" />
                        </div>
                    </div>
                    
                    {/* Payment Methods Section */}
                    <div className="mt-8 pt-6 border-t border-stone-100">
                        <h3 className="text-lg font-semibold text-stone-800 mb-4">Payment Methods</h3>
                        <div className="space-y-3">
                           {paymentMethods.map(method => (
                               <div key={method.id} className="flex items-center justify-between p-4 bg-stone-50 rounded-lg border border-stone-200 shadow-sm">
                                   <div className="text-sm text-stone-800">
                                       <span className="font-bold">{method.type}:</span> {method.details}
                                       {method.isDefault && <span className="ml-3 text-xs font-semibold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full align-middle border border-emerald-200">Default</span>}
                                   </div>
                                   <div className="space-x-3">
                                       <button type="button" onClick={() => setEditingMethod(method)} className="text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors">Edit</button>
                                       <button type="button" onClick={() => handleDeletePaymentMethod(method.id)} className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors">Delete</button>
                                   </div>
                               </div>
                           ))}
                        </div>
                        {editingMethod ? (
                            <div className="mt-4 p-5 bg-stone-50 rounded-xl border border-stone-200 space-y-4">
                                <h4 className="font-semibold text-stone-900">{editingMethod.id ? 'Edit' : 'Add'} Payment Method</h4>
                                <div>
                                    <label className="text-sm font-medium text-stone-700 mb-1.5 block">Type</label>
                                    <select value={editingMethod.type || ''} onChange={e => setEditingMethod(p => ({...p, type: e.target.value as PaymentMethod['type']}))} className={inputClasses}>
                                        <option value="" disabled>Select type...</option>
                                        <option value="Credit Card">Credit Card</option>
                                        <option value="Bank Transfer">Bank Transfer</option>
                                        <option value="On Account">On Account</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-stone-700 mb-1.5 block">Details</label>
                                    <input type="text" value={editingMethod.details || ''} onChange={e => setEditingMethod(p => ({...p, details: e.target.value}))} placeholder="e.g., Visa ending in 1234 or Net 30" className={inputClasses} />
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                     <input type="checkbox" id="isDefault" checked={editingMethod.isDefault || false} onChange={e => setEditingMethod(p => ({...p, isDefault: e.target.checked}))} className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-600" />
                                     <label htmlFor="isDefault" className="text-sm font-medium text-stone-700">Set as default</label>
                                </div>
                                <div className="flex justify-end space-x-3 pt-2">
                                    <button type="button" onClick={() => setEditingMethod(null)} className="bg-white py-2 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors">Cancel</button>
                                    <button type="button" onClick={() => handleSavePaymentMethod(editingMethod)} className="bg-stone-900 py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white hover:bg-stone-800 transition-colors">Save Method</button>
                                </div>
                            </div>
                        ) : (
                            <button type="button" onClick={() => setEditingMethod({type: 'Credit Card', details: '', isDefault: paymentMethods.length === 0})} className="mt-4 text-sm font-medium text-stone-900 hover:text-stone-700 bg-stone-100 py-2 px-4 rounded-lg transition-colors border border-stone-200">+ Add Payment Method</button>
                        )}
                    </div>


                    <div className="mt-8 flex justify-end space-x-3 pt-4 border-t border-stone-100">
                        <button type="button" onClick={onClose} className="bg-white py-2.5 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Cancel
                        </button>
                        <button type="submit" className="inline-flex justify-center py-2.5 px-5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-stone-900 hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Save HoReCa
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default HoReCaForm;