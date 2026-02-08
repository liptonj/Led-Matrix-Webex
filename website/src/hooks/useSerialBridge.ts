'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSerialPort } from './useSerialPort';
import { useEspFlash } from './useEspFlash';
import { useSupportSession } from './useSupportSession';
import { useSupportChannel } from './useSupportChannel';
import { resetDevice, enterBootloader } from '@/lib/serial/signals';
import type {
  TerminalLine,
  ActionEvent,
  SerialInputEvent,
  SessionEndEvent,
} from '@/types/support';

interface UseSerialBridgeReturn {
  /** Serial port state and controls */
  serialPort: ReturnType<typeof useSerialPort>;
  /** Flash state and controls */
  flash: ReturnType<typeof useEspFlash>;
  /** Session state and controls */
  session: ReturnType<typeof useSupportSession>;
  /** Channel connection state */
  channel: ReturnType<typeof useSupportChannel>;
  /** Terminal lines with source metadata (for display) */
  terminalLines: TerminalLine[];
  /** Connect device and create session in one action */
  startSupport: () => Promise<void>;
  /** End the support session and disconnect */
  endSupport: (reason?: string) => Promise<void>;
  /** Whether PIO shim bridge is connected */
  shimConnected: boolean;
}

/**
 * Orchestrator hook for the user side of the remote support console.
 *
 * Composes useSerialPort, useEspFlash, useSupportSession, and useSupportChannel
 * into a single interface. Contains NO serial port logic, NO flash logic,
 * NO session CRUD, NO channel management -- only the wiring between them.
 */
