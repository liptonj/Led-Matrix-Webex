'use client';

import { Device, UserDeviceAssignment, UserProfile } from '@/lib/supabase';
import UserRow from './UserRow';

interface UserRowState {
    email: string;
    role: 'admin' | 'user';
    firstName: string;
    lastName: string;
    disabled: boolean;
    password: string;
}

interface AssignmentMap {
    [userId: string]: UserDeviceAssignment[];
}

interface UserTableProps {
    users: UserProfile[];
    devices: Device[];
    assignmentsByUser: AssignmentMap;
    devicesBySerial: Record<string, Device>;
    activeAdminCount: number;
    rowState: Record<string, UserRowState>;
    selectedDevice: Record<string, string>;
    saving: boolean;
    onRowStateChange: (userId: string, state: UserRowState) => void;
    onSelectedDeviceChange: (userId: string, serialNumber: string) => void;
    onAssignDevice: (userId: string) => Promise<void>;
    onRemoveAssignment: (assignmentId: string) => Promise<void>;
    onUpdateUser: (user: UserProfile) => Promise<void>;
    onDeleteUser: (user: UserProfile) => Promise<void>;
}

export default function UserTable({
    users,
    devices,
    assignmentsByUser,
    devicesBySerial,
    activeAdminCount,
    rowState,
    selectedDevice,
    saving,
    onRowStateChange,
    onSelectedDeviceChange,
    onAssignDevice,
    onRemoveAssignment,
    onUpdateUser,
    onDeleteUser,
}: UserTableProps) {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
            <div className="px-4 lg:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Users & Device Access</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 lg:hidden">
                    Scroll horizontally to view all columns
                </p>
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
                                    <UserRow
                                        key={user.user_id}
                                        user={user}
                                        state={state}
                                        isLastActiveAdmin={isLastActiveAdmin}
                                        userAssignments={userAssignments}
                                        availableDevices={availableDevices}
                                        devicesBySerial={devicesBySerial}
                                        selectedDevice={selectedDevice[user.user_id] || ''}
                                        saving={saving}
                                        onStateChange={(newState) => onRowStateChange(user.user_id, newState)}
                                        onSelectedDeviceChange={(serialNumber) => onSelectedDeviceChange(user.user_id, serialNumber)}
                                        onAssignDevice={() => onAssignDevice(user.user_id)}
                                        onRemoveAssignment={onRemoveAssignment}
                                        onUpdateUser={() => onUpdateUser(user)}
                                        onDeleteUser={() => onDeleteUser(user)}
                                    />
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
