'use client';

import { Command } from '@/lib/supabase';
import { memo } from 'react';

type SubscriptionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface DeviceCommandsPanelProps {
    commands: Command[];
    commandError: string | null;
    commandStatus: SubscriptionStatus;
    commandFilter: 'all' | Command['status'];
    commandCount: number;
    commandPage: number;
    commandTotalPages: number;
    onFilterChange: (filter: 'all' | Command['status']) => void;
    onPageChange: (page: number) => void;
    onShowResponse: (title: string, body: Record<string, unknown> | null) => void;
}

export default memo(function DeviceCommandsPanel({
    commands,
    commandError,
    commandStatus,
    commandFilter,
    commandCount,
    commandPage,
    commandTotalPages,
    onFilterChange,
    onPageChange,
    onShowResponse,
}: DeviceCommandsPanelProps) {
    const formatCommandAge = (createdAt: string) => {
        const deltaMs = Date.now() - new Date(createdAt).getTime();
        const minutes = Math.max(0, Math.floor(deltaMs / 60000));
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const getCommandStatusClasses = (status: Command['status']) => {
        if (status === 'acked') return 'bg-green-100 text-green-800';
        if (status === 'failed') return 'bg-red-100 text-red-800';
        if (status === 'expired') return 'bg-gray-200 text-gray-700';
        return 'bg-yellow-100 text-yellow-800';
    };

    const commandPageSafe = Math.min(commandPage, commandTotalPages);

    return (
        <div className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="panel-header">Command Status</h3>
                    <p className="panel-subtext">Subscription: {commandStatus}</p>
                </div>
                <select
                    value={commandFilter}
                    onChange={(event) =>
                        onFilterChange(event.target.value as 'all' | Command['status'])
                    }
                    className="input-field-sm"
                >
                    <option value="pending">Pending</option>
                    <option value="acked">Acked</option>
                    <option value="failed">Failed</option>
                    <option value="expired">Expired</option>
                    <option value="all">All</option>
                </select>
            </div>
            {commandError && (
                <p className="text-xs text-red-600 mt-2">{commandError}</p>
            )}
            <p className="text-[10px] mt-2" style={{ color: 'var(--color-text-muted)' }}>
                Showing {commands.length} of {commandCount}
            </p>
            {commands.length > 0 && (
                <div className="mt-3 space-y-2">
                    {commands.map((cmd) => (
                        <button
                            key={cmd.id}
                            onClick={() => onShowResponse(`Command ${cmd.command}`, cmd.response || null)}
                            className="w-full text-left text-xs px-2 py-2 rounded border"
                            style={{ borderColor: 'var(--color-border)' }}
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{cmd.command}</span>
                                <span
                                    className={`text-[10px] px-2 py-0.5 rounded ${getCommandStatusClasses(cmd.status)}`}
                                >
                                    {cmd.status}
                                </span>
                            </div>
                            <div className="flex items-center justify-between mt-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                                <span>Created {formatCommandAge(cmd.created_at)}</span>
                                <span>
                                    {cmd.acked_at ? `Acked ${formatCommandAge(cmd.acked_at)}` : 'Not acked'}
                                </span>
                            </div>
                            {cmd.error && (
                                <div className="mt-1 text-[10px] text-red-600">
                                    {cmd.error}
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            )}
            <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--color-text)' }}>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(1, commandPage - 1))}
                    disabled={commandPageSafe <= 1}
                    className="rounded border px-2 py-1 disabled:opacity-50"
                    style={{ borderColor: 'var(--color-border)' }}
                >
                    Prev
                </button>
                <span>
                    Page {commandPageSafe} of {commandTotalPages}
                </span>
                <button
                    type="button"
                    onClick={() =>
                        onPageChange(Math.min(commandTotalPages, commandPage + 1))
                    }
                    disabled={commandPageSafe >= commandTotalPages}
                    className="rounded border px-2 py-1 disabled:opacity-50"
                    style={{ borderColor: 'var(--color-border)' }}
                >
                    Next
                </button>
            </div>
        </div>
    );
});
