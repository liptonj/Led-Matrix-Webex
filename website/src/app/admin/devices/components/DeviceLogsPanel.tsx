'use client';

import { DeviceLog } from '@/lib/supabase';
import { Select } from '@/components/ui';
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

const levelColor: Record<string, string> = {
    error: 'text-red-500',
    warn: 'text-yellow-500',
    info: 'text-blue-500',
    debug: 'text-gray-400',
    verbose: 'text-gray-300',
};

const VirtualizedLogList = memo(function VirtualizedLogList({ logs }: { logs: DeviceLog[] }) {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: logs.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 32,
        overscan: 10,
        measureElement: (el) => el.getBoundingClientRect().height,
    });

    return (
        <div
            ref={parentRef}
            role="log"
            aria-label="Device log entries"
            className="mt-3 h-[300px] md:h-[400px] lg:h-[500px] xl:h-[600px] overflow-y-auto overscroll-contain rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]"
        >
            <div
                className="relative w-full"
                style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                    const log = logs[virtualItem.index];
                    if (!log) return null;
                    const lvl = log.level?.toLowerCase() ?? 'info';
                    return (
                        <div
                            key={log.id}
                            ref={virtualizer.measureElement}
                            data-index={virtualItem.index}
                            className="absolute left-0 top-0 w-full border-b border-[var(--color-border)] text-xs font-mono animate-fade-in"
                            style={{ transform: `translateY(${virtualItem.start}px)` }}
                        >
                            <div className="flex items-baseline gap-2 px-3 py-1.5 min-w-0">
                                <span
                                    className={`shrink-0 inline-block w-[3.5rem] text-right uppercase font-semibold ${levelColor[lvl] ?? 'text-gray-400'}`}
                                >
                                    {log.level}
                                </span>
                                <span
                                    className="shrink-0 tabular-nums text-[10px] text-text-muted"
                                >
                                    {new Date(log.created_at).toLocaleTimeString()}
                                </span>
                                <span
                                    className="min-w-0 whitespace-pre-wrap text-[var(--color-text)] [overflow-wrap:anywhere]"
                                >
                                    {log.message}
                                </span>
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
    const logCountText = `${logs.length} log${logs.length !== 1 ? 's' : ''}`;
    const statusText = logStatus === 'connected' ? 'Live' : logStatus;

    return (
        <div className="panel" role="region" aria-label="Device logs">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="panel-header">Device Logs</h3>
                    <p
                        role="status"
                        aria-live="polite"
                        aria-label={`Log stream: ${statusText}. ${logCountText}. Newest first.`}
                        className="panel-subtext"
                    >
                        {statusText} • {logCountText} • Newest first
                    </p>
                </div>
                <Select
                    size="sm"
                    value={logFilter}
                    onChange={(event) => onFilterChange(event.target.value as 'all' | DeviceLog['level'])}
                    aria-label="Filter logs by level"
                >
                    <option value="all">All</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                    <option value="debug">Debug</option>
                </Select>
            </div>
            {logsError && (
                <p role="alert" className="text-xs text-red-600 mt-2">
                    {logsError}
                </p>
            )}
            {logsLoading ? (
                <div className="py-6 text-xs text-text-muted">Loading logs...</div>
            ) : logs.length === 0 ? (
                <div className="py-6 text-xs text-text-muted">
                    {logStatus === 'connecting' && 'Connecting to log stream...'}
                    {logStatus === 'connected' && 'Connected — waiting for device to send logs. Enable debug mode for more output.'}
                    {logStatus === 'disconnected' && 'Log stream disconnected. The device may be offline.'}
                    {logStatus === 'error' && (logsError || 'Log stream error. Check connection.')}
                </div>
            ) : (
                <VirtualizedLogList logs={logs} />
            )}
        </div>
    );
});
