'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSupportChannel } from './useSupportChannel';
import {
  joinSupportSession,
  closeSupportSession,
  revertSessionToWaiting,
} from '@/lib/supabase/supportSessions';
import { getSession } from '@/lib/supabase/auth';
import type {
  TerminalLine,
  ActionType,
  BridgeHealth,
  FlashProgressEvent,
} from '@/types/support';

/** Max lines to keep in the terminal buffer */
const MAX_TERMINAL_LINES = 1000;

/** Time without heartbeat before marking bridge as degraded (ms) */
const HEARTBEAT_DEGRADED_MS = 10000;

/** Time without heartbeat before marking bridge as disconnected (ms) */
const HEARTBEAT_DISCONNECTED_MS = 15000;

/** LocalStorage key for command history */
const COMMAND_HISTORY_KEY = 'support-console-command-history';

/** Max commands to persist in history */
const MAX_HISTORY = 100;

interface UseRemoteConsoleOptions {
  /** Session ID to join and subscribe to */
  sessionId: string | null;
  /** Callback invoked when the session is ended by the remote user (via session_end broadcast) */
  onSessionEnded?: () => void;
}

interface UseRemoteConsoleReturn {
  /** Terminal lines for display */
  terminalLines: TerminalLine[];
  /** Whether the admin has joined the session */
  isJoined: boolean;
  /** Whether the channel is connected */
  isConnected: boolean;
  /** Bridge health status (from heartbeat monitoring) */
  bridgeHealth: BridgeHealth;
  /** Flash progress (if a flash is in progress) */
  flashProgress: FlashProgressEvent | null;
  /** Command history for the input */
  commandHistory: string[];
  /** Channel error, if any */
  channelError: string | null;
  /** Join error, if any */
  joinError: string | null;
  /** Join the support session */
  join: () => Promise<boolean>;
  /** Send a serial command to the device */
  sendCommand: (text: string) => void;
  /** Send an action command (reset, bootloader, flash, etc.) */
  sendAction: (type: ActionType, manifestUrl?: string) => void;
  /** End the support session */
  endSession: (reason?: string) => Promise<void>;
  /** Leave the session (revert to waiting so another admin can join) */
  leaveSession: () => Promise<void>;
  /** Clear the terminal output */
  clearTerminal: () => void;
}

