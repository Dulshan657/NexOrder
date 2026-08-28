import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, UserCircle } from 'lucide-react';
import { User, UserRole } from '../types';
import { useToasts } from '../hooks/useToasts';
import { compressImage } from '../lib/imageCompression';
import { uploadToBucket, deleteFromBucketByUrl, isBucketUrl } from '../services/supabase/storageService';
import OptimizedImage from './OptimizedImage';
import { useWarehouses } from '../hooks/queries/useWarehouses';
import { Button, Field, Input, Modal, Select } from './ui';
import { assignableRoles } from '../lib/assignableRoles';

interface UserFormProps {
    userToEdit: User | null;
    onSave: (userData: User | Omit<User, 'id'>) => void;
    onClose: () => void;
}

interface FormFields {
    name: string;
    email: string;
    role: UserRole;
    avatarUrl: string;
}

const toFormFields = (user: User | null): FormFields => ({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? UserRole.FIELD_REP, // Default role for new users
    avatarUrl: user?.avatarUrl ?? '',
});

const UserForm: React.FC<UserFormProps> = ({ userToEdit, onSave, onClose }) => {
    // Derived from the prop rather than captured once with `useState(() => …)`, so the
    // dirty baseline stays in step with the resync effect below.
    const initialFields = useMemo(() => toFormFields(userToEdit), [userToEdit]);
    const initialWarehouseId: number | '' = userToEdit?.homeWarehouseId ?? '';

    const [formData, setFormData] = useState<FormFields>(initialFields);
    const [homeWarehouseId, setHomeWarehouseId] = useState<number | ''>(initialWarehouseId);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { addToast } = useToasts();
    const [isUploading, setIsUploading] = useState(false);
    const { data: warehouses } = useWarehouses();

    useEffect(() => {
        setFormData(initialFields);
        setHomeWarehouseId(initialWarehouseId);
    }, [initialFields, initialWarehouseId]);

    // The avatar is part of `formData`, so picking an image and then clicking the
    // backdrop raises the discard confirm instead of silently dropping the upload.
    const isDirty = useMemo(
        () =>
            homeWarehouseId !== initialWarehouseId ||
            (Object.keys(initialFields) as (keyof FormFields)[]).some((key) => formData[key] !== initialFields[key]),
        [formData, initialFields, homeWarehouseId, initialWarehouseId],
    );

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Compress + resize to WebP, upload to Storage, store the public URL —
    // instead of persisting a base64 data URL in profiles.avatar_url.
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            addToast('Please choose an image file.', 'error');
            return;
        }
        const previous = formData.avatarUrl;
        setIsUploading(true);
        try {
            const compressed = await compressImage(file, { maxWidthOrHeight: 256, quality: 0.8 });
            const url = await uploadToBucket('avatars', compressed, { prefix: 'avatars' });
            setFormData(prev => ({ ...prev, avatarUrl: url }));
            if (isBucketUrl('avatars', previous)) {
                void deleteFromBucketByUrl('avatars', previous);
            }
        } catch {
            addToast('Avatar upload failed. Please try again.', 'error');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!formData.name.trim() || !formData.email.trim()) {
            setError('Name and email are required.');
            return;
        }

        const userData = {
            name: formData.name,
            email: formData.email,
            role: formData.role,
            avatarUrl: formData.avatarUrl,
            homeWarehouseId:
                formData.role === UserRole.WAREHOUSE && homeWarehouseId !== '' ? Number(homeWarehouseId) : undefined,
        };

        if (userToEdit) {
            onSave({ ...userData, id: userToEdit.id });
        } else {
            onSave(userData);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            dirty={isDirty}
            onSubmit={handleSubmit}
            icon={<UserCircle className="w-4 h-4 text-nexgen-blue" />}
            title={userToEdit ? 'Edit User' : 'Add New User'}
            footer={({ requestClose }) => (
                <>
                    <Button variant="ghost" onClick={requestClose}>Cancel</Button>
                    <Button type="submit" loading={isUploading}>Save User</Button>
                </>
            )}
        >
            <div className="space-y-5">
                <Field label="Name" htmlFor="name">
                    <Input id="name" name="name" value={formData.name} onChange={handleChange} required />
                </Field>

                <Field label="Email" htmlFor="email">
                    <Input id="email" name="email" type="email" value={formData.email} onChange={handleChange} required />
                </Field>

                <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Avatar</label>
                    <div className="flex items-center space-x-4">
                        {isUploading ? (
                            <div className="h-16 w-16 rounded-full bg-stone-100 border border-stone-200 shadow-sm flex items-center justify-center">
                                <Loader2 className="h-5 w-5 text-stone-500 animate-spin" />
                            </div>
                        ) : (
                            <OptimizedImage
                                src={formData.avatarUrl || `https://i.pravatar.cc/150?u=${userToEdit?.id ?? 'new-user'}`}
                                alt="Avatar preview"
                                className="h-16 w-16 rounded-full bg-stone-100 border border-stone-200 shadow-sm"
                                transformWidth={128}
                            />
                        )}
                        <Button
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                        >
                            {isUploading ? 'Uploading…' : 'Upload Image'}
                        </Button>
                        <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                    </div>
                </div>

                <Field label="Or enter Avatar URL" htmlFor="avatarUrl">
                    <Input
                        id="avatarUrl"
                        name="avatarUrl"
                        value={formData.avatarUrl}
                        onChange={handleChange}
                        placeholder="https://..."
                    />
                </Field>

                <Field label="Role" htmlFor="role">
                    <Select
                        id="role"
                        name="role"
                        value={formData.role}
                        onChange={handleChange}
                        required
                        className="capitalize"
                    >
                        {assignableRoles.map(role => (
                            <option key={role} value={role}>{role}</option>
                        ))}
                    </Select>
                </Field>

                {formData.role === UserRole.WAREHOUSE && (
                    <Field
                        label="Home warehouse"
                        htmlFor="homeWarehouse"
                        helper="Pickers/receivers only see and act on their own site's work."
                    >
                        <Select
                            id="homeWarehouse"
                            value={homeWarehouseId}
                            onChange={(e) => setHomeWarehouseId(e.target.value === '' ? '' : Number(e.target.value))}
                        >
                            <option value="">Select a warehouse…</option>
                            {(warehouses ?? []).filter(w => w.isActive).map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                        </Select>
                    </Field>
                )}

                {error && (
                    <p className="text-sm text-red-600" role="alert">
                        {error}
                    </p>
                )}
            </div>
        </Modal>
    );
};

export default UserForm;
