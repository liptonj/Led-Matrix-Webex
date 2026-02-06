'use client';

import { Device } from '@/lib/supabase';
import { memo } from 'react';

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface DeviceInfoCardProps {
    device: Device;
    pairingStatus: SubscriptionStatus;
    commandStatus: SubscriptionStatus;
    logStatus: SubscriptionStatus;
}

export default memo(function DeviceInfoCard({
    device,
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

    const realtimeStatuses: SubscriptionStatus[] = [pairingStatus, commandStatus, logStatus];
    const realtimeAllConnected = realtimeStatuses.every((status) => status === 'connected');
    const realtimeAnyError = realtimeStatuses.some((status) => status === 'error');
    const realtimeAnyDisconnected = realtimeStatuses.some((status) => status === 'disconnected');
    const realtimeLabel = realtimeAllConnected
        ? 'Connected'
        : `P:${pairingStatus} C:${commandStatus} L:${logStatus}`;
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
        <div className="panel">
            <h3 className="panel-header">Device</h3>
            <p className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>{device.display_name || 'Unnamed device'}</p>
            <p className="panel-subtext">Firmware {device.firmware_version || 'Unknown'}</p>
            <div className="mt-2">
                <span className="panel-subtext">Paired user:</span>
                <span className="ml-2 text-sm" style={{ color: 'var(--color-text)' }}>
                    {pairedUserDisplay}
                </span>
            </div>
            <div className="mt-2">
                <span className="panel-subtext">Access:</span>
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-700">
                    {accessLabel}
                </span>
            </div>
            <div className="mt-2">
                <span className="panel-subtext">Realtime (Admin):</span>
                <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs ${realtimeBadgeClass}`}>
                    {realtimeLabel}
                </span>
            </div>
        </div>
    );
});
