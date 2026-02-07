'use client';

import { TerminalDisplay } from '@/components/ui/TerminalDisplay';
import type { TerminalLine } from '@/types/support';

interface SupportActiveProps {
  terminalLines: TerminalLine[];
  isFlashing: boolean;
  onEndSession: () => void;
}

/**
 * Active state: technician connected, showing full terminal view.
 * User sees everything the admin sees plus activity annotations.
 */
export function SupportActive({ terminalLines, isFlashing, onEndSession }: SupportActiveProps) {
  return (
    <div className="space-y-4">
      {/* Active session header */}
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-center gap-3">
        <span className="inline-block w-3 h-3 bg-green-500 rounded-full" />
        <div className="flex-1">
          <p className="font-medium text-green-900 dark:text-green-200">
            Technician connected
          </p>
          <p className="text-sm text-green-700 dark:text-green-400">
            Your device is being remotely accessed. You can see everything the technician does.
          </p>
        </div>
        <button
          onClick={onEndSession}
          disabled={isFlashing}
          className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          End Session
        </button>
      </div>

      {/* Terminal */}
      <TerminalDisplay
        lines={terminalLines}
        title="Support Console"
        heightClass="h-[calc(100vh-280px)]"
        emptyText="Waiting for device output..."
      />
    </div>
  );
}
