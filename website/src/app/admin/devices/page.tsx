'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDevices, setDeviceDebugMode, Device } from '@/lib/supabase';

export default function DevicesPage() {
    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');

    useEffect(() => {
        loadDevices();
    }, []);

    async function loadDevices() {
        try {
            const data = await getDevices();
            setDevices(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load devices');
        }
        setLoading(false);
    }

    async function toggleDebug(device: Device) {
        try {
            await setDeviceDebugMode(device.serial_number, !device.debug_enabled);
            // Refresh device list
            await loadDevices();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to toggle debug mode');
        }
    }

    const filteredDevices = devices.filter((device) => {
        const isOnline = new Date(device.last_seen) > new Date(Date.now() - 5 * 60 * 1000);
        if (filter === 'online') return isOnline;
        if (filter === 'offline') return !isOnline;
        return true;
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                    Devices
                </h1>
                <div className="flex items-center space-x-2">
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as typeof filter)}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    >
                        <option value="all">All Devices ({devices.length})</option>
                        <option value="online">
                            Online ({devices.filter((d) => new Date(d.last_seen) > new Date(Date.now() - 5 * 60 * 1000)).length})
                        </option>
                        <option value="offline">
                            Offline ({devices.filter((d) => new Date(d.last_seen) <= new Date(Date.now() - 5 * 60 * 1000)).length})
                        </option>
                    </select>
                    <button
                        onClick={loadDevices}
                        className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
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
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredDevices.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                                    >
                                        No devices found
                                    </td>
                                </tr>
                            ) : (
                                filteredDevices.map((device) => {
                                    const isOnline = new Date(device.last_seen) > new Date(Date.now() - 5 * 60 * 1000);
                                    return (
                                        <tr key={device.id}>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div>
                                                    <span className="text-sm font-mono text-gray-900 dark:text-white">
                                                        {device.serial_number}
                                                    </span>
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
                                                        {new Date(device.last_seen).toLocaleString()}
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
                                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                                    -
                                                </span>
                                                {device.debug_enabled && (
                                                    <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                                                        (logs enabled)
                                                    </span>
                                                )}
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