function loadCommandHistory(): string[] {
  try {
    const stored = localStorage.getItem(COMMAND_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveCommandHistory(history: string[]): void {
  try {
    localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Admin-side hook for the remote support console.
 *
 * Manages channel subscription, terminal buffer, command sending,
 * flash progress tracking, command history, and bridge health monitoring.
 */
export function useRemoteConsole({
  sessionId,
  onSessionEnded,
}: UseRemoteConsoleOptions): UseRemoteConsoleReturn {
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [bridgeHealth, setBridgeHealth] = useState<BridgeHealth>('unknown');
  const [flashProgress, setFlashProgress] = useState<FlashProgressEvent | null>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>(loadCommandHistory);
  const [joinError, setJoinError] = useState<string | null>(null);

  const lastHeartbeatRef = useRef<number>(0);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joiningRef = useRef(false);

  // Add a line to the terminal buffer (with limit)
  const addLine = useCallback((text: string, source: TerminalLine['source'], level?: TerminalLine['level']) => {
    setTerminalLines((prev) => {
      const next = [...prev, { text, source, level, timestamp: Date.now() }];
      return next.length > MAX_TERMINAL_LINES ? next.slice(-MAX_TERMINAL_LINES) : next;
    });
  }, []);

  // Channel event handlers
  const handleSerialOutput = useCallback((payload: Record<string, unknown>) => {
    const text = payload.text as string;
    if (text) {
      addLine(text, 'device');
    }
  }, [addLine]);

  const handleFlashProgress = useCallback((payload: Record<string, unknown>) => {
    const progress = payload as unknown as FlashProgressEvent;
    setFlashProgress(progress);
    addLine(`[Flash] ${progress.phase}: ${progress.message} (${progress.percent}%)`, 'system');
  }, [addLine]);

  const handleDeviceInfo = useCallback((payload: Record<string, unknown>) => {
    const chip = payload.chip as string;
    const serial = payload.serial as string | undefined;
    const firmware = payload.firmware as string | undefined;
    addLine(
      `Device detected: ${chip}${serial ? ` (${serial})` : ''}${firmware ? ` fw:${firmware}` : ''}`,
      'system',
    );
  }, [addLine]);

  const handleActionResult = useCallback((payload: Record<string, unknown>) => {
    const action = payload.action as string;
    const success = payload.success as boolean;
    const error = payload.error as string | undefined;
    if (success) {
      addLine(`Action '${action}' completed successfully`, 'system');
    } else {
      addLine(`Action '${action}' failed: ${error || 'unknown error'}`, 'system', 'error');
    }
  }, [addLine]);

  const handleHeartbeat = useCallback((payload: Record<string, unknown>) => {
    const connected = payload.connected as boolean;
    lastHeartbeatRef.current = Date.now();
    setBridgeHealth(connected ? 'healthy' : 'degraded');
  }, []);

  // Handle session_end broadcast from user side
  const handleSessionEnd = useCallback((payload: Record<string, unknown>) => {
    const reason = (payload.reason as string) || 'user_ended';
    addLine(`Session ended by user: ${reason}`, 'system');
    setIsJoined(false);
    setBridgeHealth('unknown');
    onSessionEnded?.();
  }, [addLine, onSessionEnded]);

  const eventHandlers = useMemo(() => ({
    serial_output: handleSerialOutput,
    flash_progress: handleFlashProgress,
    device_info: handleDeviceInfo,
    action_result: handleActionResult,
    heartbeat: handleHeartbeat,
    session_end: handleSessionEnd,
  }), [handleSerialOutput, handleFlashProgress, handleDeviceInfo, handleActionResult, handleHeartbeat, handleSessionEnd]);

  // Channel subscription
  const channel = useSupportChannel({
    sessionId: isJoined ? sessionId : null,
    eventHandlers,
  });

  // Reset join state when sessionId changes so a fresh attempt can be made
  useEffect(() => {
    setIsJoined(false);
    setJoinError(null);
    joiningRef.current = false;
  }, [sessionId]);

  // Bridge health monitoring (check heartbeat timeout)
  useEffect(() => {
    if (!isJoined || !channel.isConnected) {
      if (healthCheckRef.current) {
        clearInterval(healthCheckRef.current);
        healthCheckRef.current = null;
      }
      return;
    }

    healthCheckRef.current = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeatRef.current;
      if (lastHeartbeatRef.current === 0) {
        setBridgeHealth('unknown');
      } else if (elapsed > HEARTBEAT_DISCONNECTED_MS) {
        setBridgeHealth('disconnected');
      } else if (elapsed > HEARTBEAT_DEGRADED_MS) {
        setBridgeHealth('degraded');
      } else {
        setBridgeHealth('healthy');
      }
    }, 3000);

    return () => {
      if (healthCheckRef.current) {
        clearInterval(healthCheckRef.current);
        healthCheckRef.current = null;
      }
    };
  }, [isJoined, channel.isConnected]);

  // Join session
  const join = useCallback(async (): Promise<boolean> => {
    if (!sessionId || joiningRef.current) return false;
    joiningRef.current = true;

    try {
      setJoinError(null);
      const { data: { session: authSession } } = await getSession();
      if (!authSession) {
        setJoinError('Not authenticated');
        return false;
      }

      await joinSupportSession(sessionId, authSession.user.id);
      setIsJoined(true);
      lastHeartbeatRef.current = 0;
      setBridgeHealth('unknown');
      addLine('Joined support session', 'system');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to join session';
      setJoinError(message);
      addLine(`Failed to join session: ${message}`, 'system', 'error');
      return false;
    } finally {
      joiningRef.current = false;
    }
  }, [sessionId, addLine]);

  // Send serial command
  const sendCommand = useCallback((text: string) => {
    if (!text.trim()) return;

    channel.send('serial_input', { text: text.trim() });
    addLine(`> ${text.trim()}`, 'admin');

    // Update command history
    setCommandHistory((prev) => {
      const next = [...prev.filter((cmd) => cmd !== text.trim()), text.trim()];
      saveCommandHistory(next);
      return next;
    });
  }, [channel, addLine]);

  // Send action
  const sendAction = useCallback((type: ActionType, manifestUrl?: string) => {
    const payload: Record<string, unknown> = { type };
    if (manifestUrl) payload.manifestUrl = manifestUrl;

    channel.send('action', payload);
    addLine(`Sending action: ${type}${manifestUrl ? ` (${manifestUrl})` : ''}`, 'system');
  }, [channel, addLine]);

  // End session
  const endSession = useCallback(async (reason = 'admin_ended') => {
    if (!sessionId) return;

    channel.send('session_end', { reason });
    try {
      await closeSupportSession(sessionId, reason);
    } catch (err) {
      console.error('[useRemoteConsole] Close error:', err);
    }
    setIsJoined(false);
    addLine('Session ended', 'system');
  }, [sessionId, channel, addLine]);

  // Leave session (revert to waiting)
  const leaveSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      await revertSessionToWaiting(sessionId);
    } catch (err) {
      console.error('[useRemoteConsole] Leave error:', err);
    }
    setIsJoined(false);
    setBridgeHealth('unknown');
    addLine('Left support session (session returned to waiting)', 'system');
  }, [sessionId, addLine]);

  // Clear terminal
  const clearTerminal = useCallback(() => {
    setTerminalLines([]);
  }, []);

  // Cleanup: revert session to waiting when admin unmounts (closes tab)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isJoined && sessionId) {
        revertSessionToWaiting(sessionId).catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isJoined, sessionId]);

  return {
    terminalLines,
    isJoined,
    isConnected: channel.isConnected,
    bridgeHealth,
    flashProgress,
    commandHistory,
    channelError: channel.channelError,
    joinError,
    join,
    sendCommand,
    sendAction,
    endSession,
    leaveSession,
    clearTerminal,
  };
}
