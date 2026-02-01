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
                <pre className="text-xs p-3 rounded overflow-x-auto" style={{ backgroundColor: 'var(--color-code-bg)', color: 'var(--color-code-text)' }}>
{JSON.stringify(body, null, 2)}
                </pre>
            </div>
        </div>
    );
});
