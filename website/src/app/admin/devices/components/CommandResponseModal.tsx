'use client';

import { memo } from 'react';

interface CommandResponseModalProps {
    isOpen: boolean;
    title: string;
    body: Record<string, unknown> | null;
    onClose: () => void;
}

export default memo(function CommandResponseModal({
    isOpen,
    title,
    body,
    onClose,
}: CommandResponseModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="rounded-lg shadow-lg max-w-lg w-full p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-sm hover:opacity-70"
                        style={{ color: 'var(--color-text-muted)' }}
                    >
                        Close
                    </button>
                </div>
                {body === null ? (
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No response data</p>
                ) : (
                    <div className="space-y-3">
                        {/* Structured fields */}
                        <div className="space-y-2 text-xs">
                            {body.success !== undefined && (
                                <div className="flex gap-2">
                                    <span className="font-medium shrink-0" style={{ color: 'var(--color-text-muted)' }}>Status:</span>
                                    <span className={body.success ? 'text-green-600' : 'text-red-600'}>
                                        {body.success ? 'Success' : 'Failed'}
                                    </span>
                                </div>
                            )}
                            {body.error != null && (
                                <div className="flex gap-2">
                                    <span className="font-medium shrink-0" style={{ color: 'var(--color-text-muted)' }}>Error:</span>
                                    <span className="text-red-600">{String(body.error)}</span>
                                </div>
                            )}
                            {body.data != null && (
                                <div>
                                    <span className="font-medium block mb-1" style={{ color: 'var(--color-text-muted)' }}>Data:</span>
                                    <pre className="text-xs p-2 rounded overflow-x-auto" style={{ backgroundColor: 'var(--color-code-bg)', color: 'var(--color-code-text)' }}>
                                        {JSON.stringify(body.data, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                        {/* Collapsible raw JSON */}
                        <details className="text-xs">
                            <summary className="cursor-pointer font-medium" style={{ color: 'var(--color-text-muted)' }}>
                                Raw JSON
                            </summary>
                            <pre className="mt-2 p-3 rounded overflow-x-auto" style={{ backgroundColor: 'var(--color-code-bg)', color: 'var(--color-code-text)' }}>
                                {JSON.stringify(body, null, 2)}
                            </pre>
                        </details>
                    </div>
                )}
            </div>
        </div>
    );
});
