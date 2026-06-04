import React, { useState, useEffect, useCallback } from 'react';
import { AdminUser } from '../types';
import { apiListAdminUsers, apiAddAdminUser, apiDeleteAdminUser } from '../services/api';
import { IconPlus, IconTrash2 } from './icons';
import { useAuth } from '../hooks/useAuth';

// Re-using styles from Admin.tsx for consistency
const AdminSection: React.FC<React.PropsWithChildren<{ title: string; description?: string }>> = ({ title, description, children }) => (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
        <h3 className="text-xl font-semibold mb-1">{title}</h3>
        {description && <p className="text-sm text-gray-400 mb-4">{description}</p>}
        {children}
    </div>
);

const AdminInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, id, ...props }) => (
    <div>
        <label htmlFor={id} className="block mb-1 text-sm font-medium text-gray-400">{label}</label>
        <input id={id} {...props} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-brand-blue focus:border-brand-blue" />
    </div>
);

const AdminButton = ({ children, onClick, variant = 'primary', className = '', ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'secondary' }>) => {
    const baseClasses = 'px-4 py-2 rounded-md font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    const variantClasses = {
        primary: 'bg-brand-blue text-white hover:bg-blue-500',
        danger: 'bg-red-600 text-white hover:bg-red-500',
        secondary: 'bg-gray-600 text-white hover:bg-gray-500',
    }[variant];

    return (
        <button onClick={onClick} className={`${baseClasses} ${variantClasses} ${className}`} {...props}>
            {children}
        </button>
    );
};


const AdminUserManager = () => {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [newUser, setNewUser] = useState({ username: '', displayName: '', password: '' });
    const { user: currentUser } = useAuth();

    const fetchUsers = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const userList = await apiListAdminUsers();
            setUsers(userList);
        } catch (e: any) {
            setError(e.message || 'Failed to load users.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setNewUser(prev => ({ ...prev, [name]: value }));
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newUser.username || !newUser.displayName || !newUser.password) {
            setError("All fields are required.");
            return;
        }
        setError(null);
        try {
            await apiAddAdminUser(newUser);
            setNewUser({ username: '', displayName: '', password: '' });
            setIsAdding(false);
            await fetchUsers(); // Refresh the list
        } catch (e: any) {
            setError(e.message || 'Failed to add user.');
        }
    };

    const handleDeleteUser = async (userId: string, username: string) => {
        if (!window.confirm(`Are you sure you want to delete the admin user "${username}"? This cannot be undone.`)) {
            return;
        }
        setError(null);
        try {
            await apiDeleteAdminUser(userId);
            await fetchUsers();
        } catch (e: any) {
            setError(e.message);
        }
    };

    return (
        <AdminSection title="Admin User Management" description="Manage accounts that can log in to this admin panel.">
            {isLoading && <p>Loading users...</p>}
            {error && <p className="text-red-400 mb-4">{error}</p>}
            
            {!isLoading && (
                <div className="space-y-2 mb-4">
                    {users.map(user => (
                        <div key={user.id} className="flex items-center justify-between bg-gray-700 p-3 rounded-md">
                            <div>
                                <span className="font-medium">{user.displayName}</span>
                                <span className="text-sm text-gray-400 ml-2">({user.username})</span>
                            </div>
                             <AdminButton 
                                onClick={() => handleDeleteUser(user.id, user.username)} 
                                variant="danger" 
                                className="!px-3 !py-1 text-sm"
                                disabled={user.id === currentUser?.id || users.length <= 1}
                                title={user.id === currentUser?.id ? "Cannot delete yourself" : (users.length <= 1 ? "Cannot delete the last user" : "Delete user")}
                            >
                                <IconTrash2 className="w-4 h-4" />
                            </AdminButton>
                        </div>
                    ))}
                </div>
            )}

            {isAdding ? (
                <form onSubmit={handleAddUser} className="bg-gray-700 p-4 rounded-lg mt-4 space-y-4">
                     <h4 className="font-semibold text-lg">Add New Admin User</h4>
                     <AdminInput label="Username" id="username" name="username" type="text" value={newUser.username} onChange={handleInputChange} required />
                     <AdminInput label="Display Name" id="displayName" name="displayName" type="text" value={newUser.displayName} onChange={handleInputChange} required />
                     <AdminInput label="Password" id="password" name="password" type="password" value={newUser.password} onChange={handleInputChange} required />
                     <div className="flex gap-2">
                        <AdminButton type="submit">Save User</AdminButton>
                        <AdminButton type="button" variant="secondary" onClick={() => setIsAdding(false)}>Cancel</AdminButton>
                     </div>
                </form>
            ) : (
                <AdminButton onClick={() => setIsAdding(true)}>
                    <IconPlus className="inline w-4 h-4 mr-2" />
                    Add Admin User
                </AdminButton>
            )}
        </AdminSection>
    );
};

export default AdminUserManager;