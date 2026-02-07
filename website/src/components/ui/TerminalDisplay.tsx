'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

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
  /**
   * Height class for the scrollable content area (default: "h-64").
   * For flex fill mode, use "flex-1 min-h-0" together with className="h-full".
   */
  heightClass?: string;
  /** Placeholder text when no lines (default: "Waiting for output...") */
  emptyText?: string;
  /** Initial auto-scroll state (default: true) */
  defaultAutoScroll?: boolean;
  /** Additional class names for the outermost container (e.g., "h-full" for flex fill) */
  className?: string;
}

/** Pixel threshold to consider "at the bottom" */
const SCROLL_THRESHOLD = 24;

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
 * Returns true when the scroll container is at (or very near) the bottom.
 */
function isScrolledToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD;
}

/**
 * Shared terminal display component with dark theme, monospace font,
 * toggleable auto-scroll, and optional line numbers.
 *
 * Auto-scroll behaviour:
 *  - Enabled by default: terminal snaps to the latest output.
 *  - Scrolling up pauses auto-scroll automatically.
 *  - Scrolling back to the bottom re-enables auto-scroll.
 *  - A header toggle lets the user explicitly enable / disable auto-scroll.
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
  defaultAutoScroll = true,
  className,
}: TerminalDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(defaultAutoScroll);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Track whether the user is interacting (to distinguish programmatic scrolls)
  const isUserScrolling = useRef(false);

  // Exit fullscreen on Escape key
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFullscreen]);

  // Auto-scroll to bottom when new output arrives (if enabled)
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Detect manual scroll position to auto-pause / auto-resume
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !isUserScrolling.current) return;
    const atBottom = isScrolledToBottom(scrollRef.current);
    setAutoScroll(atBottom);
  }, []);

  // Mark user-initiated scroll events
  const handlePointerDown = useCallback(() => {
    isUserScrolling.current = true;
  }, []);
  const handlePointerUp = useCallback(() => {
    isUserScrolling.current = false;
  }, []);
  const handleWheel = useCallback(() => {
    isUserScrolling.current = true;
    // Reset after a short debounce so programmatic scrolls aren't misidentified
    requestAnimationFrame(() => {
      isUserScrolling.current = false;
    });
  }, []);

  // Jump to bottom and re-enable auto-scroll
  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // When fullscreen, override the container to fill the entire viewport
  const containerClasses = isFullscreen
    ? 'fixed inset-0 z-50 bg-gray-900 dark:bg-black flex flex-col'
    : `bg-gray-900 dark:bg-black rounded-lg border border-gray-700 dark:border-gray-800 overflow-hidden flex flex-col${className ? ` ${className}` : ''}`;

  // In fullscreen mode the content area should fill all remaining space
  const effectiveHeightClass = isFullscreen ? 'flex-1 min-h-0' : heightClass;

  return (
    <div className={containerClasses}>
      {/* Terminal Header */}
      <div className="shrink-0 bg-gray-800 dark:bg-gray-900 px-4 py-2 flex items-center gap-2 border-b border-gray-700 dark:border-gray-800">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          />
        </div>
        <span className="text-xs text-gray-400 ml-2">
          {title}
          {isFullscreen && (
            <span className="ml-2 text-gray-500 text-[10px]">(Esc to exit)</span>
          )}
        </span>

        {/* Auto-scroll toggle */}
        <button
          type="button"
          onClick={() => (autoScroll ? setAutoScroll(false) : scrollToBottom())}
          className={`ml-2 px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
            autoScroll
              ? 'bg-green-700/40 text-green-300 hover:bg-green-700/60'
              : 'bg-gray-700/60 text-gray-400 hover:bg-gray-700/80'
          }`}
          title={autoScroll ? 'Auto-scroll is ON – click to pause' : 'Auto-scroll is OFF – click to resume'}
          aria-pressed={autoScroll}
        >
          {autoScroll ? '⬇ Auto-scroll' : '⏸ Paused'}
        </button>

        {statusSlot && <div className="ml-auto">{statusSlot}</div>}
      </div>

      {/* Terminal Content -- relative wrapper for the scroll-to-bottom FAB */}
      <div className={`${effectiveHeightClass} relative`}>
        <div
          ref={scrollRef}
          className="absolute inset-0 p-4 font-mono text-sm overflow-y-auto"
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          }}
          onScroll={handleScroll}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
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

        {/* Scroll-to-bottom FAB (shown when auto-scroll is off and there are lines) */}
        {!autoScroll && lines.length > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 z-10 p-1.5 rounded-full bg-gray-700/80 text-gray-300 hover:bg-gray-600 shadow-lg transition-colors"
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
