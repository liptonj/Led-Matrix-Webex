'use client';

import { TerminalDisplay } from '@/components/ui/TerminalDisplay';
import type { TerminalLine } from '@/types/support';

interface SupportWaitingProps {
  sessionId: string;
  terminalLines: TerminalLine[];
  onEndSession: () => void;
}

/**
 * Waiting state: session created, waiting for a technician to join.
 * Uses flex layout so the terminal fills remaining viewport space
 * without pushing content below the fold.
 */
export function SupportWaiting({ sessionId, terminalLines, onEndSession }: SupportWaitingProps) {
  return (
    <div className="flex flex-col h-full gap-4">
      {/* Waiting indicator */}
      <div className="shrink-0 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex items-center gap-3">
        <span className="inline-block w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
        <div className="flex-1">
          <p className="font-medium text-blue-900 dark:text-blue-200">
            Waiting for a technician to join...
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-400">
            Session ID: <code className="font-mono">{sessionId.slice(0, 8)}</code> &middot; Keep this page open
          </p>
        </div>
        <button
          onClick={onEndSession}
          className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
        >
          End Session
        </button>
      </div>

      {/* Terminal showing device output -- fills remaining space */}
      <div className="flex-1 min-h-0">
        <TerminalDisplay
          lines={terminalLines}
          title="Device Output"
          className="h-full"
          heightClass="flex-1 min-h-0"
          emptyText="Waiting for device output..."
        />
      </div>
    </div>
  );
}
