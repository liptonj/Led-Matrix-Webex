'use client';

import { useEffect, useRef } from 'react';

export interface TerminalLine {
  text: string;
  /** 'device' = green, 'admin' = blue, 'system' = yellow */
  source?: 'device' | 'admin' | 'system';
  /** Override color for errors/warnings */
  level?: 'info' | 'warn' | 'error';
}

interface TerminalDisplayProps {
  /** Lines to display. Can be plain strings or TerminalLine objects */
  lines: (string | TerminalLine)[];
  /** Title shown in the terminal header (default: "Terminal") */
  title?: string;
  /** Optional React node rendered in the header's right side (e.g., status indicator) */
  statusSlot?: React.ReactNode;
  /** Show line numbers (default: true) */
  showLineNumbers?: boolean;
  /** Terminal height CSS class (default: "h-64") */
  heightClass?: string;
  /** Placeholder text when no lines (default: "Waiting for output...") */
  emptyText?: string;
}

function getLineColor(line: string | TerminalLine): string {
  if (typeof line === 'string') {
    return 'text-green-400 dark:text-green-300';
  }
  // Level overrides source color
  if (line.level === 'error') return 'text-red-400 dark:text-red-300';
  if (line.level === 'warn') return 'text-yellow-400 dark:text-yellow-300';
  // Source-based colors
  if (line.source === 'admin') return 'text-blue-400 dark:text-blue-300';
  if (line.source === 'system') return 'text-yellow-400 dark:text-yellow-300';
  return 'text-green-400 dark:text-green-300';
}

function getLineText(line: string | TerminalLine): string {
  return typeof line === 'string' ? line : line.text;
}

/**
 * Shared terminal display component with dark theme, monospace font,
 * auto-scroll, and optional line numbers.
 *
 * Used by SerialMonitor (install flow) and RemoteTerminal (support flow).
 */
export function TerminalDisplay({
  lines,
  title = 'Terminal',
  statusSlot,
  showLineNumbers = true,
  heightClass = 'h-64',
  emptyText = 'Waiting for output...',
}: TerminalDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="bg-gray-900 dark:bg-black rounded-lg border border-gray-700 dark:border-gray-800 overflow-hidden">
      {/* Terminal Header */}
      <div className="bg-gray-800 dark:bg-gray-900 px-4 py-2 flex items-center gap-2 border-b border-gray-700 dark:border-gray-800">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <span className="text-xs text-gray-400 ml-2">{title}</span>
        {statusSlot && <div className="ml-auto">{statusSlot}</div>}
      </div>

      {/* Terminal Content */}
      <div
        ref={scrollRef}
        className={`p-4 font-mono text-sm ${heightClass} overflow-y-auto`}
        style={{
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        }}
      >
        {lines.length === 0 ? (
          <div className="text-gray-500 dark:text-gray-600">{emptyText}</div>
        ) : (
          lines.map((line, index) => (
            <div key={index} className="mb-1">
              {showLineNumbers && (
                <span className="text-gray-500 dark:text-gray-600 mr-2">
                  {String(index + 1).padStart(4, '0')}
                </span>
              )}
              <span className={getLineColor(line)}>{getLineText(line)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
