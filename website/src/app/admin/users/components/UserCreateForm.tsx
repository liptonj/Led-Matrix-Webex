'use client';

import { useState } from 'react';

interface UserCreateFormProps {
    saving: boolean;
    onSubmit: (email: string, password: string, role: 'admin' | 'user') => Promise<void>;
}

export default function UserCreateForm({ saving, onSubmit }: UserCreateFormProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'admin' | 'user'>('user');

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        await onSubmit(email, password, role);
        setEmail('');
        setPassword('');
        setRole('user');
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Create User</h2>
            <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Email
                    </label>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder="user@example.com"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Password
                    </label>
                    <input
                        type="password"
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                        placeholder="Temporary password"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Role
                    </label>
                    <select
                        value={role}
                        onChange={(event) => setRole(event.target.value as 'admin' | 'user')}
                        className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                    >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                    </select>
                </div>
                <div className="md:col-span-4">
                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                        {saving ? 'Creating...' : 'Create User'}
                    </button>
                </div>
            </form>
        </div>
    );
}
