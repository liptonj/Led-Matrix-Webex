'use client';

import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import {
    Command,
    deleteDevice,
    Device,
    DeviceLog,
    getCommandsPage,
    getDevice,
    getDeviceUserId,
    getPairing,
    insertCommand,
    Pairing,
    setDeviceApprovalRequired,
    setDeviceBlacklisted,
    setDeviceDebugMode,
    setDeviceDisabled,
    subscribeToCommands,
    subscribeToDeviceLogs,
    subscribeToPairing
} from '@/lib/supabase';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import CommandResponseModal from './components/CommandResponseModal';
import DeviceActionsPanel from './components/DeviceActionsPanel';
import DeviceCommandsPanel from './components/DeviceCommandsPanel';
import DeviceInfoCard from './components/DeviceInfoCard';
import DeviceLogsPanel from './components/DeviceLogsPanel';
import DeviceTelemetryPanel from './components/DeviceTelemetryPanel';

const LOG_LIMIT = 200;
const COMMAND_PAGE_SIZE = 10;

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function DeviceDetailPanel({
    serialNumber,
    onClose,
}: {
    serialNumber: string;
    onClose: () => void;
}) {
    const [device, setDevice] = useState<Device | null>(null);
    const [pairing, setPairing] = useState<Pairing | null>(null);
    const [logs, setLogs] = useState<DeviceLog[]>([]);
    const [commands, setCommands] = useState<Command[]>([]);
    const [userUuid, setUserUuid] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [logsLoading, setLogsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [logsError, setLogsError] = useState<string | null>(null);
    const [pairingError, setPairingError] = useState<string | null>(null);
    const [commandError, setCommandError] = useState<string | null>(null);
    const [debugUpdating, setDebugUpdating] = useState(false);
    const [accessUpdating, setAccessUpdating] = useState(false);
    const [commandSubmitting, setCommandSubmitting] = useState(false);
    const [logFilter, setLogFilter] = useState<'all' | DeviceLog['level']>('all');
    const [commandFilter, setCommandFilter] = useState<'all' | Command['status']>('all');
    const [commandPage, setCommandPage] = useState(1);
    const [commandCount, setCommandCount] = useState(0);
    const [commandRefreshToken, setCommandRefreshToken] = useState(0);
    const [logStatus, setLogStatus] = useState<SubscriptionStatus>('connecting');
    const [pairingStatus, setPairingStatus] = useState<SubscriptionStatus>('connecting');
    const [commandStatus, setCommandStatus] = useState<SubscriptionStatus>('connecting');
    const [responseModalOpen, setResponseModalOpen] = useState(false);
    const [responseModalTitle, setResponseModalTitle] = useState('');
    const [responseModalBody, setResponseModalBody] = useState<Record<string, unknown> | null>(null);

    useEffect(() => {
        if (!serialNumber) {
            setError('Missing device serial number.');
            setLoading(false);
            return;
        }

        let isMounted = true;

        (async () => {
            try {
                const record = await getDevice(serialNumber);
                if (!isMounted) return;
                if (!record) {
                    setError('Device not found.');
                    setLoading(false);
                    return;
                }
                setDevice(record);
                
                // Get user UUID for this device
                try {
                    const userId = await getDeviceUserId(record.id);
                    if (!isMounted) return;
                    setUserUuid(userId);
                } catch (err) {
                    // If user lookup fails, set to null (device may not be paired)
                    if (isMounted) {
                        setUserUuid(null);
                    }
                }
            } catch (err) {
                if (!isMounted) return;
                setError(err instanceof Error ? err.message : 'Failed to load device.');
            } finally {
                if (isMounted) setLoading(false);
            }
        })();

        return () => {
            isMounted = false;
        };
    }, [serialNumber]);

    useEffect(() => {
        if (!device?.serial_number) return;

        let pairingUnsubscribe: (() => void) | null = null;
        let logsUnsubscribe: (() => void) | null = null;
        let commandsUnsubscribe: (() => void) | null = null;
        let isMounted = true;

        const loadPairing = async () => {
            if (!device.pairing_code) return;
            try {
                const data = await getPairing(device.pairing_code);
                if (!isMounted) return;
                setPairing(data);
            } catch (err) {
                if (!isMounted) return;
                setPairingError(err instanceof Error ? err.message : 'Failed to load telemetry.');
            }
        };

        const loadLogs = async () => {
            // BROADCAST-ONLY MODE: No historical logs in database
            // We start with empty logs and only populate from Realtime
            setLogs([]);
            setLogsLoading(false);
            setLogsError(null);
        };

        loadPairing();
        loadLogs();

        if (device.pairing_code) {
            setPairingStatus('connecting');
            subscribeToPairing(
                device.pairing_code,
                (update) => {
                    setPairing((prev) => ({ ...(prev || {}), ...update } as Pairing));
                },
                (subscribed) => {
                    setPairingStatus(subscribed ? 'connected' : 'disconnected');
                },
                () => {
                    setPairingStatus('error');
                },
            ).then((unsubscribe) => {
                pairingUnsubscribe = unsubscribe;
            }).catch(() => {
                setPairingStatus('error');
            });
            setCommandStatus('connecting');
            subscribeToCommands(
                device.pairing_code,
                (update) => {
                    if (update.id) {
                        setCommandRefreshToken((prev) => prev + 1);
                    }
                },
                (subscribed) => {
                    setCommandStatus(subscribed ? 'connected' : 'disconnected');
                },
                () => {
                    setCommandStatus('error');
                },
            ).then((unsubscribe) => {
                commandsUnsubscribe = unsubscribe;
            }).catch(() => {
                setCommandStatus('error');
            });
        } else {
            setPairingStatus('disconnected');
            setCommandStatus('disconnected');
        }

        // Only subscribe to logs if we have a userUuid
        if (userUuid) {
            setLogStatus('connecting');
            subscribeToDeviceLogs(
                userUuid,
                (log) => {
                    setLogs((prev) => {
                        const next = [log, ...prev];
                        return next.slice(0, LOG_LIMIT);
                    });
                },
                (subscribed) => {
                    setLogStatus(subscribed ? 'connected' : 'disconnected');
                    if (!subscribed) {
                        setLogsError('Disconnected from log stream');
                    } else {
                        setLogsError(null);
                    }
                },
                (errorMessage) => {
                    setLogStatus('error');
                    setLogsError(errorMessage || 'Failed to subscribe to device logs');
                },
                device.id, // device_uuid for filtering
            ).then((unsubscribe) => {
                logsUnsubscribe = unsubscribe;
            }).catch((err) => {
                setLogStatus('error');
                setLogsError(err instanceof Error ? err.message : 'Failed to subscribe to device logs');
            });
        } else {
            setLogStatus('disconnected');
            setLogsError('Device is not paired to a user. Logs are only available for paired devices.');
        }

        return () => {
            isMounted = false;
            if (pairingUnsubscribe) pairingUnsubscribe();
            if (logsUnsubscribe) logsUnsubscribe();
            if (commandsUnsubscribe) commandsUnsubscribe();
        };
    }, [device?.serial_number, device?.pairing_code, device?.id, userUuid]);

    const filteredLogs = useMemo(() => {
        if (logFilter === 'all') return logs;
        return logs.filter((log) => log.level === logFilter);
    }, [logs, logFilter]);

    useEffect(() => {
        setCommandPage(1);
    }, [commandFilter]);

    useEffect(() => {
        if (!device?.pairing_code) {
            setCommands([]);
            setCommandCount(0);
            return;
        }

        let isMounted = true;
        (async () => {
            try {
                const result = await getCommandsPage(device.pairing_code, {
                    status: commandFilter,
                    page: commandPage,
                    pageSize: COMMAND_PAGE_SIZE,
                });
                if (!isMounted) return;
                setCommands(result.data);
                setCommandCount(result.count ?? result.data.length);
                setCommandError(null);
            } catch (err) {
                if (!isMounted) return;
                setCommandError(err instanceof Error ? err.message : 'Failed to load commands.');
            }
        })();

        return () => {
            isMounted = false;
        };
    }, [device?.pairing_code, commandFilter, commandPage, commandRefreshToken]);

    const handleToggleDebug = async () => {
        if (!device) return;
        try {
            setDebugUpdating(true);
            await setDeviceDebugMode(device.serial_number, !device.debug_enabled);
            setDevice({ ...device, debug_enabled: !device.debug_enabled });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to toggle debug mode.');
        } finally {
            setDebugUpdating(false);
        }
    };

    const handleApprove = async () => {
        if (!device) return;
        try {
            setAccessUpdating(true);
            await setDeviceApprovalRequired(device.serial_number, false);
            setDevice({ ...device, approval_required: false });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to approve device.');
        } finally {
            setAccessUpdating(false);
        }
    };

    const handleToggleDisabled = async () => {
        if (!device) return;
        try {
            setAccessUpdating(true);
            const next = !device.disabled;
            await setDeviceDisabled(device.serial_number, next);
            setDevice({ ...device, disabled: next });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update device.');
        } finally {
            setAccessUpdating(false);
        }
    };

    const handleToggleBlacklisted = async () => {
        if (!device) return;
        try {
            setAccessUpdating(true);
            const next = !device.blacklisted;
            await setDeviceBlacklisted(device.serial_number, next);
            setDevice({ ...device, blacklisted: next });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update device.');
        } finally {
            setAccessUpdating(false);
        }
    };

    const handleDelete = async () => {
        if (!device) return;
        const confirmed = window.confirm(
            `Delete device ${device.serial_number}? This cannot be undone.`,
        );
        if (!confirmed) return;
        try {
            setAccessUpdating(true);
            await deleteDevice(device.serial_number);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete device.');
        } finally {
            setAccessUpdating(false);
        }
    };

    const handleInsertCommand = async (command: string) => {
        if (!device?.pairing_code) return;
        try {
            setCommandSubmitting(true);
            const result = await insertCommand(device.pairing_code, device.serial_number, command, {});
            void result;
        } catch (err) {
            setCommandError(err instanceof Error ? err.message : 'Failed to send command.');
        } finally {
            setCommandSubmitting(false);
        }
    };

    const handleShowResponse = (title: string, body: Record<string, unknown> | null) => {
        setResponseModalTitle(title);
        setResponseModalBody(body);
        setResponseModalOpen(true);
    };

    if (!serialNumber) return null;

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Device Details</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Serial {serialNumber}</p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                    Back to devices
                </button>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-8">
                    <Spinner size="lg" />
                </div>
            )}

            {error && (
                <Alert variant="danger">
                    {error}
                </Alert>
            )}

            {!loading && device && (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="space-y-4">
                            <DeviceInfoCard
                                device={device}
                                pairingStatus={pairingStatus}
                                commandStatus={commandStatus}
                                logStatus={logStatus}
                            />
                            <DeviceActionsPanel
                                device={device}
                                debugUpdating={debugUpdating}
                                accessUpdating={accessUpdating}
                                commandSubmitting={commandSubmitting}
                                onToggleDebug={handleToggleDebug}
                                onApprove={handleApprove}
                                onToggleDisabled={handleToggleDisabled}
                                onToggleBlacklisted={handleToggleBlacklisted}
                                onDelete={handleDelete}
                                onSendReboot={() => handleInsertCommand('reboot')}
                            />
                        </div>

                        <div className="lg:col-span-2 space-y-4">
                            <DeviceTelemetryPanel
                                pairing={pairing}
                                pairingStatus={pairingStatus}
                                pairingError={pairingError}
                            />
                            <DeviceLogsPanel
                                logs={filteredLogs}
                                logsLoading={logsLoading}
                                logsError={logsError}
                                logStatus={logStatus}
                                logFilter={logFilter}
                                onFilterChange={setLogFilter}
                            />
                        </div>
                    </div>
                    <DeviceCommandsPanel
                        commands={commands}
                        commandError={commandError}
                        commandStatus={commandStatus}
                        commandFilter={commandFilter}
                        commandCount={commandCount}
                        commandPage={commandPage}
                        commandTotalPages={Math.max(1, Math.ceil(commandCount / COMMAND_PAGE_SIZE))}
                        onFilterChange={setCommandFilter}
                        onPageChange={setCommandPage}
                        onShowResponse={handleShowResponse}
                    />
                </div>
            )}

            <CommandResponseModal
                isOpen={responseModalOpen}
                title={responseModalTitle}
                body={responseModalBody}
                onClose={() => setResponseModalOpen(false)}
            />
        </div>
    );
}
