'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export type SerialPortStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseSerialPortOptions {
  /** Baud rate for the serial connection (default: 115200) */
  baudRate?: number;
  /** Called for each complete line received from the serial port */
  onLine?: (line: string) => void;
  /** Called with raw Uint8Array chunks BEFORE line processing */
  onRawData?: (data: Uint8Array) => void;
  /** Called when the port disconnects (USB unplug, etc.) */
  onDisconnect?: () => void;
}

interface UseSerialPortReturn {
  /** Current connection status */
  status: SerialPortStatus;
  /** All received lines */
  lines: string[];
  /** Last error message, if any */
  error: string | null;
  /** The underlying SerialPort object (null if not connected) */
  port: SerialPort | null;
  /** Request and open a serial port */
  connect: () => Promise<void>;
  /** Close the serial port and clean up */
  disconnect: () => void;
  /** Write a string to the serial port (appends newline) */
  write: (data: string) => Promise<boolean>;
  /** Write raw data to the serial port (no newline) */
  writeRaw: (data: string) => Promise<boolean>;
  /** Write raw binary bytes to the serial port */
  writeBytes: (data: Uint8Array) => Promise<boolean>;
  /** Change baud rate (closes and reopens port) */
  changeBaudRate: (rate: number) => Promise<void>;
  /** Pause the read loop (e.g., before handing port to esptool) */
  pauseReader: () => Promise<void>;
  /** Resume the read loop after pause */
  resumeReader: () => void;
  /** Set DTR/RTS signals on the port */
  setSignals: (signals: SerialOutputSignals) => Promise<void>;
  /** Clear all captured lines */
  clearLines: () => void;
}

// Web Serial API signal type
interface SerialOutputSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
  break?: boolean;
}

export function useSerialPort({
  baudRate = 115200,
  onLine,
  onRawData,
  onDisconnect,
}: UseSerialPortOptions = {}): UseSerialPortReturn {
  const [status, setStatus] = useState<SerialPortStatus>('disconnected');
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onLineRef = useRef(onLine);
  const onRawDataRef = useRef(onRawData);
  const onDisconnectRef = useRef(onDisconnect);
  const pausedRef = useRef(false);
  const currentBaudRateRef = useRef(baudRate);

  // Keep callback refs current without triggering re-renders
  useEffect(() => { onLineRef.current = onLine; }, [onLine]);
  useEffect(() => { onRawDataRef.current = onRawData; }, [onRawData]);
  useEffect(() => { onDisconnectRef.current = onDisconnect; }, [onDisconnect]);

  const clearLines = useCallback(() => {
    setLines([]);
  }, []);

  const writeRaw = useCallback(async (data: string): Promise<boolean> => {
    if (!portRef.current?.writable) {
      console.error('[SerialPort] Port not writable');
      return false;
    }
    try {
      const writer = portRef.current.writable.getWriter();
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(data));
      writer.releaseLock();
      return true;
    } catch (err) {
      console.error('[SerialPort] Write error:', err);
      return false;
    }
  }, []);

  const write = useCallback(async (data: string): Promise<boolean> => {
    return writeRaw(data + '\n');
  }, [writeRaw]);

  const writeBytes = useCallback(async (data: Uint8Array): Promise<boolean> => {
    if (!portRef.current?.writable) return false;
    try {
      const writer = portRef.current.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
      return true;
    } catch (err) {
      console.error('[SerialPort] writeBytes error:', err);
      return false;
    }
  }, []);

  const setSignals = useCallback(async (signals: SerialOutputSignals): Promise<void> => {
    if (!portRef.current) {
      throw new Error('Serial port is not connected');
    }
    await portRef.current.setSignals(signals);
  }, []);

  const startReadLoop = useCallback(async () => {
    const port = portRef.current;
    if (!port?.readable) return;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const reader = port.readable.getReader();
    readerRef.current = reader;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!abortController.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;

        if (value) {
          // Call raw data handler BEFORE text processing
          onRawDataRef.current?.(value);

          const text = decoder.decode(value, { stream: true });
          buffer += text;

          // Process complete lines
          const parts = buffer.split('\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed) {
              setLines((prev) => [...prev, trimmed]);
              onLineRef.current?.(trimmed);
            }
          }
        }
      }
    } catch (err) {
      // Only report errors if we weren't intentionally aborted
      if (!abortController.signal.aborted) {
        console.error('[SerialPort] Read error:', err);
      }
    } finally {
      reader.releaseLock();
      readerRef.current = null;
      abortControllerRef.current = null;
    }
  }, []);

  const pauseReader = useCallback(async (): Promise<void> => {
    pausedRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (readerRef.current) {
      try { await readerRef.current.cancel(); } catch { /* ignore */ }
      readerRef.current = null;
    }
  }, []);

  const resumeReader = useCallback(() => {
    pausedRef.current = false;
    startReadLoop();
  }, [startReadLoop]);

  const changeBaudRate = useCallback(async (rate: number): Promise<void> => {
    if (!portRef.current) throw new Error('Port not connected');
    // Pause reader first
    await pauseReader();
    // Close the port
    await portRef.current.close();
    // Update baud rate ref
    currentBaudRateRef.current = rate;
    // Reopen at new baud rate
    await portRef.current.open({ baudRate: rate });
    // Resume reader
    resumeReader();
  }, [pauseReader, resumeReader]);

  const disconnect = useCallback(() => {
    setStatus('disconnected');

    // Cancel reader
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Close reader
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => { /* ignore */ });
      readerRef.current = null;
    }

    // Close port
    if (portRef.current) {
      portRef.current.close().catch(() => { /* ignore */ });
      portRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    // Check Web Serial API availability
    if (!('serial' in navigator)) {
      setError('Web Serial API is not available. Please use Chrome or Edge.');
      setStatus('error');
      return;
    }

    try {
      setStatus('connecting');
      setError(null);
      setLines([]);

      // Request port from user
      const port = await navigator.serial.requestPort();
      portRef.current = port;

      // Listen for USB disconnect
      port.addEventListener('disconnect', () => {
        setStatus('disconnected');
        portRef.current = null;
        onDisconnectRef.current?.();
      });

      // Open port
      await port.open({ baudRate });
      currentBaudRateRef.current = baudRate;
      setStatus('connected');

      // Start reading
      startReadLoop();
    } catch (err) {
      console.error('[SerialPort] Connection error:', err);
      disconnect();

      if (err instanceof DOMException && err.name === 'NotFoundError') {
        setError('No serial port selected.');
        setStatus('disconnected');
      } else if (err instanceof DOMException && err.name === 'SecurityError') {
        setError('Serial port access denied.');
        setStatus('error');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to connect to serial port.');
        setStatus('error');
      }
    }
  }, [baudRate, disconnect, startReadLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    lines,
    error,
    port: portRef.current,
    connect,
    disconnect,
    write,
    writeRaw,
    writeBytes,
    changeBaudRate,
    pauseReader,
    resumeReader,
    setSignals,
    clearLines,
  };
}
