'use client';

import { Device, UserDeviceAssignment, UserProfile } from '@/lib/supabase';

interface UserRowState {
    email: string;
    role: 'admin' | 'user';
    firstName: string;
    lastName: string;
    disabled: boolean;
    password: string;
}

interface UserRowProps {
    user: UserProfile;
    state: UserRowState;
    isLastActiveAdmin: boolean;
    userAssignments: UserDeviceAssignment[];
    availableDevices: Device[];
    devicesBySerial: Record<string, Device>;
    selectedDevice: string;
    saving: boolean;
    onStateChange: (state: UserRowState) => void;
    onSelectedDeviceChange: (serialNumber: string) => void;
    onAssignDevice: () => Promise<void>;
    onRemoveAssignment: (assignmentId: string) => Promise<void>;
    onUpdateUser: () => Promise<void>;
    onDeleteUser: () => Promise<void>;
}

export default function UserRow({
    user,
    state,
    isLastActiveAdmin,
    userAssignments,
    availableDevices,
    devicesBySerial,
    selectedDevice,
    saving,
    onStateChange,
    onSelectedDeviceChange,
    onAssignDevice,
    onRemoveAssignment,
    onUpdateUser,
    onDeleteUser,
}: UserRowProps) {
    return (
        <tr>
            <td className="table-cell">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={state.firstName}
                        onChange={(event) =>
                            onStateChange({
                                ...state,
                                firstName: event.target.value,
                            })
                        }
                        className="w-24 input-field-sm"
                        placeholder="First"
                    />
                    <input
                        type="text"
                        value={state.lastName}
                        onChange={(event) =>
                            onStateChange({
                                ...state,
                                lastName: event.target.value,
                            })
                        }
                        className="w-24 input-field-sm"
                        placeholder="Last"
                    />
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{user.user_id}</div>
            </td>
            <td className="table-cell">
                <input
                    type="email"
                    value={state.email}
                    onChange={(event) =>
                        onStateChange({
                            ...state,
                            email: event.target.value,
                        })
                    }
                    className="w-56 input-field-sm"
                />
            </td>
            <td className="table-cell">
                <span className="inline-flex items-center">
                    <select
                        value={state.role}
                        onChange={(event) =>
                            onStateChange({
                                ...state,
                                role: event.target.value as 'admin' | 'user',
                            })
                        }
                        disabled={isLastActiveAdmin}
                        className="input-field-sm"
                    >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                    </select>
                </span>
            </td>
            <td className="table-cell">
                <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                    <input
                        type="checkbox"
                        checked={state.disabled}
                        onChange={(event) =>
                            onStateChange({
                                ...state,
                                disabled: event.target.checked,
                            })
                        }
                        disabled={isLastActiveAdmin}
                        className="h-4 w-4"
                    />
                    Disabled
                </label>
                {isLastActiveAdmin && (
                    <div className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        Last active admin
                    </div>
                )}
            </td>
            <td className="table-cell">
                <input
                    type="password"
                    value={state.password}
                    onChange={(event) =>
                        onStateChange({
                            ...state,
                            password: event.target.value,
                        })
                    }
                    className="w-40 input-field-sm"
                    placeholder="New password"
                />
            </td>
            <td className="table-cell">
                {userAssignments.length === 0 ? (
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No devices assigned</span>
                ) : (
                    <div className="space-y-2">
                        {userAssignments.map((assignment) => {
                            const device = devicesBySerial[assignment.serial_number];
                            return (
                                <div
                                    key={assignment.id}
                                    className="flex items-center justify-between rounded-md border px-2 py-1"
                                    style={{ borderColor: 'var(--color-border)' }}
                                >
                                    <div>
                                        <div className="font-mono text-xs">{assignment.serial_number}</div>
                                        {device?.display_name && (
                                            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{device.display_name}</div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => onRemoveAssignment(assignment.id)}
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
            <td className="table-cell">
                <div className="flex items-center gap-2">
                    <select
                        value={selectedDevice}
                        onChange={(event) => onSelectedDeviceChange(event.target.value)}
                        className="input-field-sm"
                    >
                        <option value="">Select device</option>
                        {availableDevices.map((device) => (
                            <option key={device.serial_number} value={device.serial_number}>
                                {device.serial_number}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={onAssignDevice}
                        disabled={saving || availableDevices.length === 0 || !selectedDevice}
                        className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                        Assign
                    </button>
                </div>
            </td>
            <td className="table-cell">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onUpdateUser}
                        disabled={saving}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        Save
                    </button>
                    <button
                        onClick={onDeleteUser}
                        disabled={saving || isLastActiveAdmin}
                        className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                        Delete
                    </button>
                </div>
            </td>
        </tr>
    );
}
