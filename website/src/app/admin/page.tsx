'use client';

import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import {
    Device,
    getDevices,
    getPairingsForDevices,
    getReleases,
    Pairing
} from '@/lib/supabase';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Stats {
    totalDevices: number;
    onlineDevices: number;
    totalReleases: number;
    latestVersion: string;
}

export default function AdminDashboardPage() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [recentDevices, setRecentDevices] = useState<Device[]>([]);
    const [pairings, setPairings] = useState<Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadDashboard() {
            try {
                const [devices, releases] = await Promise.all([getDevices(), getReleases()]);
                const pairingRows = await getPairingsForDevices(
                    devices.map((device) => device.id),
                );
                const pairingMap = pairingRows.reduce<Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>>(
                    (acc, row) => {
                        acc[row.device_uuid] = row;
                        return acc;
                    },
                    {},
                );

                setPairings(pairingMap);

                const nowMs = Date.now();
                const onlineDevices = devices.filter((device) =>
                    isDeviceOnlineWithMap(device, pairingMap, nowMs),
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
                        getLastSeenMs(b, pairingMap) - getLastSeenMs(a, pairingMap),
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
                <Spinner size="lg" />
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="danger">
                {error}
            </Alert>
        );
    }

    return (
        <div className="space-y-6 lg:space-y-8">
            <h1 className="text-xl lg:text-2xl font-bold text-[var(--color-text)]">
                Dashboard
            </h1>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
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
            <div className="bg-[var(--color-bg-card)] rounded-lg shadow">
                <div className="px-4 lg:px-6 py-4 border-b border-[var(--color-border)] flex justify-between items-center">
                    <h2 className="text-base lg:text-lg font-medium text-[var(--color-text)]">
                        Recent Devices
                    </h2>
                    <Link
                        href="/admin/devices"
                        className="text-sm text-primary hover:underline"
                    >
                        View All
                    </Link>
                </div>
                
                {/* Mobile Card View */}
                <div className="lg:hidden p-4 space-y-3">
                    {recentDevices.length === 0 ? (
                        <p className="text-center text-[var(--color-text-muted)] py-4">
                            No devices registered yet
                        </p>
                    ) : (
                        recentDevices.map((device) => {
                            const lastSeen = getLastSeenValue(device, pairings[device.id]);
                            const isOnline = isDeviceOnlineWithHeartbeat(device, pairings[device.id], Date.now());
                            return (
                                <div key={device.id} className="border border-[var(--color-border)] rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-mono text-sm text-[var(--color-text)]">
                                            {device.serial_number}
                                        </span>
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                isOnline
                                                    ? 'bg-success/10 text-success'
                                                    : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]'
                                            }`}
                                        >
                                            {isOnline ? 'Online' : 'Offline'}
                                        </span>
                                    </div>
                                    <div className="text-xs text-[var(--color-text-muted)] space-y-1">
                                        <p>Firmware: {device.firmware_version || 'Unknown'}</p>
                                        <p>Last seen: {lastSeen ? new Date(lastSeen).toLocaleString() : 'Unknown'}</p>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Desktop Table View */}
                <div className="hidden lg:block overflow-x-auto">
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
                                    Last Seen
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                                    Status
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-[var(--color-bg-card)] divide-y divide-[var(--color-border)]">
                            {recentDevices.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-6 py-4 text-center text-[var(--color-text-muted)]"
                                    >
                                        No devices registered yet
                                    </td>
                                </tr>
                            ) : (
                                recentDevices.map((device) => (
                                    <DeviceRow
                                        key={device.id}
                                        device={device}
                                        pairing={pairings[device.id]}
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
        blue: 'bg-primary/10 border-primary/20',
        green: 'bg-success/10 border-success/20',
        yellow: 'bg-warning/10 border-warning/20',
        red: 'bg-danger/10 border-danger/20',
    };

    const content = (
        <div className={`${colorClasses[color]} border rounded-lg p-4 lg:p-6`}>
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <p className="text-xs lg:text-sm font-medium text-[var(--color-text-muted)] truncate">
                        {title}
                    </p>
                    <p className="mt-1 text-lg lg:text-2xl font-semibold text-[var(--color-text)] truncate">
                        {value}
                    </p>
                </div>
                <span className="text-2xl lg:text-3xl flex-shrink-0">{icon}</span>
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
    pairing,
}: {
    device: Device;
    pairing?: Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>;
}) {
    const lastSeen = getLastSeenValue(device, pairing);
    const isOnline = isDeviceOnlineWithHeartbeat(device, pairing, Date.now());
    const lastSeenLabel = lastSeen ? new Date(lastSeen).toLocaleString() : 'Unknown';

    return (
        <tr>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm font-mono text-[var(--color-text)]">
                    {device.serial_number}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm font-mono text-[var(--color-text)]" title={device.id}>
                    {device.id.slice(0, 8)}...
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-[var(--color-text-muted)]">
                    {device.firmware_version || 'Unknown'}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-sm text-[var(--color-text-muted)]">
                    {lastSeenLabel}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        isOnline
                            ? 'bg-success/10 text-success'
                            : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]'
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
    pairing?: Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>,
): string | null {
    return pairing?.device_last_seen ?? device.last_seen ?? null;
}

function getLastSeenMs(
    device: Device,
    pairingMap: Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>,
): number {
    const lastSeen = getLastSeenValue(device, pairingMap[device.id]);
    return lastSeen ? new Date(lastSeen).getTime() : 0;
}

function isDeviceOnlineWithMap(
    device: Device,
    pairingMap: Record<string, Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'>>,
    nowMs: number,
): boolean {
    return isDeviceOnlineWithHeartbeat(device, pairingMap[device.id], nowMs);
}

function isDeviceOnlineWithHeartbeat(
    device: Device,
    pairing: Pick<Pairing, 'device_uuid' | 'app_last_seen' | 'device_last_seen' | 'app_connected' | 'device_connected'> | undefined,
    nowMs: number,
): boolean {
    const lastSeen = getLastSeenValue(device, pairing);
    const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;
    return lastSeenMs > nowMs - 5 * 60 * 1000;
}
