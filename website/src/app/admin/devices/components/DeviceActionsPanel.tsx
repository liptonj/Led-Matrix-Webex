'use client';

import { ConfirmDialog, useConfirmDialog } from '@/components/ui';
import { Device } from '@/lib/supabase';
import { memo, useEffect, useState } from 'react';

const LOG_LEVELS = [
    { value: 'none', label: 'None (silent)' },
    { value: 'error', label: 'Error' },
    { value: 'warn', label: 'Warn' },
    { value: 'info', label: 'Info (default)' },
    { value: 'debug', label: 'Debug' },
    { value: 'verbose', label: 'Verbose' },
] as const;

type LogLevel = (typeof LOG_LEVELS)[number]['value'];

interface DeviceActionsPanelProps {
    device: Device;
    debugUpdating: boolean;
    accessUpdating: boolean;
    commandSubmitting: boolean;
    currentLogLevel?: string;
    onToggleDebug: () => void;
    onApprove: () => void;
    onToggleDisabled: () => void;
    onToggleBlacklisted: () => void;
    onDelete: () => void;
    onSendReboot: () => void;
    onSetLogLevel: (level: string) => void;
}

export default memo(function DeviceActionsPanel({
    device,
    debugUpdating,
    accessUpdating,
    commandSubmitting,
    currentLogLevel,
    onToggleDebug,
    onApprove,
    onToggleDisabled,
    onToggleBlacklisted,
    onDelete,
    onSendReboot,
    onSetLogLevel,
}: DeviceActionsPanelProps) {
    const [logLevel, setLogLevel] = useState<LogLevel>((currentLogLevel as LogLevel) || 'info');
    const confirmDisable = useConfirmDialog();
    const confirmBlacklist = useConfirmDialog();

    useEffect(() => {
        if (currentLogLevel) {
            setLogLevel(currentLogLevel as LogLevel);
        }
    }, [currentLogLevel]);

    const handleLogLevelChange = (level: LogLevel) => {
        setLogLevel(level);
        onSetLogLevel(level);
    };

    const handleDisableClick = () => {
        confirmDisable.open();
    };

    const handleBlacklistClick = () => {
        confirmBlacklist.open();
    };

    const handleConfirmDisable = () => {
        onToggleDisabled();
        confirmDisable.close();
    };

    const handleConfirmBlacklist = () => {
        onToggleBlacklisted();
        confirmBlacklist.close();
    };

    return (
        <div className="panel space-y-3">
            <h3 className="panel-header">Actions</h3>
            
            {/* Monitoring */}
            <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-muted)' }}>Monitoring</p>
                <button
                    onClick={onToggleDebug}
                    disabled={debugUpdating}
                    className="w-full rounded-md bg-gray-900 text-white text-xs px-3 py-2 hover:bg-gray-700 disabled:opacity-50"
                >
                    {device.debug_enabled ? 'Disable debug logs' : 'Enable debug logs'}
                </button>

                {/* Log Verbosity Level */}
                <div className="pt-1">
                    <label htmlFor="log-level-select" className="block text-xs font-medium text-gray-500 mb-1">
                        Serial Log Level
                    </label>
                    <select
                        id="log-level-select"
                        value={logLevel}
                        onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
                        disabled={commandSubmitting || !device.pairing_code}
                        className="w-full rounded-md border border-gray-300 bg-white text-xs px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {LOG_LEVELS.map((l) => (
                            <option key={l.value} value={l.value}>
                                {l.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            
            <hr className="border-gray-200 dark:border-gray-700" />
            
            {/* Device Control */}
            <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-muted)' }}>Device Control</p>
                <button
                    onClick={onSendReboot}
                    disabled={commandSubmitting || !device.pairing_code}
                    className="w-full rounded-md bg-blue-600 text-white text-xs px-3 py-2 hover:bg-blue-700 disabled:opacity-50"
                >
                    Send reboot command
                </button>
            </div>
            
            <hr className="border-gray-200 dark:border-gray-700" />
            
            {/* Access Control */}
            <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-muted)' }}>Access Control</p>
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
                    onClick={handleDisableClick}
                    disabled={accessUpdating}
                    className="w-full rounded-md bg-yellow-600 text-white text-xs px-3 py-2 hover:bg-yellow-700 disabled:opacity-50"
                >
                    {device.disabled ? 'Enable device' : 'Disable device'}
                </button>
                <button
                    onClick={handleBlacklistClick}
                    disabled={accessUpdating}
                    className="w-full rounded-md bg-red-600 text-white text-xs px-3 py-2 hover:bg-red-700 disabled:opacity-50"
                >
                    {device.blacklisted ? 'Remove blacklist' : 'Blacklist device'}
                </button>
            </div>
            
            <hr className="border-gray-200 dark:border-gray-700" />
            
            {/* Danger Zone */}
            <div className="space-y-2 pt-1">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-red-500">Danger Zone</p>
                <button
                    onClick={onDelete}
                    disabled={accessUpdating}
                    className="w-full rounded-md border border-red-600 text-red-600 text-xs px-3 py-2 hover:bg-red-50 disabled:opacity-50"
                >
                    Delete device
                </button>
            </div>

            {/* Confirm Dialogs */}
            <ConfirmDialog
                open={confirmDisable.isOpen}
                onClose={() => confirmDisable.close()}
                onConfirm={handleConfirmDisable}
                title={device.disabled ? 'Enable Device' : 'Disable Device'}
                message={`Are you sure you want to ${device.disabled ? 'enable' : 'disable'} this device?`}
                variant="warning"
                confirmLabel={device.disabled ? 'Enable' : 'Disable'}
            />

            <ConfirmDialog
                open={confirmBlacklist.isOpen}
                onClose={() => confirmBlacklist.close()}
                onConfirm={handleConfirmBlacklist}
                title={device.blacklisted ? 'Remove from Blacklist' : 'Blacklist Device'}
                message={`Are you sure you want to ${device.blacklisted ? 'remove this device from the blacklist' : 'blacklist this device'}?${!device.blacklisted ? ' Blacklisted devices cannot connect.' : ''}`}
                variant="danger"
                confirmLabel={device.blacklisted ? 'Remove' : 'Blacklist'}
            />
        </div>
    );
});
