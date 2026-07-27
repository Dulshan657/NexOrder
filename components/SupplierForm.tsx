import React, { useMemo, useState } from 'react';
import { Button, Field, Input, Modal } from './ui';
import type { Supplier } from '../types';

interface SupplierFormProps {
    supplierToEdit: Supplier | null; // null = create
    onSave: (supplierData: Supplier | Omit<Supplier, 'id'>) => void;
    onClose: () => void;
}

interface FormState {
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
}

const toFormState = (supplier: Supplier | null): FormState => ({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
});

const SupplierForm: React.FC<SupplierFormProps> = ({ supplierToEdit, onSave, onClose }) => {
    const [initial] = useState(() => toFormState(supplierToEdit));
    const [formData, setFormData] = useState<FormState>(initial);

    const isDirty = useMemo(
        () => (Object.keys(initial) as (keyof FormState)[]).some((key) => formData[key] !== initial[key]),
        [formData, initial],
    );

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

    return (
        <Modal
            open
            onClose={onClose}
            dirty={isDirty}
            onSubmit={handleSubmit}
            title={supplierToEdit ? 'Edit Supplier' : 'Add New Supplier'}
            footer={({ requestClose }) => (
                <>
                    <Button variant="secondary" onClick={requestClose}>
                        Cancel
                    </Button>
                    <Button type="submit">Save Supplier</Button>
                </>
            )}
        >
            <div className="space-y-4">
                <Field label="Supplier Name" htmlFor="supplier-name">
                    <Input id="supplier-name" name="name" value={formData.name} onChange={handleChange} required />
                </Field>
                <Field label="Contact Person" htmlFor="supplier-contact">
                    <Input
                        id="supplier-contact"
                        name="contactPerson"
                        value={formData.contactPerson}
                        onChange={handleChange}
                        required
                    />
                </Field>
                <Field label="Email" htmlFor="supplier-email">
                    <Input
                        id="supplier-email"
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                    />
                </Field>
                <Field label="Phone" htmlFor="supplier-phone">
                    <Input id="supplier-phone" name="phone" type="tel" value={formData.phone} onChange={handleChange} />
                </Field>
            </div>
        </Modal>
    );
};

export default SupplierForm;
