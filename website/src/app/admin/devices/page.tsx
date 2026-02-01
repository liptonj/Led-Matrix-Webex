'use client';

import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import {
    ConnectionHeartbeat,
    deleteDevice,
    Device,
    DeviceChangeEvent,
    getConnectionHeartbeats,
    getDevices,
    setDeviceApprovalRequired,
    setDeviceBlacklisted,
    setDeviceDebugMode,
    setDeviceDisabled,
    subscribeToDevices,
} from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export default function DevicesPage() {
    const router = useRouter();
    const [devices, setDevices] = useState<Device[]>([]);
    const [heartbeats, setHeartbeats] = useState<Record<string, ConnectionHeartbeat>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
    const [now, setNow] = useState(Date.now());
    const [actionSerial, setActionSerial] = useState<string | null>(null);
    const devicesRef = useRef<Device[]>([]);

    const refreshHeartbeats = useCallback(async (deviceList?: Device[]) => {
        const list = deviceList ?? devicesRef.current;
        if (!list.length) {
            setHeartbeats({});
            return;
        }

        try {
            const rows = await getConnectionHeartbeats(
                list.map((device) => device.pairing_code),
            );
            const map = rows.reduce<Record<string, ConnectionHeartbeat>>((acc, row) => {
                acc[row.pairing_code] = row;
                return acc;
            }, {});
            setHeartbeats(map);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to load connection heartbeats',
            );
        }
    }, []);

    const loadDevices = useCallback(async () => {
        try {
            const data = await getDevices();
            setDevices(data);
            await refreshHeartbeats(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load devices');
        }
        setLoading(false);
    }, [refreshHeartbeats]);

    useEffect(() => {
        loadDevices();
    }, [loadDevices]);

    useEffect(() => {
        const interval = setInterval(() => {
            setNow(Date.now());
            refreshHeartbeats();
        }, 30_000);
        return () => clearInterval(interval);
    }, [refreshHeartbeats]);

    async function toggleDebug(device: Device) {
        try {
            await setDeviceDebugMode(device.serial_number, !device.debug_enabled);
            await loadDevices();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to toggle debug mode');
        }
    }

    async function handleApprove(device: Device) {
        if (!device.approval_required) return;
        try {
            setActionSerial(device.serial_number);
            await setDeviceApprovalRequired(device.serial_number, false);
            await loadDevices();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to approve device');
        } finally {
            setActionSerial(null);
        }
    }

    async function handleToggleDisabled(device: Device) {
        try {
            setActionSerial(device.serial_number);
            await setDeviceDisabled(device.serial_number, !device.disabled);
            await loadDevices();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update device access');
        } finally {
            setActionSerial(null);
        }
    }

    async function handleToggleBlacklisted(device: Device) {
        try {
            setActionSerial(device.serial_number);
            await setDeviceBlacklisted(device.serial_number, !device.blacklisted);
            await loadDevices();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update device access');
        } finally {
            setActionSerial(null);
        }
    }

    async function handleDelete(device: Device) {
        const confirmed = window.confirm(
            `Delete device ${device.serial_number}? This cannot be undone.`,
        );
        if (!confirmed) return;
        try {
            setActionSerial(device.serial_number);
            await deleteDevice(device.serial_number);
            await loadDevices();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete device');
        } finally {
            setActionSerial(null);
        }
    }

    async function handleActionSelect(device: Device, action: string) {
        if (!action) return;
        if (action === 'view') {
            router.push(`/admin/devices/details?serial=${encodeURIComponent(device.serial_number)}`);
            return;
        }
        if (action === 'approve') {
            await handleApprove(device);
            return;
        }
        if (action === 'toggle-disabled') {
            await handleToggleDisabled(device);
            return;
        }
        if (action === 'toggle-blacklist') {
            await handleToggleBlacklisted(device);
            return;
        }
        if (action === 'delete') {
            await handleDelete(device);
        }
    }

    useEffect(() => {
        devicesRef.current = devices;
    }, [devices]);

    useEffect(() => {
        let unsubscribe: (() => void) | null = null;
        let isMounted = true;

        (async () => {
            try {
                unsubscribe = await subscribeToDevices((event: DeviceChangeEvent) => {
                    setDevices((prev) => {
                        if (event.event === 'DELETE') {
                            const removedId = event.old?.id;
                            if (!removedId) return prev;
                            return prev.filter((device) => device.id !== removedId);
                        }

                        const updated = event.new;
                        if (!updated) return prev;

                        const existingIndex = prev.findIndex((device) => device.id === updated.id);
                        if (existingIndex === -1) {
                            return [...prev, updated];
                        }

                        const next = [...prev];
                        next[existingIndex] = updated;
                        return next;
                    });
                });
            } catch (err) {
                if (isMounted) {
                    setError(err instanceof Error ? err.message : 'Failed to subscribe to device updates');
                }
            }
        })();

        return () => {
            isMounted = false;
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    const sortedDevices = useMemo(
        () => sortDevices(devices, heartbeats),
        [devices, heartbeats],
    );

    const filteredDevices = sortedDevices.filter((device) => {
        const isOnline = isDeviceOnline(device, heartbeats, now);
        if (filter === 'online') return isOnline;
        if (filter === 'offline') return !isOnline;
        return true;
    });

    const onlineCount = sortedDevices.filter((device) =>
        isDeviceOnline(device, heartbeats, now),
    ).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="space-y-4 lg:space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">
                    Devices
                </h1>
                <div className="flex items-center gap-2">
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as typeof filter)}
                        className="flex-1 sm:flex-none px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                        <option value="all">All ({devices.length})</option>
                        <option value="online">
                            Online ({onlineCount})
                        </option>
                        <option value="offline">
                            Offline ({devices.length - onlineCount})
                        </option>
                    </select>
                    <button
                        onClick={loadDevices}
                        className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md whitespace-nowrap"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {error && (
                <Alert variant="danger">
                    {error}
                </Alert>
            )}

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-3">
                {filteredDevices.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center text-gray-500 dark:text-gray-400">
                        No devices found
                    </div>
                ) : (
                    filteredDevices.map((device) => {
                        const lastSeen = getLastSeenValue(device, heartbeats);
                        const lastSeenLabel = lastSeen
                            ? new Date(lastSeen).toLocaleString()
                            : 'Unknown';
                        const isOnline = isDeviceOnline(device, heartbeats, now);
                        return (
                            <div
                                key={device.id}
                                className="bg-white dark:bg-gray-800 rounded-lg shadow p-4"
                            >
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div className="min-w-0 flex-1">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                router.push(
                                                    `/admin/devices/details?serial=${encodeURIComponent(device.serial_number)}`,
                                                )
                                            }
                                            className="text-sm font-mono font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                        >
                                            {device.serial_number}
                                        </button>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                            {device.display_name || device.device_id}
                                        </p>
                                    </div>
                                    <span
                                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                                            isOnline
                                                ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                                        }`}
                                    >
                                        {isOnline ? 'Online' : 'Offline'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                                    <div>
                                        <span className="text-gray-500 dark:text-gray-400">Pairing:</span>{' '}
                                        <span className="font-mono">{device.pairing_code}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 dark:text-gray-400">Firmware:</span>{' '}
                                        <span>{device.firmware_version || 'Unknown'}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 dark:text-gray-400">IP:</span>{' '}
                                        <span className="font-mono">{device.ip_address || '-'}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 dark:text-gray-400">Last seen:</span>{' '}
                                        <span>{lastSeenLabel}</span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                device.blacklisted
                                                    ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                                                    : device.disabled
                                                        ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                                                        : device.approval_required
                                                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                                            : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                            }`}
                                        >
                                            {device.blacklisted
                                                ? 'Blacklisted'
                                                : device.disabled
                                                    ? 'Disabled'
                                                    : device.approval_required
                                                        ? 'Pending'
                                                        : 'Active'}
                                        </span>
                                        <button
                                            onClick={() => toggleDebug(device)}
                                            className={`px-2 py-0.5 text-xs rounded ${
                                                device.debug_enabled
                                                    ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                            }`}
                                        >
                                            Debug {device.debug_enabled ? 'ON' : 'OFF'}
                                        </button>
                                    </div>
                                    <select
                                        defaultValue=""
                                        onChange={(event) => {
                                            const action = event.target.value;
                                            event.target.value = '';
                                            handleActionSelect(device, action);
                                        }}
                                        disabled={actionSerial === device.serial_number}
                                        className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                    >
                                        <option value="">Actions</option>
                                        <option value="view">View details</option>
                                        {device.approval_required && (
                                            <option value="approve">Approve</option>
                                        )}
                                        <option value="toggle-disabled">
                                            {device.disabled ? 'Enable' : 'Disable'}
                                        </option>
                                        <option value="toggle-blacklist">
                                            {device.blacklisted ? 'Unblacklist' : 'Blacklist'}
                                        </option>
                                        <option value="delete">Delete</option>
                                    </select>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Serial
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Pairing Code
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Firmware
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    IP Address
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Last Seen
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Debug
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Access
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredDevices.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={8}
                                        className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                                    >
                                        No devices found
                                    </td>
                                </tr>
                            ) : (
                                filteredDevices.map((device) => {
                                    const lastSeen = getLastSeenValue(device, heartbeats);
                                    const lastSeenLabel = lastSeen
                                        ? new Date(lastSeen).toLocaleString()
                                        : 'Unknown';
                                    const isOnline = isDeviceOnline(device, heartbeats, now);
                                    return (
                                        <tr key={device.id}>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            router.push(
                                                                `/admin/devices/details?serial=${encodeURIComponent(device.serial_number)}`,
                                                            )
                                                        }
                                                        className="text-sm font-mono text-blue-600 dark:text-blue-400 hover:underline"
                                                    >
                                                        {device.serial_number}
                                                    </button>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                                        {device.device_id}
                                                    </p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                                    {device.pairing_code}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                                    {device.firmware_version || 'Unknown'}
                                                </span>
                                                {device.target_firmware_version && (
                                                    <span className="ml-1 text-xs text-orange-600 dark:text-orange-400">
                                                        → {device.target_firmware_version}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                                                    {device.ip_address || '-'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div>
                                                    <span
                                                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                            isOnline
                                                                ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                                                        }`}
                                                    >
                                                        {isOnline ? 'Online' : 'Offline'}
                                                    </span>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                        {lastSeenLabel}
                                                    </p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <button
                                                    onClick={() => toggleDebug(device)}
                                                    className={`px-2 py-1 text-xs rounded ${
                                                        device.debug_enabled
                                                            ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                                                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                                    }`}
                                                >
                                                    {device.debug_enabled ? 'ON' : 'OFF'}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span
                                                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                        device.blacklisted
                                                            ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                                                            : device.disabled
                                                                ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                                                                : device.approval_required
                                                                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                                                    : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                                    }`}
                                                >
                                                    {device.blacklisted
                                                        ? 'Blacklisted'
                                                        : device.disabled
                                                            ? 'Disabled'
                                                            : device.approval_required
                                                                ? 'Pending approval'
                                                                : 'Active'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        defaultValue=""
                                                        onChange={(event) => {
                                                            const action = event.target.value;
                                                            event.target.value = '';
                                                            handleActionSelect(device, action);
                                                        }}
                                                        disabled={actionSerial === device.serial_number}
                                                        className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                                    >
                                                        <option value="">Actions</option>
                                                        <option value="view">View details</option>
                                                        {device.approval_required && (
                                                            <option value="approve">Approve</option>
                                                        )}
                                                        <option value="toggle-disabled">
                                                            {device.disabled ? 'Enable' : 'Disable'}
                                                        </option>
                                                        <option value="toggle-blacklist">
                                                            {device.blacklisted ? 'Unblacklist' : 'Blacklist'}
                                                        </option>
                                                        <option value="delete">Delete</option>
                                                    </select>
                                                    {device.debug_enabled && (
                                                        <span className="text-xs text-green-600 dark:text-green-400">
                                                            logs enabled
                                                        </span>
                                                    )}
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

function getLastSeenValue(
    device: Device,
    heartbeatMap: Record<string, ConnectionHeartbeat>,
): string | null {
    return heartbeatMap[device.pairing_code]?.device_last_seen ?? device.last_seen ?? null;
}

function getLastSeenMs(
    device: Device,
    heartbeatMap: Record<string, ConnectionHeartbeat>,
): number {
    const lastSeen = getLastSeenValue(device, heartbeatMap);
    return lastSeen ? new Date(lastSeen).getTime() : 0;
}

function isDeviceOnline(
    device: Device,
    heartbeatMap: Record<string, ConnectionHeartbeat>,
    nowMs: number,
): boolean {
    const lastSeenMs = getLastSeenMs(device, heartbeatMap);
    return lastSeenMs > nowMs - 5 * 60 * 1000;
}

function sortDevices(
    list: Device[],
    heartbeatMap: Record<string, ConnectionHeartbeat>,
) {
    return [...list].sort(
        (a, b) => getLastSeenMs(b, heartbeatMap) - getLastSeenMs(a, heartbeatMap),
    );
}
