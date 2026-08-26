import React, { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import type { HoReCa, User } from '../types';
import HoReCaForm from './HoReCaForm';
import ConfirmationDialog from './ConfirmationDialog';

interface HoReCaAdminProps {
    hoReCas: HoReCa[];
    currentUser?: User;
    onAddHoReCa: (customer: Omit<HoReCa, 'id'>, reason?: string) => void;
    onUpdateHoReCa: (customer: HoReCa, reason?: string) => void;
    onDeleteHoReCa: (hoReCaId: number) => void;
}

const HoReCaAdmin: React.FC<HoReCaAdminProps> = ({ hoReCas, currentUser, onAddHoReCa, onUpdateHoReCa, onDeleteHoReCa }) => {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [hoReCaToEdit, setHoReCaToEdit] = useState<HoReCa | null>(null);
    const [hoReCaToDelete, setHoReCaToDelete] = useState<HoReCa | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredHoReCas = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        if (!query) return hoReCas;
        return hoReCas.filter((customer) => {
            const nameMatch = customer.name.toLowerCase().includes(query);
            const addressMatch = customer.address.toLowerCase().includes(query);
            const paymentMatch = customer.paymentMethods?.some(
                (pm) => pm.type.toLowerCase().includes(query) || pm.details.toLowerCase().includes(query)
            ) ?? false;
            return nameMatch || addressMatch || paymentMatch;
        });
    }, [hoReCas, searchQuery]);

    const handleOpenFormForEdit = (customer: HoReCa) => {
        setHoReCaToEdit(customer);
        setIsFormOpen(true);
    };

    const handleOpenFormForNew = () => {
        setHoReCaToEdit(null);
        setIsFormOpen(true);
    };

    const handleSaveCustomer = (customerData: HoReCa | Omit<HoReCa, 'id'>, reason?: string) => {
        if ('id' in customerData) {
            onUpdateHoReCa(customerData, reason);
        } else {
            onAddHoReCa(customerData, reason);
        }
        setIsFormOpen(false);
    };

    const confirmDelete = () => {
        if (hoReCaToDelete) {
            onDeleteHoReCa(hoReCaToDelete.id);
            setHoReCaToDelete(null);
        }
    };

    return (
        <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Manage HoReCa</h2>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:flex-initial">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search hoReCas..."
                            className="w-full sm:w-64 pl-9 pr-8 py-2 border border-stone-300 rounded-lg text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent transition-colors"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={handleOpenFormForNew}
                        className="bg-stone-900 text-white font-medium py-2 px-4 rounded-lg hover:bg-stone-800 transition-colors shadow-sm whitespace-nowrap"
                    >
                        Add New HoReCa
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto border border-stone-200 rounded-xl shadow-sm">
                <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-stone-50">
                        <tr>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">HoReCa Name</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Address</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Payment Methods</th>
                            <th scope="col" className="px-6 py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-stone-200">
                        {filteredHoReCas.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-sm text-stone-500">
                                    {searchQuery ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <Search className="h-8 w-8 text-stone-300" />
                                            <p>No hoReCas found matching "<span className="font-medium text-stone-700">{searchQuery}</span>"</p>
                                        </div>
                                    ) : (
                                        <p>No hoReCas yet.</p>
                                    )}
                                </td>
                            </tr>
                        ) : (
                            filteredHoReCas.map((customer) => (
                                <tr key={customer.id} className="hover:bg-stone-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-stone-900">{customer.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">{customer.address}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">{customer.paymentMethods?.length || 0} configured</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                                        <button onClick={() => handleOpenFormForEdit(customer)} className="text-emerald-600 hover:text-emerald-900 transition-colors">Edit</button>
                                        <button onClick={() => setHoReCaToDelete(customer)} className="text-red-600 hover:text-red-900 transition-colors">Delete</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {isFormOpen && (
                <HoReCaForm
                    hoReCaToEdit={hoReCaToEdit}
                    onSave={handleSaveCustomer}
                    onClose={() => setIsFormOpen(false)}
                    userRole={currentUser?.role}
                />
            )}

            <ConfirmationDialog
                isOpen={!!hoReCaToDelete}
                title="Delete HoReCa"
                message={`Are you sure you want to delete the customer "${hoReCaToDelete?.name}"? This action cannot be undone.`}
                onConfirm={confirmDelete}
                onCancel={() => setHoReCaToDelete(null)}
            />
        </div>
    );
};

export default HoReCaAdmin;
