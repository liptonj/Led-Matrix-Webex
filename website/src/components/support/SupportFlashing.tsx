'use client';

import { TerminalDisplay } from '@/components/ui/TerminalDisplay';
import type { TerminalLine, FlashProgressEvent } from '@/types/support';

interface SupportFlashingProps {
  terminalLines: TerminalLine[];
  flashProgress: FlashProgressEvent | null;
}

/**
 * Flash in progress state: shows warning banner and progress bar.
 * End Session is disabled during flash.
 * Uses flex layout so the terminal fills remaining viewport space.
 */
export function SupportFlashing({ terminalLines, flashProgress }: SupportFlashingProps) {
  const percent = flashProgress?.percent ?? 0;
  const phase = flashProgress?.phase ?? 'Preparing';
  const message = flashProgress?.message ?? 'Starting firmware update...';

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Warning banner */}
      <div className="shrink-0 bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-bold text-red-900 dark:text-red-200">
              Firmware Update In Progress — DO NOT Disconnect!
            </p>
            <p className="text-sm text-red-700 dark:text-red-400">
              {message}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-red-700 dark:text-red-400">
            <span>{phase}</span>
            <span>{percent}%</span>
          </div>
          <div className="w-full bg-red-200 dark:bg-red-800 rounded-full h-3 overflow-hidden">
            <div
              className="bg-red-600 dark:bg-red-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Terminal (read-only during flash) -- fills remaining space */}
      <div className="flex-1 min-h-0">
        <TerminalDisplay
          lines={terminalLines}
          title="Firmware Flash"
          className="h-full"
          heightClass="flex-1 min-h-0"
          emptyText="Waiting for flash output..."
        />
      </div>
    </div>
  );
}
