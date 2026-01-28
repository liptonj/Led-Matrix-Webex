'use client';

import {
    Device,
    DeviceLog,
    getDevice,
    getDeviceLogsBySerial,
    getReleases,
    Release,
    setDeviceDebugMode,
    setDeviceTargetFirmware,
    subscribeToDeviceLogs,
} from '@/lib/supabase';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function DeviceDetailPage() {
    const params = useParams();
    const router = useRouter();
    const serial = params.serial as string;

    const [device, setDevice] = useState<Device | null>(null);
    const [logs, setLogs] = useState<DeviceLog[]>([]);
    const [releases, setReleases] = useState<Release[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState(false);

    // Supabase Realtime streaming state
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamError, setStreamError] = useState<string | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        loadDevice();
    }, [serial]);

    // Supabase Realtime subscription for debug log streaming
    useEffect(() => {
        if (!device?.debug_enabled || !device?.serial_number) {
            // Clean up any existing subscription when debug is disabled
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
            setIsStreaming(false);
            return;
        }

        // Subscribe to realtime log updates filtered by serial_number
        const setupSubscription = async () => {
            try {
                setStreamError(null);
                const unsubscribe = await subscribeToDeviceLogs(
                    device.serial_number,
                    (newLog: DeviceLog) => {
                        setLogs((prev) => [newLog, ...prev].slice(0, 200));
                    },
                    (subscribed: boolean) => {
                        setIsStreaming(subscribed);
                    },
                    (err: string) => {
                        console.error('Realtime subscription error:', err);
                        setStreamError(err);
                        setIsStreaming(false);
                    }
                );
                unsubscribeRef.current = unsubscribe;
            } catch (err) {
                console.error('Failed to setup realtime subscription:', err);
                setStreamError(err instanceof Error ? err.message : 'Subscription failed');
            }
        };

        setupSubscription();

        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    }, [device?.debug_enabled, device?.serial_number]);

    async function loadDevice() {
        try {
            const [deviceData, releasesData] = await Promise.all([
                getDevice(serial),
                getReleases(),
            ]);

            if (!deviceData) {
                setError('Device not found');
                setLoading(false);
                return;
            }

            setDevice(deviceData);
            setReleases(releasesData);

            // Load logs if debug is enabled (using serial_number)
            if (deviceData.debug_enabled) {
                const logsData = await getDeviceLogsBySerial(deviceData.serial_number);
                setLogs(logsData);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load device');
        }
        setLoading(false);
    }

    async function toggleDebug() {
        if (!device) return;
        setUpdating(true);
        try {
            await setDeviceDebugMode(device.serial_number, !device.debug_enabled);
            await loadDevice();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to toggle debug');
        }
        setUpdating(false);
    }

    async function updateTargetFirmware(version: string) {
        if (!device) return;
        setUpdating(true);
        try {
            await setDeviceTargetFirmware(device.serial_number, version || null);
            await loadDevice();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update target firmware');
        }
        setUpdating(false);
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (error || !device) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-red-600 dark:text-red-400">{error || 'Device not found'}</p>
                <Link
                    href="/admin/devices"
                    className="mt-2 inline-block text-blue-600 dark:text-blue-400 hover:underline"
                >
                    Back to Devices
                </Link>
            </div>
        );
    }

    const isOnline = new Date(device.last_seen) > new Date(Date.now() - 5 * 60 * 1000);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-start">
                <div>
                    <Link
                        href="/admin/devices"
                        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-2 inline-block"
                    >
                        ← Back to Devices
                    </Link>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-mono">
                        {device.serial_number}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        {device.device_id}
                    </p>
                </div>
                <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                        isOnline
                            ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                    }`}
                >
                    {isOnline ? '🟢 Online' : '⚫ Offline'}
                </span>
            </div>

            {/* Device Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                        Device Information
                    </h2>
                    <dl className="space-y-3">
                        <div className="flex justify-between">
                            <dt className="text-sm text-gray-500 dark:text-gray-400">Pairing Code</dt>
                            <dd className="text-sm font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                {device.pairing_code}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-sm text-gray-500 dark:text-gray-400">Firmware Version</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {device.firmware_version || 'Unknown'}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-sm text-gray-500 dark:text-gray-400">IP Address</dt>
                            <dd className="text-sm font-mono text-gray-900 dark:text-white">
                                {device.ip_address || '-'}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-sm text-gray-500 dark:text-gray-400">Last Seen</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {new Date(device.last_seen).toLocaleString()}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-sm text-gray-500 dark:text-gray-400">Registered</dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {new Date(device.registered_at).toLocaleDateString()}
                            </dd>
                        </div>
                    </dl>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                        Device Controls
                    </h2>
                    <div className="space-y-4">
                        {/* Debug Toggle */}
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    Debug Logging
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Stream logs via Supabase Realtime for troubleshooting
                                </p>
                            </div>
                            <button
                                onClick={toggleDebug}
                                disabled={updating}
                                className={`px-4 py-2 text-sm rounded-md ${
                                    device.debug_enabled
                                        ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                } disabled:opacity-50`}
                            >
                                {device.debug_enabled ? 'Enabled' : 'Disabled'}
                            </button>
                        </div>

                        {/* Target Firmware */}
                        <div>
                            <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                                Target Firmware
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                Force device to update to a specific version
                            </p>
                            <select
                                value={device.target_firmware_version || ''}
                                onChange={(e) => updateTargetFirmware(e.target.value)}
                                disabled={updating}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                            >
                                <option value="">Use latest release</option>
                                {releases.map((release) => (
                                    <option key={release.id} value={release.version}>
                                        {release.version} {release.is_latest ? '(Latest)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Debug Logs */}
            {device.debug_enabled && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                                Debug Logs
                            </h2>
                            {isStreaming ? (
                                <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                    </span>
                                    Streaming via Realtime
                                </span>
                            ) : streamError ? (
                                <span className="text-xs text-red-500 dark:text-red-400">
                                    {streamError}
                                </span>
                            ) : (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Connecting to Realtime...
                                </span>
                            )}
                        </div>
                        {!isStreaming && (
                            <button
                                onClick={loadDevice}
                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                Refresh
                            </button>
                        )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                        {logs.length === 0 ? (
                            <p className="px-6 py-4 text-gray-500 dark:text-gray-400 text-sm">
                                No logs yet. Logs will appear when the device sends debug data.
                            </p>
                        ) : (
                            <div className="divide-y divide-gray-200 dark:divide-gray-700">
                                {logs.map((log) => (
                                    <div
                                        key={log.id}
                                        className={`px-6 py-3 text-sm ${
                                            log.level === 'error'
                                                ? 'bg-red-50 dark:bg-red-900/10'
                                                : log.level === 'warn'
                                                ? 'bg-yellow-50 dark:bg-yellow-900/10'
                                                : ''
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center space-x-2">
                                                <span
                                                    className={`text-xs font-medium uppercase ${
                                                        log.level === 'error'
                                                            ? 'text-red-600 dark:text-red-400'
                                                            : log.level === 'warn'
                                                            ? 'text-yellow-600 dark:text-yellow-400'
                                                            : log.level === 'info'
                                                            ? 'text-blue-600 dark:text-blue-400'
                                                            : 'text-gray-500 dark:text-gray-400'
                                                    }`}
                                                >
                                                    [{log.level}]
                                                </span>
                                                <span className="text-gray-900 dark:text-white font-mono">
                                                    {log.message}
                                                </span>
                                            </div>
                                            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ml-4">
                                                {new Date(log.created_at).toLocaleTimeString()}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
