import React, { useState } from 'react';
import type { User } from '../types';

interface UserProfileProps {
    user: User;
    onSave: (updatedUser: User) => void;
    onClose: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ user, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        name: user.name,
        email: user.email,
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.email) {
            alert('Name and email cannot be empty.');
            return;
        }
        onSave({ ...user, ...formData });
    };

    const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

    return (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border border-stone-200">
                <form onSubmit={handleSubmit}>
                    <div className="flex items-start justify-between mb-6 border-b border-stone-100 pb-4">
                        <div>
                            <h2 className="text-2xl font-display font-bold text-stone-900">My Profile</h2>
                            <p className="text-sm text-stone-500 mt-1">Update your personal information.</p>
                        </div>
                        <img 
                            src={user.avatarUrl || `https://i.pravatar.cc/150?u=${user.id}`} 
                            alt="User Avatar"
                            className="h-16 w-16 rounded-full border-2 border-white shadow-md ring-2 ring-stone-100"
                        />
                    </div>
                    
                    <div className="space-y-5">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1.5">Name</label>
                            <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className={inputClasses} />
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1.5">Email Address</label>
                            <input type="email" name="email" id="email" value={formData.email} onChange={handleChange} required className={inputClasses} />
                        </div>
                         <div>
                            <label className="block text-sm font-medium text-stone-700 mb-1.5">Role</label>
                            <p className="mt-1 text-sm text-stone-600 bg-stone-100 px-3 py-2.5 rounded-lg capitalize font-medium">{user.role}</p>
                        </div>
                    </div>

                    <div className="mt-8 flex justify-end space-x-3 pt-4 border-t border-stone-100">
                        <button type="button" onClick={onClose} className="bg-white py-2.5 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Cancel
                        </button>
                        <button type="submit" className="inline-flex justify-center py-2.5 px-5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-stone-900 hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UserProfile;
