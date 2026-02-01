'use client';

import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import {
    assignDeviceToUser,
    createUserWithRole,
    deleteAdminUser,
    Device,
    getDevices,
    getUserDeviceAssignments,
    getUserProfiles,
    removeUserDeviceAssignment,
    updateAdminUser,
    UserDeviceAssignment,
    UserProfile,
} from '@/lib/supabase';
import { useEffect, useMemo, useState } from 'react';
import UserCreateForm from './components/UserCreateForm';
import UserTable from './components/UserTable';

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
            acc[assignment.user_id]!.push(assignment);
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

    const handleCreateUser = async (email: string, password: string, role: 'admin' | 'user') => {
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
            setRowState((prev) => {
                const currentRowState = prev[user.user_id];
                return {
                    ...prev,
                    [user.user_id]: { ...(currentRowState || { email: user.email, password: '', role: user.role, firstName: user.first_name || '', lastName: user.last_name || '', disabled: user.disabled || false }), password: '' },
                };
            });
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
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="space-y-4 lg:space-y-8">
            <div>
                <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
                <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
                    Create admins or users and assign devices to limit access.
                </p>
            </div>

            {error && (
                <Alert variant="danger">
                    {error}
                </Alert>
            )}

            {!error && message && (
                <Alert variant="success">
                    {message}
                </Alert>
            )}

            <UserCreateForm saving={saving} onSubmit={handleCreateUser} />

            <UserTable
                users={users}
                devices={devices}
                assignmentsByUser={assignmentsByUser}
                devicesBySerial={devicesBySerial}
                activeAdminCount={activeAdminCount}
                rowState={rowState}
                selectedDevice={selectedDevice}
                saving={saving}
                onRowStateChange={(userId, state) =>
                    setRowState((prev) => ({ ...prev, [userId]: state }))
                }
                onSelectedDeviceChange={(userId, serialNumber) =>
                    setSelectedDevice((prev) => ({ ...prev, [userId]: serialNumber }))
                }
                onAssignDevice={handleAssignDevice}
                onRemoveAssignment={handleRemoveAssignment}
                onUpdateUser={handleUpdateUser}
                onDeleteUser={handleDeleteUser}
            />
        </div>
    );
}
