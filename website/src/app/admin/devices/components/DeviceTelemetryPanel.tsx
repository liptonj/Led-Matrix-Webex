'use client';

import { Tooltip } from '@/components/ui';
import { Pairing } from '@/lib/supabase';
import { formatRelativeTime } from '@/lib/utils';
import { memo } from 'react';

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface DeviceTelemetryPanelProps {
    pairing: Pairing | null;
    pairingStatus: SubscriptionStatus;
    pairingError: string | null;
}

export default memo(function DeviceTelemetryPanel({
    pairing,
    pairingStatus,
    pairingError,
}: DeviceTelemetryPanelProps) {
    const getRssiQuality = (rssi: number | null | undefined) => {
        if (rssi == null) return { label: 'N/A', color: 'text-gray-400' };
        if (rssi >= -50) return { label: 'Excellent', color: 'text-green-600' };
        if (rssi >= -60) return { label: 'Good', color: 'text-green-500' };
        if (rssi >= -70) return { label: 'Fair', color: 'text-yellow-500' };
        return { label: 'Poor', color: 'text-red-500' };
    };

    const getWebexStatusBadge = (status: string | undefined) => {
        if (!status || status === 'unknown') return { label: 'Unknown', color: 'bg-gray-200 text-gray-700' };
        if (status === 'active' || status === 'Active') return { label: 'Active', color: 'bg-green-100 text-green-800' };
        if (status === 'inactive' || status === 'Inactive') return { label: 'Inactive', color: 'bg-gray-200 text-gray-700' };
        if (status === 'dnd' || status === 'DoNotDisturb') return { label: 'Do Not Disturb', color: 'bg-red-100 text-red-800' };
        if (status === 'meeting' || status === 'call') return { label: 'In Meeting', color: 'bg-blue-100 text-blue-800' };
        return { label: status, color: 'bg-gray-200 text-gray-700' };
    };

    const webexBadge = getWebexStatusBadge(pairing?.webex_status);
    const rssiQuality = getRssiQuality(pairing?.rssi);

    return (
        <div className="panel" role="region" aria-label="Device telemetry">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="panel-header">Telemetry</h3>
                    <p
                        role="status"
                        aria-label={`Telemetry subscription: ${pairingStatus}`}
                        className="panel-subtext"
                    >
                        Subscription: {pairingStatus}
                    </p>
                </div>
                {pairingError && (
                    <span role="alert" className="text-xs text-red-600">
                        {pairingError}
                    </span>
                )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-text)]">
                <div>
                    <Tooltip
                        content={
                            pairing?.device_last_seen
                                ? new Date(pairing.device_last_seen).toLocaleString()
                                : 'Unknown'
                        }
                    >
                        <span>
                            Last seen:{' '}
                            {pairing?.device_last_seen
                                ? formatRelativeTime(pairing.device_last_seen)
                                : 'Unknown'}
                        </span>
                    </Tooltip>
                </div>
                <div>
                    Webex:{' '}
                    <span
                        role="status"
                        aria-label={`Webex status: ${webexBadge.label}`}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${webexBadge.color}`}
                    >
                        {webexBadge.label}
                    </span>
                </div>
                <div>In call: {pairing?.in_call ? 'Yes' : 'No'}</div>
                <div>Camera: {pairing?.camera_on ? 'On' : 'Off'}</div>
                <div>Mic muted: {pairing?.mic_muted ? 'Yes' : 'No'}</div>
                <div>
                    RSSI: {pairing?.rssi != null ? `${pairing.rssi} dBm` : 'N/A'}{' '}
                    <span
                        role="status"
                        aria-label={`Signal strength: ${rssiQuality.label}`}
                        className={`text-xs ${rssiQuality.color}`}
                    >
                        ({rssiQuality.label})
                    </span>
                </div>
                <div>Temp: {pairing?.temperature != null ? `${pairing.temperature}°` : 'N/A'}</div>
            </div>
        </div>
    );
});
