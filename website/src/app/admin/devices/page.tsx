'use client';

import { Alert } from '@/components/ui/Alert';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import {
    deleteDevice,
    Device,
    DeviceChangeEvent,
    getDevices,
    getPairingsForDevices,
    Pairing,
    setDeviceApprovalRequired,
    setDeviceBlacklisted,
    setDeviceDebugMode,
    setDeviceDisabled,
    setDeviceReleaseChannel,
    subscribeToDevices,
} from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export default function DevicesPage() {
    const router = useRouter();
    const [devices, setDevices] = useState<Device[]>([]);
    const [pairings, setPairings] = useState<Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
    const [now, setNow] = useState(Date.now());
    const [actionSerial, setActionSerial] = useState<string | null>(null);
    const devicesRef = useRef<Device[]>([]);

    const refreshPairings = useCallback(async (deviceList?: Device[]) => {
        const list = deviceList ?? devicesRef.current;
        if (!list.length) {
            setPairings({});
            return;
        }

        try {
            const rows = await getPairingsForDevices(
                list.map((device) => device.id),
            );
            const map = rows.reduce<Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>>((acc, row) => {
                acc[row.device_uuid] = row;
                return acc;
            }, {});
            setPairings(map);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to load pairings',
            );
        }
    }, []);

    const loadDevices = useCallback(async () => {
        try {
            const data = await getDevices();
            setDevices(data);
            await refreshPairings(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load devices');
        }
        setLoading(false);
    }, [refreshPairings]);

    useEffect(() => {
        loadDevices();
    }, [loadDevices]);

    useEffect(() => {
        const interval = setInterval(() => {
            setNow(Date.now());
            refreshPairings();
        }, 30_000);
        return () => clearInterval(interval);
    }, [refreshPairings]);

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

    async function handleToggleReleaseChannel(device: Device) {
        try {
            setActionSerial(device.serial_number);
            const newChannel = device.release_channel === 'production' ? 'beta' : 'production';
            await setDeviceReleaseChannel(device.serial_number, newChannel);
            await loadDevices();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update device channel');
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
        if (action === 'toggle-channel') {
            await handleToggleReleaseChannel(device);
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
        () => sortDevices(devices, pairings),
        [devices, pairings],
    );

    const filteredDevices = sortedDevices.filter((device) => {
        const isOnline = isDeviceOnline(device, pairings, now);
        if (filter === 'online') return isOnline;
        if (filter === 'offline') return !isOnline;
        return true;
    });

    const onlineCount = sortedDevices.filter((device) =>
        isDeviceOnline(device, pairings, now),
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
                <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)]">
                    Devices
                </h1>
                <div className="flex flex-wrap items-center gap-2 min-w-0 w-full sm:w-auto">
                    <Select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as typeof filter)}
                        size="sm"
                        aria-label="Filter devices by status"
                        className="flex-1 sm:flex-none min-w-0"
                    >
                        <option value="all">All ({devices.length})</option>
                        <option value="online">
                            Online ({onlineCount})
                        </option>
                        <option value="offline">
                            Offline ({devices.length - onlineCount})
                        </option>
                    </Select>
                    <button
                        onClick={loadDevices}
                        className="px-3 py-2 text-sm bg-[var(--color-surface-alt)] text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-md whitespace-nowrap transition-colors"
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
            <div className="lg:hidden space-y-3" role="region" aria-label="Device list">
                {filteredDevices.length === 0 ? (
                    <div className="bg-[var(--color-bg-card)] rounded-lg shadow p-6 text-center text-[var(--color-text-muted)]">
                        No devices found
                    </div>
                ) : (
                    filteredDevices.map((device) => {
                        const lastSeen = getLastSeenValue(device, pairings);
                        const lastSeenLabel = lastSeen
                            ? new Date(lastSeen).toLocaleString()
                            : 'Unknown';
                        const isOnline = isDeviceOnline(device, pairings, now);
                        return (
                            <div
                                key={device.id}
                                className="bg-[var(--color-bg-card)] rounded-lg shadow p-4"
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
                                            className="text-sm font-mono font-medium text-[var(--color-primary)] hover:underline"
                                        >
                                            {device.serial_number}
                                        </button>
                                        <p className="text-xs text-[var(--color-text-muted)] truncate">
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
                                        <span className="text-[var(--color-text-muted)]">Pairing:</span>{' '}
                                        <span className="font-mono">{device.pairing_code}</span>
                                    </div>
                                    <div>
                                        <span className="text-[var(--color-text-muted)]">Firmware:</span>{' '}
                                        <span>{device.firmware_version || 'Unknown'}</span>
                                    </div>
                                    <div>
                                        <span className="text-[var(--color-text-muted)]">IP:</span>{' '}
                                        <span className="font-mono">{device.ip_address || '-'}</span>
                                    </div>
                                    <div>
                                        <span className="text-[var(--color-text-muted)]">Last seen:</span>{' '}
                                        <span>{lastSeenLabel}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-[var(--color-border)]">
                                    <div className="flex flex-wrap items-center gap-2 min-w-0">
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
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                            device.release_channel === 'production'
                                                ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                                : 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                                        }`}>
                                            {device.release_channel || 'production'}
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
                                    <Select
                                        defaultValue=""
                                        onChange={(event) => {
                                            const action = event.target.value;
                                            event.target.value = '';
                                            handleActionSelect(device, action);
                                        }}
                                        disabled={actionSerial === device.serial_number}
                                        size="sm"
                                        aria-label={`Actions for device ${device.serial_number}`}
                                        className="w-full sm:w-auto min-w-[7rem] shrink-0"
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
                                        <option value="toggle-channel">
                                            {device.release_channel === 'production' ? 'Switch to Beta' : 'Switch to Production'}
                                        </option>
                                        <option value="delete">Delete</option>
                                    </Select>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block bg-[var(--color-bg-card)] rounded-lg shadow overflow-hidden" role="region" aria-label="Device table">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[var(--color-border)]">
                        <thead className="bg-[var(--color-surface-alt)]">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    Serial
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    Pairing Code
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    Firmware
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    IP Address
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    Last Seen
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    Debug
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    Access
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-[var(--color-bg-card)] divide-y divide-[var(--color-border)]">
                            {filteredDevices.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={8}
                                        className="px-6 py-8 text-center text-[var(--color-text-muted)]"
                                    >
                                        No devices found
                                    </td>
                                </tr>
                            ) : (
                                filteredDevices.map((device) => {
                                    const lastSeen = getLastSeenValue(device, pairings);
                                    const lastSeenLabel = lastSeen
                                        ? new Date(lastSeen).toLocaleString()
                                        : 'Unknown';
                                    const isOnline = isDeviceOnline(device, pairings, now);
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
                                                        className="text-sm font-mono text-[var(--color-primary)] hover:underline"
                                                    >
                                                        {device.serial_number}
                                                    </button>
                                                    <p className="text-xs text-[var(--color-text-muted)]">
                                                        {device.device_id}
                                                    </p>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm font-mono bg-[var(--color-surface-alt)] px-2 py-1 rounded">
                                                    {device.pairing_code}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm text-[var(--color-text-muted)]">
                                                    {device.firmware_version || 'Unknown'}
                                                </span>
                                                {device.target_firmware_version && (
                                                    <span className="ml-1 text-xs text-orange-600 dark:text-orange-400">
                                                        → {device.target_firmware_version}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm text-[var(--color-text-muted)] font-mono">
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
                                                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
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
                                                <div className="flex flex-col gap-1">
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
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                        device.release_channel === 'production'
                                                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                                            : 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                                                    }`}>
                                                        {device.release_channel || 'production'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    <Select
                                                        defaultValue=""
                                                        onChange={(event) => {
                                                            const action = event.target.value;
                                                            event.target.value = '';
                                                            handleActionSelect(device, action);
                                                        }}
                                                        disabled={actionSerial === device.serial_number}
                                                        size="sm"
                                                        aria-label={`Actions for device ${device.serial_number}`}
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
                                                        <option value="toggle-channel">
                                                            {device.release_channel === 'production' ? 'Switch to Beta' : 'Switch to Production'}
                                                        </option>
                                                        <option value="delete">Delete</option>
                                                    </Select>
                                                    {device.debug_enabled && (
                                                        <span className="text-xs text-[var(--color-success)]">
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
    pairingMap: Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>,
): string | null {
    return pairingMap[device.id]?.device_last_seen ?? device.last_seen ?? null;
}

function getLastSeenMs(
    device: Device,
    pairingMap: Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>,
): number {
    const lastSeen = getLastSeenValue(device, pairingMap);
    return lastSeen ? new Date(lastSeen).getTime() : 0;
}

function isDeviceOnline(
    device: Device,
    pairingMap: Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>,
    nowMs: number,
): boolean {
    const lastSeenMs = getLastSeenMs(device, pairingMap);
    return lastSeenMs > nowMs - 5 * 60 * 1000;
}

function sortDevices(
    list: Device[],
    pairingMap: Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>,
) {
    return [...list].sort(
        (a, b) => getLastSeenMs(b, pairingMap) - getLastSeenMs(a, pairingMap),
    );
}
