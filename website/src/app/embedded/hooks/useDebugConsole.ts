'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG, MAX_ACTIVITY_LOG_ENTRIES, MAX_DEBUG_LOG_ENTRIES } from '../constants';
import type { ActivityLogEntry, DebugEntry, DebugLevel } from '../types';

export interface UseDebugConsoleResult {
  debugVisible: boolean;
  setDebugVisible: React.Dispatch<React.SetStateAction<boolean>>;
  debugLogs: DebugEntry[];
  clearDebugLogs: () => void;
  activityLog: ActivityLogEntry[];
  addLog: (message: string) => void;
  handleCopyDebug: () => Promise<void>;
  formatRelativeTime: (timestampMs: number | null) => string;
  appendDebugLog: (level: DebugLevel, message: string) => void;
}

export function useDebugConsole(): UseDebugConsoleResult {
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugEntry[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const originalConsoleRef = useRef<{ log: typeof console.log; info: typeof console.info; warn: typeof console.warn; error: typeof console.error; debug: typeof console.debug } | null>(null);

  useEffect(() => {
    const savedDebugVisible = localStorage.getItem(CONFIG.storageKeyDebugVisible);
    if (savedDebugVisible === 'true') setDebugVisible(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(CONFIG.storageKeyDebugVisible, debugVisible ? 'true' : 'false');
  }, [debugVisible]);

  const appendDebugLog = useCallback((level: DebugLevel, message: string) => {
    setDebugLogs((prev) => {
      const entry: DebugEntry = { time: new Date().toLocaleTimeString(), level, message };
      const next = [entry, ...prev];
      return next.length > MAX_DEBUG_LOG_ENTRIES ? next.slice(0, MAX_DEBUG_LOG_ENTRIES) : next;
    });
  }, []);

  const addLog = useCallback((message: string) => {
    appendDebugLog('activity', message);
    setActivityLog((prev) => {
      const entry: ActivityLogEntry = { time: new Date().toLocaleTimeString(), message };
      const next = [entry, ...prev];
      return next.length > MAX_ACTIVITY_LOG_ENTRIES ? next.slice(0, MAX_ACTIVITY_LOG_ENTRIES) : next;
    });
  }, [appendDebugLog]);

  const clearDebugLogs = useCallback(() => {
    setDebugLogs([]);
    addLog('Debug log cleared');
  }, [addLog]);

  const formatDebugValue = useCallback((value: unknown): string => {
    if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return String(value);
    try { return JSON.stringify(value); } catch { return String(value); }
  }, []);

  const formatDebugArgs = useCallback((args: unknown[]): string => args.map(formatDebugValue).join(' '), [formatDebugValue]);

  const handleCopyDebug = useCallback(async () => {
    if (!navigator.clipboard) { addLog('Clipboard not available'); return; }
    try {
      const payload = debugLogs.slice().reverse().map((entry) => `[${entry.time}] [${entry.level}] ${entry.message}`).join('\n');
      await navigator.clipboard.writeText(payload);
      addLog('Debug log copied to clipboard');
    } catch (error) { addLog(`Failed to copy debug log: ${error instanceof Error ? error.message : 'Unknown error'}`); }
  }, [debugLogs, addLog]);

  const formatRelativeTime = useCallback((timestampMs: number | null): string => {
    if (!timestampMs) return 'Never';
    const diff = Date.now() - timestampMs;
    if (diff < 1000) return 'Just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV === 'test') return;

    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    originalConsoleRef.current = original;

    const wrap = (level: Exclude<DebugLevel, 'activity'>) => (...args: unknown[]) => { original[level](...args); appendDebugLog(level, formatDebugArgs(args)); };
    console.log = wrap('log');
    console.info = wrap('info');
    console.warn = wrap('warn');
    console.error = wrap('error');
    console.debug = wrap('debug');

    const handleError = (event: ErrorEvent) => { appendDebugLog('error', `Window error: ${event.message} (${event.filename}:${event.lineno}:${event.colno})`); };
    const handleRejection = (event: PromiseRejectionEvent) => { appendDebugLog('error', `Unhandled rejection: ${formatDebugValue(event.reason)}`); };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [appendDebugLog, formatDebugArgs, formatDebugValue]);

  return { debugVisible, setDebugVisible, debugLogs, clearDebugLogs, activityLog, addLog, handleCopyDebug, formatRelativeTime, appendDebugLog };
}
