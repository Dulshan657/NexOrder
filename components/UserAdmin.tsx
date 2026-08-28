import React, { useState, useMemo } from 'react';
import type { User } from '../types';
import UserForm from './UserForm';
import ConfirmationDialog from './ConfirmationDialog';

interface UserAdminProps {
    users: User[];
    onAddUser: (user: Omit<User, 'id'>) => void;
    onUpdateUser: (user: User) => void;
    onDeleteUser: (userId: number) => void;
}

const UserAdmin: React.FC<UserAdminProps> = ({ users, onAddUser, onUpdateUser, onDeleteUser }) => {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [userToEdit, setUserToEdit] = useState<User | null>(null);
    const [userToDelete, setUserToDelete] = useState<User | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredUsers = useMemo(() => {
        if (!searchQuery.trim()) {
            return users;
        }
        const lowercasedQuery = searchQuery.toLowerCase();
        return users.filter(user =>
            user.name.toLowerCase().includes(lowercasedQuery) ||
            user.email.toLowerCase().includes(lowercasedQuery)
        );
    }, [users, searchQuery]);

    const handleOpenFormForEdit = (user: User) => {
        setUserToEdit(user);
        setIsFormOpen(true);
    };

    const handleOpenFormForNew = () => {
        setUserToEdit(null);
        setIsFormOpen(true);
    };

    const handleSaveUser = (userData: User | Omit<User, 'id'>) => {
        if ('id' in userData) {
            onUpdateUser(userData);
        } else {
            onAddUser(userData);
        }
        setIsFormOpen(false);
    };

    const confirmDelete = () => {
        if (userToDelete) {
            onDeleteUser(userToDelete.id);
            setUserToDelete(null);
        }
    };

    return (
        <div className="bg-white min-h-svh p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
            <div className="flex flex-wrap gap-4 justify-between items-center">
                <h2 className="text-lg sm:text-xl font-display font-bold text-stone-900">Manage Users</h2>
                <button
                    onClick={handleOpenFormForNew}
                    className="bg-stone-900 text-white font-medium py-2.5 px-5 rounded-lg hover:bg-stone-800 transition-colors shadow-sm"
                >
                    + Add New User
                </button>
            </div>

            <div className="mb-6 relative">
                <label htmlFor="user-search" className="sr-only">Search by Name or Email</label>
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-stone-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                    </svg>
                </div>
                <input
                    type="text"
                    id="user-search"
                    className="block w-full max-w-md rounded-lg border-0 bg-white py-3 pl-11 pr-4 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300"
                    placeholder="Search by Name or Email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            <div className="overflow-x-auto border border-stone-200 rounded-xl shadow-sm bg-white">
                <table className="min-w-full divide-y divide-stone-200">
                    <thead className="bg-stone-50">
                        <tr>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Name</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Email</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-stone-500 uppercase tracking-wider">Role</th>
                            <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-stone-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-stone-100">
                        {filteredUsers.length > 0 ? (
                            filteredUsers.map((user) => (
                                <tr key={user.id} className="hover:bg-stone-50/50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-stone-900">{user.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-600">{user.email}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-600 capitalize">{user.role}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
                                        <button onClick={() => handleOpenFormForEdit(user)} className="text-emerald-600 hover:text-emerald-800 transition-colors">Edit</button>
                                        <button onClick={() => setUserToDelete(user)} className="text-red-600 hover:text-red-800 transition-colors">Delete</button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-stone-500">
                                    No users match your search.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {isFormOpen && (
                <UserForm
                    userToEdit={userToEdit}
                    onSave={handleSaveUser}
                    onClose={() => setIsFormOpen(false)}
                />
            )}

            <ConfirmationDialog
                isOpen={!!userToDelete}
                title="Delete User"
                message={`Are you sure you want to delete the user "${userToDelete?.name}"? This action cannot be undone.`}
                onConfirm={confirmDelete}
                onCancel={() => setUserToDelete(null)}
            />
        </div>
    );
};

export default UserAdmin;
