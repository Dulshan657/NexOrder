import React, { useState, useEffect, useMemo } from 'react';
import { Building2 } from 'lucide-react';
import type { HoReCa, HoReCaTier, PaymentMethod } from '../types';
import { UserRole } from '../types';
import { Button, Modal } from './ui';

// Defaults used by the Edge Function / DB schema
const SENSITIVE_DEFAULTS = {
    creditLimit: 0,
    tier: 'Bronze' as HoReCaTier,
    discountPercent: 0,
} as const;

interface HoReCaFormProps {
    hoReCaToEdit: HoReCa | null;
    onSave: (customerData: HoReCa | Omit<HoReCa, 'id'>, reason?: string) => void;
    onClose: () => void;
    userRole?: UserRole;
}

interface FormFields {
    name: string;
    address: string;
    creditLimit: string;
    tier: HoReCaTier | '';
    discountPercent: string;
}

const toFormFields = (hoReCa: HoReCa | null): FormFields => ({
    name: hoReCa?.name ?? '',
    address: hoReCa?.address ?? '',
    creditLimit: hoReCa?.creditLimit !== undefined ? String(hoReCa.creditLimit) : '',
    tier: hoReCa?.tier ?? '',
    discountPercent: hoReCa?.discountPercent !== undefined ? String(hoReCa.discountPercent) : '',
});

// Payment methods are edited in place, so the dirty check compares them element-wise
// against the list the form opened with.
const samePaymentMethods = (a: PaymentMethod[], b: PaymentMethod[]): boolean =>
    a.length === b.length &&
    a.every((method, index) =>
        method.id === b[index].id &&
        method.type === b[index].type &&
        method.details === b[index].details &&
        (method.isDefault ?? false) === (b[index].isDefault ?? false),
    );

