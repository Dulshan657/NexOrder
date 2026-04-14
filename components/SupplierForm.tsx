// FIX: Implement the SupplierForm component.
import React, { useState, useEffect } from 'react';
import type { Supplier } from '../types';

interface SupplierFormProps {
    supplierToEdit: Supplier | null;
    onSave: (supplierData: Supplier | Omit<Supplier, 'id'>) => void;
    onClose: () => void;
}

const SupplierForm: React.FC<SupplierFormProps> = ({ supplierToEdit, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        name: '',
        contactPerson: '',
        email: '',
        phone: '',
    });

    useEffect(() => {
        if (supplierToEdit) {
            setFormData({
                name: supplierToEdit.name,
                contactPerson: supplierToEdit.contactPerson,
                email: supplierToEdit.email,
                phone: supplierToEdit.phone,
            });
        } else {
             setFormData({
                name: '',
                contactPerson: '',
                email: '',
                phone: '',
            });
        }
    }, [supplierToEdit]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.contactPerson || !formData.email) {
            alert('Please fill all required fields.');
            return;
        }

        if (supplierToEdit) {
            onSave({ ...formData, id: supplierToEdit.id });
        } else {
            onSave(formData);
        }
    };
    
    const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

    return (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg border border-stone-200">
                <form onSubmit={handleSubmit} className="space-y-5">
                    <h2 className="text-2xl font-display font-bold text-stone-900 mb-6 border-b border-stone-100 pb-3">{supplierToEdit ? 'Edit Supplier' : 'Add New Supplier'}</h2>
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1.5">Supplier Name</label>
                        <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className={inputClasses} />
                    </div>
                    <div>
                        <label htmlFor="contactPerson" className="block text-sm font-medium text-stone-700 mb-1.5">Contact Person</label>
                        <input type="text" name="contactPerson" id="contactPerson" value={formData.contactPerson} onChange={handleChange} required className={inputClasses} />
                    </div>
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1.5">Email</label>
                        <input type="email" name="email" id="email" value={formData.email} onChange={handleChange} required className={inputClasses} />
                    </div>
                    <div>
                        <label htmlFor="phone" className="block text-sm font-medium text-stone-700 mb-1.5">Phone</label>
                        <input type="tel" name="phone" id="phone" value={formData.phone} onChange={handleChange} className={inputClasses} />
                    </div>
                    <div className="mt-8 flex justify-end space-x-3 pt-4 border-t border-stone-100">
                        <button type="button" onClick={onClose} className="bg-white py-2.5 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Cancel
                        </button>
                        <button type="submit" className="inline-flex justify-center py-2.5 px-5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-stone-900 hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Save Supplier
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SupplierForm;
