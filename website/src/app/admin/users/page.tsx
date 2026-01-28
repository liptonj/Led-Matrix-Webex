'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    assignDeviceToUser,
    createUserWithRole,
    deleteAdminUser,
    getDevices,
    getUserDeviceAssignments,
    getUserProfiles,
    removeUserDeviceAssignment,
    updateAdminUser,
    Device,
    UserDeviceAssignment,
    UserProfile,
} from '@/lib/supabase';

interface AssignmentMap {
    [userId: string]: UserDeviceAssignment[];
}

interface UserRowState {
    email: string;
    role: 'admin' | 'user';
    firstName: string;
    lastName: string;
    disabled: boolean;
    password: string;
}

export default function AdminUsersPage() {
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [devices, setDevices] = useState<Device[]>([]);
    const [assignments, setAssignments] = useState<UserDeviceAssignment[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'admin' | 'user'>('user');
    const [selectedDevice, setSelectedDevice] = useState<Record<string, string>>({});
    const [rowState, setRowState] = useState<Record<string, UserRowState>>({});

    useEffect(() => {
        loadUsers();
    }, []);

    async function loadUsers() {
        setLoading(true);
        setError(null);
        try {
            const [profileData, deviceData, assignmentData] = await Promise.all([
                getUserProfiles(),
                getDevices(),
                getUserDeviceAssignments(),
            ]);
            setUsers(profileData);
            setDevices(deviceData);
            setAssignments(assignmentData);
            setRowState((prev) => {
                const next: Record<string, UserRowState> = { ...prev };
                profileData.forEach((profile) => {
                    next[profile.user_id] = {
                        email: profile.email,
                        role: profile.role,
                        firstName: profile.first_name ?? '',
                        lastName: profile.last_name ?? '',
                        disabled: profile.disabled,
                        password: '',
                    };
                });
                return next;
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load users');
        }
        setLoading(false);
    }

    const assignmentsByUser = useMemo(() => {
        return assignments.reduce<AssignmentMap>((acc, assignment) => {
            if (!acc[assignment.user_id]) acc[assignment.user_id] = [];
            acc[assignment.user_id].push(assignment);
            return acc;
        }, {});
    }, [assignments]);

    const activeAdminCount = useMemo(() => {
        return users.filter((user) => user.role === 'admin' && !user.disabled).length;
    }, [users]);

    const devicesBySerial = useMemo(() => {
        return devices.reduce<Record<string, Device>>((acc, device) => {
            acc[device.serial_number] = device;
            return acc;
        }, {});
    }, [devices]);

    const handleCreateUser = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const result = await createUserWithRole(email, password, role);
            setMessage(
                result.existing
                    ? 'User already existed. Role/profile updated.'
                    : 'User created successfully.',
            );
            setEmail('');
            setPassword('');
            setRole('user');
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create user');
        }

        setSaving(false);
    };

    const handleAssignDevice = async (userId: string) => {
        const serialNumber = selectedDevice[userId];
        if (!serialNumber) return;
        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            await assignDeviceToUser(userId, serialNumber);
            setSelectedDevice((prev) => ({ ...prev, [userId]: '' }));
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to assign device');
        }

        setSaving(false);
    };

    const handleRemoveAssignment = async (assignmentId: string) => {
        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            await removeUserDeviceAssignment(assignmentId);
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to remove assignment');
        }

        setSaving(false);
    };

    const handleUpdateUser = async (user: UserProfile) => {
        const state = rowState[user.user_id];
        if (!state) return;

        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            await updateAdminUser({
                userId: user.user_id,
                email: state.email,
                role: state.role,
                firstName: state.firstName,
                lastName: state.lastName,
                disabled: state.disabled,
                password: state.password || undefined,
            });
            setMessage('User updated successfully.');
            setRowState((prev) => ({
                ...prev,
                [user.user_id]: { ...prev[user.user_id], password: '' },
            }));
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update user');
        }

        setSaving(false);
    };

    const handleDeleteUser = async (user: UserProfile) => {
        if (!window.confirm(`Delete user ${user.email}? This cannot be undone.`)) {
            return;
        }

        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            await deleteAdminUser(user.user_id);
            setMessage('User deleted.');
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete user');
        }

        setSaving(false);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    Create admins or users and assign devices to limit access.
                </p>
            </div>

            {(error || message) && (
                <div
                    className={`rounded-lg border p-4 ${
                        error
                            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-300'
                            : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                    }`}
                >
                    {error ?? message}
                </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Create User</h2>
                <form onSubmit={handleCreateUser} className="grid gap-4 md:grid-cols-4">
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

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Users & Device Access</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Name
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Email
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Role
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Password
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Devices
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Assign
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {users.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                                        No users yet.
                                    </td>
                                </tr>
                            ) : (
                                users.map((user) => {
                                    const state = rowState[user.user_id] || {
                                        email: user.email,
                                        role: user.role,
                                        firstName: user.first_name ?? '',
                                        lastName: user.last_name ?? '',
                                        disabled: user.disabled,
                                        password: '',
                                    };
                                    const isLastActiveAdmin =
                                        activeAdminCount <= 1 &&
                                        user.role === 'admin' &&
                                        !user.disabled;
                                    const userAssignments = assignmentsByUser[user.user_id] || [];
                                    const assignedSerials = new Set(userAssignments.map((assignment) => assignment.serial_number));
                                    const availableDevices = devices.filter(
                                        (device) => !assignedSerials.has(device.serial_number),
                                    );

                                    return (
                                        <tr key={user.user_id}>
                                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={state.firstName}
                                                        onChange={(event) =>
                                                            setRowState((prev) => ({
                                                                ...prev,
                                                                [user.user_id]: {
                                                                    ...state,
                                                                    firstName: event.target.value,
                                                                },
                                                            }))
                                                        }
                                                        className="w-24 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white"
                                                        placeholder="First"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={state.lastName}
                                                        onChange={(event) =>
                                                            setRowState((prev) => ({
                                                                ...prev,
                                                                [user.user_id]: {
                                                                    ...state,
                                                                    lastName: event.target.value,
                                                                },
                                                            }))
                                                        }
                                                        className="w-24 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white"
                                                        placeholder="Last"
                                                    />
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{user.user_id}</div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                                                <input
                                                    type="email"
                                                    value={state.email}
                                                    onChange={(event) =>
                                                        setRowState((prev) => ({
                                                            ...prev,
                                                            [user.user_id]: {
                                                                ...state,
                                                                email: event.target.value,
                                                            },
                                                        }))
                                                    }
                                                    className="w-56 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white"
                                                />
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                <span className="inline-flex items-center">
                                                    <select
                                                        value={state.role}
                                                        onChange={(event) =>
                                                            setRowState((prev) => ({
                                                                ...prev,
                                                                [user.user_id]: {
                                                                    ...state,
                                                                    role: event.target.value as 'admin' | 'user',
                                                                },
                                                            }))
                                                        }
                                                        disabled={isLastActiveAdmin}
                                                        className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white"
                                                    >
                                                        <option value="user">user</option>
                                                        <option value="admin">admin</option>
                                                    </select>
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                <label className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                                    <input
                                                        type="checkbox"
                                                        checked={state.disabled}
                                                        onChange={(event) =>
                                                            setRowState((prev) => ({
                                                                ...prev,
                                                                [user.user_id]: {
                                                                    ...state,
                                                                    disabled: event.target.checked,
                                                                },
                                                            }))
                                                        }
                                                        disabled={isLastActiveAdmin}
                                                        className="h-4 w-4"
                                                    />
                                                    Disabled
                                                </label>
                                                {isLastActiveAdmin && (
                                                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                                                        Last active admin
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                <input
                                                    type="password"
                                                    value={state.password}
                                                    onChange={(event) =>
                                                        setRowState((prev) => ({
                                                            ...prev,
                                                            [user.user_id]: {
                                                                ...state,
                                                                password: event.target.value,
                                                            },
                                                        }))
                                                    }
                                                    className="w-40 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white"
                                                    placeholder="New password"
                                                />
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-200">
                                                {userAssignments.length === 0 ? (
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">No devices assigned</span>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {userAssignments.map((assignment) => {
                                                            const device = devicesBySerial[assignment.serial_number];
                                                            return (
                                                                <div
                                                                    key={assignment.id}
                                                                    className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1"
                                                                >
                                                                    <div>
                                                                        <div className="font-mono text-xs">{assignment.serial_number}</div>
                                                                        {device?.display_name && (
                                                                            <div className="text-xs text-gray-500 dark:text-gray-400">{device.display_name}</div>
                                                                        )}
                                                                    </div>
                                                                    <button
                                                                        onClick={() => handleRemoveAssignment(assignment.id)}
                                                                        className="text-xs text-red-600 hover:text-red-800"
                                                                        disabled={saving}
                                                                    >
                                                                        Remove
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={selectedDevice[user.user_id] || ''}
                                                        onChange={(event) =>
                                                            setSelectedDevice((prev) => ({
                                                                ...prev,
                                                                [user.user_id]: event.target.value,
                                                            }))
                                                        }
                                                        className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-white"
                                                    >
                                                        <option value="">Select device</option>
                                                        {availableDevices.map((device) => (
                                                            <option key={device.serial_number} value={device.serial_number}>
                                                                {device.serial_number}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={() => handleAssignDevice(user.user_id)}
                                                        disabled={saving || availableDevices.length === 0 || !selectedDevice[user.user_id]}
                                                        className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                                                    >
                                                        Assign
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleUpdateUser(user)}
                                                        disabled={saving}
                                                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteUser(user)}
                                                        disabled={saving || isLastActiveAdmin}
                                                        className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