const HoReCaForm: React.FC<HoReCaFormProps> = ({ hoReCaToEdit, onSave, onClose, userRole }) => {
    // Derived from the prop rather than captured once with `useState(() => …)`, so the
    // dirty baseline stays in step with the resync effect below.
    const initialFields = useMemo(() => toFormFields(hoReCaToEdit), [hoReCaToEdit]);
    const initialPaymentMethods = useMemo(() => hoReCaToEdit?.paymentMethods ?? [], [hoReCaToEdit]);

    const [formData, setFormData] = useState<FormFields>(initialFields);
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(initialPaymentMethods);
    const [editingMethod, setEditingMethod] = useState<Partial<PaymentMethod> | null>(null);
    const [reason, setReason] = useState('');

    useEffect(() => {
        setFormData(initialFields);
        setPaymentMethods(initialPaymentMethods);
        setReason('');
        setEditingMethod(null);
    }, [initialFields, initialPaymentMethods]);

    // Derive whether any sensitive fields have changed vs original or defaults.
    // For create: compare against schema defaults (creditLimit=0, tier=Bronze, discountPercent=0).
    // For edit:   compare against the original hoReCaToEdit values.
    const sensitiveFieldsTouched: string[] = useMemo(() => {
        const touched: string[] = [];

        const originalCreditLimit = hoReCaToEdit
            ? (hoReCaToEdit.creditLimit ?? SENSITIVE_DEFAULTS.creditLimit)
            : SENSITIVE_DEFAULTS.creditLimit;
        const formCreditLimit = formData.creditLimit ? parseFloat(formData.creditLimit) : SENSITIVE_DEFAULTS.creditLimit;
        if (formCreditLimit !== originalCreditLimit) touched.push('creditLimit');

        const originalTier = hoReCaToEdit
            ? (hoReCaToEdit.tier ?? SENSITIVE_DEFAULTS.tier)
            : SENSITIVE_DEFAULTS.tier;
        const formTier = (formData.tier || SENSITIVE_DEFAULTS.tier) as HoReCaTier;
        if (formTier !== originalTier) touched.push('tier');

        const originalDiscount = hoReCaToEdit
            ? (hoReCaToEdit.discountPercent ?? SENSITIVE_DEFAULTS.discountPercent)
            : SENSITIVE_DEFAULTS.discountPercent;
        const formDiscount = formData.discountPercent ? parseFloat(formData.discountPercent) : SENSITIVE_DEFAULTS.discountPercent;
        if (formDiscount !== originalDiscount) touched.push('discountPercent');

        return touched;
    }, [formData.creditLimit, formData.tier, formData.discountPercent, hoReCaToEdit]);

    // Show the reason prompt only for Managers who have touched a sensitive field.
    const showReasonPrompt = userRole === UserRole.MANAGER && sensitiveFieldsTouched.length > 0;

    // A half-entered payment method counts as unsaved input too — it lives only in
    // `editingMethod` until "Save Method" folds it into the list.
    const isDirty = useMemo(
        () =>
            editingMethod !== null ||
            reason.trim() !== '' ||
            !samePaymentMethods(paymentMethods, initialPaymentMethods) ||
            (Object.keys(initialFields) as (keyof FormFields)[]).some((key) => formData[key] !== initialFields[key]),
        [formData, initialFields, paymentMethods, initialPaymentMethods, editingMethod, reason],
    );

    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
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

        if (showReasonPrompt && reason.trim().length < 5) {
            alert('Please provide a reason for changing the sensitive field(s). Minimum 5 characters.');
            return;
        }

        const customerData = {
            name: formData.name,
            address: formData.address,
            creditLimit: formData.creditLimit ? parseFloat(formData.creditLimit) : undefined,
            tier: (formData.tier || undefined) as HoReCaTier | undefined,
            discountPercent: formData.discountPercent ? parseFloat(formData.discountPercent) : undefined,
            pricing: hoReCaToEdit?.pricing,
            paymentMethods: paymentMethods.length > 0 ? paymentMethods : undefined,
        };

        const reasonToSend = showReasonPrompt ? reason.trim() : undefined;

        if (hoReCaToEdit) {
            onSave({ ...customerData, id: hoReCaToEdit.id }, reasonToSend);
        } else {
            onSave(customerData, reasonToSend);
        }
    };

    const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

    return (
        <Modal
            open
            onClose={onClose}
            size="3xl"
            dirty={isDirty}
            onSubmit={handleSubmit}
            icon={<Building2 className="w-4 h-4 text-nexgen-blue" />}
            title={hoReCaToEdit ? 'Edit HoReCa' : 'Add New HoReCa'}
            footer={({ requestClose }) => (
                <>
                    <Button variant="secondary" onClick={requestClose}>Cancel</Button>
                    <Button type="submit" disabled={showReasonPrompt && reason.trim().length < 5}>
                        Save HoReCa
                    </Button>
                </>
            )}
        >
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
                <div>
                    <label htmlFor="tier" className="block text-sm font-medium text-stone-700 mb-1.5">Tier</label>
                    <select name="tier" id="tier" value={formData.tier} onChange={handleFormChange} className={inputClasses}>
                        <option value="">Bronze (default)</option>
                        <option value="Bronze">Bronze</option>
                        <option value="Silver">Silver</option>
                        <option value="Gold">Gold</option>
                    </select>
                </div>
                <div>
                    <label htmlFor="discountPercent" className="block text-sm font-medium text-stone-700 mb-1.5">Discount (%)</label>
                    <input type="number" name="discountPercent" id="discountPercent" value={formData.discountPercent} onChange={handleFormChange} min="0" max="100" step="0.1" className={inputClasses} placeholder="e.g., 10" />
                </div>
            </div>

            {/* Reason for change — shown only to Managers who touch a sensitive field */}
            {showReasonPrompt && (
                <div className="mt-6 pt-5 border-t border-amber-100 bg-amber-50/60 rounded-xl p-4 space-y-2">
                    <label htmlFor="reason" className="block text-sm font-semibold text-amber-800">
                        Reason for change <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-amber-700">
                        You changed: {sensitiveFieldsTouched.join(', ')}. An audit reason is required.
                    </p>
                    <textarea
                        id="reason"
                        name="reason"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        rows={3}
                        minLength={5}
                        maxLength={500}
                        placeholder="Why are you changing the credit limit / tier / discount? Required for audit trail."
                        className="block w-full rounded-lg border-0 bg-white py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-amber-300 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-amber-500 sm:text-sm transition-all resize-none"
                    />
                    <p className="text-xs text-stone-400 text-right">{reason.length}/500</p>
                </div>
            )}

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
        </Modal>
    );
};

export default HoReCaForm;
