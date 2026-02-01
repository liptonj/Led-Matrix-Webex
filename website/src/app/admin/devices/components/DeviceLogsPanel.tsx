'use client';

import { DeviceLog } from '@/lib/supabase';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useRef } from 'react';

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface DeviceLogsPanelProps {
    logs: DeviceLog[];
    logsLoading: boolean;
    logsError: string | null;
    logStatus: SubscriptionStatus;
    logFilter: 'all' | DeviceLog['level'];
    onFilterChange: (filter: 'all' | DeviceLog['level']) => void;
}

const VirtualizedLogList = memo(function VirtualizedLogList({ logs }: { logs: DeviceLog[] }) {
    const parentRef = useRef<HTMLDivElement>(null);
    
    const virtualizer = useVirtualizer({
        count: logs.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 70, // Estimated height of each log item
        overscan: 5,
    });

    return (
        <div
            ref={parentRef}
            className="mt-3 max-h-72 overflow-y-auto"
        >
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                    const log = logs[virtualItem.index];
                    if (!log) return null;
                    return (
                        <div
                            key={log.id}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualItem.start}px)`,
                            }}
                            className="pb-2"
                        >
                            <div className="rounded border px-2 py-2 text-xs" style={{ borderColor: 'var(--color-border)' }}>
                                <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                                    <span>{log.level.toUpperCase()}</span>
                                    <span>{new Date(log.created_at).toLocaleString()}</span>
                                </div>
                                <p className="mt-1" style={{ color: 'var(--color-text)' }}>{log.message}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

export default memo(function DeviceLogsPanel({
    logs,
    logsLoading,
    logsError,
    logStatus,
    logFilter,
    onFilterChange,
}: DeviceLogsPanelProps) {
    return (
        <div className="panel">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="panel-header">Device Logs (Live Only)</h3>
                    <p className="panel-subtext">Subscription: {logStatus} • Real-time streaming only, no history</p>
                </div>
                <select
                    value={logFilter}
                    onChange={(event) => onFilterChange(event.target.value as 'all' | DeviceLog['level'])}
                    className="input-field-sm"
                >
                    <option value="all">All</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                    <option value="debug">Debug</option>
                </select>
            </div>
            {logsError && (
                <p className="text-xs text-red-600 mt-2">{logsError}</p>
            )}
            {logsLoading ? (
                <div className="py-6 text-xs" style={{ color: 'var(--color-text-muted)' }}>Loading logs...</div>
            ) : logs.length === 0 ? (
                <div className="py-6 text-xs" style={{ color: 'var(--color-text-muted)' }}>Waiting for live logs... (Enable debug mode on device to see more logs)</div>
            ) : (
                <VirtualizedLogList logs={logs} />
            )}
        </div>
    );
});
