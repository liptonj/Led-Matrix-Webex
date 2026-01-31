'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    getConnectionHeartbeats,
    getDevices,
    getReleases,
    ConnectionHeartbeat,
    Device,
    Release,
} from '@/lib/supabase';

interface Stats {
    totalDevices: number;
    onlineDevices: number;
    totalReleases: number;
    latestVersion: string;
}

export default function AdminDashboardPage() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [recentDevices, setRecentDevices] = useState<Device[]>([]);
    const [heartbeats, setHeartbeats] = useState<Record<string, ConnectionHeartbeat>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadDashboard() {
            try {
                const [devices, releases] = await Promise.all([getDevices(), getReleases()]);
                const heartbeatRows = await getConnectionHeartbeats(
                    devices.map((device) => device.pairing_code),
                );
                const heartbeatMap = heartbeatRows.reduce<Record<string, ConnectionHeartbeat>>(
                    (acc, row) => {
                        acc[row.pairing_code] = row;
                        return acc;
                    },
                    {},
                );

                setHeartbeats(heartbeatMap);

                const nowMs = Date.now();
                const onlineDevices = devices.filter((device) =>
                    isDeviceOnlineWithMap(device, heartbeatMap, nowMs),
                ).length;

                const latestRelease = releases.find((r) => r.is_latest);

                setStats({
                    totalDevices: devices.length,
                    onlineDevices,
                    totalReleases: releases.length,
                    latestVersion: latestRelease?.version || 'N/A',
                });

                const sortedDevices = [...devices].sort(
                    (a, b) =>
                        getLastSeenMs(b, heartbeatMap) - getLastSeenMs(a, heartbeatMap),
                );
                setRecentDevices(sortedDevices.slice(0, 5));
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load dashboard');
            }
            setLoading(false);
        }

        loadDashboard();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Dashboard
            </h1>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Total Devices"
                    value={stats?.totalDevices || 0}
                    icon="📱"
                    link="/admin/devices"
                />
                <StatCard
                    title="Online Now"
                    value={stats?.onlineDevices || 0}
                    icon="🟢"
                    color="green"
                />
                <StatCard
                    title="Releases"
                    value={stats?.totalReleases || 0}
                    icon="📦"
                    link="/admin/releases"
                />
                <StatCard
                    title="Latest Version"
                    value={stats?.latestVersion || 'N/A'}
                    icon="🏷️"
                />
            </div>

            {/* Recent Devices */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                        Recent Devices
                    </h2>
                    <Link
                        href="/admin/devices"
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        View All
                    </Link>
                </div>
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
                                    Last Seen
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Status
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {recentDevices.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-6 py-4 text-center text-gray-500 dark:text-gray-400"
                                    >
                                        No devices registered yet
                                    </td>
                                </tr>
                            ) : (
                                recentDevices.map((device) => (
                                    <DeviceRow
                                        key={device.id}
                                        device={device}
                                        heartbeat={heartbeats[device.pairing_code]}
                                    />
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function StatCard({
    title,
    value,
    icon,
    color = 'blue',
    link,
}: {
    title: string;
    value: number | string;
    icon: string;
    color?: 'blue' | 'green' | 'yellow' | 'red';
    link?: string;
}) {
    const colorClasses = {
        blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
        green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
        yellow: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
        red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    };

    const content = (
        <div className={`${colorClasses[color]} border rounded-lg p-6`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                        {title}
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                        {value}
                    </p>
                </div>
                <span className="text-3xl">{icon}</span>
            </div>
        </div>
    );

    if (link) {
        return (
            <Link href={link} className="block hover:opacity-90 transition-opacity">
                {content}
            </Link>
        );
    }

    return content;
}

function DeviceRow({
    device,
    heartbeat,
}: {
    device: Device;
    heartbeat?: ConnectionHeartbeat;
}) {
    const lastSeen = getLastSeenValue(device, heartbeat);
    const isOnline = isDeviceOnlineWithHeartbeat(device, heartbeat, Date.now());
    const lastSeenLabel = lastSeen ? new Date(lastSeen).toLocaleString() : 'Unknown';

    return (
        <tr>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm font-mono text-gray-900 dark:text-white">
                    {device.serial_number}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm font-mono text-gray-900 dark:text-white">
                    {device.pairing_code}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                    {device.firmware_version || 'Unknown'}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                    {lastSeenLabel}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        isOnline
                            ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                    }`}
                >
                    {isOnline ? 'Online' : 'Offline'}
                </span>
            </td>
        </tr>
    );
}

function getLastSeenValue(
    device: Device,
    heartbeat?: ConnectionHeartbeat,
): string | null {
    return heartbeat?.device_last_seen ?? device.last_seen ?? null;
}

function getLastSeenMs(
    device: Device,
    heartbeatMap: Record<string, ConnectionHeartbeat>,
): number {
    const lastSeen = getLastSeenValue(device, heartbeatMap[device.pairing_code]);
    return lastSeen ? new Date(lastSeen).getTime() : 0;
}

function isDeviceOnlineWithMap(
    device: Device,
    heartbeatMap: Record<string, ConnectionHeartbeat>,
    nowMs: number,
): boolean {
    return isDeviceOnlineWithHeartbeat(device, heartbeatMap[device.pairing_code], nowMs);
}

function isDeviceOnlineWithHeartbeat(
    device: Device,
    heartbeat: ConnectionHeartbeat | undefined,
    nowMs: number,
): boolean {
    const lastSeen = getLastSeenValue(device, heartbeat);
    const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;
    return lastSeenMs > nowMs - 5 * 60 * 1000;
}
