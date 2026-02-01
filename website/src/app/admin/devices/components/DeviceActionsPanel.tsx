'use client';

import { Device } from '@/lib/supabase';
import { memo } from 'react';

interface DeviceActionsPanelProps {
    device: Device;
    debugUpdating: boolean;
    accessUpdating: boolean;
    commandSubmitting: boolean;
    onToggleDebug: () => void;
    onApprove: () => void;
    onToggleDisabled: () => void;
    onToggleBlacklisted: () => void;
    onDelete: () => void;
    onSendReboot: () => void;
}

export default memo(function DeviceActionsPanel({
    device,
    debugUpdating,
    accessUpdating,
    commandSubmitting,
    onToggleDebug,
    onApprove,
    onToggleDisabled,
    onToggleBlacklisted,
    onDelete,
    onSendReboot,
}: DeviceActionsPanelProps) {
    return (
        <div className="panel space-y-2">
            <h3 className="panel-header">Actions</h3>
            <button
                onClick={onToggleDebug}
                disabled={debugUpdating}
                className="w-full rounded-md bg-gray-900 text-white text-xs px-3 py-2 hover:bg-gray-700 disabled:opacity-50"
            >
                {device.debug_enabled ? 'Disable debug logs' : 'Enable debug logs'}
            </button>
            {device.approval_required && (
                <button
                    onClick={onApprove}
                    disabled={accessUpdating}
                    className="w-full rounded-md bg-green-600 text-white text-xs px-3 py-2 hover:bg-green-700 disabled:opacity-50"
                >
                    Approve device
                </button>
            )}
            <button
                onClick={onToggleDisabled}
                disabled={accessUpdating}
                className="w-full rounded-md bg-yellow-600 text-white text-xs px-3 py-2 hover:bg-yellow-700 disabled:opacity-50"
            >
                {device.disabled ? 'Enable device' : 'Disable device'}
            </button>
            <button
                onClick={onToggleBlacklisted}
                disabled={accessUpdating}
                className="w-full rounded-md bg-red-600 text-white text-xs px-3 py-2 hover:bg-red-700 disabled:opacity-50"
            >
                {device.blacklisted ? 'Remove blacklist' : 'Blacklist device'}
            </button>
            <button
                onClick={onDelete}
                disabled={accessUpdating}
                className="w-full rounded-md border border-red-600 text-red-600 text-xs px-3 py-2 hover:bg-red-50 disabled:opacity-50"
            >
                Delete device
            </button>
            <button
                onClick={onSendReboot}
                disabled={commandSubmitting || !device.pairing_code}
                className="w-full rounded-md bg-blue-600 text-white text-xs px-3 py-2 hover:bg-blue-700 disabled:opacity-50"
            >
                Send reboot command
            </button>
        </div>
    );
});
