import React, { useState, useEffect, useRef } from 'react';
import { User, UserRole } from '../types';

interface UserFormProps {
    userToEdit: User | null;
    onSave: (userData: User | Omit<User, 'id'>) => void;
    onClose: () => void;
}

const UserForm: React.FC<UserFormProps> = ({ userToEdit, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        role: UserRole.FIELD_REP, // Default role for new users
        avatarUrl: '',
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (userToEdit) {
            setFormData({
                name: userToEdit.name,
                email: userToEdit.email,
                role: userToEdit.role,
                avatarUrl: userToEdit.avatarUrl || '',
            });
        } else {
             setFormData({
                name: '',
                email: '',
                role: UserRole.FIELD_REP,
                avatarUrl: '',
            });
        }
    }, [userToEdit]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormData(prev => ({ ...prev, avatarUrl: reader.result as string }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.email) {
            alert('Name and email are required.');
            return;
        }

        const userData = {
            name: formData.name,
            email: formData.email,
            role: formData.role,
            avatarUrl: formData.avatarUrl,
        };

        if (userToEdit) {
            onSave({ ...userData, id: userToEdit.id });
        } else {
            onSave(userData);
        }
    };
    
    const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

    return (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg border border-stone-200">
                <form onSubmit={handleSubmit}>
                    <h2 className="text-2xl font-display font-bold text-stone-900 mb-6 border-b border-stone-100 pb-3">{userToEdit ? 'Edit User' : 'Add New User'}</h2>
                    
                    <div className="space-y-5">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1.5">Name</label>
                            <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className={inputClasses} />
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1.5">Email</label>
                            <input type="email" name="email" id="email" value={formData.email} onChange={handleChange} required className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1.5">Avatar</label>
                            <div className="flex items-center space-x-4">
                                <img 
                                    src={formData.avatarUrl || `https://i.pravatar.cc/150?u=${userToEdit?.id ?? 'new-user'}`} 
                                    alt="Avatar Preview" 
                                    className="h-16 w-16 rounded-full object-cover bg-stone-100 border border-stone-200 shadow-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="bg-white py-2 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
                                >
                                    Upload Image
                                </button>
                                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="avatarUrl" className="block text-sm font-medium text-stone-700 mb-1.5">Or enter Avatar URL</label>
                            <input type="text" name="avatarUrl" id="avatarUrl" value={formData.avatarUrl} onChange={handleChange} placeholder="https://..." className={inputClasses} />
                        </div>
                        <div>
                            <label htmlFor="role" className="block text-sm font-medium text-stone-700 mb-1.5">Role</label>
                            <select name="role" id="role" value={formData.role} onChange={handleChange} required className={`${inputClasses} capitalize`}>
                                {Object.values(UserRole).map(role => (
                                    <option key={role} value={role}>{role}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="mt-8 flex justify-end space-x-3 pt-4 border-t border-stone-100">
                        <button type="button" onClick={onClose} className="bg-white py-2.5 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Cancel
                        </button>
                        <button type="submit" className="inline-flex justify-center py-2.5 px-5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-stone-900 hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Save User
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UserForm;