'use client';

import { Tooltip } from '@/components/ui';
import { Device, Pairing } from '@/lib/supabase';
import { memo } from 'react';

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface DeviceInfoCardProps {
    device: Device;
    pairing?: Pairing | null;
    pairingStatus: SubscriptionStatus;
    commandStatus: SubscriptionStatus;
    logStatus: SubscriptionStatus;
}

export default memo(function DeviceInfoCard({
    device,
    pairing,
    pairingStatus,
    commandStatus,
    logStatus,
}: DeviceInfoCardProps) {
    const accessLabel = device.blacklisted
        ? 'Blacklisted'
        : device.disabled
            ? 'Disabled'
            : device.approval_required
                ? 'Awaiting approval'
                : 'Active';

    const getOnlineStatus = () => {
        if (!pairing?.device_last_seen) return { label: 'Unknown', color: 'bg-gray-200 text-gray-600' };
        const lastSeenMs = Date.now() - new Date(pairing.device_last_seen).getTime();
        const twoMinutes = 2 * 60 * 1000;
        if (lastSeenMs < twoMinutes) return { label: 'Online', color: 'bg-green-100 text-green-800' };
        return { label: 'Offline', color: 'bg-gray-200 text-gray-600' };
    };
    const onlineStatus = getOnlineStatus();

    // Check if pairing_code is active (not null and not expired)
    const hasActivePairingCode = pairing?.pairing_code && (
        !pairing.pairing_code_expires_at || 
        new Date(pairing.pairing_code_expires_at) > new Date()
    );

    // Display first 8 characters of device UUID
    const deviceUuidDisplay = device.id ? device.id.substring(0, 8) : 'N/A';

    const realtimeStatuses: SubscriptionStatus[] = [pairingStatus, commandStatus, logStatus];
    const realtimeAllConnected = realtimeStatuses.every((status) => status === 'connected');
    const realtimeAnyError = realtimeStatuses.some((status) => status === 'error');
    const realtimeAnyDisconnected = realtimeStatuses.some((status) => status === 'disconnected');
    
    const getRealtimeLabel = () => {
        if (realtimeAllConnected) return 'Connected';
        const issues: string[] = [];
        if (pairingStatus !== 'connected') issues.push(`telemetry ${pairingStatus}`);
        if (commandStatus !== 'connected') issues.push(`commands ${commandStatus}`);
        if (logStatus !== 'connected') issues.push(`logs ${logStatus}`);
        return issues.length > 0 ? `Partial (${issues.join(', ')})` : 'Connecting...';
    };
    const realtimeLabel = getRealtimeLabel();
    
    const realtimeBadgeClass = realtimeAllConnected
        ? 'bg-green-100 text-green-800'
        : realtimeAnyError
            ? 'bg-red-100 text-red-800'
            : realtimeAnyDisconnected
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-gray-200 text-gray-700';

    const pairedUserDisplay = device.paired_user_name
        ? device.paired_user_name
        : device.paired_user_email
            ? device.paired_user_email
            : 'Not paired';

    return (
        <div className="panel" role="region" aria-label="Device information">
            <h3 className="panel-header">Device</h3>
            <div className="flex items-center gap-2 mt-1">
                <span
                    role="status"
                    aria-label={`Device is ${onlineStatus.label.toLowerCase()}`}
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors duration-200 ${onlineStatus.color}`}
                >
                    {onlineStatus.label}
                </span>
            </div>
            <p className="text-sm mt-2 text-[var(--color-text)]">{device.display_name || 'Unnamed device'}</p>
            <p className="panel-subtext">Firmware {device.firmware_version || 'Unknown'}</p>
            <div className="mt-2">
                <span className="panel-subtext">Device UUID:</span>
                <Tooltip content={`Full Device UUID: ${device.id}`}>
                    <span className="ml-2 text-sm font-mono text-[var(--color-text)]">
                        {deviceUuidDisplay}...
                    </span>
                </Tooltip>
            </div>
            {hasActivePairingCode && (
                <div className="mt-2">
                    <span className="panel-subtext">Pairing Code:</span>
                    <Tooltip
                        content={
                            pairing.pairing_code_expires_at
                                ? `Expires: ${new Date(pairing.pairing_code_expires_at).toLocaleString()}`
                                : 'No expiration'
                        }
                    >
                        <span className="ml-2 text-sm font-mono text-[var(--color-text)]">
                            {pairing.pairing_code}
                        </span>
                    </Tooltip>
                </div>
            )}
            <div className="mt-2">
                <span className="panel-subtext">Paired user:</span>
                <span className="ml-2 text-sm text-[var(--color-text)]">
                    {pairedUserDisplay}
                </span>
            </div>
            <div className="mt-2">
                <span className="panel-subtext">Access:</span>
                <span
                    aria-label={`Access level: ${accessLabel}`}
                    className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-700 transition-colors duration-200"
                >
                    {accessLabel}
                </span>
            </div>
            <div className="mt-2">
                <span className="panel-subtext">Realtime (Admin):</span>
                <span
                    role="status"
                    aria-label={`Realtime connection: ${realtimeLabel}`}
                    className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs transition-colors duration-200 ${realtimeBadgeClass}`}
                >
                    {realtimeLabel}
                </span>
            </div>
        </div>
    );
});
