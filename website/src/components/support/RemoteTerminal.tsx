'use client';

import { useState, useCallback, useRef } from 'react';
import { TerminalDisplay } from '@/components/ui/TerminalDisplay';
import type { TerminalLine, ActionType, BridgeHealth, FlashProgressEvent } from '@/types/support';

interface RemoteTerminalProps {
  lines: TerminalLine[];
  bridgeHealth: BridgeHealth;
  flashProgress: FlashProgressEvent | null;
  commandHistory: string[];
  onCommand: (text: string) => void;
  onAction: (type: ActionType, manifestUrl?: string) => void;
  onEndSession: () => void;
  onClear: () => void;
}

function BridgeHealthIndicator({ health }: { health: BridgeHealth }) {
  const colors: Record<BridgeHealth, string> = {
    unknown: 'bg-gray-400',
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    disconnected: 'bg-red-500',
  };
  const labels: Record<BridgeHealth, string> = {
    unknown: 'Connecting...',
    healthy: 'Bridge Connected',
    degraded: 'Bridge Slow',
    disconnected: 'Bridge Lost',
  };

  return (
    <span className="text-xs text-gray-400 flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${colors[health]}`} />
      {labels[health]}
    </span>
  );
}

/**
 * Admin remote terminal component.
 * Wraps TerminalDisplay with command input, action toolbar, and connection indicators.
 */
export function RemoteTerminal({
  lines,
  bridgeHealth,
  flashProgress,
  commandHistory,
  onCommand,
  onAction,
  onEndSession,
  onClear,
}: RemoteTerminalProps) {
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const isFlashing = flashProgress !== null && flashProgress.percent < 100;

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onCommand(input);
    setInput('');
    setHistoryIndex(-1);
  }, [input, onCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
      setHistoryIndex(newIndex);
      if (newIndex >= 0 && commandHistory.length > 0) {
        setInput(commandHistory[commandHistory.length - 1 - newIndex] ?? '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIndex = Math.max(historyIndex - 1, -1);
      setHistoryIndex(newIndex);
      if (newIndex >= 0) {
        setInput(commandHistory[commandHistory.length - 1 - newIndex] ?? '');
      } else {
        setInput('');
      }
    }
  }, [historyIndex, commandHistory]);

  return (
    <div className="flex flex-col h-full">
      {/* Action Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
        <button
          onClick={() => onAction('reset')}
          disabled={isFlashing}
          className="px-2.5 py-1 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors disabled:opacity-50"
          title="Hardware reset (DTR/RTS)"
        >
          Reset
        </button>
        <button
          onClick={() => onAction('bootloader')}
          disabled={isFlashing}
          className="px-2.5 py-1 text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 rounded hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors disabled:opacity-50"
          title="Enter bootloader mode"
        >
          Bootloader
        </button>
        <button
          onClick={() => onAction('flash')}
          disabled={isFlashing}
          className="px-2.5 py-1 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
          title="Flash firmware"
        >
          Flash Firmware
        </button>
        {isFlashing && (
          <button
            onClick={() => onAction('flash_abort')}
            className="px-2.5 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            Abort Flash
          </button>
        )}

        <div className="flex-1" />

        <BridgeHealthIndicator health={bridgeHealth} />

        <button
          onClick={onClear}
          className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
        >
          Clear
        </button>
        <button
          onClick={onEndSession}
          disabled={isFlashing}
          className="px-2.5 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
        >
          End Session
        </button>
      </div>

      {/* Flash Progress Bar (overlay) */}
      {isFlashing && flashProgress && (
        <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
          <div className="flex justify-between text-xs text-yellow-700 dark:text-yellow-400 mb-1">
            <span>{flashProgress.phase}: {flashProgress.message}</span>
            <span>{flashProgress.percent}%</span>
          </div>
          <div className="w-full bg-yellow-200 dark:bg-yellow-800 rounded-full h-1.5">
            <div
              className="bg-yellow-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${flashProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Terminal Display */}
      <div className="flex-1 min-h-0">
        <TerminalDisplay
          lines={lines}
          title="Remote Console"
          heightClass="h-full"
          emptyText="Waiting for device output..."
          statusSlot={<BridgeHealthIndicator health={bridgeHealth} />}
        />
      </div>

      {/* Command Input */}
      <form onSubmit={handleSubmit} className="flex border-t border-gray-700 dark:border-gray-800">
        <span className="flex items-center px-3 text-green-400 font-mono text-sm bg-gray-900 dark:bg-black">
          $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command and press Enter..."
          className="flex-1 px-3 py-2.5 bg-gray-900 dark:bg-black text-green-400 font-mono text-sm outline-none placeholder-gray-600"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="px-4 bg-gray-800 dark:bg-gray-900 text-gray-400 hover:text-white text-sm font-medium transition-colors border-l border-gray-700"
        >
          Send
        </button>
      </form>
    </div>
  );
}
