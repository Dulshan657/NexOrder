import React, { useMemo, useState } from 'react';
import { UserCircle } from 'lucide-react';
import type { User } from '../types';
import OptimizedImage from './OptimizedImage';
import { Button, Field, Input, Modal } from './ui';

interface UserProfileProps {
    user: User;
    onSave: (updatedUser: User) => void;
    onClose: () => void;
}

interface FormState {
    name: string;
    email: string;
}

const toFormState = (user: User): FormState => ({ name: user.name, email: user.email });

const UserProfile: React.FC<UserProfileProps> = ({ user, onSave, onClose }) => {
    const [initial] = useState(() => toFormState(user));
    const [form, setForm] = useState<FormState>(initial);
    const [error, setError] = useState<string | null>(null);

    const isDirty = useMemo(
        () => (Object.keys(initial) as (keyof FormState)[]).some((key) => form[key] !== initial[key]),
        [form, initial],
    );

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((current) => ({ ...current, [key]: value }));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!form.name.trim() || !form.email.trim()) {
            setError('Name and email cannot be empty.');
            return;
        }
        onSave({ ...user, name: form.name.trim(), email: form.email.trim() });
    };

    return (
        <Modal
            open
            onClose={onClose}
            size="md"
            dirty={isDirty}
            onSubmit={handleSubmit}
            icon={<UserCircle className="w-4 h-4 text-nexgen-blue" />}
            title="My Profile"
            description="Update your personal information."
            footer={({ requestClose }) => (
                <>
                    <Button variant="ghost" onClick={requestClose}>Cancel</Button>
                    <Button type="submit">Save Changes</Button>
                </>
            )}
        >
            <div className="space-y-5">
                <div className="flex justify-center">
                    <OptimizedImage
                        src={user.avatarUrl || `https://i.pravatar.cc/150?u=${user.id}`}
                        alt="User avatar"
                        className="h-20 w-20 rounded-full border-2 border-white shadow-md ring-2 ring-stone-100"
                        transformWidth={128}
                    />
                </div>

                <Field label="Name" htmlFor="profile-name">
                    <Input
                        id="profile-name"
                        value={form.name}
                        onChange={(e) => set('name', e.target.value)}
                        required
                    />
                </Field>

                <Field label="Email Address" htmlFor="profile-email">
                    <Input
                        id="profile-email"
                        type="email"
                        value={form.email}
                        onChange={(e) => set('email', e.target.value)}
                        required
                    />
                </Field>

                <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1.5">Role</label>
                    <p className="mt-1 text-sm text-stone-600 bg-stone-100 px-3 py-2.5 rounded-lg capitalize font-medium">{user.role}</p>
                </div>

                {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>
        </Modal>
    );
};

export default UserProfile;
