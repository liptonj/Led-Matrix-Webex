'use client';

import { Pairing } from '@/lib/supabase';
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
    return (
        <div className="panel">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="panel-header">Telemetry</h3>
                    <p className="panel-subtext">Subscription: {pairingStatus}</p>
                </div>
                {pairingError && (
                    <span className="text-xs text-red-600">{pairingError}</span>
                )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                <div>Webex status: {pairing?.webex_status || 'unknown'}</div>
                <div>In call: {pairing?.in_call ? 'Yes' : 'No'}</div>
                <div>Camera: {pairing?.camera_on ? 'On' : 'Off'}</div>
                <div>Mic muted: {pairing?.mic_muted ? 'Yes' : 'No'}</div>
                <div>RSSI: {pairing?.rssi ?? 'n/a'}</div>
                <div>Temp: {pairing?.temperature ?? 'n/a'}</div>
            </div>
        </div>
    );
});