export function useSerialBridge(): UseSerialBridgeReturn {
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [shimConnected, setShimConnected] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelSendRef = useRef<((event: string, payload: Record<string, unknown>) => void) | null>(null);
  const shimConnectedRef = useRef(false);

  // Add a terminal line with metadata
  const addLine = useCallback((text: string, source: TerminalLine['source'], level?: TerminalLine['level']) => {
    setTerminalLines((prev) => [...prev, { text, source, level, timestamp: Date.now() }]);
  }, []);

  // Serial port -- relay lines to terminal and broadcast
  const handleSerialLine = useCallback((line: string) => {
    addLine(line, 'device');
    // Broadcast to admin if channel is available
    if (channelSendRef.current) {
      channelSendRef.current('serial_output', { text: line, ts: Date.now() });
    }
  }, [addLine]);

  const handleDisconnect = useCallback(() => {
    addLine('Device disconnected (USB unplugged)', 'system', 'warn');
  }, [addLine]);

  // Raw data handler - When shim is connected, broadcast raw bytes as base64
  const handleRawData = useCallback((data: Uint8Array) => {
    if (!shimConnectedRef.current || !channelSendRef.current) return;
    
    // Convert to base64
    const binary = new Uint8Array(data);
    let binaryStr = '';
    for (let i = 0; i < binary.length; i++) {
      binaryStr += String.fromCharCode(binary[i]!);
    }
    const b64 = btoa(binaryStr);
    
    channelSendRef.current('serial_output', { data: b64, binary: true, ts: Date.now() });
  }, []);

  const serialPort = useSerialPort({
    baudRate: 115200,
    onLine: handleSerialLine,
    onRawData: handleRawData,
    onDisconnect: handleDisconnect,
  });

  // Flash
  const flash = useEspFlash();

  // Session
  const supportSession = useSupportSession();

  // Channel event handlers (admin -> user)
  const handleSerialInput = useCallback(async (payload: Record<string, unknown>) => {
    if ((payload as any).binary) {
      // Binary mode: decode base64 and write raw bytes
      const b64 = (payload as any).data as string;
      const binaryStr = atob(b64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      await serialPort.writeBytes(bytes);
    } else {
      // Text mode: existing behavior
      const { text } = payload as unknown as SerialInputEvent;
      if (text) {
        addLine(`> ${text}`, 'admin');
        serialPort.write(text);
      }
    }
  }, [addLine, serialPort]);

  const handleAction = useCallback(async (payload: Record<string, unknown>) => {
    const action = payload as unknown as ActionEvent;
    const port = serialPort.port;

    if (!port) {
      addLine('Cannot execute action: device not connected', 'system', 'error');
      return;
    }

    if (!channelSendRef.current) {
      addLine('Cannot execute action: channel not connected', 'system', 'error');
      return;
    }

    try {
      switch (action.type) {
        case 'reset':
          addLine('Technician performing hardware reset...', 'system');
          await resetDevice(port);
          addLine('Device reset complete', 'system');
          channelSendRef.current('action_result', { action: 'reset', success: true });
          break;

        case 'bootloader':
          addLine('Technician entering bootloader mode...', 'system');
          await enterBootloader(port);
          addLine('Bootloader mode entered', 'system');
          channelSendRef.current('action_result', { action: 'bootloader', success: true });
          break;

        case 'flash':
          if (!action.manifestUrl) {
            addLine('Flash error: no manifest URL provided', 'system', 'error');
            return;
          }
          addLine('Firmware update starting...', 'system', 'warn');
          // Pause serial reader for exclusive port access
          await serialPort.pauseReader();
          try {
            await flash.startFlash(port, action.manifestUrl, (progress) => {
              if (channelSendRef.current) {
                channelSendRef.current('flash_progress', {
                  phase: progress.phase,
                  percent: progress.percent,
                  message: progress.message,
                });
              }
            });
            addLine('Firmware update complete!', 'system');
          } catch (err) {
            addLine(`Flash failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'system', 'error');
          } finally {
            // Resume serial reader
            serialPort.resumeReader();
          }
          break;

        case 'flash_abort':
          flash.abortFlash();
          addLine('Firmware update aborted', 'system', 'warn');
          break;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      addLine(`Action failed: ${errMsg}`, 'system', 'error');
      if (channelSendRef.current) {
        channelSendRef.current('action_result', { action: action.type, success: false, error: errMsg });
      }
    }
  }, [serialPort, flash, addLine]);

  const handleSessionEnd = useCallback((payload: Record<string, unknown>) => {
    const { reason } = payload as unknown as SessionEndEvent;
    addLine(`Session ended by technician: ${reason || 'no reason given'}`, 'system');
    supportSession.close(reason || 'admin_ended');
    serialPort.disconnect();
  }, [addLine, supportSession, serialPort]);

  const handleShimHello = useCallback((payload: Record<string, unknown>) => {
    setShimConnected(true);
    shimConnectedRef.current = true;
    addLine('PIO bridge connected', 'system');
  }, [addLine]);

  const handleSignal = useCallback(async (payload: Record<string, unknown>) => {
    const { dtr, rts } = payload as { dtr: boolean; rts: boolean };
    try {
      await serialPort.setSignals({
        dataTerminalReady: dtr,
        requestToSend: rts,
      });
    } catch (err) {
      console.error('[SerialBridge] Signal error:', err);
    }
  }, [serialPort]);

  const handleSetBaud = useCallback(async (payload: Record<string, unknown>) => {
    const { rate } = payload as { rate: number };
    try {
      await serialPort.changeBaudRate(rate);
      addLine(`Baud rate changed to ${rate}`, 'system');
      if (channelSendRef.current) {
        channelSendRef.current('baud_ack', { rate });
      }
    } catch (err) {
      addLine(`Baud rate change failed: ${err instanceof Error ? err.message : 'Unknown'}`, 'system', 'error');
    }
  }, [serialPort, addLine]);

  // Build event handlers map for the channel
  const eventHandlers = useMemo(() => ({
    serial_input: handleSerialInput,
    action: handleAction,
    session_end: handleSessionEnd,
    shim_hello: handleShimHello,
    signal: handleSignal,
    set_baud: handleSetBaud,
  }), [handleSerialInput, handleAction, handleSessionEnd, handleShimHello, handleSignal, handleSetBaud]);

  // Channel
  const channel = useSupportChannel({
    sessionId: supportSession.session?.id ?? null,
    eventHandlers,
  });

  // Keep channel.send ref current for use in callbacks
  useEffect(() => {
    channelSendRef.current = channel.send;
  }, [channel.send]);

  // Heartbeat: send every 5 seconds while connected
  useEffect(() => {
    if (!channel.isConnected || serialPort.status !== 'connected') {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }

    heartbeatRef.current = setInterval(() => {
      channel.send('heartbeat', {
        connected: serialPort.status === 'connected',
        ts: Date.now(),
      });
    }, 5000);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [channel.isConnected, channel.send, serialPort.status]);

  // Start support: connect device + create session
  const startSupport = useCallback(async () => {
    try {
      // Connect serial port first (needs user gesture)
      await serialPort.connect();
      addLine('Device connected', 'system');

      // Create session
      const newSession = await supportSession.create();
      if (newSession) {
        addLine(`Support session created: ${newSession.id.slice(0, 8)}...`, 'system');
      }
    } catch (err) {
      addLine(`Failed to start support: ${err instanceof Error ? err.message : 'Unknown error'}`, 'system', 'error');
    }
  }, [serialPort, supportSession, addLine]);

  // End support: notify admin, close session, disconnect serial
  const endSupport = useCallback(async (reason = 'user_ended') => {
    // Notify admin immediately via broadcast before closing
    if (channelSendRef.current) {
      channelSendRef.current('session_end', { reason });
    }
    await supportSession.close(reason);
    serialPort.disconnect();
    addLine('Support session ended', 'system');
  }, [supportSession, serialPort, addLine]);

  return {
    serialPort,
    flash,
    session: supportSession,
    channel,
    terminalLines,
    startSupport,
    endSupport,
    shimConnected,
  };
}
