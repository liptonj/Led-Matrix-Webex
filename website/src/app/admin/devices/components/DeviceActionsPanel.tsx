'use client';

import { Button, ConfirmDialog, Select, useConfirmDialog } from '@/components/ui';
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
                <p className="text-xs leading-tight uppercase tracking-wide font-semibold text-text-muted">
                    Monitoring
                </p>
                <Button
                    variant="default"
                    size="sm"
                    block
                    onClick={onToggleDebug}
                    disabled={debugUpdating}
                >
                    {device.debug_enabled ? 'Disable debug logs' : 'Enable debug logs'}
                </Button>

                {/* Log Verbosity Level */}
                <div className="pt-1 space-y-1">
                    <label htmlFor="log-level-select" className="block text-xs font-medium text-text-muted">
                        Serial Log Level
                    </label>
                    <Select
                        id="log-level-select"
                        size="sm"
                        value={logLevel}
                        onChange={(e) => handleLogLevelChange(e.target.value as LogLevel)}
                        disabled={commandSubmitting || !device.id}
                        className="w-full"
                    >
                        {LOG_LEVELS.map((l) => (
                            <option key={l.value} value={l.value}>
                                {l.label}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>

            <hr className="border-gray-200 dark:border-gray-700" />

            {/* Device Control */}
            <div className="space-y-2">
                <p className="text-xs leading-tight uppercase tracking-wide font-semibold text-text-muted">
                    Device Control
                </p>
                <Button
                    variant="primary"
                    size="sm"
                    block
                    onClick={onSendReboot}
                    disabled={commandSubmitting || !device.id}
                >
                    Send reboot command
                </Button>
            </div>

            <hr className="border-gray-200 dark:border-gray-700" />

            {/* Access Control */}
            <div className="space-y-2">
                <p className="text-xs leading-tight uppercase tracking-wide font-semibold text-text-muted">
                    Access Control
                </p>
                <div className="space-y-2">
                    {device.approval_required && (
                        <Button
                            variant="success"
                            size="sm"
                            block
                            onClick={onApprove}
                            disabled={accessUpdating}
                        >
                            Approve device
                        </Button>
                    )}
                    <Button
                        variant="warning"
                        size="sm"
                        block
                        onClick={handleDisableClick}
                        disabled={accessUpdating}
                    >
                        {device.disabled ? 'Enable device' : 'Disable device'}
                    </Button>
                    <Button
                        variant="danger"
                        size="sm"
                        block
                        onClick={handleBlacklistClick}
                        disabled={accessUpdating}
                    >
                        {device.blacklisted ? 'Remove blacklist' : 'Blacklist device'}
                    </Button>
                </div>
            </div>

            <hr className="border-gray-200 dark:border-gray-700" />

            {/* Danger Zone */}
            <div className="space-y-2 pt-1">
                <p className="text-xs leading-tight uppercase tracking-wide font-semibold text-red-500">
                    Danger Zone
                </p>
                <Button
                    variant="danger"
                    size="sm"
                    block
                    onClick={onDelete}
                    disabled={accessUpdating}
                >
                    Delete device
                </Button>
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
