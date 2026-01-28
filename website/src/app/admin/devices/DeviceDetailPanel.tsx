'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    Device,
    DeviceLog,
    Pairing,
    Command,
    getDevice,
    getDeviceLogsBySerial,
    getPairing,
    getPendingCommands,
    insertCommand,
    setDeviceDebugMode,
    subscribeToCommands,
    subscribeToDeviceLogs,
    subscribeToPairing,
} from '@/lib/supabase';

const LOG_LIMIT = 200;

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
    const [loading, setLoading] = useState(true);
    const [logsLoading, setLogsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [logsError, setLogsError] = useState<string | null>(null);
    const [pairingError, setPairingError] = useState<string | null>(null);
    const [commandError, setCommandError] = useState<string | null>(null);
    const [debugUpdating, setDebugUpdating] = useState(false);
    const [commandSubmitting, setCommandSubmitting] = useState(false);
    const [logFilter, setLogFilter] = useState<'all' | DeviceLog['level']>('all');
    const [logStatus, setLogStatus] = useState<SubscriptionStatus>('connecting');
    const [pairingStatus, setPairingStatus] = useState<SubscriptionStatus>('connecting');
    const [commandStatus, setCommandStatus] = useState<SubscriptionStatus>('connecting');
    const [pendingCommandIds, setPendingCommandIds] = useState<Set<string>>(new Set());
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

        const loadCommands = async () => {
            if (!device.pairing_code) return;
            try {
                const data = await getPendingCommands(device.pairing_code);
                if (!isMounted) return;
                setCommands(data);
                setPendingCommandIds(new Set(data.map((cmd) => cmd.id)));
                setCommandError(null);
            } catch (err) {
                if (!isMounted) return;
                setCommandError(err instanceof Error ? err.message : 'Failed to load commands.');
            }
        };

        const loadLogs = async () => {
            try {
                setLogsLoading(true);
                const data = await getDeviceLogsBySerial(device.serial_number, LOG_LIMIT);
                if (!isMounted) return;
                setLogs(data);
                setLogsError(null);
            } catch (err) {
                if (!isMounted) return;
                setLogsError(err instanceof Error ? err.message : 'Failed to load logs.');
            } finally {
                if (isMounted) setLogsLoading(false);
            }
        };

        loadPairing();
        loadCommands();
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
                    setCommands((prev) => {
                        const existingIndex = prev.findIndex((cmd) => cmd.id === update.id);
                        const next = [...prev];
                        if (existingIndex >= 0) {
                            next[existingIndex] = { ...next[existingIndex], ...update } as Command;
                        } else if (update.id) {
                            next.unshift(update as Command);
                        }
                        return next.slice(0, 20);
                    });
                    if (update.id && update.status) {
                        if (update.status === 'pending') {
                            setPendingCommandIds((prev) => new Set(prev).add(update.id as string));
                        } else {
                            setPendingCommandIds((prev) => {
                                const next = new Set(prev);
                                next.delete(update.id as string);
                                return next;
                            });
                        }
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

        setLogStatus('connecting');
        subscribeToDeviceLogs(
            device.serial_number,
            (log) => {
                setLogs((prev) => {
                    const next = [log, ...prev];
                    return next.slice(0, LOG_LIMIT);
                });
            },
            (subscribed) => {
                setLogStatus(subscribed ? 'connected' : 'disconnected');
            },
            () => {
                setLogStatus('error');
            },
        ).then((unsubscribe) => {
            logsUnsubscribe = unsubscribe;
        }).catch(() => {
            setLogStatus('error');
        });

        return () => {
            isMounted = false;
            if (pairingUnsubscribe) pairingUnsubscribe();
            if (logsUnsubscribe) logsUnsubscribe();
            if (commandsUnsubscribe) commandsUnsubscribe();
        };
    }, [device?.serial_number, device?.pairing_code]);

    const filteredLogs = useMemo(() => {
        if (logFilter === 'all') return logs;
        return logs.filter((log) => log.level === logFilter);
    }, [logs, logFilter]);

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

    const handleInsertCommand = async (command: string) => {
        if (!device?.pairing_code) return;
        try {
            setCommandSubmitting(true);
            const result = await insertCommand(device.pairing_code, device.serial_number, command, {});
            if (result?.id) {
                setPendingCommandIds((prev) => new Set(prev).add(result.id));
            }
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
                    Close
                </button>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            )}

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}

            {!loading && device && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="space-y-4">
                        <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-4">
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Device</h3>
                            <p className="text-sm text-gray-900 dark:text-white mt-2">{device.display_name || 'Unnamed device'}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Firmware {device.firmware_version || 'Unknown'}</p>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-4 space-y-2">
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Actions</h3>
                            <button
                                onClick={handleToggleDebug}
                                disabled={debugUpdating}
                                className="w-full rounded-md bg-gray-900 text-white text-xs px-3 py-2 hover:bg-gray-700 disabled:opacity-50"
                            >
                                {device.debug_enabled ? 'Disable debug logs' : 'Enable debug logs'}
                            </button>
                            <button
                                onClick={() => handleInsertCommand('reboot')}
                                disabled={commandSubmitting || !device.pairing_code}
                                className="w-full rounded-md bg-blue-600 text-white text-xs px-3 py-2 hover:bg-blue-700 disabled:opacity-50"
                            >
                                Send reboot command
                            </button>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-4">
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Command Status</h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Subscription: {commandStatus}</p>
                            {commandError && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-2">{commandError}</p>
                            )}
                            {commands.length > 0 && (
                                <div className="mt-3 space-y-2">
                                    {commands.map((cmd) => (
                                        <button
                                            key={cmd.id}
                                            onClick={() => handleShowResponse(`Command ${cmd.command}`, cmd.response || null)}
                                            className="w-full text-left text-xs px-2 py-2 rounded border border-gray-200 dark:border-gray-700"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span>{cmd.command}</span>
                                                <span className="text-[10px] text-gray-500">{cmd.status}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Telemetry</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Subscription: {pairingStatus}</p>
                                </div>
                                {pairingError && (
                                    <span className="text-xs text-red-600 dark:text-red-400">{pairingError}</span>
                                )}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-700 dark:text-gray-300">
                                <div>Webex status: {pairing?.webex_status || 'unknown'}</div>
                                <div>In call: {pairing?.in_call ? 'Yes' : 'No'}</div>
                                <div>Camera: {pairing?.camera_on ? 'On' : 'Off'}</div>
                                <div>Mic muted: {pairing?.mic_muted ? 'Yes' : 'No'}</div>
                                <div>RSSI: {pairing?.rssi ?? 'n/a'}</div>
                                <div>Temp: {pairing?.temperature ?? 'n/a'}</div>
                            </div>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Device Logs</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Subscription: {logStatus}</p>
                                </div>
                                <select
                                    value={logFilter}
                                    onChange={(event) => setLogFilter(event.target.value as 'all' | DeviceLog['level'])}
                                    className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white"
                                >
                                    <option value="all">All</option>
                                    <option value="info">Info</option>
                                    <option value="warn">Warn</option>
                                    <option value="error">Error</option>
                                    <option value="debug">Debug</option>
                                </select>
                            </div>
                            {logsError && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-2">{logsError}</p>
                            )}
                            {logsLoading ? (
                                <div className="py-6 text-xs text-gray-500">Loading logs...</div>
                            ) : filteredLogs.length === 0 ? (
                                <div className="py-6 text-xs text-gray-500">No logs yet.</div>
                            ) : (
                                <div className="mt-3 max-h-72 overflow-y-auto space-y-2">
                                    {filteredLogs.map((log) => (
                                        <div
                                            key={log.id}
                                            className="rounded border border-gray-200 dark:border-gray-700 px-2 py-2 text-xs"
                                        >
                                            <div className="flex items-center justify-between text-[10px] text-gray-500">
                                                <span>{log.level.toUpperCase()}</span>
                                                <span>{new Date(log.created_at).toLocaleString()}</span>
                                            </div>
                                            <p className="text-gray-800 dark:text-gray-200 mt-1">{log.message}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {responseModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-lg w-full p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                {responseModalTitle}
                            </h3>
                            <button
                                onClick={() => setResponseModalOpen(false)}
                                className="text-sm text-gray-500 hover:text-gray-700"
                            >
                                Close
                            </button>
                        </div>
                        <pre className="text-xs bg-gray-100 dark:bg-gray-900 p-3 rounded overflow-x-auto">
{JSON.stringify(responseModalBody, null, 2)}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
}
