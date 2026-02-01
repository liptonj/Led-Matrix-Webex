'use client';

import { Button, Card } from '@/components/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useRef } from 'react';
import type { DebugEntry } from '../types';

export interface DebugConsoleProps {
  debugLogs: DebugEntry[];
  onClear: () => void;
  onCopy: () => void;
  onClose: () => void;
}

const VirtualizedDebugLogs = memo(function VirtualizedDebugLogs({ debugLogs }: { debugLogs: DebugEntry[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: debugLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24, // Estimated height per log entry
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="max-h-72 overflow-y-auto font-mono text-xs whitespace-pre-wrap">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const entry = debugLogs[virtualItem.index];
          if (!entry) return null;
          return (
            <div
              key={`${entry.time}-${virtualItem.index}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className="flex gap-2"
            >
              <span className="text-[var(--color-text-muted)]">[{entry.time}]</span>
              <span className={entry.level === 'error' ? 'text-danger' : entry.level === 'warn' ? 'text-warning' : entry.level === 'info' ? 'text-primary' : entry.level === 'activity' ? 'text-success' : 'text-[var(--color-text)]'}>{entry.level}</span>
              <span className="flex-1">{entry.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const DebugConsole = memo(function DebugConsole({ debugLogs, onClear, onCopy, onClose }: DebugConsoleProps) {
  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-[520px] z-50">
      <Card className="shadow-lg border border-[var(--color-border)] bg-[var(--color-bg-card)]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Debug Console</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={onClear}>Clear</Button>
            <Button size="sm" variant="default" onClick={onCopy}>Copy</Button>
            <Button size="sm" variant="warning" onClick={onClose}>Close</Button>
          </div>
        </div>
        {debugLogs.length === 0 ? (
          <div className="max-h-72 overflow-y-auto font-mono text-xs whitespace-pre-wrap">
            <div className="text-[var(--color-text-muted)]">No logs captured yet.</div>
          </div>
        ) : (
          <VirtualizedDebugLogs debugLogs={debugLogs} />
        )}
      </Card>
    </div>
  );
});
